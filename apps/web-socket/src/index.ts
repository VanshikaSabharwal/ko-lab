import "dotenv/config";
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import Express from "express";
import { timingSafeEqual } from "crypto";
import { verifyWsToken } from "./wsToken";
import { verifyRingTicket } from "./ringTicket";
import { git } from "./gitRouter";

const app = Express();
const port = 8080;

// ── Allowed origins (set WS_ALLOWED_ORIGINS in your .env) ──────────────────
const ALLOWED_ORIGINS = process.env.WS_ALLOWED_ORIGINS
  ? process.env.WS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000"];

// ── Per-connection message rate limiting ────────────────────────────────────
const MAX_MESSAGES_PER_SECOND = 10;
const MAX_MESSAGE_SIZE_BYTES = 8_000; // 8KB per message
// Each tab opens 2–3 sockets, and an office or campus shares one IP.
const MAX_CONNECTIONS_PER_IP = 20;

// Track connection counts per IP to limit simultaneous connections
const ipConnectionCount = new Map<string, number>();

// ── Security middleware for Express ────────────────────────────────────────
app.disable("x-powered-by"); // Don't leak Express version
app.use(Express.json({ limit: "50kb" })); // Limit body size
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/ws",

  // Validate origin before the WebSocket handshake completes
  verifyClient: ({ origin, req }, callback) => {
    const clientIP =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    // ── Origin check (prevents WebSocket hijacking from other sites) ────────
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      console.warn(`🚫 Rejected WS connection from unauthorized origin: ${origin}`);
      callback(false, 403, "Forbidden");
      return;
    }

    // ── Per-IP connection limit ─────────────────────────────────────────────
    const currentCount = ipConnectionCount.get(clientIP) || 0;
    if (currentCount >= MAX_CONNECTIONS_PER_IP) {
      console.warn(`🚫 Too many connections from IP: ${clientIP}`);
      callback(false, 429, "Too Many Connections");
      return;
    }

    ipConnectionCount.set(clientIP, currentCount + 1);
    callback(true);
  },
});

// A room maps each user to ALL of their sockets in it. Holding one socket per
// user meant a second tab replaced the first, and closing any socket (e.g. the
// call socket reconnecting) dropped the user from the room entirely.
type Room = Map<string, Set<WebSocket>>;

const groupClients = new Map<string, Room>();
// Which group rooms each socket joined, so closing it removes only that socket.
const wsGroups = new Map<WebSocket, Set<string>>();

function joinRoom(rooms: Map<string, Room>, key: string, userId: string, ws: WebSocket) {
  let room = rooms.get(key);
  if (!room) rooms.set(key, (room = new Map()));
  let sockets = room.get(userId);
  if (!sockets) room.set(userId, (sockets = new Set()));
  sockets.add(ws);
}

function leaveRoom(rooms: Map<string, Room>, key: string, userId: string, ws: WebSocket) {
  const room = rooms.get(key);
  const sockets = room?.get(userId);
  if (!room || !sockets) return;
  sockets.delete(ws);
  if (sockets.size === 0) room.delete(userId);
  if (room.size === 0) rooms.delete(key);
}

/** Send to every socket in the room, skipping all of `exceptUserId`'s sockets. */
function broadcastToRoom(
  rooms: Map<string, Room>,
  key: string,
  payload: string,
  exceptUserId?: string,
) {
  const room = rooms.get(key);
  if (!room) return;
  for (const [memberId, sockets] of room) {
    if (memberId === exceptUserId) continue;
    for (const s of sockets) {
      if (s.readyState === WebSocket.OPEN) s.send(payload);
    }
  }
}

function joinGroupRoom(groupId: string, userId: string, ws: WebSocket) {
  joinRoom(groupClients, groupId, userId, ws);
  let joined = wsGroups.get(ws);
  if (!joined) wsGroups.set(ws, (joined = new Set()));
  joined.add(groupId);
}

function leaveGroupRoom(groupId: string, userId: string, ws: WebSocket) {
  leaveRoom(groupClients, groupId, userId, ws);
  wsGroups.get(ws)?.delete(groupId);
}

// A user can have several live sockets at once (call provider, group chat,
// editor, DM…). Track ALL of them so individually-targeted messages such as
// call_offer reach every tab/component, not just whichever connected last.
const individualClients = new Map<string, Set<WebSocket>>();

// Deliver an individually-targeted message to every open socket a user has.
// Returns true if at least one socket received it.
function sendToUser(userId: string, data: unknown): boolean {
  const sockets = individualClients.get(userId);
  if (!sockets || sockets.size === 0) return false;
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  let delivered = false;
  for (const s of sockets) {
    if (s.readyState === WebSocket.OPEN) {
      s.send(payload);
      delivered = true;
    }
  }
  return delivered;
}

