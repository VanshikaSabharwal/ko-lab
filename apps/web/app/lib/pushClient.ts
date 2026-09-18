/**
 * Server-side bridge from the Next.js app to the WebSocket service.
 *
 * Notification rows are written to Postgres, but nothing told the recipient
 * they existed — the notifications page fetches once on mount, so a new
 * notification surfaced only when the recipient next navigated there. This
 * pushes the row over their open socket so it arrives immediately.
 *
 * Reuses GIT_SERVICE_URL / GIT_SERVICE_SECRET, the same service-to-service
 * pair the git workspace client uses; the socket service validates the bearer
 * token on /internal/push.
 */

const SERVICE = process.env.GIT_SERVICE_URL || "";
const SECRET = process.env.GIT_SERVICE_SECRET || "";

/** What the browser receives. `type` lets the client route it. */
export interface PushPayload {
  type: string;
  [key: string]: unknown;
}

/**
 * Deliver a payload to every open socket the given users have.
 *
 * Deliberately never throws. The database write that prompted this has already
 * committed, so a socket failure must not fail the caller's request — the
 * recipient still sees the notification on their next fetch. Callers may
 * omit `await` entirely.
 *
 * Returns how many users were reached, or 0 if delivery was not possible.
 */
export async function pushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<number> {
  const recipients = userIds.filter(Boolean);
  if (recipients.length === 0) return 0;

  if (!SERVICE || !SECRET) {
    // Not configured (e.g. a local run without the socket service). Silent by
    // design: notifications still persist and still render on next load.
    return 0;
  }

  try {
    const res = await fetch(`${SERVICE}/internal/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ userIds: recipients, payload }),
      // A slow socket service must not hold up the user's request.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { delivered?: number };
    return data.delivered ?? 0;
  } catch (error) {
    console.error("Failed to push over socket:", error);
    return 0;
  }
}
