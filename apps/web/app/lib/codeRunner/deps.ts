import { dirname, isRelativeSpecifier, joinPath, resolveJsImport } from "./paths";

// Workers can't fetch repo files on demand (require() is synchronous), so the
// files a program needs are gathered up front by scanning imports from the
// entry file outward.

/** Stops a huge import graph from turning one Run into hundreds of fetches. */
const MAX_FILES = 60;

const JS_IMPORT =
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const PY_FROM_IMPORT = /^[ \t]*from[ \t]+([.\w]+)[ \t]+import[ \t]+\(?([\w \t,*]+)/gm;
const PY_IMPORT = /^[ \t]*import[ \t]+([\w., \t]+)/gm;

const HTML_ASSET =
  /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;

function jsDependencies(path: string, source: string, exists: (p: string) => boolean): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(JS_IMPORT)) {
    const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (!spec || !isRelativeSpecifier(spec)) continue;
    const resolved = resolveJsImport(path, spec, exists);
    if (resolved) found.push(resolved);
  }
  return found;
}

/** Candidate files for a Python module name, searched beside the file and at the repo root. */
function pyModuleFiles(module: string, fromPath: string): string[] {
  const dir = dirname(fromPath);
  let bases: string[];
  let name = module;

  if (module.startsWith(".")) {
    // Relative import: each extra leading dot goes one package up
    const dots = /^\.+/.exec(module)![0].length;
    let pkg = dir;
    for (let i = 1; i < dots; i++) pkg = dirname(pkg);
    bases = [pkg];
    name = module.slice(dots);
  } else {
    bases = dir ? [dir, ""] : [""];
  }

  const rel = name.replace(/\./g, "/");
  const out: string[] = [];
  for (const base of bases) {
    const stem = [base, rel].filter(Boolean).join("/");
    if (stem) out.push(`${stem}.py`, `${stem}/__init__.py`);
    else out.push(`${base ? `${base}/` : ""}__init__.py`);
  }
  return out;
}

function pyDependencies(path: string, source: string, exists: (p: string) => boolean): string[] {
  const candidates: string[] = [];

  for (const match of source.matchAll(PY_FROM_IMPORT)) {
    const module = match[1]!;
    candidates.push(...pyModuleFiles(module, path));
    // `from pkg import mod` may name a submodule rather than an attribute
    for (const raw of match[2]!.split(",")) {
      const name = raw.trim().split(/\s+/)[0];
      if (!name || name === "*") continue;
      const sub = module.endsWith(".") ? `${module}${name}` : `${module}.${name}`;
      candidates.push(...pyModuleFiles(sub, path));
    }
  }
  for (const match of source.matchAll(PY_IMPORT)) {
    for (const raw of match[1]!.split(",")) {
      const module = raw.trim().split(/\s+/)[0];
      if (!module) continue;
      // `import a.b.c` imports a, a.b and a.b.c
      const parts = module.split(".");
      for (let i = 1; i <= parts.length; i++) {
        candidates.push(...pyModuleFiles(parts.slice(0, i).join("."), path));
      }
    }
  }
  return candidates.filter(exists);
}

function htmlDependencies(path: string, source: string, exists: (p: string) => boolean): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(HTML_ASSET)) {
    const ref = match[1]!.split(/[?#]/)[0]!;
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) continue;
    const resolved = joinPath(dirname(path), ref);
    if (resolved && exists(resolved)) found.push(resolved);
  }
  return found;
}

export interface CollectResult {
  files: Record<string, string>;
  /** Imports that pointed at repo files but couldn't be read. */
  missing: string[];
  truncated: boolean;
}

/**
 * Read the entry file and everything it (transitively) imports from the repo.
 * `read` returns a file's text, or null if it can't be loaded as text.
 */
export async function collectFiles(opts: {
  entry: string;
  entrySource: string;
  exists: (path: string) => boolean;
  read: (path: string) => Promise<string | null>;
}): Promise<CollectResult> {
  const { entry, entrySource, exists, read } = opts;
  const files: Record<string, string> = { [entry]: entrySource };
  const missing: string[] = [];
  const queue: string[] = [entry];
  const seen = new Set<string>([entry]);
  let truncated = false;

  const scan = (path: string, source: string): string[] => {
    // HTML pulls in scripts, which may themselves import modules
    if (path.endsWith(".py")) return pyDependencies(path, source, exists);
    if (/\.html?$/i.test(path)) return htmlDependencies(path, source, exists);
    if (/\.(css|json)$/i.test(path)) return [];
    return jsDependencies(path, source, exists);
  };

  while (queue.length > 0) {
    const path = queue.shift()!;
    const deps = scan(path, files[path]!).filter((d) => !seen.has(d));
    deps.forEach((d) => seen.add(d));

    const room = MAX_FILES - Object.keys(files).length;
    if (deps.length > room) truncated = true;

    const loaded = await Promise.all(
      deps.slice(0, Math.max(0, room)).map(async (d) => [d, await read(d)] as const),
    );
    for (const [dep, text] of loaded) {
      if (text === null) {
        missing.push(dep);
        continue;
      }
      files[dep] = text;
      queue.push(dep);
    }
  }

  return { files, missing, truncated };
}