// ── Workspace boards (mind map / planning / DB schema / UI design) ─────────
// Rooms are keyed `${groupId}:${boardType}`, mirroring groupClients above.
const WORKSPACE_BOARD_TYPES = new Set([
  "MIND_MAP",
  "PLANNING",
  "DB_SCHEMA",
  "UI_DESIGN",
]);
const workspaceClients = new Map<string, Room>();
const wsWorkspaceRoom = new Map<WebSocket, string>();

function workspaceRoomKey(groupId: string, board: string) {
  return `${groupId}:${board}`;
}

function broadcastWorkspacePresence(roomKey: string) {
  const members = workspaceClients.get(roomKey);
  if (!members) return;
  const outbound = JSON.stringify({
    type: "workspace_presence",
    userIds: Array.from(members.keys()),
  });
  broadcastToRoom(workspaceClients, roomKey, outbound);
}

// ── Call signaling helper ────────────────────────────────────────────────────
function handleCallSignal(
  ws: WebSocket,
  msg: any,
  senderId: string,
  allowedGroups: Set<string>,
) {
  switch (msg.type) {
    case "call_offer": {
      // Who gets rung comes only from the ticket the app signed when it
      // created the call (group roster, or a friend for 1:1) — never from the
      // client, which used to be able to ring any user id it liked.
      const ticket = verifyRingTicket(msg.ticket);
      if (!ticket || ticket.callerId !== senderId || ticket.callId !== msg.callId) {
        ws.send(JSON.stringify({
          type: "error",
          message: "Invalid or expired call ticket",
          callId: msg.callId,
        }));
        break;
      }

      const outbound = JSON.stringify({
        type: "call_offer",
        callId: ticket.callId,
        roomName: ticket.roomName,
        callerId: senderId,
        callerName: typeof msg.callerName === "string" ? msg.callerName.slice(0, 100) : "Unknown",
        callType: msg.callType,
        ...(ticket.groupId
          ? { groupId: ticket.groupId }
          : { targetId: ticket.invitees[0] }),
      });

      let delivered = false;
      for (const uid of ticket.invitees) {
        if (uid !== senderId && sendToUser(uid, outbound)) delivered = true;
      }

      if (!ticket.groupId) {
        ws.send(JSON.stringify(
          delivered
            ? { type: "call_offered", callId: ticket.callId }
            : { type: "error", message: "Recipient not connected", callId: ticket.callId },
        ));
      }
      break;
    }

    case "call_accepted": {
      sendToUser(msg.initiatorId, {
        type: "call_accepted",
        callId: msg.callId,
        roomName: msg.roomName,
        token: msg.token,
        participantId: senderId,
      });
      break;
    }

    case "call_rejected": {
      sendToUser(msg.initiatorId, {
        type: "call_rejected",
        callId: msg.callId,
        reason: msg.reason || "rejected",
      });
      break;
    }

    case "call_ended": {
      // Broadcast to all participants if groupId provided — members only, so
      // outsiders can't hang up a group's call
      if (msg.groupId && allowedGroups.has(msg.groupId)) {
        broadcastToRoom(
          groupClients,
          msg.groupId,
          JSON.stringify({ type: "call_ended", callId: msg.callId, endedBy: senderId }),
          senderId,
        );
      }
      // Also notify individual participant if targetId provided
      if (msg.targetId) {
        sendToUser(msg.targetId, {
          type: "call_ended",
          callId: msg.callId,
          endedBy: senderId,
        });
      }
      break;
    }

    case "call_missed": {
      sendToUser(msg.callerId, {
        type: "call_missed",
        callId: msg.callId,
        targetId: senderId,
      });
      break;
    }

    default:
      ws.send(JSON.stringify({ type: "error", message: "Unknown call signal type" }));
  }
}

// ── Server-side heartbeat (detects and removes zombie connections) ───────────
// Many proxies/load balancers kill idle TCP connections after 60s.
// Ping every 30s; terminate any client that doesn't pong back.
const wsIsAlive = new Map<WebSocket, boolean>();

const serverHeartbeat = setInterval(() => {
  wss.clients.forEach((client) => {
    if (!wsIsAlive.get(client)) {
      client.terminate();
      return;
    }
    wsIsAlive.set(client, false);
    client.ping();
  });
}, 30_000);

wss.on("close", () => clearInterval(serverHeartbeat));

