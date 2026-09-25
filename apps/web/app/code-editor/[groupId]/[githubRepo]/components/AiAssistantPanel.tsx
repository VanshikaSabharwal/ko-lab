"use client";

import React from "react";
import { Bot, PanelRightClose, Sparkles, X } from "lucide-react";

interface AiAssistantPanelProps {
  /** Mobile sheet dismiss; omitted on desktop where the panel is docked. */
  onClose?: () => void;
  onGenerateReadme?: () => void;
  generatingReadme?: boolean;
  /** Collapses the docked panel to a rail. Absent on mobile, where it's a sheet. */
  onCollapse?: () => void;
}

/**
 * AI tools for the repo. Only what works is shown: chat about the open file
 * isn't built yet, so there is no disabled composer or placeholder for it.
 */
export default function AiAssistantPanel({
  onClose,
  onGenerateReadme,
  generatingReadme,
  onCollapse,
}: AiAssistantPanelProps) {
  return (
    <aside className="flex h-full w-full flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950 lg:w-80">
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

      {onGenerateReadme && (
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
      )}
    </aside>
  );
}
