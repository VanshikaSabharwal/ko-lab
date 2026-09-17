/**
 * Chat background palette.
 *
 * Two kinds of background coexist here:
 *
 * - The six original presets are Tailwind class pairs that carry their own
 *   `dark:` variant, so they adapt to the theme on their own.
 * - The named palette pairs a light pastel with a deep dark tone. The two sets
 *   were chosen independently and don't correspond one-to-one, so each swatch
 *   is paired by colour family: a blue pastel takes a blue dark tone, a pink
 *   takes a pink, and so on. The dark tone's own name is kept so the picker can
 *   show it while the dark theme is active.
 */

export interface BgOption {
  label: string;
  /** Stable id persisted to localStorage. */
  value: string;
  /** Light-mode background: a CSS color for palette entries, else a class. */
  light: string;
  /** Dark-mode background, or null to fall back to the default dark surface. */
  dark: string | null;
  /** The dark tone's own name, shown when the dark theme is active. */
  darkLabel?: string;
  /** Tailwind classes are applied as-is; CSS colors go through inline style. */
  kind: "class" | "color";
}

/** Chat surface used when an entry has no dark variant of its own. */
export const DEFAULT_DARK = "#030712"; // gray-950, matching the Default preset

/** The original six, unchanged so existing saved preferences keep working. */
const PRESETS: BgOption[] = [
  { label: "Default", value: "bg-gray-50 dark:bg-gray-950", light: "bg-gray-50", dark: "dark:bg-gray-950", kind: "class" },
  { label: "Midnight", value: "bg-gray-900 dark:bg-gray-900", light: "bg-gray-900", dark: "dark:bg-gray-900", kind: "class" },
  { label: "Sky", value: "bg-sky-50 dark:bg-sky-950", light: "bg-sky-50", dark: "dark:bg-sky-950", kind: "class" },
  { label: "Sage", value: "bg-emerald-50 dark:bg-emerald-950", light: "bg-emerald-50", dark: "dark:bg-emerald-950", kind: "class" },
  { label: "Rose", value: "bg-rose-50 dark:bg-rose-950", light: "bg-rose-50", dark: "dark:bg-rose-950", kind: "class" },
  { label: "Sand", value: "bg-amber-50 dark:bg-amber-950", light: "bg-amber-50", dark: "dark:bg-amber-950", kind: "class" },
];

/**
 * A palette entry. `value` is the light hex, which doubles as the stable id, so
 * a saved preference survives any later change to the dark pairing.
 */
const swatch = (
  label: string,
  light: string,
  dark: string,
  darkLabel: string,
): BgOption => ({ label, value: light, light, dark, darkLabel, kind: "color" });

export interface BgGroup {
  name: string;
  options: BgOption[];
}

export const BG_GROUPS: BgGroup[] = [
  {
    name: "Presets",
    options: PRESETS,
  },
  {
    name: "Blues",
    options: [
      swatch("Baby Blue", "#cfe4f7", "#1b2435", "Deceit"),
      swatch("Sky Blue", "#bcd9f5", "#20293c", "Treachery"),
      swatch("Powder Blue", "#cde3ee", "#232f3d", "Manipulation"),
    ],
  },
  {
    name: "Greens",
    options: [
      swatch("Mint Green", "#cfe9de", "#1e2a26", "Poison"),
      swatch("Pale Green", "#d5e8d2", "#232b21", "Greed"),
      swatch("Light Olive", "#dde7bf", "#2b2e22", "Corruption"),
      swatch("Livable Green", "#cfe0d2", "#252f28", "Envy"),
    ],
  },
  {
    name: "Pinks",
    options: [
      swatch("Blush Pink", "#fad9e2", "#33222a", "Heartbreak"),
      swatch("Rose Pink", "#f9cdd9", "#3a2028", "Rejection"),
      swatch("Piggy Pink", "#f7d6d8", "#37232a", "Humiliation"),
      swatch("Millennium Pink", "#f6c9c6", "#3d2526", "Resentment"),
      swatch("Sweet Pink", "#f4b8bc", "#42222a", "Malice"),
      swatch("Pastel Pink", "#f7cfd0", "#382329", "Spite"),
      swatch("Shell Pink", "#f7d9c9", "#342620", "Disgust"),
    ],
  },
  {
    name: "Warm",
    options: [
      swatch("Peach", "#fbd5c4", "#33251e", "Loathing"),
      swatch("Apricot", "#f6c9a8", "#38291f", "Contempt"),
      swatch("Butter Yellow", "#faeec2", "#2f2a1d", "Superiority"),
      swatch("Cream", "#f8e7cd", "#2e281f", "Arrogance"),
      swatch("Ivory", "#f7eedd", "#2b2724", "Scorn"),
      swatch("Vanilla", "#f2e6cf", "#2d2823", "Disdain"),
      swatch("Coconut White", "#f7f2ec", "#2a2724", "Darkness"),
    ],
  },
  {
    name: "Purples",
    options: [
      swatch("Lavender", "#ddd3ef", "#292139", "Betrayal"),
      swatch("Lilac", "#e4d5f0", "#2e2340", "Fury"),
      swatch("Soft Lilac", "#dcc9ec", "#312444", "Rage"),
      swatch("Soft Purple", "#cdb6e9", "#2b1f3d", "Vindictiveness"),
      swatch("Pale Purple", "#c9b3e3", "#261c35", "Hate"),
    ],
  },
  {
    name: "Neutrals",
    options: [
      swatch("Beige", "#e3d6c5", "#2b2722", "Cruelty"),
      swatch("Sand", "#e8cfb5", "#302a22", "Sadism"),
      swatch("Light Gray", "#dcdcdc", "#26262a", "Abandonment"),
      swatch("Silver", "#d5d5d7", "#232327", "Jealousy"),
    ],
  },
];

export const ALL_BG_OPTIONS: BgOption[] = BG_GROUPS.flatMap((g) => g.options);

export const DEFAULT_BG = PRESETS[0]!.value;

/** Look up a saved preference; unknown values fall back to the default. */
export function findBgOption(value: string | null | undefined): BgOption {
  return ALL_BG_OPTIONS.find((o) => o.value === value) ?? PRESETS[0]!;
}

/**
 * How to render a chosen background.
 *
 * Palette entries are fixed colors rather than Tailwind classes, so they are
 * applied inline. Both sides of a pairing are dark-on-light or light-on-dark by
 * construction, so the app's own text colors work against either.
 */
export function bgStyles(option: BgOption, isDark: boolean): {
  className: string;
  style: React.CSSProperties;
} {
  if (option.kind === "class") {
    return { className: `${option.light} ${option.dark ?? ""}`, style: {} };
  }

  if (isDark) {
    return {
      className: "",
      style: { backgroundColor: option.dark ?? DEFAULT_DARK },
    };
  }

  return { className: "", style: { backgroundColor: option.light } };
}

/** The name to show for an option under the active theme. */
export function bgLabel(option: BgOption, isDark: boolean): string {
  return isDark && option.darkLabel ? option.darkLabel : option.label;
}
