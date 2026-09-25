// Runs a JS/TS program in a dedicated worker: no DOM, no cookies, no access to
// the page. One worker per run; the page terminates it on exit, Stop or timeout.

import { transform, type Transform } from "sucrase";
import { dirname, extensionOf, isRelativeSpecifier, resolveJsImport } from "./paths";
import type { RunRequest, WorkerEvent } from "./protocol";

const scope = self as unknown as {
  postMessage: (event: WorkerEvent) => void;
  onmessage: ((e: MessageEvent<RunRequest>) => void) | null;
  addEventListener: (type: string, listener: (e: any) => void) => void;
  [key: string]: unknown;
};

const post = (event: WorkerEvent) => scope.postMessage(event);

// ── Value formatting (a small `util.inspect`) ────────────────────────────────

function formatValue(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
  if (value === null || value === undefined) return String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
  if (typeof value !== "object") return String(value);

  if (value instanceof Error) return cleanStack(value.stack || `${value.name}: ${value.message}`);
  if (seen.has(value)) return "[Circular]";
  if (depth > 3) return Array.isArray(value) ? "[Array]" : "[Object]";
  seen.add(value);

  const inner = (v: unknown) => formatValue(v, depth + 1, seen);
  if (Array.isArray(value)) return `[ ${value.map(inner).join(", ")} ]`;
  if (value instanceof Map) {
    return `Map(${value.size}) { ${[...value].map(([k, v]) => `${inner(k)} => ${inner(v)}`).join(", ")} }`;
  }
  if (value instanceof Set) return `Set(${value.size}) { ${[...value].map(inner).join(", ")} }`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Promise) return "Promise { <pending> }";

  const entries = Object.entries(value).map(([k, v]) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    return `${key}: ${inner(v)}`;
  });
  const name = value.constructor && value.constructor !== Object ? `${value.constructor.name} ` : "";
  return entries.length ? `${name}{ ${entries.join(", ")} }` : `${name}{}`;
}

// ── Error stacks ─────────────────────────────────────────────────────────────

let userFiles: Record<string, string> = {};

/**
 * Keep only frames in the user's files, with line numbers corrected: the
 * Function constructor wraps each module in two extra header lines.
 */
function cleanStack(stack: string): string {
  const lines = stack.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const frame = /^\s+at\s/.test(line);
    if (!frame) {
      kept.push(line);
      continue;
    }
    const fixed = line.replace(
      /([\w./@-]+\.(?:[mc]?[jt]sx?|json)):(\d+):(\d+)/g,
      (match, path: string, lineNo: string, col: string) =>
        path in userFiles ? `${path}:${Number(lineNo) - 2}:${col}` : match,
    );
    if (Object.keys(userFiles).some((p) => fixed.includes(`${p}:`))) kept.push(fixed);
  }
  return kept.join("\n");
}

// ── Program lifetime ─────────────────────────────────────────────────────────

let finished = false;
function finish(code: number) {
  if (finished) return;
  finished = true;
  post({ type: "exit", code });
}

class ExitSignal {
  constructor(readonly code: number) {}
}

function reportUncaught(error: unknown) {
  if (error instanceof ExitSignal) return finish(error.code);
  post({ type: "stderr", text: `Uncaught ${formatValue(error)}\n` });
  finish(1);
}

// Timers and fetches the program is still waiting on. When none are left the
// program is done, like Node exiting once its event loop is empty.
let pending = 0;
const liveTimers = new Set<unknown>();
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const realSetInterval = setInterval;
const realClearInterval = clearInterval;
const realFetch = fetch;

function guard(fn: unknown, args: unknown[]) {
  try {
    if (typeof fn === "function") fn(...args);
  } catch (error) {
    reportUncaught(error);
  }
}

scope.setTimeout = (fn: unknown, ms?: number, ...args: unknown[]) => {
  pending++;
  const id = realSetTimeout(() => {
    if (liveTimers.delete(id)) pending--;
    guard(fn, args);
  }, ms);
  liveTimers.add(id);
  return id;
};
scope.clearTimeout = (id: ReturnType<typeof setTimeout>) => {
  if (liveTimers.delete(id)) pending--;
  realClearTimeout(id);
};
scope.setInterval = (fn: unknown, ms?: number, ...args: unknown[]) => {
  pending++;
  const id = realSetInterval(() => guard(fn, args), ms);
  liveTimers.add(id);
  return id;
};
scope.clearInterval = (id: ReturnType<typeof setInterval>) => {
  if (liveTimers.delete(id)) pending--;
  realClearInterval(id);
};
scope.fetch = (...args: Parameters<typeof fetch>) => {
  pending++;
  return realFetch(...args).finally(() => pending--);
};

