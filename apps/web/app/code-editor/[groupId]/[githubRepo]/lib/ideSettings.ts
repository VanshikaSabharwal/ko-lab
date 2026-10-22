"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
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
  /** The theme's ordinary text colour; with the background, it colours the rest of the IDE. */
  text: string;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * How far each grey sits between the theme's background (0) and its text (1).
 * The IDE is laid out with its dark-mode classes, where 950/900/800 are
 * surfaces, 700 borders and 400–100 text, so the same steps give a panel
 * slightly off the background, a visible border and readable text in any
 * theme, light ones included.
 */
const GREY_STEPS: Record<number, number> = {
  950: 0,
  900: 0.035,
  800: 0.085,
  700: 0.16,
  600: 0.3,
  500: 0.45,
  400: 0.62,
  300: 0.76,
  200: 0.87,
  100: 0.94,
  50: 1,
};

/**
 * The IDE's grey scale for a theme, as the CSS variables Tailwind's greys read
 * (see tailwind.config.js). Set on the IDE's root, this is what makes the
 * sidebar, tabs, toolbar and panels follow the editor theme.
 */
export function ideThemeVars(theme: EditorThemeOption): Record<string, string> {
  const bg = hexToRgb(theme.swatch[0]);
  const fg = hexToRgb(theme.text);
  const vars: Record<string, string> = {};
  for (const [shade, t] of Object.entries(GREY_STEPS)) {
    vars[`--gray-${shade}`] = bg.map((c, i) => Math.round(c + (fg[i]! - c) * t)).join(" ");
  }
  return vars;
}

/** "system" follows the site's light/dark toggle; the rest are fixed. */
export const EDITOR_THEMES: EditorThemeOption[] = [
  { id: "one-dark", text: "#abb2bf", label: "One Dark", dark: true, extension: oneDark, swatch: ["#282c34", "#c678dd", "#98c379"] },
  { id: "vscode-dark", text: "#d4d4d4", label: "VS Code Dark", dark: true, extension: vscodeDark, swatch: ["#1e1e1e", "#569cd6", "#ce9178"] },
  { id: "github-dark", text: "#c9d1d9", label: "GitHub Dark", dark: true, extension: githubDark, swatch: ["#0d1117", "#ff7b72", "#a5d6ff"] },
  { id: "dracula", text: "#f8f8f2", label: "Dracula", dark: true, extension: dracula, swatch: ["#282a36", "#ff79c6", "#50fa7b"] },
  { id: "tokyo-night", text: "#a9b1d6", label: "Tokyo Night", dark: true, extension: tokyoNight, swatch: ["#1a1b26", "#bb9af7", "#9ece6a"] },
  { id: "nord", text: "#d8dee9", label: "Nord", dark: true, extension: nord, swatch: ["#2e3440", "#81a1c1", "#a3be8c"] },
  { id: "monokai", text: "#f8f8f2", label: "Monokai", dark: true, extension: monokai, swatch: ["#272822", "#f92672", "#a6e22e"] },
  { id: "solarized-dark", text: "#93a1a1", label: "Solarized Dark", dark: true, extension: solarizedDark, swatch: ["#002b36", "#859900", "#2aa198"] },
  { id: "github-light", text: "#24292e", label: "GitHub Light", dark: false, extension: githubLight, swatch: ["#ffffff", "#cf222e", "#0a3069"] },
  { id: "vscode-light", text: "#1f2328", label: "VS Code Light", dark: false, extension: vscodeLight, swatch: ["#ffffff", "#0000ff", "#a31515"] },
  { id: "solarized-light", text: "#586e75", label: "Solarized Light", dark: false, extension: solarizedLight, swatch: ["#fdf6e3", "#859900", "#2aa198"] },
];

export const SYSTEM_THEME = "system";

export const TAB_SIZES = [2, 4, 8] as const;
export const TERMINAL_FONT_SIZE_DEFAULT = 13;

/** "afterDelay" saves once typing pauses; "onTabSwitch" when you leave the file. */
export type AutoSaveMode = "off" | "afterDelay" | "onTabSwitch";
/** Which file the editor shows when a repo opens. */
export type OpenFirst = "readme" | "last" | "none";

export interface IdeSettings {
  fontSize: number;
  themeId: string;
  tabSize: number;
  /** Indent with a tab character instead of spaces. */
  useTabs: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  foldGutter: boolean;
  closeBrackets: boolean;
  autoSave: AutoSaveMode;
  formatOnSave: boolean;
  openFirst: OpenFirst;
  restoreTabs: boolean;
  /** Ask before closing a tab whose edits would be lost. */
  confirmDiscard: boolean;
  terminalFontSize: number;
  /** Suggested in the terminal; empty means guess from package.json. */
  terminalCommand: string;
}

const STORAGE_KEY = "ko-lab:ide-settings";
const DEFAULTS: IdeSettings = {
  fontSize: FONT_SIZE_DEFAULT,
  themeId: SYSTEM_THEME,
  tabSize: 2,
  useTabs: false,
  wordWrap: false,
  lineNumbers: true,
  foldGutter: true,
  closeBrackets: true,
  autoSave: "off",
  formatOnSave: false,
  openFirst: "readme",
  restoreTabs: false,
  confirmDiscard: true,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  terminalCommand: "",
};

const clampFontSize = (n: number) =>
  Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));