wss.on("connection", (ws, req) => {
  const clientIP =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  // verifyClient counted this connection. Release it on close whatever the
  // reason — attached before the auth checks below, whose early closes used
  // to leak the count until that IP was locked out.
  ws.once("close", () => {
    const count = ipConnectionCount.get(clientIP) || 1;
    if (count <= 1) ipConnectionCount.delete(clientIP);
    else ipConnectionCount.set(clientIP, count - 1);
  });

  const urlParams = new URLSearchParams(req.url?.split("?")[1] || "");
  const groupId = urlParams.get("groupId");
  const board = urlParams.get("board");

  // ── Authentication: identity comes from a signed token, never from a
  //    client-chosen userId param (which anyone could spoof) ───────────────
  const token = urlParams.get("token");
  if (!token) {
    ws.close(1008, "Auth token required");
    return;
  }

  const claims = verifyWsToken(token);
  if (!claims) {
    ws.close(1008, "Invalid or expired auth token");
    return;
  }

  const userId = claims.sub;
  // Groups this token is allowed to join rooms for. The claim is signed by the
  // Next.js app, which is the only side with a database.
  const allowedGroups = new Set(claims.grp);

  // ── Basic userId validation (alphanumeric + hyphens only) ──────────────
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) {
    ws.close(1008, "Invalid userId format");
    return;
  }

  // Membership is authorized from the signed claim — a well-formed groupId is
  // not enough. Without this, any authenticated user could join any group's
  // room and receive its live traffic. Checked before the socket is registered
  // anywhere, since the cleanup handler isn't attached yet.
  const mayJoinGroup =
    !!groupId && /^[a-zA-Z0-9_-]{1,64}$/.test(groupId) && allowedGroups.has(groupId);

  if (groupId && !mayJoinGroup) {
    ws.close(1008, "Not a member of this group");
    return;
  }

  // Track liveness for heartbeat
  wsIsAlive.set(ws, true);
  ws.on("pong", () => wsIsAlive.set(ws, true));

  // Register this socket among the user's live connections (not overwrite)
  if (!individualClients.has(userId)) individualClients.set(userId, new Set());
  individualClients.get(userId)!.add(ws);

  if (mayJoinGroup) {
    joinGroupRoom(groupId!, userId, ws);
  }

  if (mayJoinGroup && board && WORKSPACE_BOARD_TYPES.has(board)) {
    const roomKey = workspaceRoomKey(groupId!, board);
    joinRoom(workspaceClients, roomKey, userId, ws);
    wsWorkspaceRoom.set(ws, roomKey);
    broadcastWorkspacePresence(roomKey);
  }

  ws.send(
    JSON.stringify({
      type: "connection_established",
      message: "Connected successfully",
      userId,
    }),
  );

  // ── Per-connection rate limiting ────────────────────────────────────────
  let messageCount = 0;
  const rateLimitWindow = setInterval(() => {
    messageCount = 0;
  }, 1000);

  ws.on("message", (rawMessage, isBinary) => {
    // Block binary frames
    if (isBinary) {
      ws.send(JSON.stringify({ type: "error", message: "Binary messages not supported" }));
      return;
    }

    // ── Message size check ────────────────────────────────────────────────
    const messageStr = rawMessage.toString();
    if (messageStr.length > MAX_MESSAGE_SIZE_BYTES) {
      ws.send(JSON.stringify({ type: "error", message: "Message too large" }));
      return;
    }

    // ── Rate limit per connection ─────────────────────────────────────────
    messageCount++;
    if (messageCount > MAX_MESSAGES_PER_SECOND) {
      ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded" }));
      return;
    }

    try {
      const parsedMessage = JSON.parse(messageStr);

      // ── Application-level ping (client keepalive) ─────────────────────
      if (parsedMessage.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // ── Read receipt: recipient tells sender messages were read ────────
      if (parsedMessage.type === "read_receipt") {
        sendToUser(parsedMessage.senderId, {
          type: "read_receipt",
          chatId: parsedMessage.chatId,
          readBy: userId,
        });
        return;
      }

      // ── Group context registration ────────────────────────────────────
      if (parsedMessage.type === "join_group" && parsedMessage.groupId) {
        const gId = parsedMessage.groupId;
        // Same membership check as the handshake — otherwise this message
        // would be a second door into any group's room.
        if (!allowedGroups.has(gId)) {
          ws.send(JSON.stringify({ type: "error", message: "Not a member of this group" }));
          return;
        }
        joinGroupRoom(gId, userId, ws);
        ws.send(JSON.stringify({ type: "joined_group", groupId: gId }));
        return;
      }

      if (parsedMessage.type === "leave_group" && parsedMessage.groupId) {
        // Only this socket leaves; the user's other tabs stay in the room
        leaveGroupRoom(parsedMessage.groupId, userId, ws);
        return;
      }

      // ── Workspace board operation broadcast ────────────────────────────
      if (parsedMessage.type === "workspace_op" && parsedMessage.groupId && parsedMessage.board) {
        const roomKey = workspaceRoomKey(parsedMessage.groupId, parsedMessage.board);
        const members = workspaceClients.get(roomKey);
        if (members?.has(userId)) {
          // userId lets receivers attribute a remote op to its author; without
          // it the richer planning board can't show who changed what.
          const outbound = JSON.stringify({
            type: "workspace_op",
            op: parsedMessage.op,
            userId,
          });
          broadcastToRoom(workspaceClients, roomKey, outbound, userId);
        }
        return;
      }

      // ── Call signaling ─────────────────────────────────────────────────
      // Chat messages carry no `type`; calling startsWith on undefined threw
      // and every chat message was answered with "Invalid JSON".
      if (typeof parsedMessage.type === "string" && parsedMessage.type.startsWith("call_")) {
        handleCallSignal(ws, parsedMessage, userId, allowedGroups);
        return;
      }

      // ── Validate required fields ──────────────────────────────────────
      if (typeof parsedMessage.content !== "string" || parsedMessage.content.trim() === "") {
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
        return;
      }

      // ── Sanitize content length ───────────────────────────────────────
      if (parsedMessage.content.length > 4000) {
        ws.send(JSON.stringify({ type: "error", message: "Message content too long" }));
        return;
      }

      // One-to-one messaging
      if (parsedMessage.recipientId) {
        const delivered = sendToUser(parsedMessage.recipientId, {
          chatId: parsedMessage.chatId,
          senderId: userId,
          recipientId: parsedMessage.recipientId,
          content: parsedMessage.content,
          timestamp: parsedMessage.timestamp || Date.now(),
        });
        if (delivered) {
          ws.send(
            JSON.stringify({
              type: "message_delivered",
              chatId: parsedMessage.chatId,
              timestamp: parsedMessage.timestamp,
            }),
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Recipient not connected",
            }),
          );
        }
        return;
      }

      // Group messaging — broadcast to all members of the group. Membership
      // is checked here as well as at join, or any signed-in user could post
      // into any group's live chat.
      if (parsedMessage.groupId) {
        if (!allowedGroups.has(parsedMessage.groupId)) {
          ws.send(JSON.stringify({ type: "error", message: "Not a member of this group" }));
          return;
        }
        const outbound = JSON.stringify({
          id: parsedMessage.id,
          senderId: userId,
          senderName: parsedMessage.senderName,
          groupId: parsedMessage.groupId,
          content: parsedMessage.content,
          createdAt: Date.now(),
        });
        // Skips every socket of the sender (their own tab shows it optimistically)
        broadcastToRoom(groupClients, parsedMessage.groupId, outbound, userId);
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    }
  });

  ws.on("close", () => {
    wsIsAlive.delete(ws);
    clearInterval(rateLimitWindow);

    // Remove just this socket from the user's set (they may have others open)
    const userSockets = individualClients.get(userId);
    if (userSockets) {
      userSockets.delete(ws);
      if (userSockets.size === 0) individualClients.delete(userId);
    }
    // Leave only the rooms THIS socket joined; the user's other sockets stay
    for (const gId of wsGroups.get(ws) ?? []) {
      leaveRoom(groupClients, gId, userId, ws);
    }
    wsGroups.delete(ws);

    const roomKey = wsWorkspaceRoom.get(ws);
    if (roomKey) {
      wsWorkspaceRoom.delete(ws);
      leaveRoom(workspaceClients, roomKey, userId, ws);
      // Presence only changes if that was the user's last socket in the room
      broadcastWorkspacePresence(roomKey);
    }
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error for ${userId}:`, error.message);
  });
});

// ── Git workspace service (service-to-service auth via bearer token) ──────────
app.use("/git", git);

// ── Internal push (service-to-service auth via bearer token) ─────────────────
// The Next.js app writes a notification row to Postgres, then calls this so the
// recipient's open socket hears about it immediately. Without it a notification
// only surfaced when the recipient next loaded the notifications page, which
// made delivery feel arbitrary rather than merely late.
//
// Fire-and-forget by design: the row is already committed, so a delivery
// failure here must not fail the originating request. A user with no open
// socket simply picks it up on their next fetch, exactly as before.
app.post("/internal/push", (req, res) => {
  const header = req.headers.authorization || "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(process.env.GIT_SERVICE_SECRET || "");
  if (
    expected.length === 0 ||
    given.length !== expected.length ||
    !timingSafeEqual(new Uint8Array(given), new Uint8Array(expected))
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { userIds, payload } = req.body ?? {};
  if (!Array.isArray(userIds) || userIds.length === 0 || !payload) {
    return res.status(400).json({ error: "userIds[] and payload required" });
  }

  let delivered = 0;
  for (const userId of userIds) {
    if (typeof userId === "string" && sendToUser(userId, payload)) delivered++;
  }
  res.json({ delivered });
});

// ── Health check (internal use only — protect this in production) ──────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    connectedClients: individualClients.size,
    activeGroups: groupClients.size,
  });
});

server.listen(port, () => {
  console.log(`🚀 WebSocket server running on port ${port}`);
});

export { wss, individualClients, groupClients, workspaceClients };
