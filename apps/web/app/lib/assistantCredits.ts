// Shared by the assistant API route and the chat UI, so it must stay free of
// server-only imports.

/** Messages a user can send in one assistant conversation. */
export const CREDITS_PER_CONVERSATION = 15;

export interface AssistantCredits {
  total: number;
  used: number;
  remaining: number;
}
