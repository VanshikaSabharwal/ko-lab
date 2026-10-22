/**
 * Marker for chat lines the app generated rather than a person typing.
 *
 * Kept apart from memberEvents.ts, which pulls in Prisma — the chat UI is a
 * client component and can only import the pure helpers.
 */

/** Prefix marking a GroupMessage as system-generated. */
export const SYSTEM_MESSAGE_PREFIX = "__system__:";

/**
 * A membership event, stored as JSON after the prefix. Ids rather than a
 * finished sentence, so each reader sees it from their side: "You added Neelam"
 * for the actor, "Vanshika added you" for the new member.
 */
export interface MemberAddedEvent {
  type: "member_added";
  actorId: string;
  actorName: string;
  /** Null for a phone/email invite to someone without an account yet. */
  inviteeId: string | null;
  inviteeName: string;
}

/**
 * A group call's log line. One row per thing that happened, so the chat reads
 * as a history of the call: who started it, who came and went, how long it ran.
 */
export interface CallEvent {
  type: "call";
  action: "started" | "joined" | "left" | "ended";
  actorId: string;
  actorName: string;
  /** For "ended": how long the call ran. */
  durationMs?: number;
}

export function isSystemMessage(message: string): boolean {
  return message.startsWith(SYSTEM_MESSAGE_PREFIX);
}

export function callEventMessage(event: Omit<CallEvent, "type">): string {
  const payload: CallEvent = { type: "call", ...event };
  return `${SYSTEM_MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

/** True for a call log line, as opposed to a membership announcement. */
export function isCallEvent(message: string): boolean {
  return parseEvent(message.slice(SYSTEM_MESSAGE_PREFIX.length))?.type === "call";
}

/** "45 sec", "12 min", "1 hr 5 min". */
export function formatCallLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} hr ${rest} min` : `${Math.floor(minutes / 60)} hr`;
}

export function memberAddedMessage(event: Omit<MemberAddedEvent, "type">): string {
  const payload: MemberAddedEvent = { type: "member_added", ...event };
  return `${SYSTEM_MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

function parseEvent(body: string): MemberAddedEvent | CallEvent | null {
  if (!body.startsWith("{")) return null;
  try {
    const event = JSON.parse(body);
    return event?.type === "member_added" || event?.type === "call" ? event : null;
  } catch {
    return null;
  }
}

interface Viewer {
  /** The signed-in user reading the chat. */
  viewerId?: string | null;
  /** The message row's senderId — for system messages, who performed the action. */
  senderId?: string | null;
}

/**
 * The readable sentence for a system message, phrased for the viewer.
 *
 * Older rows are plain sentences with names only. For those, only the actor can
 * be recognised (from senderId); the added person is never guessed by name,
 * since two accounts can share a display name.
 */
export function systemMessageText(message: string, { viewerId, senderId }: Viewer = {}): string {
  const body = message.slice(SYSTEM_MESSAGE_PREFIX.length);
  const event = parseEvent(body);

  if (event?.type === "call") {
    const actor = viewerId && event.actorId === viewerId ? "You" : event.actorName;
    switch (event.action) {
      case "started":
        return `${actor} started a call`;
      case "joined":
        return `${actor} joined the call`;
      case "left":
        return `${actor} left the call`;
      case "ended":
        return event.durationMs !== undefined
          ? `Call ended · ${formatCallLength(event.durationMs)}`
          : "Call ended";
    }
  }

  if (event) {
    const actorIsViewer = !!viewerId && event.actorId === viewerId;
    const inviteeIsViewer = !!viewerId && event.inviteeId === viewerId;
    const actor = actorIsViewer ? "You" : event.actorName;

    // Joining through a link records the new member as their own actor
    if (event.inviteeId && event.inviteeId === event.actorId) return `${actor} joined the group`;
    if (inviteeIsViewer) return `${actor} added you to the group`;
    return `${actor} added ${event.inviteeName} to the group`;
  }

  const legacy = /^(.+?) added (.+) to the group$/.exec(body);
  if (legacy && viewerId && senderId === viewerId) return `You added ${legacy[2]} to the group`;
  return body;
}
