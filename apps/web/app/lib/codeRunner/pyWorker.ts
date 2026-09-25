// Runs Python with Pyodide (CPython compiled to WebAssembly) in a worker.
// Pyodide takes a few seconds to load, so this worker is kept between runs and
// only replaced when a run is stopped or times out.

import { dirname } from "./paths";
import type { RunRequest, WorkerEvent } from "./protocol";

declare function importScripts(...urls: string[]): void;

const PYODIDE_VERSION = "0.26.4";
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
/** Each run's files are written under here, mirroring the repo layout. */
const ROOT = "/home/pyodide/ko-lab";

const scope = self as unknown as {
  postMessage: (event: WorkerEvent) => void;
  onmessage: ((e: MessageEvent<RunRequest>) => void) | null;
  loadPyodide: (opts: { indexURL: string }) => Promise<any>;
};

const post = (event: WorkerEvent) => scope.postMessage(event);

let pyodidePromise: Promise<any> | null = null;

function getPyodide(): Promise<any> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      importScripts(`${INDEX_URL}pyodide.js`);
      return scope.loadPyodide({ indexURL: INDEX_URL });
    })();
    // A failed download (offline, blocked) shouldn't poison later runs
    pyodidePromise.catch(() => {
      pyodidePromise = null;
    });
  }
  return pyodidePromise;
}

/**
 * Drop traceback frames from Pyodide's own machinery and shorten the user's
 * paths back to repo paths, so the traceback reads like one from `python`.
 */
function cleanTraceback(message: string): string {
  const lines = message.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const frame = /^\s*File "([^"]+)"/.exec(lines[i]!);
    if (frame && !frame[1]!.startsWith(ROOT)) {
      // Skip the frame plus the source and ^^^ marker lines printed under it
      while (lines[i + 1] && /^\s{4,}/.test(lines[i + 1]!) && !/^\s*File "/.test(lines[i + 1]!)) i++;
      continue;
    }
    out.push(lines[i]!.split(`${ROOT}/`).join(""));
  }
  return out.join("\n");
}

const pyString = (s: string) => JSON.stringify(s);

scope.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { entry, files } = e.data;

  let py: any;
  try {
    if (!pyodidePromise) post({ type: "status", text: "Loading Python… (first run only)" });
    py = await getPyodide();
  } catch {
    post({
      type: "stderr",
      text: "Couldn't load Python. Check your internet connection and try again.\n",
    });
    post({ type: "exit", code: 1 });
    return;
  }

  const decoder = new TextDecoder();
  const writer = (type: "stdout" | "stderr") => ({
    write: (buf: Uint8Array) => {
      post({ type, text: decoder.decode(buf) });
      return buf.length;
    },
  });
  py.setStdout(writer("stdout"));
  py.setStderr(writer("stderr"));

  // Fresh copy of the files for this run
  py.runPython(`import shutil\nshutil.rmtree(${pyString(ROOT)}, ignore_errors=True)`);
  for (const [path, text] of Object.entries(files)) {
    const full = `${ROOT}/${path}`;
    py.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
    py.FS.writeFile(full, text);
  }

  // Third-party packages Pyodide ships (numpy, pandas…) load on first import
  try {
    await py.loadPackagesFromImports(Object.values(files).join("\n"), {
      messageCallback: (msg: string) => post({ type: "status", text: msg }),
    });
  } catch {
    // Unknown packages surface as a normal ImportError when the code runs
  }

  const entryPath = `${ROOT}/${entry}`;
  const entryDir = dirname(entryPath);
  py.runPython(`
import sys, os, builtins, importlib
for _name, _mod in list(sys.modules.items()):
    if (getattr(_mod, "__file__", None) or "").startswith(${pyString(ROOT)}):
        del sys.modules[_name]
sys.path[:] = [p for p in sys.path if not p.startswith(${pyString(ROOT)})]
sys.path[0:0] = [${pyString(entryDir)}, ${pyString(ROOT)}]
os.chdir(${pyString(entryDir)})
def _no_input(prompt=""):
    raise RuntimeError("input() isn't supported when running in the browser yet. Hard-code the value for now.")
builtins.input = _no_input
importlib.invalidate_caches()
`);

  post({ type: "started" });
  let code = 0;
  try {
    // A fresh globals dict per run, so variables don't leak between runs
    const globals = py.toPy({ __name__: "__main__", __file__: entryPath });
    await py.runPythonAsync(files[entry], { globals, filename: entryPath });
    globals.destroy();
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const exit = /SystemExit(?::\s*(\d+))?\s*$/.exec(message.trim());
    if (exit) {
      code = Number(exit[1] ?? 0);
    } else {
      post({ type: "stderr", text: `${cleanTraceback(message).trimEnd()}\n` });
      code = 1;
    }
  } finally {
    py.runPython("import sys\nsys.stdout.flush()\nsys.stderr.flush()");
  }
  post({ type: "exit", code });
};
