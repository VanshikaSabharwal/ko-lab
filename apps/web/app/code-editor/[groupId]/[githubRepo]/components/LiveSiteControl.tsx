"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  Power,
  RefreshCw,
  Rocket,
} from "lucide-react";
import toast from "react-hot-toast";
import { PRIVATE_PREVIEW_MINUTES, SHARE_DURATIONS_MINUTES, formatDuration } from "../../../../lib/livePreviewConfig";
import type { LivePreviewControls } from "../lib/useLivePreview";

interface LiveSiteControlProps {
  live: LivePreviewControls;
  branch: string;
  /** The open file's unsaved text, published instead of its saved version. */
  unsaved?: { path: string; content: string };
}

function timeLeft(iso: string | null | undefined, now: number): number {
  return iso ? Math.max(0, new Date(iso).getTime() - now) : 0;
}

function formatLeft(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
  return h ? `${h}:${mmss}` : mmss;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Couldn't copy. Your browser blocked clipboard access.");
  }
}

/**
 * Toolbar control for "Make it live": deploy the static site, see how long the
 * private link has left, share it publicly for a chosen time, or take it down.
 */
export default function LiveSiteControl({ live, branch, unsaved }: LiveSiteControlProps) {
  const { preview, deploying } = live;
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  const privateLeft = timeLeft(preview?.expiresAt, now);
  const shareLeft = timeLeft(preview?.shareExpiresAt, now);
  const isLive = privateLeft > 0;
  const isShared = !!preview?.shareUrl && shareLeft > 0;

  useEffect(() => {
    if (!isLive && !isShared) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive, isShared]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const deploy = async () => {
    setOpen(false);
    // Not opened automatically: a window.open after the await is popup-blocked
    if (await live.makeLive(branch, unsaved)) setNow(Date.now());
  };

  const item =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-gray-200 hover:bg-gray-700/70 disabled:opacity-50 disabled:hover:bg-transparent";

  if (!isLive && !isShared) {
    return (
      <button
        onClick={deploy}
        disabled={deploying || !branch}
        title={`Host this static site at a private link for ${PRIVATE_PREVIEW_MINUTES} minutes`}
        className="flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
      >
        {deploying ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
        {deploying ? "Going live…" : "Make it live"}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative flex min-w-0 items-center gap-1.5">
      {isLive ? (
        <a
          href={preview!.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-1.5 rounded bg-emerald-900/40 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-900/60"
          title={preview!.url}
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
          <span className="truncate">Live</span>
          <span className="tabular-nums text-emerald-400/80">{formatLeft(privateLeft)}</span>
          <ExternalLink size={12} className="shrink-0" />
        </a>
      ) : (
        <button
          onClick={deploy}
          disabled={deploying}
          className="flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {deploying ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
          {deploying ? "Going live…" : "Make it live"}
        </button>
      )}
      {isShared && (
        <span className="hidden items-center gap-1 rounded bg-sky-900/40 px-2 py-1.5 text-xs text-sky-300 sm:flex">
          <Link2 size={12} />
          Shared <span className="tabular-nums">{formatLeft(shareLeft)}</span>
        </span>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        title="Live site options"
        aria-label="Live site options"
      >
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-xl">
          {isLive && (
            <>
              <p className="px-3 pb-1.5 pt-1 text-[11px] leading-snug text-gray-400">
                Private link: only you can open it, signed in. It comes down in {formatLeft(privateLeft)}.
              </p>
              <button onClick={() => copy(preview!.url, "Link")} className={item}>
                <Copy size={14} className="shrink-0 text-gray-400" />
                Copy private link
              </button>
            </>
          )}
          <button onClick={deploy} disabled={deploying} className={item}>
            <RefreshCw size={14} className="shrink-0 text-gray-400" />
            {isLive ? `Redeploy (restarts the ${PRIVATE_PREVIEW_MINUTES}-min timer)` : "Make it live again"}
          </button>

          <div className="my-1 border-t border-gray-700" />
          <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {isShared ? `Public link · ${formatLeft(shareLeft)} left` : "Share a public link for"}
          </p>
          {isShared && (
            <button onClick={() => copy(preview!.shareUrl!, "Share link")} className={item}>
              <Copy size={14} className="shrink-0 text-gray-400" />
              <span className="truncate">Copy share link</span>
            </button>
          )}
          <div className="flex flex-wrap gap-1.5 px-3 py-1.5">
            {SHARE_DURATIONS_MINUTES.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setOpen(false);
                  live.share(m);
                }}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:border-sky-500 hover:text-sky-300"
                title={isShared ? `Keep the share link up for ${formatDuration(m)} from now` : undefined}
              >
                {formatDuration(m)}
              </button>
            ))}
          </div>
          {isShared && (
            <button
              onClick={() => {
                setOpen(false);
                live.stopSharing();
              }}
              className={item}
            >
              <Link2Off size={14} className="shrink-0 text-gray-400" />
              Stop sharing
            </button>
          )}

          <div className="my-1 border-t border-gray-700" />
          <button
            onClick={() => {
              setOpen(false);
              live.takeDown();
            }}
            className={`${item} text-red-300`}
          >
            <Power size={14} className="shrink-0" />
            Take down now
          </button>
        </div>
      )}
    </div>
  );
}
