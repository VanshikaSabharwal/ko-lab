"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collectFiles } from "./deps";
import { buildPreviewDocument } from "./htmlPreview";
import { getRunLanguage, type RunLanguage } from "./paths";
import { startRun, type RunEnd } from "./runner";

export type OutputStream = "stdout" | "stderr" | "info";

export interface OutputChunk {
  stream: OutputStream;
  text: string;
}

export interface CodeRunState {
  phase: "idle" | "preparing" | "running" | "finished";
  entry: string | null;
  language: RunLanguage | null;
  chunks: OutputChunk[];
  /** Progress shown before user code starts ("Loading Python…"). */
  statusText: string | null;
  end: RunEnd | null;
  /** Set for HTML runs: the document shown in the preview iframe. */
  previewHtml: string | null;
}

const INITIAL: CodeRunState = {
  phase: "idle",
  entry: null,
  language: null,
  chunks: [],
  statusText: null,
  end: null,
  previewHtml: null,
};

export interface RunSource {
  entry: string;
  /** The entry file's current text, including unsaved edits. */
  entrySource: string;
  /** Whether a repo path exists (and isn't staged for deletion). */
  exists: (path: string) => boolean;
  /** A repo file's text, or null if it can't be read as text. */
  read: (path: string) => Promise<string | null>;
}

export function useCodeRunner() {
  const [state, setState] = useState<CodeRunState>(INITIAL);
  const stopRef = useRef<(() => void) | null>(null);
  // Bumped per run so late events from a replaced run are ignored
  const runIdRef = useRef(0);

  const appendOutput = useCallback((stream: OutputStream, text: string) => {
    setState((s) => {
      const last = s.chunks[s.chunks.length - 1];
      // Merge consecutive writes to one stream so a chatty program stays cheap to render
      const chunks =
        last && last.stream === stream
          ? [...s.chunks.slice(0, -1), { stream, text: last.text + text }]
          : [...s.chunks, { stream, text }];
      return { ...s, chunks };
    });
  }, []);

  const stop = useCallback(() => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
      return;
    }
    // Still gathering files: abandon the run before a worker is started
    runIdRef.current++;
    setState((s) =>
      s.phase === "preparing"
        ? { ...s, phase: "finished", statusText: null, end: { code: 130, reason: "stopped", timeMs: 0 } }
        : s,
    );
  }, []);

  const clear = useCallback(() => {
    setState((s) => ({ ...s, chunks: [] }));
  }, []);

  const reset = useCallback(() => {
    stop();
    setState(INITIAL);
  }, [stop]);

  const run = useCallback(
    async ({ entry, entrySource, exists, read }: RunSource) => {
      const language = getRunLanguage(entry);
      if (!language) return;

      stop();
      const runId = ++runIdRef.current;
      const current = () => runId === runIdRef.current;

      setState({
        ...INITIAL,
        phase: "preparing",
        entry,
        language,
        statusText: "Gathering files…",
      });

      const { files, missing, truncated } = await collectFiles({ entry, entrySource, exists, read });
      if (!current()) return;

      if (missing.length > 0) {
        appendOutput("info", `Couldn't load: ${missing.join(", ")}\n`);
      }
      if (truncated) {
        appendOutput("info", "Only the first 60 imported files were loaded.\n");
      }

      if (language === "html") {
        setState((s) => ({
          ...s,
          phase: "finished",
          statusText: null,
          previewHtml: buildPreviewDocument(entry, files),
          end: { code: 0, reason: "exit", timeMs: 0 },
        }));
        return;
      }

      stopRef.current = startRun({
        language,
        entry,
        files,
        handlers: {
          onStatus: (text) => current() && setState((s) => ({ ...s, statusText: text })),
          onStarted: () =>
            current() && setState((s) => ({ ...s, phase: "running", statusText: null })),
          onOutput: (stream, text) => current() && appendOutput(stream, text),
          onEnd: (end) => {
            if (!current()) return;
            stopRef.current = null;
            setState((s) => ({ ...s, phase: "finished", statusText: null, end }));
          },
        },
      });
    },
    [appendOutput, stop],
  );

  // Don't leave a worker running after the editor unmounts
  useEffect(() => stop, [stop]);

  return { state, run, stop, clear, reset, appendOutput };
}
