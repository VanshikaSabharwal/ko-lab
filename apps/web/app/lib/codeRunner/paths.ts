// Path helpers shared by the main thread and the runner workers. Repo paths
// are always POSIX-style and relative to the repo root ("src/utils.ts").

export type RunLanguage = "javascript" | "typescript" | "python" | "html";

const LANGUAGE_BY_EXTENSION: Record<string, RunLanguage> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  py: "python",
  html: "html",
  htm: "html",
};

export function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The runner for a file, or null when the browser can't run it. */
export function getRunLanguage(path: string): RunLanguage | null {
  return LANGUAGE_BY_EXTENSION[extensionOf(path)] ?? null;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Join and normalise, resolving "." and "..". Returns null if it climbs above the root. */
export function joinPath(base: string, relative: string): string | null {
  const parts = relative.startsWith("/") ? [] : base.split("/").filter(Boolean);
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

export function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/");
}

const JS_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "json"];

/**
 * Resolve a relative JS import the way Node/bundlers do: exact path, then with
 * each extension, then as a folder's index file. `exists` says whether a repo
 * path is available.
 */
export function resolveJsImport(
  fromPath: string,
  spec: string,
  exists: (path: string) => boolean,
): string | null {
  const base = joinPath(dirname(fromPath), spec);
  if (base === null) return null;
  const candidates = [
    base,
    ...JS_EXTENSIONS.map((ext) => `${base}.${ext}`),
    ...JS_EXTENSIONS.map((ext) => `${base}/index.${ext}`),
  ];
  // "./utils.js" written in TypeScript source usually means "./utils.ts"
  const jsExt = /\.(m|c)?jsx?$/.exec(base);
  if (jsExt) {
    const stem = base.slice(0, jsExt.index);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  }
  return candidates.find((c) => c && exists(c)) ?? null;
}
