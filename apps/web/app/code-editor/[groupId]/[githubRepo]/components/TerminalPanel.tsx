"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, PanelBottom, RefreshCw, SquareTerminal, X } from "lucide-react";
import type { Terminal } from "@xterm/xterm";
import type { WebContainerProcess } from "@webcontainer/api";
import "@xterm/xterm/css/xterm.css";
import {
  getWebContainer,
  loadProjectFiles,
  suggestedCommand,
  unsupportedReason,
} from "../lib/webContainer";

/** Set before the one-time reload that turns on cross-origin isolation. */
export const OPEN_TERMINAL_AFTER_RELOAD_KEY = "kolab:openTerminal";

const PREVIEW_SHARE_KEY = "kolab:terminalPreviewShare";
const DEFAULT_PREVIEW_SHARE = 0.5;
const MIN_PREVIEW_SHARE = 0.15;
const MAX_PREVIEW_SHARE = 0.85;

interface TerminalPanelProps {
  groupId: string;
  branch: string;
  /** Hidden panels stay mounted so the shell and its output survive tab switches. */
  active: boolean;
  /** True when the open file has unsaved edits a page reload would lose. */
  hasUnsavedChanges: boolean;
  fontSize: number;
  /** The editor theme's background and text colours. */
  background: string;
  foreground: string;
  /** Suggested instead of the command guessed from package.json; "" to guess. */
  startCommand: string;
}

type Phase = "idle" | "starting" | "ready" | "error";

interface Server {
  port: number;
  url: string;
}

