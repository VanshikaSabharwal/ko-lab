// Shared by the editor and the live-preview routes, so no server imports here.

/** How long the author's private "Make it live" link stays up. */
export const PRIVATE_PREVIEW_MINUTES = 30;

/** Lifetimes offered for a public share link, in minutes. */
export const SHARE_DURATIONS_MINUTES = [20, 30, 60, 120] as const;

/** Heads-up toast this long before the private link comes down. */
export const EXPIRY_WARNING_MINUTES = 5;

/** localStorage key for the editor's "update the live site on save" setting. */
export const AUTO_UPDATE_SETTING_KEY = "kolab:livePreview:autoUpdate";

export interface LivePreviewState {
  url: string;
  expiresAt: string;
  branch: string;
  rootDir: string;
  shareUrl: string | null;
  shareExpiresAt: string | null;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
