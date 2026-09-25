import type { RunLanguage } from "./paths";
import type { RunRequest, WorkerEvent } from "./protocol";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_OUTPUT_CHARS = 1_000_000;

export type RunEndReason = "exit" | "timeout" | "stopped" | "output-limit" | "crashed";

export interface RunEnd {
  code: number;
  reason: RunEndReason;
  /** Time spent running user code (excludes loading Python etc.). */
  timeMs: number;
}

export interface RunHandlers {
  onOutput: (stream: "stdout" | "stderr", text: string) => void;
  onStatus: (text: string) => void;
  onStarted: () => void;
  onEnd: (end: RunEnd) => void;
}

// Pyodide is slow to load, so its worker survives between runs. It's thrown
// away when a run is stopped or times out, since the only way to interrupt
// running Python is to terminate the worker.
let pythonWorker: Worker | null = null;

function createWorker(language: Exclude<RunLanguage, "html">): Worker {
  if (language === "python") {
    pythonWorker ??= new Worker(new URL("./pyWorker.ts", import.meta.url));
    return pythonWorker;
  }
  return new Worker(new URL("./jsWorker.ts", import.meta.url));
}

function disposeWorker(worker: Worker) {
  worker.terminate();
  if (worker === pythonWorker) pythonWorker = null;
}

/** Run a JS/TS/Python program in a worker. Returns a function that stops it. */
export function startRun(opts: {
  language: Exclude<RunLanguage, "html">;
  entry: string;
  files: Record<string, string>;
  timeoutMs?: number;
  handlers: RunHandlers;
}): () => void {
  const { language, entry, files, handlers, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const worker = createWorker(language);

  let startedAt = 0;
  let outputChars = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;

  const end = (code: number, reason: RunEndReason) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    worker.onmessage = null;
    worker.onerror = null;
    // Interrupted Python leaves the interpreter mid-run, so it can't be reused
    if (language !== "python" || reason !== "exit") disposeWorker(worker);
    handlers.onEnd({ code, reason, timeMs: startedAt ? Math.round(performance.now() - startedAt) : 0 });
  };

  worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
    const event = e.data;
    switch (event.type) {
      case "status":
        handlers.onStatus(event.text);
        break;
      case "started":
        startedAt = performance.now();
        timer = setTimeout(() => end(124, "timeout"), timeoutMs);
        handlers.onStarted();
        break;
      case "stdout":
      case "stderr":
        outputChars += event.text.length;
        if (outputChars > MAX_OUTPUT_CHARS) {
          end(1, "output-limit");
          return;
        }
        handlers.onOutput(event.type, event.text);
        break;
      case "exit":
        end(event.code, "exit");
        break;
    }
  };

  worker.onerror = (e: ErrorEvent) => {
    e.preventDefault();
    handlers.onOutput("stderr", `The runner failed to start: ${e.message || "unknown error"}\n`);
    end(1, "crashed");
  };

  const request: RunRequest = { type: "run", entry, files };
  worker.postMessage(request);

  return () => end(130, "stopped");
}
