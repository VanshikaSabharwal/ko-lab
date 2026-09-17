"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import {
  BG_GROUPS,
  bgLabel,
  bgStyles,
  type BgOption,
} from "../lib/chatBackgrounds";

interface ChatBackgroundPickerProps {
  /** Currently applied background's `value`. */
  current: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

/**
 * The full background palette, shown over the chat.
 *
 * Swatches preview the colour for the *active* theme, so what you see in the
 * grid is what the chat will actually look like — picking by a light pastel
 * while in dark mode would otherwise be guesswork.
 */
export default function ChatBackgroundPicker({
  current,
  onSelect,
  onClose,
}: ChatBackgroundPickerProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Escape closes, matching every other dismissible layer in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** A swatch's preview fill under the active theme. */
  const previewStyle = (opt: BgOption) => {
    if (opt.kind === "color") {
      return { backgroundColor: isDark ? (opt.dark ?? opt.light) : opt.light };
    }
    return {};
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Chat background"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Chat Background
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {BG_GROUPS.map((group) => (
            <div key={group.name} className="mb-5 last:mb-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {group.name}
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {group.options.map((opt) => {
                  const selected = current === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => onSelect(opt.value)}
                      aria-pressed={selected}
                      className={`flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all ${
                        selected
                          ? "ring-2 ring-blue-500"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span
                        style={previewStyle(opt)}
                        className={`h-10 w-full rounded-md border border-gray-200 dark:border-gray-700 ${
                          opt.kind === "class"
                            ? (isDark ? opt.dark ?? "" : opt.light)
                            : ""
                        }`}
                      />
                      <span className="text-center text-[11px] leading-tight text-gray-600 dark:text-gray-300">
                        {bgLabel(opt, isDark)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
