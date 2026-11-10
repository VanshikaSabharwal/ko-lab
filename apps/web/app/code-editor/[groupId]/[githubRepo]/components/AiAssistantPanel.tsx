"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  Loader2,
  PanelRightClose,
  Search,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import AssistantMarkdown from "../../../../components/AssistantMarkdown";
import type { FindFixState } from "../lib/useFindFix";

export type AssistantTab = "tools" | "fix";

export interface LintError {
  line: number;
  message: string;
}

interface AiAssistantPanelProps {
  /** Mobile sheet dismiss; omitted on desktop where the panel is docked. */
  onClose?: () => void;
  onGenerateReadme?: () => void;
  generatingReadme?: boolean;
  /** Collapses the docked panel to a rail. Absent on mobile, where it's a sheet. */
  onCollapse?: () => void;

  tab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
  /** Errors the in-browser linter found in the open file. */
  lintErrors: LintError[];
  /** False when the open file's language has no linter at all. */
  lintAvailable: boolean;
  /** True for JS/TS, whose linter only sees syntax errors. */
  syntaxOnly: boolean;
  fix: FindFixState;
  onFindLintFix: (error: LintError) => void;
  onFindManualFix: (text: string) => void;
  onCancelFix: () => void;
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

/**
 * AI tools for the repo: README generation, and "Find fix" for errors, which
 * searches the web through SearchApi and has Groq write a fix from the results.
 */
export default function AiAssistantPanel({
  onClose,
  onGenerateReadme,
  generatingReadme,
  onCollapse,
  tab,
  onTabChange,
  lintErrors,
  lintAvailable,
  syntaxOnly,
  fix,
  onFindLintFix,
  onFindManualFix,
  onCancelFix,
}: AiAssistantPanelProps) {
  const [pasted, setPasted] = useState("");
  const loading = fix.status === "loading";

  return (
    <aside className="flex h-full w-full flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2.5 dark:border-gray-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <Bot size={16} className="text-purple-500" />
          AI Assistant
        </h2>
        <div className="flex items-center gap-1">
          {onCollapse && (
            <button
              onClick={onCollapse}
              aria-label="Collapse assistant"
              title="Collapse"
              className="hidden rounded p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 lg:block"
            >
              <PanelRightClose size={15} />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close assistant"
              className="rounded p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 lg:hidden"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div role="tablist" className="flex shrink-0 gap-1 border-b border-gray-200 px-2 py-1.5 text-xs dark:border-gray-800">
        {(
          [
            ["tools", "Tools", Sparkles],
            ["fix", "Fix error", Wrench],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTabChange(id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors ${
              tab === id
                ? "bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-white"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            <Icon size={13} />
            {label}
            {id === "fix" && lintErrors.length > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 text-[10px] leading-4 text-white">
                {lintErrors.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "tools" ? (
          onGenerateReadme && (
            <div className="space-y-2 p-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Write a README for this repo from its files and code.
              </p>
              <button
                onClick={onGenerateReadme}
                disabled={generatingReadme}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles size={15} />
                {generatingReadme ? "Generating…" : "Generate AI README"}
              </button>
            </div>
          )
        ) : (
          <div className="space-y-4 p-3 text-sm">
            {/* Linter errors in the open file */}
            <section className="space-y-2">
              <h3 className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Problems in this file
                {syntaxOnly && (
                  <span className="text-[10px] font-normal normal-case tracking-normal" title="Type errors are not checked">
                    Syntax errors only
                  </span>
                )}
              </h3>
              {!lintAvailable ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No linter for this language. Run the file or paste an error below.
                </p>
              ) : lintErrors.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">No problems found.</p>
              ) : (
                <ul className="space-y-1.5">
                  {lintErrors.map((e, i) => (
                    <li
                      key={`${e.line}-${i}`}
                      className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"
                    >
                      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-gray-400">L{e.line}</span>
                      <span className="min-w-0 flex-1 break-words text-xs text-red-600 dark:text-red-400">
                        {e.message}
                      </span>
                      <button
                        onClick={() => onFindLintFix(e)}
                        disabled={loading}
                        className="shrink-0 rounded-md bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                      >
                        Find fix
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Pasted errors, e.g. from the terminal */}
            <section className="space-y-2">
              <label
                htmlFor="find-fix-paste"
                className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                Paste an error
              </label>
              <textarea
                id="find-fix-paste"
                value={pasted}
                onChange={(e) => setPasted(e.target.value.slice(0, 2000))}
                rows={4}
                placeholder="e.g. a terminal error: Error: Cannot find module 'express'"
                className="w-full resize-y rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              <button
                onClick={() => onFindManualFix(pasted.trim())}
                disabled={loading || !pasted.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              >
                <Search size={13} />
                Find fix
              </button>
            </section>

            <FixResult fix={fix} onCancel={onCancelFix} />
          </div>
        )}
      </div>
    </aside>
  );
}

function FixResult({ fix, onCancel }: { fix: FindFixState; onCancel: () => void }) {
  if (fix.status === "idle") return null;

  return (
    <section className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-800" aria-live="polite">
      <p className="line-clamp-2 break-words font-mono text-[11px] text-gray-500 dark:text-gray-400" title={fix.request.error}>
        {fix.request.error}
      </p>

      {fix.status === "loading" && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-white p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-purple-500" />
            Searching for a fix…
          </span>
          <button
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-2 py-1 text-[11px] hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        </div>
      )}

      {fix.status === "error" && (
        <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{fix.message}</p>
      )}

      {fix.status === "done" && (
        <>
          {fix.data.searchLimited && (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Search limit reached for this month, here&apos;s an AI-only answer.
            </p>
          )}
          {fix.data.searchFailed && (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Web search didn&apos;t respond, so this answer is AI-only.
            </p>
          )}

          {fix.data.aiFix ? (
            <div className="rounded-lg border border-purple-200 bg-white p-3 text-xs text-gray-800 dark:border-purple-900/60 dark:bg-gray-900 dark:text-gray-100">
              <AssistantMarkdown content={fix.data.aiFix} />
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No AI summary this time. The sources below may help.
            </p>
          )}

          {fix.data.results.length > 0 && (
            <div className="space-y-2">
              <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Sources
                {fix.data.cached && (
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal dark:bg-gray-800">
                    cached
                  </span>
                )}
              </h3>
              <ol className="space-y-2">
                {fix.data.results.map((r, i) => (
                  <li key={r.link}>
                    <a
                      href={r.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg border border-gray-200 bg-white p-2 hover:border-purple-400 dark:border-gray-800 dark:bg-gray-900"
                    >
                      <span className="flex items-start gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                        <span className="text-gray-400">[{i + 1}]</span>
                        <span className="min-w-0 flex-1 break-words">{r.title}</span>
                        <ExternalLink size={11} className="mt-0.5 shrink-0" />
                      </span>
                      <span className="mt-0.5 block text-[10px] text-gray-400">{hostOf(r.link)}</span>
                      {r.snippet && (
                        <span className="mt-1 line-clamp-3 block text-[11px] text-gray-600 dark:text-gray-400">
                          {r.snippet}
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex items-center justify-between text-[10px] text-gray-400">
            <a
              href="https://www.searchapi.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-600 hover:underline dark:hover:text-gray-300"
            >
              Search results by SearchApi
            </a>
            <span>{fix.data.remaining} searches left this hour</span>
          </div>
        </>
      )}
    </section>
  );
}