export default function TerminalPanel({
  groupId,
  branch,
  active,
  hasUnsavedChanges,
  fontSize,
  background,
  foreground,
  startCommand,
}: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const shellRef = useRef<WebContainerProcess | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadedBranch, setLoadedBranch] = useState<string | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const [reloading, setReloading] = useState(false);

  // Checked after mount: the server render can't know, and guessing would
  // mismatch on hydration. undefined = not checked yet.
  const [unsupported, setUnsupported] = useState<string | null | undefined>(undefined);
  useEffect(() => setUnsupported(unsupportedReason()), []);

  const loadFiles = useCallback(
    async (term: Terminal) => {
      const loaded = await loadProjectFiles(groupId, branch, setStatus);
      const { paths } = loaded;
      setLoadedBranch(loaded.branch);
      const cmd = startCommand.trim() || (await suggestedCommand(paths));
      term.writeln(`\x1b[2mLoaded ${paths.length} files from ${loaded.branch} (with your saved drafts).\x1b[0m`);
      if (cmd) term.writeln(`\x1b[2mTry: \x1b[0m\x1b[36m${cmd}\x1b[0m`);
      term.writeln("");
    },
    [groupId, branch, startCommand],
  );

  // The terminal is created once, so a later change of size is applied to it
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    fitRef.current?.();
  }, [fontSize]);

  // Same for its colours, which follow the editor theme like the rest of the IDE
  const colorsRef = useRef({ background, foreground });
  colorsRef.current = { background, foreground };
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = { background, foreground, cursor: foreground };
  }, [background, foreground]);

  const start = useCallback(async () => {
    if (startedRef.current || !hostRef.current) return;
    startedRef.current = true;
    setPhase("starting");
    setError(null);
    try {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontSize: fontSizeRef.current,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        theme: { ...colorsRef.current, cursor: colorsRef.current.foreground },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();
      termRef.current = term;

      setStatus("Starting Node in your browser…");
      const wc = await getWebContainer();
      wc.on("server-ready", (port, url) => {
        setServers((s) => [...s.filter((x) => x.port !== port), { port, url }]);
        setPreviewPort((p) => p ?? port);
      });
      wc.on("port", (port, type) => {
        if (type === "close") {
          setServers((s) => s.filter((x) => x.port !== port));
          setPreviewPort((p) => (p === port ? null : p));
        }
      });

      await loadFiles(term);

      const shell = await wc.spawn("jsh", { terminal: { cols: term.cols, rows: term.rows } });
      shellRef.current = shell;
      shell.output.pipeTo(new WritableStream({ write: (data) => term.write(data) })).catch(() => {});
      const input = shell.input.getWriter();
      term.onData((data) => void input.write(data));

      fitRef.current = () => {
        fit.fit();
        shell.resize({ cols: term.cols, rows: term.rows });
      };
      setPhase("ready");
      setStatus("");
      term.focus();
    } catch (err) {
      startedRef.current = false;
      termRef.current?.dispose();
      termRef.current = null;
      setPhase("error");
      setError(err instanceof Error ? err.message : "The terminal couldn't start");
    }
  }, [loadFiles]);

  // Start the first time the tab is opened
  useEffect(() => {
    if (active && unsupported === null && phase === "idle") void start();
  }, [active, unsupported, phase, start]);

  // ── Terminal / preview split ──
  // Share of the height given to the preview; remembered in this browser.
  const splitRef = useRef<HTMLDivElement>(null);
  const [previewShare, setPreviewShare] = useState(DEFAULT_PREVIEW_SHARE);
  const [resizingPreview, setResizingPreview] = useState(false);
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(PREVIEW_SHARE_KEY));
      if (stored >= MIN_PREVIEW_SHARE && stored <= MAX_PREVIEW_SHARE) setPreviewShare(stored);
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);

  const savePreviewShare = (share: number) => {
    const clamped = Math.min(MAX_PREVIEW_SHARE, Math.max(MIN_PREVIEW_SHARE, share));
    setPreviewShare(clamped);
    try {
      localStorage.setItem(PREVIEW_SHARE_KEY, String(clamped));
    } catch {
      /* fine: applies for this visit */
    }
    return clamped;
  };

  const startPreviewResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = splitRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizingPreview(true);
    const handle = e.currentTarget;
    const onMove = (ev: PointerEvent) => {
      // The preview gets everything below the pointer
      const share = (box.bottom - ev.clientY) / box.height;
      setPreviewShare(Math.min(MAX_PREVIEW_SHARE, Math.max(MIN_PREVIEW_SHARE, share)));
    };
    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setResizingPreview(false);
      savePreviewShare((box.bottom - ev.clientY) / box.height);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  // Keep the terminal sized to its box (also when the tab becomes visible again)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      if (host.offsetWidth > 0) fitRef.current?.();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (active && phase === "ready") termRef.current?.focus();
  }, [active, phase]);

  const reloadFiles = async () => {
    const term = termRef.current;
    if (!term) return;
    setReloading(true);
    try {
      term.writeln("\r\n\x1b[2mReloading files (node_modules is kept)…\x1b[0m");
      await loadFiles(term);
    } catch (err) {
      term.writeln(`\x1b[31m${err instanceof Error ? err.message : "Couldn't reload files"}\x1b[0m`);
    } finally {
      setReloading(false);
      setStatus("");
    }
  };

  const enableIsolation = () => {
    if (hasUnsavedChanges && !window.confirm("Reloading the page discards your unsaved edits. Continue?")) return;
    try {
      sessionStorage.setItem(OPEN_TERMINAL_AFTER_RELOAD_KEY, "1");
    } catch {
      /* the Terminal tab just won't reopen by itself */
    }
    window.location.reload();
  };

  const preview = servers.find((s) => s.port === previewPort);

  return (
    <div className={active ? "flex min-h-0 min-w-0 flex-1 flex-col bg-gray-950" : "hidden"}>
      <div className="flex items-center gap-2 border-b border-gray-700/50 bg-gray-800/80 px-4 py-2 text-xs text-gray-300">
        <SquareTerminal size={14} className="text-gray-400" />
        <span className="font-medium">Terminal</span>
        {loadedBranch && <span className="text-gray-500">· {loadedBranch}</span>}
        {status && (
          <span className="flex items-center gap-1.5 text-gray-400">
            <Loader2 size={12} className="animate-spin" />
            {status}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {servers.map((s) => (
            <span key={s.port} className="flex items-center gap-1 rounded bg-emerald-900/40 px-2 py-1 text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              :{s.port}
              <button
                onClick={() => setPreviewPort((p) => (p === s.port ? null : s.port))}
                title={previewPort === s.port ? "Hide preview" : "Show preview"}
                className="ml-1 rounded p-0.5 hover:bg-emerald-800/60"
              >
                <PanelBottom size={12} />
              </button>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in a new tab (works in this browser while this tab stays open)"
                className="rounded p-0.5 hover:bg-emerald-800/60"
              >
                <ExternalLink size={12} />
              </a>
            </span>
          ))}
          {phase === "ready" && (
            <button
              onClick={reloadFiles}
              disabled={reloading}
              title={`Replace the files with ${branch} + your saved drafts`}
              className="flex items-center gap-1 rounded bg-gray-700 px-2.5 py-1 text-gray-100 hover:bg-gray-600 disabled:opacity-60"
            >
              <RefreshCw size={12} className={reloading ? "animate-spin" : undefined} />
              Reload files
            </button>
          )}
        </div>
      </div>

      {unsupported === "isolation" ? (
        <Notice title="The terminal needs a page reload">
          <p>
            It runs Node inside your browser, which needs this page to load with special security headers. The page
            you&apos;re on was opened without them.
          </p>
          <button
            onClick={enableIsolation}
            className="mt-4 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            Reload and open the terminal
          </button>
        </Notice>
      ) : unsupported ? (
        <Notice title="Terminal unavailable">{unsupported}</Notice>
      ) : phase === "error" ? (
        <Notice title="The terminal couldn't start">
          <p className="font-mono text-red-300">{error}</p>
          <button
            onClick={() => setPhase("idle")}
            className="mt-4 rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
          >
            Try again
          </button>
        </Notice>
      ) : null}

      <div
        ref={splitRef}
        className={`flex min-h-0 flex-1 flex-col ${unsupported || phase === "error" ? "hidden" : ""}`}
      >
        <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-2" />
        {preview && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize preview"
            title="Drag to resize · double-click to reset"
            onPointerDown={startPreviewResize}
            onDoubleClick={() => savePreviewShare(DEFAULT_PREVIEW_SHARE)}
            className="group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center border-t border-gray-700 bg-gray-800 hover:bg-blue-600/40"
          >
            <span className="h-0.5 w-10 rounded-full bg-gray-500 group-hover:bg-blue-300" />
          </div>
        )}
        {preview && (
          <div
            className="flex min-h-[80px] shrink-0 flex-col"
            style={{ height: `${Math.round(previewShare * 100)}%` }}
          >
            <div className="flex items-center gap-2 bg-gray-800 px-3 py-1 text-xs text-gray-400">
              <span className="truncate">localhost:{preview.port}</span>
              <button onClick={() => setPreviewPort(null)} className="ml-auto rounded p-0.5 hover:bg-gray-700" title="Hide preview">
                <X size={12} />
              </button>
            </div>
            <iframe
              key={preview.url}
              src={preview.url}
              title={`App on port ${preview.port}`}
              // While dragging, the iframe would swallow pointer moves and stall the drag
              className={`min-h-0 flex-1 bg-white ${resizingPreview ? "pointer-events-none" : ""}`}
              allow="cross-origin-isolated"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center text-sm text-gray-400">
        <h3 className="mb-2 text-base font-semibold text-gray-100">{title}</h3>
        {children}
      </div>
    </div>
  );
}
