"use client";

import React, { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useTheme } from "next-themes";
import toast from "react-hot-toast";
import { Check, Github, Minus, Monitor, Plus, RotateCcw, Users } from "lucide-react";
import { cn } from "../../../../lib/utils";
import {
  DEFAULT_IDE_SETTINGS,
  EDITOR_THEMES,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SYSTEM_THEME,
  TAB_SIZES,
  basicSetupFor,
  behaviourExtensions,
  fontSizeTheme,
  resolveEditorTheme,
  type AutoSaveMode,
  type EditorThemeOption,
  type IdeSettings,
  type OpenFirst,
  type useIdeSettings,
} from "../lib/ideSettings";
import type { Branch } from "./BranchMenu";
import { PRIVATE_PREVIEW_MINUTES } from "../../../../lib/livePreviewConfig";

const PREVIEW_CODE = `// Preview
function greet(name: string) {
  const message = \`Hello, \${name}!\`;
  return message.length > 10 ? message : "Hi";
}

console.log(greet("Ko-Lab"));
`;

const AUTO_SAVE_OPTIONS: { value: AutoSaveMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "afterDelay", label: "After I stop typing" },
  { value: "onTabSwitch", label: "When I switch tabs" },
];

const OPEN_FIRST_OPTIONS: { value: OpenFirst; label: string }[] = [
  { value: "readme", label: "The README" },
  { value: "last", label: "The file I had open last" },
  { value: "none", label: "Nothing" },
];

const fieldClass =
  "rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {description && <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>}
      <div className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {children}
      </div>
    </section>
  );
}

/** One setting: what it is on the left, its control on the right. */
function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
      <span className="min-w-0 flex-1 basis-56">
        <span className="block text-sm font-medium text-gray-900 dark:text-white">{label}</span>
        {description && (
          <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {description}
          </span>
        )}
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative block h-5 w-9 rounded-full transition-colors",
        checked ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
            o.value === value
              ? "border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
              : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}


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
  branches: Branch[];
  /** Branch this repo opens on; "" for the repo's default. */
  startBranch: string;
  onStartBranchChange: (name: string) => void;
  onReconnectGithub: () => void;
  reconnecting: boolean;
  onOpenCollaboration: () => void;
}

type Draft = IdeSettings & { autoUpdateLiveSite: boolean; startBranch: string };

