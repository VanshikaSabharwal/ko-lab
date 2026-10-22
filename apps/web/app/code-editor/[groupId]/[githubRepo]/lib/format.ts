"use client";

import type { Plugin } from "prettier";

// Prettier and its language plugins are large, so they are fetched the first
// time a file of that kind is formatted, not with the editor.

type Loaded = { parser: string; plugins: Plugin[] };

const estree = () => import("prettier/plugins/estree").then((m) => m.default as Plugin);

const babel = (parser: string) => async (): Promise<Loaded> => ({
  parser,
  plugins: [(await import("prettier/plugins/babel")).default, await estree()],
});
const typescript = async (): Promise<Loaded> => ({
  parser: "typescript",
  plugins: [(await import("prettier/plugins/typescript")).default, await estree()],
});
const postcss = (parser: string) => async (): Promise<Loaded> => ({
  parser,
  plugins: [(await import("prettier/plugins/postcss")).default],
});
const html = (parser: string) => async (): Promise<Loaded> => ({
  parser,
  plugins: [(await import("prettier/plugins/html")).default],
});
const markdown = async (): Promise<Loaded> => ({
  parser: "markdown",
  plugins: [(await import("prettier/plugins/markdown")).default],
});
const yaml = async (): Promise<Loaded> => ({
  parser: "yaml",
  plugins: [(await import("prettier/plugins/yaml")).default],
});

const FORMATTERS: Record<string, () => Promise<Loaded>> = {
  js: babel("babel"),
  jsx: babel("babel"),
  mjs: babel("babel"),
  cjs: babel("babel"),
  json: babel("json"),
  ts: typescript,
  tsx: typescript,
  css: postcss("css"),
  scss: postcss("scss"),
  less: postcss("less"),
  html: html("html"),
  htm: html("html"),
  vue: html("vue"),
  md: markdown,
  yaml,
  yml: yaml,
};

/** Whether format-on-save does anything for this file. */
export function canFormat(path: string): boolean {
  return (path.split(".").pop()?.toLowerCase() ?? "") in FORMATTERS;
}

/**
 * The formatted text, or null when the file's type isn't supported or the
 * code doesn't parse. Null means "save it as typed": a syntax error mid-edit
 * must never get in the way of saving.
 */
export async function formatSource(
  path: string,
  text: string,
  options: { tabWidth: number; useTabs: boolean },
): Promise<string | null> {
  const load = FORMATTERS[path.split(".").pop()?.toLowerCase() ?? ""];
  if (!load) return null;
  try {
    const [{ format }, { parser, plugins }] = await Promise.all([
      import("prettier/standalone"),
      load(),
    ]);
    return await format(text, { parser, plugins, ...options });
  } catch {
    return null;
  }
}