function exitWhenIdle() {
  if (finished) return;
  if (pending === 0) finish(0);
  else realSetTimeout(exitWhenIdle, 25);
}

// ── Console and process ──────────────────────────────────────────────────────

const write = (type: "stdout" | "stderr") => (...args: unknown[]) =>
  post({ type, text: `${args.map((a) => formatValue(a)).join(" ")}\n` });

scope.console = {
  ...console,
  log: write("stdout"),
  info: write("stdout"),
  debug: write("stdout"),
  trace: write("stdout"),
  dir: write("stdout"),
  table: write("stdout"),
  warn: write("stderr"),
  error: write("stderr"),
};

scope.addEventListener("error", (e: ErrorEvent) => {
  e.preventDefault();
  reportUncaught(e.error ?? e.message);
});
scope.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  e.preventDefault();
  reportUncaught(e.reason);
});

// ── Modules ──────────────────────────────────────────────────────────────────

const PACKAGE_HINT =
  "npm packages and Node built-ins aren't available to the Run button. " +
  "Open the Terminal tab to npm install and run the whole project.";

const moduleCache = new Map<string, { exports: unknown }>();

function compile(path: string, source: string): string {
  const ext = extensionOf(path);
  const transforms: Transform[] = ["imports"];
  if (["ts", "tsx", "mts", "cts"].includes(ext)) transforms.push("typescript");
  if (ext === "tsx" || ext === "jsx") transforms.push("jsx");
  // sucrase keeps line numbers stable, so stack traces still point at the source
  return transform(source, { transforms, filePath: path }).code;
}

function makeRequire(fromPath: string) {
  return (spec: string) => {
    if (!isRelativeSpecifier(spec)) {
      throw new Error(`Cannot load "${spec}": ${PACKAGE_HINT}`);
    }
    const resolved = resolveJsImport(fromPath, spec, (p) => p in userFiles);
    if (!resolved) throw new Error(`Cannot find module '${spec}' imported from ${fromPath}`);
    return loadModule(resolved).exports;
  };
}

function loadModule(path: string): { exports: unknown } {
  const cached = moduleCache.get(path);
  if (cached) return cached;

  const module = { exports: {} as unknown };
  moduleCache.set(path, module);
  const source = userFiles[path]!;

  if (extensionOf(path) === "json") {
    module.exports = JSON.parse(source);
    return module;
  }
  const body = `${compile(path, source)}\n//# sourceURL=${path}`;
  const fn = new Function("require", "module", "exports", "__filename", "__dirname", body);
  fn(makeRequire(path), module, module.exports, path, dirname(path));
  return module;
}

scope.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { entry, files } = e.data;
  userFiles = files;

  scope.process = {
    env: { NODE_ENV: "development" },
    argv: ["node", entry],
    platform: "browser",
    cwd: () => `/${dirname(entry)}`,
    nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
      queueMicrotask(() => guard(fn, args)),
    stdout: { write: (s: unknown) => (post({ type: "stdout", text: String(s) }), true) },
    stderr: { write: (s: unknown) => (post({ type: "stderr", text: String(s) }), true) },
    exit: (code = 0) => {
      throw new ExitSignal(code);
    },
  };

  post({ type: "started" });
  try {
    // The entry runs as an async function so top-level await works
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const body = `${compile(entry, files[entry]!)}\n//# sourceURL=${entry}`;
    const module = { exports: {} };
    moduleCache.set(entry, module);
    const run = new AsyncFunction("require", "module", "exports", "__filename", "__dirname", body);
    await run(makeRequire(entry), module, module.exports, entry, dirname(entry));
  } catch (error) {
    return reportUncaught(error);
  }
  // Let microtasks settle before checking whether anything is still pending
  realSetTimeout(exitWhenIdle, 0);
};
