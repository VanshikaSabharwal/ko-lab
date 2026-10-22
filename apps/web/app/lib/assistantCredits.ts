// Shared by the assistant API route and the chat UI, so it must stay free of
// server-only imports.

/** Messages a user can send to the assistant per day, across all their chats. */
export const DAILY_CREDITS = 15;

export interface AssistantCredits {
  total: number;
  used: number;
  remaining: number;
}
