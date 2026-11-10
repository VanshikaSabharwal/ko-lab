"use client";

import React from "react";
import { GitBranch, CircleAlert, TriangleAlert, Bell } from "lucide-react";
import { getLanguageLabel, hasLinter, hasSyntaxLinter } from "../lib/fileTypes";

interface EditorStatusBarProps {
  branch: string;
  isDirty: boolean;
  fileName: string;
  /** Null when the active language has no linter available. */
  errors: number | null;
  warnings: number | null;
}

export default function EditorStatusBar({
  branch,
  isDirty,
  fileName,
  errors,
  warnings,
}: EditorStatusBarProps) {
  // A language with no linter reports "—", never "0": a zero would claim the
  // file was checked and found clean when nothing checked it at all.
  const checked = fileName ? hasLinter(fileName) : false;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-gray-100 px-3 py-1 text-[11px] text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1" title="Current branch">
          <GitBranch size={11} />
          {branch || "—"}
          {isDirty && <span title="Unsaved changes">*</span>}
        </span>

        <span
          className="flex items-center gap-2"
          title={
            !checked
              ? "No linter for this language"
              : hasSyntaxLinter(fileName)
                ? "Syntax errors only (type errors are not checked)"
                : "Problems in this file"
          }
        >
          <span className="flex items-center gap-1">
            <CircleAlert size={11} />
            {checked ? (errors ?? 0) : "—"}
          </span>
          <span className="flex items-center gap-1">
            <TriangleAlert size={11} />
            {checked ? (warnings ?? 0) : "—"}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span>UTF-8</span>
        <span>{getLanguageLabel(fileName)}</span>
        <Bell size={11} />
      </div>
    </div>
  );
}
