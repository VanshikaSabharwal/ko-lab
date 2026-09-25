import { createHmac } from "crypto";

// Signs who a new call may ring. Verified by the WebSocket server
// (apps/web-socket/src/ringTicket.ts), which rings exactly these invitees —
// the client can no longer choose them. Signed under a "ring:" prefix so a
// ticket can't be mistaken for a socket token, which shares the secret.

const SECRET = process.env.WS_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
const DOMAIN = "ring:";
/**
 * The offer is sent only after the caller joins the LiveKit room, which waits
 * on the browser's camera/mic permission prompt — so this must outlast a slow
 * "Allow" click. A replay can only re-ring the same invitees for the same
 * caller and call, so a few minutes is harmless.
 */
const TTL_SECONDS = 300;

export interface RingTicketInput {
  callerId: string;
  callId: string;
  roomName: string;
  groupId: string | null;
  invitees: string[];
}

export function signRingTicket(input: RingTicketInput): string {
  if (!SECRET) {
    throw new Error("WS_AUTH_SECRET or NEXTAUTH_SECRET must be set to sign ring tickets");
  }
  const payload = Buffer.from(
    JSON.stringify({
      kind: "ring",
      ...input,
      exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(DOMAIN + payload).digest("base64url");
  return `${payload}.${sig}`;
}
