import "dotenv/config";
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import Express from "express";
import { timingSafeEqual } from "crypto";
import { verifyWsToken } from "./wsToken";
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
const MAX_CONNECTIONS_PER_IP = 5;

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

const groupClients = new Map<string, Map<string, WebSocket>>();
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
const workspaceClients = new Map<string, Map<string, WebSocket>>();
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
  for (const memberWs of members.values()) {
    if (memberWs.readyState === WebSocket.OPEN) memberWs.send(outbound);
  }
}

// ── Call signaling helper ────────────────────────────────────────────────────
function handleCallSignal(ws: WebSocket, msg: any, senderId: string) {
  switch (msg.type) {
    case "call_offer": {
      if (msg.groupId) {
        const outbound = JSON.stringify({
          type: "call_offer",
          callId: msg.callId,
          roomName: msg.roomName,
          callerId: senderId,
          callerName: msg.callerName,
          callType: msg.callType,
          groupId: msg.groupId,
        });

        // Ring the group's actual roster, which the caller resolved server-side
        // and sent as inviteeIds. groupClients only holds sockets that joined
        // the group chat room, so relying on it meant a group call silently
        // rang nobody unless every member happened to be on that page.
        const invitees: string[] = Array.isArray(msg.inviteeIds) ? msg.inviteeIds : [];
        const rung = new Set<string>();
        for (const uid of invitees) {
          if (typeof uid !== "string" || uid === senderId) continue;
          if (sendToUser(uid, outbound)) rung.add(uid);
        }

        // Anyone sitting in the group room who wasn't on the roster (or whose
        // id didn't arrive) still gets rung, so this can't regress the old path.
        const members = groupClients.get(msg.groupId);
        if (members) {
          for (const [mid, mws] of members) {
            if (mid === senderId || rung.has(mid)) continue;
            if (mws.readyState === WebSocket.OPEN) mws.send(outbound);
          }
        }
      } else if (msg.targetId) {
        // Route to every socket the recipient has open
        const delivered = sendToUser(msg.targetId, {
          type: "call_offer",
          callId: msg.callId,
          roomName: msg.roomName,
          callerId: senderId,
          callerName: msg.callerName,
          callType: msg.callType,
          targetId: msg.targetId,
        });
        if (delivered) {
          ws.send(JSON.stringify({ type: "call_offered", callId: msg.callId }));
        } else {
          ws.send(JSON.stringify({
            type: "error",
            message: "Recipient not connected",
            callId: msg.callId,
          }));
        }
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
      // Broadcast to all participants if groupId provided
      if (msg.groupId) {
        const members = groupClients.get(msg.groupId);
        if (members) {
          const outbound = JSON.stringify({
            type: "call_ended",
            callId: msg.callId,
            endedBy: senderId,
          });
          for (const [mid, mws] of members) {
            if (mid !== senderId && mws.readyState === WebSocket.OPEN) {
              mws.send(outbound);
            }
          }
        }
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

  // Track liveness for heartbeat
  wsIsAlive.set(ws, true);
  ws.on("pong", () => wsIsAlive.set(ws, true));

  // Register this socket among the user's live connections (not overwrite)
  if (!individualClients.has(userId)) individualClients.set(userId, new Set());
  individualClients.get(userId)!.add(ws);

  // Membership is authorized from the signed claim — a well-formed groupId is
  // not enough. Without this, any authenticated user could join any group's
  // room and receive its live traffic.
  const mayJoinGroup =
    !!groupId && /^[a-zA-Z0-9_-]{1,64}$/.test(groupId) && allowedGroups.has(groupId);

  if (groupId && !mayJoinGroup) {
    ws.close(1008, "Not a member of this group");
    return;
  }

  if (mayJoinGroup) {
    if (!groupClients.has(groupId!)) {
      groupClients.set(groupId!, new Map());
    }
    groupClients.get(groupId!)!.set(userId, ws);
  }

  if (mayJoinGroup && board && WORKSPACE_BOARD_TYPES.has(board)) {
    const roomKey = workspaceRoomKey(groupId!, board);
    if (!workspaceClients.has(roomKey)) {
      workspaceClients.set(roomKey, new Map());
    }
    workspaceClients.get(roomKey)!.set(userId, ws);
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
        if (!groupClients.has(gId)) {
          groupClients.set(gId, new Map());
        }
        groupClients.get(gId)!.set(userId, ws);
        ws.send(JSON.stringify({ type: "joined_group", groupId: gId }));
        return;
      }

      if (parsedMessage.type === "leave_group" && parsedMessage.groupId) {
        const gId = parsedMessage.groupId;
        const members = groupClients.get(gId);
        if (members) {
          members.delete(userId);
          if (members.size === 0) groupClients.delete(gId);
        }
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
          for (const [memberId, memberWs] of members) {
            if (memberId !== userId && memberWs.readyState === WebSocket.OPEN) {
              memberWs.send(outbound);
            }
          }
        }
        return;
      }

      // ── Call signaling ─────────────────────────────────────────────────
      if (parsedMessage.type.startsWith("call_")) {
        handleCallSignal(ws, parsedMessage, userId);
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

      // Group messaging — broadcast to all members of the group
      if (parsedMessage.groupId) {
        const members = groupClients.get(parsedMessage.groupId);
        if (members) {
          const outbound = JSON.stringify({
            id: parsedMessage.id,
            senderId: userId,
            senderName: parsedMessage.senderName,
            groupId: parsedMessage.groupId,
            content: parsedMessage.content,
            createdAt: Date.now(),
          });
          for (const [memberId, memberWs] of members.entries()) {
            if (memberId !== userId && memberWs.readyState === WebSocket.OPEN) {
              memberWs.send(outbound);
            }
          }
        }
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    }
  });

  ws.on("close", () => {
    wsIsAlive.delete(ws);

    // Decrement IP connection count
    const count = ipConnectionCount.get(clientIP) || 1;
    if (count <= 1) {
      ipConnectionCount.delete(clientIP);
    } else {
      ipConnectionCount.set(clientIP, count - 1);
    }

    clearInterval(rateLimitWindow);

    // Remove just this socket from the user's set (they may have others open)
    const userSockets = individualClients.get(userId);
    if (userSockets) {
      userSockets.delete(ws);
      if (userSockets.size === 0) individualClients.delete(userId);
    }
    for (const [gId, clients] of groupClients.entries()) {
      if (clients.has(userId)) {
        clients.delete(userId);
        if (clients.size === 0) groupClients.delete(gId);
      }
    }

    const roomKey = wsWorkspaceRoom.get(ws);
    if (roomKey) {
      wsWorkspaceRoom.delete(ws);
      const members = workspaceClients.get(roomKey);
      if (members) {
        members.delete(userId);
        if (members.size === 0) {
          workspaceClients.delete(roomKey);
        } else {
          broadcastWorkspacePresence(roomKey);
        }
      }
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
