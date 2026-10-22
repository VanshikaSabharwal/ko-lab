"use client";

import { useEffect, useState } from "react";
import type { Extension } from "@codemirror/state";

// Language modes are fetched when a file of that type is first opened. Loading
// all thirteen up front made every visit pay for grammars it never used.

type Loader = () => Promise<Extension>;

const javascript = (config?: { jsx?: boolean; typescript?: boolean }): Loader => () =>
  import("@codemirror/lang-javascript").then((m) => m.javascript(config));
const python: Loader = () => import("@codemirror/lang-python").then((m) => m.python());
const html: Loader = () => import("@codemirror/lang-html").then((m) => m.html());
const css: Loader = () => import("@codemirror/lang-css").then((m) => m.css());
const json: Loader = () => import("@codemirror/lang-json").then((m) => m.json());
const markdown: Loader = () => import("@codemirror/lang-markdown").then((m) => m.markdown());
const xml: Loader = () => import("@codemirror/lang-xml").then((m) => m.xml());
const yaml: Loader = () => import("@codemirror/lang-yaml").then((m) => m.yaml());
const cpp: Loader = () => import("@codemirror/lang-cpp").then((m) => m.cpp());

const LOADERS: Record<string, Loader> = {
  ".js": javascript(),
  ".jsx": javascript({ jsx: true }),
  ".ts": javascript({ typescript: true }),
  ".tsx": javascript({ jsx: true, typescript: true }),
  ".mjs": javascript(),
  ".cjs": javascript(),
  ".py": python,
  ".pyw": python,
  ".java": () => import("@codemirror/lang-java").then((m) => m.java()),
  ".html": html,
  ".htm": html,
  ".css": css,
  ".scss": css,
  ".sass": css,
  ".less": css,
  ".json": json,
  ".jsonc": json,
  ".md": markdown,
  ".mdx": markdown,
  ".xml": xml,
  ".svg": xml,
  ".yaml": yaml,
  ".yml": yaml,
  ".rs": () => import("@codemirror/lang-rust").then((m) => m.rust()),
  ".php": () => import("@codemirror/lang-php").then((m) => m.php()),
  ".phtml": () => import("@codemirror/lang-php").then((m) => m.php()),
  ".sql": () => import("@codemirror/lang-sql").then((m) => m.sql()),
  ".c": cpp,
  ".cpp": cpp,
  ".h": cpp,
  ".hpp": cpp,
  ".cs": cpp,
  ".go": javascript({ typescript: true }),
  ".rb": python,
  ".vue": html,
  ".svelte": html,
  ".astro": html,
};

const FALLBACK = javascript();
const loaded = new Map<Loader, Extension>();

function loaderFor(fileName: string): Loader {
  const ext = "." + fileName.split(".").pop()?.toLowerCase();
  return LOADERS[ext] ?? FALLBACK;
}

/**
 * The language mode for a file, or null while it downloads (the text shows
 * unhighlighted for that moment) or when `enabled` is false.
 */
export function useFileLanguage(fileName: string, enabled = true): Extension | null {
  const loader = enabled && fileName ? loaderFor(fileName) : null;
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!loader || loaded.has(loader)) return;
    let cancelled = false;
    loader()
      .then((extension) => {
        loaded.set(loader, extension);
        if (!cancelled) setVersion((v) => v + 1);
      })
      .catch(() => {
        // Offline or a failed chunk: the file stays readable, just unhighlighted
      });
    return () => {
      cancelled = true;
    };
  }, [loader]);

  return loader ? (loaded.get(loader) ?? null) : null;
}
