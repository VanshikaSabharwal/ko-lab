"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  AUTO_UPDATE_SETTING_KEY,
  EXPIRY_WARNING_MINUTES,
  PRIVATE_PREVIEW_MINUTES,
  type LivePreviewState,
} from "../../../../lib/livePreviewConfig";

function readAutoUpdate(): boolean {
  try {
    return localStorage.getItem(AUTO_UPDATE_SETTING_KEY) === "1";
  } catch {
    return false;
  }
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

/**
 * "Make it live" state for the editor: the current preview, the actions on
 * it, the auto-update-on-save setting, and the expiry heads-up toasts.
 */
export function useLivePreview(groupId: string) {
  const [preview, setPreview] = useState<LivePreviewState | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [autoUpdate, setAutoUpdateState] = useState(false);

  useEffect(() => setAutoUpdateState(readAutoUpdate()), []);

  const setAutoUpdate = useCallback((on: boolean) => {
    setAutoUpdateState(on);
    try {
      localStorage.setItem(AUTO_UPDATE_SETTING_KEY, on ? "1" : "0");
    } catch {
      /* private mode: the setting lasts for this visit only */
    }
  }, []);

  useEffect(() => {
    if (!groupId) return;
    fetch(`/api/live-preview?groupId=${encodeURIComponent(groupId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPreview(d.preview))
      .catch(() => {});
  }, [groupId]);

  // Warn before the private link comes down, then tell the user it's gone.
  const privateExpiry = preview?.expiresAt;
  useEffect(() => {
    if (!privateExpiry) return;
    const msLeft = new Date(privateExpiry).getTime() - Date.now();
    if (msLeft <= 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const warnIn = msLeft - EXPIRY_WARNING_MINUTES * 60_000;
    if (warnIn > 0) {
      timers.push(
        setTimeout(() => {
          toast(
            `Your live site comes down in ${EXPIRY_WARNING_MINUTES} minutes. Click Make it live again to keep it up.`,
            { id: "live-preview-warning", icon: "⏳", duration: 10_000 },
          );
        }, warnIn),
      );
    }
    timers.push(
      setTimeout(() => {
        toast(
          `Your live site was taken down after ${PRIVATE_PREVIEW_MINUTES} minutes. Click Make it live to run it again.`,
          { id: "live-preview-expired", icon: "🔌", duration: 15_000 },
        );
        // Force a re-render so the control shows the expired state
        setPreview((p) => (p ? { ...p } : p));
      }, msLeft),
    );
    return () => timers.forEach(clearTimeout);
  }, [privateExpiry]);

  const makeLive = useCallback(
    async (branch: string, unsaved?: { path: string; content: string }) => {
      setDeploying(true);
      try {
        const res = await fetch("/api/live-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, branch, unsaved }),
        });
        if (!res.ok) throw new Error(await errorOf(res, "Couldn't make the site live"));
        const { preview: next } = await res.json();
        setPreview(next);
        toast.success(`Your site is live for ${PRIVATE_PREVIEW_MINUTES} minutes`);
        return next as LivePreviewState;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't make the site live", { duration: 8_000 });
        return null;
      } finally {
        setDeploying(false);
      }
    },
    [groupId],
  );

  const takeDown = useCallback(async () => {
    const res = await fetch(`/api/live-preview?groupId=${encodeURIComponent(groupId)}`, { method: "DELETE" });
    if (!res.ok) return void toast.error(await errorOf(res, "Couldn't take the site down"));
    setPreview(null);
    toast.success("Live site taken down");
  }, [groupId]);

  const share = useCallback(
    async (minutes: number) => {
      const res = await fetch("/api/live-preview/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, minutes }),
      });
      if (!res.ok) return void toast.error(await errorOf(res, "Couldn't create a share link"));
      const { preview: next } = await res.json();
      setPreview(next);
      try {
        await navigator.clipboard.writeText(next.shareUrl);
        toast.success("Share link copied");
      } catch {
        toast.success("Share link created");
      }
    },
    [groupId],
  );

  const stopSharing = useCallback(async () => {
    const res = await fetch(`/api/live-preview/share?groupId=${encodeURIComponent(groupId)}`, {
      method: "DELETE",
    });
    if (!res.ok) return void toast.error(await errorOf(res, "Couldn't stop sharing"));
    setPreview((await res.json()).preview);
    toast.success("Share link turned off");
  }, [groupId]);

  /** After a save: push the file to the live site if auto-update is on. */
  const syncSavedFile = useCallback(
    async (path: string, content: string) => {
      if (!autoUpdate || !preview) return;
      try {
        const res = await fetch("/api/live-preview", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, path, content }),
        });
        if (!res.ok) throw new Error();
        const { updated } = await res.json();
        if (updated) toast.success("Live site updated", { id: "live-preview-sync" });
      } catch {
        toast.error("Saved, but the live site didn't update. Click Make it live to redeploy.");
      }
    },
    [autoUpdate, preview, groupId],
  );

  return {
    preview,
    deploying,
    autoUpdate,
    setAutoUpdate,
    makeLive,
    takeDown,
    share,
    stopSharing,
    syncSavedFile,
  };
}

export type LivePreviewControls = ReturnType<typeof useLivePreview>;
