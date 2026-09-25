"use client";

import React, { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useTheme } from "next-themes";
import toast from "react-hot-toast";
import { Check, Minus, Monitor, Plus, RotateCcw } from "lucide-react";
import { cn } from "../../../../lib/utils";
import {
  DEFAULT_IDE_SETTINGS,
  EDITOR_THEMES,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SYSTEM_THEME,
  fontSizeTheme,
  resolveEditorTheme,
  type EditorThemeOption,
  type useIdeSettings,
} from "../lib/ideSettings";
import { PRIVATE_PREVIEW_MINUTES } from "../../../../lib/livePreviewConfig";

const PREVIEW_CODE = `// Preview
function greet(name: string) {
  const message = \`Hello, \${name}!\`;
  return message.length > 10 ? message : "Hi";
}

console.log(greet("Ko-Lab")); // 42
`;

type Settings = ReturnType<typeof useIdeSettings>;

function ThemeCard({
  selected,
  label,
  sublabel,
  swatch,
  icon,
  onSelect,
}: {
  selected: boolean;
  label: string;
  sublabel: string;
  swatch?: EditorThemeOption["swatch"];
  icon?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors",
        selected
          ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700",
      )}
    >
      <span
        className="flex h-9 w-12 shrink-0 items-center justify-center gap-1 rounded-md border border-black/10 dark:border-white/10"
        style={swatch ? { background: swatch[0] } : undefined}
      >
        {swatch ? (
          <>
            <span className="h-1.5 w-3 rounded-full" style={{ background: swatch[1] }} />
            <span className="h-1.5 w-4 rounded-full" style={{ background: swatch[2] }} />
          </>
        ) : (
          icon
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{sublabel}</span>
      </span>
      {selected && <Check size={16} className="shrink-0 text-blue-500" />}
    </button>
  );
}

interface SettingsPanelProps {
  ide: Settings;
  autoUpdateLiveSite: boolean;
  onAutoUpdateLiveSiteChange: (on: boolean) => void;
}

export default function SettingsPanel({
  ide,
  autoUpdateLiveSite,
  onAutoUpdateLiveSiteChange,
}: SettingsPanelProps) {
  // Edits collect in a draft: the Preview below shows them straight away, but
  // the editor and the stored settings only change on Save.
  const saved = { ...ide.settings, autoUpdateLiveSite };
  const [draft, setDraft] = useState(saved);
  const dirty =
    draft.fontSize !== saved.fontSize ||
    draft.themeId !== saved.themeId ||
    draft.autoUpdateLiveSite !== saved.autoUpdateLiveSite;

  // Stored settings load after mount; pick them up while nothing is being edited
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ide.settings.fontSize, ide.settings.themeId, autoUpdateLiveSite]);

  const { resolvedTheme } = useTheme();
  const theme = resolveEditorTheme(draft.themeId, resolvedTheme !== "light");
  const fontSizeExtension = useMemo(() => fontSizeTheme(draft.fontSize), [draft.fontSize]);

  const size = draft.fontSize;
  const setFontSize = (n: number) =>
    setDraft((d) => ({ ...d, fontSize: Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n)) }));
  const setThemeId = (themeId: string) => setDraft((d) => ({ ...d, themeId }));
  const reset = () => setDraft((d) => ({ ...d, ...DEFAULT_IDE_SETTINGS }));
  const autoUpdate = draft.autoUpdateLiveSite;

  const save = () => {
    ide.save({ fontSize: draft.fontSize, themeId: draft.themeId });
    if (draft.autoUpdateLiveSite !== autoUpdateLiveSite) {
      onAutoUpdateLiveSiteChange(draft.autoUpdateLiveSite);
    }
    toast.success("Settings saved");
  };
  const discard = () => setDraft(saved);

  const stepButton =
    "flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Editor settings</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Try options in the preview, then save. Saved in this browser.
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <RotateCcw size={13} />
            Reset to defaults
          </button>
        </div>

        {/* Font size */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Font size</h3>
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            Size of the code in the editor ({FONT_SIZE_MIN}–{FONT_SIZE_MAX}px).
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setFontSize(size - 1)}
              disabled={size <= FONT_SIZE_MIN}
              aria-label="Decrease font size"
              className={stepButton}
            >
              <Minus size={14} />
            </button>
            <span className="w-14 text-center text-sm font-medium tabular-nums text-gray-900 dark:text-white">
              {size}px
            </span>
            <button
              type="button"
              onClick={() => setFontSize(size + 1)}
              disabled={size >= FONT_SIZE_MAX}
              aria-label="Increase font size"
              className={stepButton}
            >
              <Plus size={14} />
            </button>
            <input
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              value={size}
              onChange={(e) => setFontSize(Number(e.target.value))}
              aria-label="Font size"
              className="ml-2 flex-1 accent-blue-500"
            />
            {size !== FONT_SIZE_DEFAULT && (
              <button
                type="button"
                onClick={() => setFontSize(FONT_SIZE_DEFAULT)}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Default ({FONT_SIZE_DEFAULT}px)
              </button>
            )}
          </div>
        </section>

        {/* Theme */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Theme</h3>
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">Colours used for code in the editor.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <ThemeCard
              selected={draft.themeId === SYSTEM_THEME}
              label="Match site theme"
              sublabel={`Now: ${theme.label}`}
              icon={<Monitor size={16} className="text-gray-500" />}
              onSelect={() => setThemeId(SYSTEM_THEME)}
            />
            {EDITOR_THEMES.map((t) => (
              <ThemeCard
                key={t.id}
                selected={draft.themeId === t.id}
                label={t.label}
                sublabel={t.dark ? "Dark" : "Light"}
                swatch={t.swatch}
                onSelect={() => setThemeId(t.id)}
              />
            ))}
          </div>
        </section>

        {/* Make it live */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Live site</h3>
          <label className="mt-3 flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <span>
              <span className="block text-sm font-medium text-gray-900 dark:text-white">
                Update the live site when I save
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                While your site is live, each save pushes that file to it, so a reload shows the change. It
                doesn&apos;t extend the {PRIVATE_PREVIEW_MINUTES}-minute limit.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autoUpdate}
              onClick={() => setDraft((d) => ({ ...d, autoUpdateLiveSite: !d.autoUpdateLiveSite }))}
              className={cn(
                "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
                autoUpdate ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600",
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  autoUpdate && "translate-x-4",
                )}
              />
            </button>
          </label>
        </section>

        {/* Live preview */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Preview</h3>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <CodeMirror
              value={PREVIEW_CODE}
              theme={theme.extension}
              editable={false}
              extensions={[javascript({ typescript: true }), fontSizeExtension]}
              basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
            />
          </div>
        </section>
      </div>

      {/* Stays in view while scrolling, so Save is always reachable */}
      <div className="sticky bottom-0 border-t border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 px-6 py-3">
          <span className="mr-auto text-xs text-gray-500 dark:text-gray-400">
            {dirty ? "You have unsaved changes" : "All changes saved"}
          </span>
          <button
            type="button"
            onClick={discard}
            disabled={!dirty}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600"
          >
            <Check size={14} />
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