export default function SettingsPanel({
  ide,
  autoUpdateLiveSite,
  onAutoUpdateLiveSiteChange,
  branches,
  startBranch,
  onStartBranchChange,
  onReconnectGithub,
  reconnecting,
  onOpenCollaboration,
}: SettingsPanelProps) {
  // Edits collect in a draft: the Preview below shows them straight away, but
  // the editor and the stored settings only change on Save.
  const saved: Draft = { ...ide.settings, autoUpdateLiveSite, startBranch };
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const dirty = JSON.stringify(draft) !== savedKey;

  // Stored settings load after mount; pick them up while nothing is being edited
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const { resolvedTheme } = useTheme();
  const theme = resolveEditorTheme(draft.themeId, resolvedTheme !== "light");
  const { fontSize: size, tabSize, useTabs, wordWrap, lineNumbers, foldGutter, closeBrackets } = draft;
  const previewExtensions = useMemo(
    () => [
      javascript({ typescript: true }),
      fontSizeTheme(size),
      ...behaviourExtensions({ tabSize, useTabs, wordWrap, lineNumbers, foldGutter, closeBrackets }),
    ],
    [size, tabSize, useTabs, wordWrap, lineNumbers, foldGutter, closeBrackets],
  );
  const previewSetup = useMemo(
    () => ({
      ...basicSetupFor({ tabSize, useTabs, wordWrap, lineNumbers, foldGutter, closeBrackets }),
      highlightActiveLine: false,
      highlightActiveLineGutter: false,
    }),
    [tabSize, useTabs, wordWrap, lineNumbers, foldGutter, closeBrackets],
  );

  const clampSize = (n: number) => Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
  const setFontSize = (n: number) => set("fontSize", clampSize(n));
  const reset = () => setDraft((d) => ({ ...d, ...DEFAULT_IDE_SETTINGS }));

  const save = () => {
    const { autoUpdateLiveSite: liveSite, startBranch: branch, ...settings } = draft;
    ide.save(settings);
    if (liveSite !== autoUpdateLiveSite) onAutoUpdateLiveSiteChange(liveSite);
    if (branch !== startBranch) onStartBranchChange(branch);
    toast.success("Settings saved");
  };
  const discard = () => setDraft(saved);

  const stepButton =
    "flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";
  const actionButton =
    "flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";

  // A stored branch that has since been deleted still needs an entry to show
  const branchNames = branches.map((b) => b.name);
  if (draft.startBranch && !branchNames.includes(draft.startBranch)) {
    branchNames.push(draft.startBranch);
  }

  return (
    <div className="ide-settings min-h-0 flex-1 overflow-y-auto">
      {/* Settings on the left, the preview pinned beside them so a change is
          visible as it's made; one column when this panel is too narrow. The
          switch depends on the panel's own width (see .ide-settings in
          globals.css), not the window's: the sidebar, the AI panel and browser
          zoom all change how much room there is. */}
      <div className="ide-settings-grid mx-auto grid gap-8 p-6">
        <div className="min-w-0 space-y-8">
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
          {/* As many cards per row as fit */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-2">
            <ThemeCard
              selected={draft.themeId === SYSTEM_THEME}
              label="Match site theme"
              sublabel={`Now: ${theme.label}`}
              icon={<Monitor size={16} className="text-gray-500" />}
              onSelect={() => set("themeId", SYSTEM_THEME)}
            />
            {EDITOR_THEMES.map((t) => (
              <ThemeCard
                key={t.id}
                selected={draft.themeId === t.id}
                label={t.label}
                sublabel={t.dark ? "Dark" : "Light"}
                swatch={t.swatch}
                onSelect={() => set("themeId", t.id)}
              />
            ))}
          </div>
        </section>

        <Section title="Editing">
          <Row label="Indent size" description="Width of one indent level, and of a tab character.">
            <Segmented
              label="Indent size"
              value={draft.tabSize}
              options={TAB_SIZES.map((n) => ({ value: n as number, label: String(n) }))}
              onChange={(n) => set("tabSize", n)}
            />
          </Row>
          <Row label="Indent with tabs" description="Insert a tab character instead of spaces.">
            <Switch label="Indent with tabs" checked={draft.useTabs} onChange={(on) => set("useTabs", on)} />
          </Row>
          <Row label="Word wrap" description="Wrap long lines instead of scrolling sideways.">
            <Switch label="Word wrap" checked={draft.wordWrap} onChange={(on) => set("wordWrap", on)} />
          </Row>
          <Row label="Line numbers">
            <Switch label="Line numbers" checked={draft.lineNumbers} onChange={(on) => set("lineNumbers", on)} />
          </Row>
          <Row label="Code folding" description="Arrows in the margin that collapse a block.">
            <Switch label="Code folding" checked={draft.foldGutter} onChange={(on) => set("foldGutter", on)} />
          </Row>
          <Row label="Close brackets automatically" description="Typing ( or a quote adds the closing one.">
            <Switch
              label="Close brackets automatically"
              checked={draft.closeBrackets}
              onChange={(on) => set("closeBrackets", on)}
            />
          </Row>
        </Section>

        <Section title="Saving">
          <Row
            label="Auto-save"
            description="Saves go to your draft, as with the Save button. Nothing reaches the repo without a change request."
          >
            <Segmented
              label="Auto-save"
              value={draft.autoSave}
              options={AUTO_SAVE_OPTIONS}
              onChange={(mode) => set("autoSave", mode)}
            />
          </Row>
          <Row
            label="Format on save"
            description="Tidies JavaScript, TypeScript, JSON, CSS, HTML, Markdown and YAML with Prettier when you save. Auto-saves aren't formatted, and code that doesn't parse is saved as typed."
          >
            <Switch
              label="Format on save"
              checked={draft.formatOnSave}
              onChange={(on) => set("formatOnSave", on)}
            />
          </Row>
          <Row
            label="Ask before discarding edits"
            description="When off, closing a tab or switching branch drops unsaved edits without asking."
          >
            <Switch
              label="Ask before discarding edits"
              checked={draft.confirmDiscard}
              onChange={(on) => set("confirmDiscard", on)}
            />
          </Row>
        </Section>

        <Section title="Opening this project">
          <Row label="Open first">
            <select
              aria-label="Open first"
              value={draft.openFirst}
              onChange={(e) => set("openFirst", e.target.value as OpenFirst)}
              className={fieldClass}
            >
              {OPEN_FIRST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Restore open tabs" description="Reopen the tabs from your last visit. Unsaved edits aren't restored.">
            <Switch
              label="Restore open tabs"
              checked={draft.restoreTabs}
              onChange={(on) => set("restoreTabs", on)}
            />
          </Row>
          <Row label="Branch to open" description="For this project only.">
            <select
              aria-label="Branch to open"
              value={draft.startBranch}
              onChange={(e) => set("startBranch", e.target.value)}
              className={cn(fieldClass, "max-w-[14rem]")}
            >
              <option value="">Repository default</option>
              {branchNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title="Terminal">
          <Row label="Font size">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => set("terminalFontSize", clampSize(draft.terminalFontSize - 1))}
                disabled={draft.terminalFontSize <= FONT_SIZE_MIN}
                aria-label="Decrease terminal font size"
                className={stepButton}
              >
                <Minus size={14} />
              </button>
              <span className="w-12 text-center text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                {draft.terminalFontSize}px
              </span>
              <button
                type="button"
                onClick={() => set("terminalFontSize", clampSize(draft.terminalFontSize + 1))}
                disabled={draft.terminalFontSize >= FONT_SIZE_MAX}
                aria-label="Increase terminal font size"
                className={stepButton}
              >
                <Plus size={14} />
              </button>
            </div>
          </Row>
          <Row
            label="Start command"
            description="Suggested when the terminal opens. Leave empty to use the one from package.json."
          >
            <input
              aria-label="Start command"
              value={draft.terminalCommand}
              onChange={(e) => set("terminalCommand", e.target.value)}
              placeholder="npm install && npm run dev"
              maxLength={200}
              spellCheck={false}
              className={cn(fieldClass, "w-64 max-w-full font-mono text-xs")}
            />
          </Row>
        </Section>

        <Section title="Live site">
          <Row
            label="Update the live site when I save"
            description={
              <>
                While your site is live, each save pushes that file to it, so a reload shows the change. It
                doesn&apos;t extend the {PRIVATE_PREVIEW_MINUTES}-minute limit.
              </>
            }
          >
            <Switch
              label="Update the live site when I save"
              checked={draft.autoUpdateLiveSite}
              onChange={(on) => set("autoUpdateLiveSite", on)}
            />
          </Row>
        </Section>

        {/* These act straight away: they aren't part of the draft above */}
        <Section title="Project">
          <Row
            label="GitHub connection"
            description="Refreshes this project's access to its repository when files stop loading. Only the group owner can do this."
          >
            <button type="button" onClick={onReconnectGithub} disabled={reconnecting} className={actionButton}>
              <Github size={14} />
              {reconnecting ? "Reconnecting…" : "Reconnect GitHub"}
            </button>
          </Row>
          <Row label="Code access" description="Who can edit this project's code is managed under Collaboration.">
            <button type="button" onClick={onOpenCollaboration} className={actionButton}>
              <Users size={14} />
              Open Collaboration
            </button>
          </Row>
        </Section>

        </div>

        {/* Live preview */}
        <aside className="ide-settings-preview min-w-0">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Preview</h3>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <CodeMirror
              value={PREVIEW_CODE}
              theme={theme.extension}
              editable={false}
              extensions={previewExtensions}
              basicSetup={previewSetup}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Shows your choices before you save them.
          </p>
        </aside>
      </div>

      {/* Stays in view while scrolling, so Save is always reachable */}
      <div className="sticky bottom-0 border-t border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="ide-settings-bar mx-auto flex items-center justify-end gap-3 px-6 py-3">
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
