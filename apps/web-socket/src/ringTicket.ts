import { createHmac, timingSafeEqual } from "crypto";

// Verifies the "ring tickets" minted by the Next.js app
// (apps/web/app/lib/ringTicket.ts) when a call is created.
//
// A caller used to tell this server whom to ring (inviteeIds / targetId), so
// anyone could ring anyone. The app now decides who may be rung — group
// members for a group call, a friend for a 1:1 call — and signs that list.
// This server rings exactly the ticket's invitees and nobody else.
//
// Shares WS_AUTH_SECRET with wsToken.ts, so tickets are signed under a
// separate "ring:" prefix: a ticket can never pass as a socket token or the
// other way round.

const SECRET = process.env.WS_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
const DOMAIN = "ring:";

export interface RingTicket {
  callerId: string;
  callId: string;
  roomName: string;
  groupId: string | null;
  invitees: string[];
}

export function verifyRingTicket(ticket: unknown): RingTicket | null {
  if (!SECRET || typeof ticket !== "string") return null;
  const [payload, sig] = ticket.split(".");
  if (!payload || !sig) return null;

  const expected = new Uint8Array(createHmac("sha256", SECRET).update(DOMAIN + payload).digest());
  const given = new Uint8Array(Buffer.from(sig, "base64url"));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.kind !== "ring") return null;
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof data.callerId !== "string" || typeof data.callId !== "string") return null;
    if (typeof data.roomName !== "string" || !Array.isArray(data.invitees)) return null;
    return {
      callerId: data.callerId,
      callId: data.callId,
      roomName: data.roomName,
      groupId: typeof data.groupId === "string" ? data.groupId : null,
      invitees: data.invitees.filter((u: unknown): u is string => typeof u === "string"),
    };
  } catch {
    return null;
  }
}
