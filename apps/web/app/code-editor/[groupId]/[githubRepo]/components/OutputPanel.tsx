"use client";

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Play, Square, Trash2, X } from "lucide-react";
import { cn } from "../../../../lib/utils";
import type { CodeRunState, OutputStream } from "../../../../lib/codeRunner/useCodeRunner";
import {
  PREVIEW_MESSAGE_TAG,
  PREVIEW_SANDBOX,
  openPreviewInNewTab,
  type PreviewConsoleMessage,
} from "../../../../lib/codeRunner/htmlPreview";
import { DEFAULT_TIMEOUT_MS, type RunEnd } from "../../../../lib/codeRunner/runner";

const HEIGHT_KEY = "ko-lab:output-panel-height";
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 240;

function readStoredHeight(): number {
  try {
    const stored = Number(localStorage.getItem(HEIGHT_KEY));
    return stored >= MIN_HEIGHT ? stored : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

function describeEnd(end: RunEnd): { text: string; tone: "ok" | "error" | "muted" } {
  switch (end.reason) {
    case "timeout":
      return { text: `Stopped: ran longer than ${DEFAULT_TIMEOUT_MS / 1000} s`, tone: "error" };
    case "stopped":
      return { text: "Stopped", tone: "muted" };
    case "output-limit":
      return { text: "Stopped: output limit (1 MB) reached", tone: "error" };
    case "crashed":
      return { text: "The runner crashed", tone: "error" };
    default:
      return end.code === 0
        ? { text: `Finished in ${end.timeMs} ms`, tone: "ok" }
        : { text: `Exited with code ${end.code}`, tone: "error" };
  }
}

const STREAM_CLASS: Record<OutputStream, string> = {
  stdout: "text-gray-100",
  stderr: "text-red-400",
  info: "italic text-gray-500",
};

interface OutputPanelProps {
  state: CodeRunState;
  onRunAgain: () => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
  /** Console output coming from the HTML preview iframe. */
  onPreviewConsole: (stream: OutputStream, text: string) => void;
}

export default function OutputPanel({
  state,
  onRunAgain,
  onStop,
  onClear,
  onClose,
  onPreviewConsole,
}: OutputPanelProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [tab, setTab] = useState<"output" | "preview">("output");
  const outputRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stickToBottom = useRef(true);

  const busy = state.phase === "preparing" || state.phase === "running";
  const hasPreview = state.previewHtml !== null;
  const entryName = state.entry?.split("/").pop() ?? "";

  useEffect(() => setHeight(readStoredHeight()), []);

  // HTML runs open on the preview; everything else on the output
  useEffect(() => {
    setTab(hasPreview ? "preview" : "output");
  }, [hasPreview, state.entry]);

  // Follow new output unless the user scrolled up to read something
  useEffect(() => {
    const el = outputRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [state.chunks]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data as PreviewConsoleMessage | undefined;
      if (!data?.[PREVIEW_MESSAGE_TAG]) return;
      const stream = data.level === "error" || data.level === "warn" ? "stderr" : "stdout";
      onPreviewConsole(stream, `${data.text}\n`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onPreviewConsole]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const max = Math.round(window.innerHeight * 0.7);
    let latest = startHeight;

    const onMove = (ev: PointerEvent) => {
      latest = Math.min(max, Math.max(MIN_HEIGHT, startHeight + (startY - ev.clientY)));
      setHeight(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(HEIGHT_KEY, String(latest));
      } catch {
        // Height just won't be remembered
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const endInfo = state.end ? describeEnd(state.end) : null;

  return (
    <div
      style={{ height }}
      className="relative flex shrink-0 flex-col border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
    >
      {/* Drag handle */}
      <div
        onPointerDown={startResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize output panel"
        className="absolute inset-x-0 -top-1 h-2 cursor-row-resize hover:bg-blue-500/40"
      />

      {/* Header */}
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1 text-xs dark:border-gray-800">
        {(["output", "preview"] as const)
          .filter((t) => t === "output" || hasPreview)
          .map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded px-2 py-1 font-medium capitalize transition-colors",
                tab === t
                  ? "bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200",
              )}
            >
              {t}
            </button>
          ))}

        {entryName && (
          <span className="ml-2 truncate text-gray-400" title={state.entry ?? undefined}>
            {entryName}
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {busy ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1 rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-500"
            >
              <Square size={11} className="fill-current" />
              Stop
            </button>
          ) : (
            state.entry && (
              <button
                onClick={onRunAgain}
                className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-500"
              >
                <Play size={11} className="fill-current" />
                Run again
              </button>
            )
          )}
          {hasPreview && (
            <button
              onClick={() => openPreviewInNewTab(state.previewHtml!, entryName)}
              title="Open preview in a new tab (only works in this browser)"
              className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button
            onClick={onClear}
            title="Clear output"
            className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={onClose}
            title="Close panel"
            className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      {tab === "preview" && hasPreview ? (
        <iframe
          ref={iframeRef}
          title="HTML preview"
          sandbox={PREVIEW_SANDBOX}
          srcDoc={state.previewHtml!}
          className="min-h-0 flex-1 bg-white"
        />
      ) : (
        <div
          ref={outputRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="min-h-0 flex-1 overflow-auto bg-gray-950 px-3 py-2 font-mono text-xs leading-relaxed"
        >
          {state.chunks.length === 0 && !busy && (
            <p className="text-gray-500">
              {state.entry
                ? hasPreview
                  ? "Console output from the page shows up here."
                  : "No output."
                : "Run a file to see its output here."}
            </p>
          )}
          <pre className="whitespace-pre-wrap break-words">
            {state.chunks.map((chunk, i) => (
              <span key={i} className={STREAM_CLASS[chunk.stream]}>
                {chunk.text}
              </span>
            ))}
          </pre>
          {state.statusText && (
            <p className="flex items-center gap-2 text-gray-400">
              <Loader2 size={12} className="animate-spin" />
              {state.statusText}
            </p>
          )}
          {state.phase === "running" && !state.statusText && (
            <p className="flex items-center gap-2 text-gray-500">
              <Loader2 size={12} className="animate-spin" />
              Running…
            </p>
          )}
        </div>
      )}

      {/* Result line */}
      {endInfo && !(hasPreview && tab === "preview") && (
        <div
          className={cn(
            "shrink-0 border-t border-gray-800 bg-gray-950 px-3 py-1 font-mono text-[11px]",
            endInfo.tone === "ok" && "text-emerald-400",
            endInfo.tone === "error" && "text-red-400",
            endInfo.tone === "muted" && "text-gray-500",
          )}
        >
          {endInfo.text}
        </div>
      )}
    </div>
  );
}