/** Stored JSON can be from an older version or hand-edited, so every field is checked. */
function sanitize(raw: Record<string, unknown>): IdeSettings {
  const bool = (key: keyof IdeSettings) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : (DEFAULTS[key] as boolean);
  const oneOf = <T extends string>(key: keyof IdeSettings, allowed: readonly T[]): T =>
    allowed.includes(raw[key] as T) ? (raw[key] as T) : (DEFAULTS[key] as T);
  return {
    fontSize: clampFontSize(Number(raw.fontSize) || FONT_SIZE_DEFAULT),
    themeId:
      raw.themeId === SYSTEM_THEME || EDITOR_THEMES.some((t) => t.id === raw.themeId)
        ? (raw.themeId as string)
        : SYSTEM_THEME,
    tabSize: (TAB_SIZES as readonly number[]).includes(Number(raw.tabSize))
      ? Number(raw.tabSize)
      : DEFAULTS.tabSize,
    useTabs: bool("useTabs"),
    wordWrap: bool("wordWrap"),
    lineNumbers: bool("lineNumbers"),
    foldGutter: bool("foldGutter"),
    closeBrackets: bool("closeBrackets"),
    autoSave: oneOf("autoSave", ["off", "afterDelay", "onTabSwitch"] as const),
    formatOnSave: bool("formatOnSave"),
    openFirst: oneOf("openFirst", ["readme", "last", "none"] as const),
    restoreTabs: bool("restoreTabs"),
    confirmDiscard: bool("confirmDiscard"),
    terminalFontSize: clampFontSize(Number(raw.terminalFontSize) || TERMINAL_FONT_SIZE_DEFAULT),
    terminalCommand:
      typeof raw.terminalCommand === "string" ? raw.terminalCommand.slice(0, 200) : "",
  };
}

/** The settings as stored, for code that runs before the hook has loaded them. */
export function readStoredIdeSettings(): IdeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULTS;
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

type Behaviour = Pick<
  IdeSettings,
  "tabSize" | "useTabs" | "wordWrap" | "lineNumbers" | "foldGutter" | "closeBrackets"
>;

/** Indentation and wrapping, as editor extensions. */
export function behaviourExtensions({ tabSize, useTabs, wordWrap }: Behaviour): Extension[] {
  return [
    EditorState.tabSize.of(tabSize),
    indentUnit.of(useTabs ? "\t" : " ".repeat(tabSize)),
    ...(wordWrap ? [EditorView.lineWrapping] : []),
  ];
}

/** The parts of CodeMirror's basic setup the settings switch on and off. */
export function basicSetupFor({ tabSize, lineNumbers, foldGutter, closeBrackets }: Behaviour) {
  return {
    lineNumbers,
    highlightActiveLineGutter: lineNumbers,
    highlightActiveLine: true,
    foldGutter,
    bracketMatching: true,
    closeBrackets,
    indentOnInput: true,
    tabSize,
  };
}

export const DEFAULT_IDE_SETTINGS = DEFAULTS;

export function useIdeSettings(siteIsDark: boolean) {
  const [settings, setSettings] = useState<IdeSettings>(DEFAULTS);

  // Read after mount: localStorage doesn't exist during server rendering
  useEffect(() => setSettings(readStoredIdeSettings()), []);

  const update = useCallback((patch: Partial<IdeSettings>) => {
    setSettings((prev) => {
      const next = sanitize({ ...prev, ...patch });
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

  // Both memoised on the values they read: CodeMirror reconfigures whenever
  // either changes identity.
  const { tabSize, useTabs, wordWrap, lineNumbers, foldGutter, closeBrackets } = settings;
  const behaviour = useMemo(
    () => ({ tabSize, useTabs, wordWrap, lineNumbers, foldGutter, closeBrackets }),
    [tabSize, useTabs, wordWrap, lineNumbers, foldGutter, closeBrackets],
  );
  const behaviourExtension = useMemo(() => behaviourExtensions(behaviour), [behaviour]);
  const basicSetup = useMemo(() => basicSetupFor(behaviour), [behaviour]);

  return {
    settings,
    theme,
    fontSizeExtension,
    behaviourExtension,
    basicSetup,
    setFontSize: (fontSize: number) => update({ fontSize }),
    setThemeId: (themeId: string) => update({ themeId }),
    reset: () => update(DEFAULTS),
    /** Apply and store several settings at once (the Settings panel's Save). */
    save: (next: Partial<IdeSettings>) => update(next),
  };
}

// ── Per-repo preferences ─────────────────────────────────────────────────────
// What to reopen is a fact about one repo, so it is stored per group rather
// than with the settings above.

export interface RepoPrefs {
  /** Branch to open instead of the repo's default. */
  startBranch?: string;
  /** Tabs that were open, and the one on screen, when the editor was last used. */
  tabs?: string[];
  active?: string;
}

const repoKey = (groupId: string) => `ko-lab:ide-repo:${groupId}`;

export function readRepoPrefs(groupId: string): RepoPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(repoKey(groupId)) ?? "{}");
    return {
      startBranch: typeof raw.startBranch === "string" ? raw.startBranch : undefined,
      tabs: Array.isArray(raw.tabs) ? raw.tabs.filter((t: unknown) => typeof t === "string") : undefined,
      active: typeof raw.active === "string" ? raw.active : undefined,
    };
  } catch {
    return {};
  }
}

export function writeRepoPrefs(groupId: string, patch: RepoPrefs) {
  try {
    localStorage.setItem(repoKey(groupId), JSON.stringify({ ...readRepoPrefs(groupId), ...patch }));
  } catch {
    // Storage unavailable: nothing is remembered, nothing breaks
  }
}
