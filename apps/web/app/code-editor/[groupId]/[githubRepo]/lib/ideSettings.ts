"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import { nord } from "@uiw/codemirror-theme-nord";
import { monokai } from "@uiw/codemirror-theme-monokai";
import { solarizedDark, solarizedLight } from "@uiw/codemirror-theme-solarized";

// Per-browser editor preferences. Stored locally: they're a viewing
// convenience, so there's nothing to sync or lose.

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 28;
export const FONT_SIZE_DEFAULT = 14;

export interface EditorThemeOption {
  id: string;
  label: string;
  dark: boolean;
  extension: Extension;
  /** Swatch colours for the picker: background, then two token colours. */
  swatch: [string, string, string];
}

/** "system" follows the site's light/dark toggle; the rest are fixed. */
export const EDITOR_THEMES: EditorThemeOption[] = [
  { id: "one-dark", label: "One Dark", dark: true, extension: oneDark, swatch: ["#282c34", "#c678dd", "#98c379"] },
  { id: "vscode-dark", label: "VS Code Dark", dark: true, extension: vscodeDark, swatch: ["#1e1e1e", "#569cd6", "#ce9178"] },
  { id: "github-dark", label: "GitHub Dark", dark: true, extension: githubDark, swatch: ["#0d1117", "#ff7b72", "#a5d6ff"] },
  { id: "dracula", label: "Dracula", dark: true, extension: dracula, swatch: ["#282a36", "#ff79c6", "#50fa7b"] },
  { id: "tokyo-night", label: "Tokyo Night", dark: true, extension: tokyoNight, swatch: ["#1a1b26", "#bb9af7", "#9ece6a"] },
  { id: "nord", label: "Nord", dark: true, extension: nord, swatch: ["#2e3440", "#81a1c1", "#a3be8c"] },
  { id: "monokai", label: "Monokai", dark: true, extension: monokai, swatch: ["#272822", "#f92672", "#a6e22e"] },
  { id: "solarized-dark", label: "Solarized Dark", dark: true, extension: solarizedDark, swatch: ["#002b36", "#859900", "#2aa198"] },
  { id: "github-light", label: "GitHub Light", dark: false, extension: githubLight, swatch: ["#ffffff", "#cf222e", "#0a3069"] },
  { id: "vscode-light", label: "VS Code Light", dark: false, extension: vscodeLight, swatch: ["#ffffff", "#0000ff", "#a31515"] },
  { id: "solarized-light", label: "Solarized Light", dark: false, extension: solarizedLight, swatch: ["#fdf6e3", "#859900", "#2aa198"] },
];

export const SYSTEM_THEME = "system";

export interface IdeSettings {
  fontSize: number;
  themeId: string;
}

const STORAGE_KEY = "ko-lab:ide-settings";
const DEFAULTS: IdeSettings = { fontSize: FONT_SIZE_DEFAULT, themeId: SYSTEM_THEME };

const clampFontSize = (n: number) =>
  Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));

function readStored(): IdeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      fontSize: clampFontSize(Number(parsed.fontSize) || FONT_SIZE_DEFAULT),
      themeId:
        parsed.themeId === SYSTEM_THEME || EDITOR_THEMES.some((t) => t.id === parsed.themeId)
          ? parsed.themeId
          : SYSTEM_THEME,
    };
  } catch {
    return DEFAULTS;
  }
}

/** The theme to use, resolving "system" against the site's current mode. */
export function resolveEditorTheme(themeId: string, siteIsDark: boolean): EditorThemeOption {
  const fixed = EDITOR_THEMES.find((t) => t.id === themeId);
  if (fixed) return fixed;
  return EDITOR_THEMES.find((t) => t.id === (siteIsDark ? "one-dark" : "github-light"))!;
}

/** Font size as an editor extension, so it scales the gutter and text together. */
export function fontSizeTheme(size: number): Extension {
  return EditorView.theme({
    "&": { fontSize: `${size}px` },
    ".cm-gutters": { fontSize: `${size}px` },
  });
}

export const DEFAULT_IDE_SETTINGS = DEFAULTS;

export function useIdeSettings(siteIsDark: boolean) {
  const [settings, setSettings] = useState<IdeSettings>(DEFAULTS);

  // Read after mount: localStorage doesn't exist during server rendering
  useEffect(() => setSettings(readStored()), []);

  const update = useCallback((patch: Partial<IdeSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      next.fontSize = clampFontSize(next.fontSize);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private mode etc.: the setting still applies for this visit
      }
      return next;
    });
  }, []);

  const theme = resolveEditorTheme(settings.themeId, siteIsDark);

  const fontSizeExtension = useMemo(() => fontSizeTheme(settings.fontSize), [settings.fontSize]);

  return {
    settings,
    theme,
    fontSizeExtension,
    setFontSize: (fontSize: number) => update({ fontSize }),
    setThemeId: (themeId: string) => update({ themeId }),
    reset: () => update(DEFAULTS),
    /** Apply and store several settings at once (the Settings panel's Save). */
    save: (next: IdeSettings) => update(next),
  };
}
