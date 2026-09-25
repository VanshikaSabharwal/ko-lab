"use client";

import React from "react";
import { X } from "lucide-react";
import { getFileIcon } from "../lib/fileTypes";
import { cn } from "../../../../lib/utils";

interface EditorTabsProps {
  openFiles: string[];
  activePath: string;
  /** Paths with unsaved edits — shown as a dot instead of the close X. */
  dirtyPaths?: Set<string>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /** Pinned to the right of the tab strip, outside its horizontal scroll. */
  actions?: React.ReactNode;
}

export default function EditorTabs({
  openFiles,
  activePath,
  dirtyPaths,
  onSelect,
  onClose,
  actions,
}: EditorTabsProps) {
  if (openFiles.length === 0) return null;

  return (
    <div className="flex shrink-0 border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {openFiles.map((path) => {
          const name = path.split("/").pop() ?? path;
          const { icon, color } = getFileIcon(name);
          const isActive = path === activePath;
          const isDirty = dirtyPaths?.has(path);

          return (
            <div
              key={path}
              onClick={() => onSelect(path)}
              role="tab"
              aria-selected={isActive}
              title={path}
              className={cn(
                "group flex shrink-0 cursor-pointer items-center gap-2 border-r border-gray-200 px-3 py-2 text-sm transition-colors dark:border-gray-800",
                isActive
                  ? "border-b-2 border-b-blue-500 bg-white text-gray-900 dark:bg-gray-900 dark:text-white"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900/60",
              )}
            >
              <span className={cn("shrink-0", color)}>{icon}</span>
              <span className="max-w-[10rem] truncate">{name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(path);
                }}
                aria-label={`Close ${name}`}
                className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                {/* A dirty file shows a dot until hovered, so unsaved work isn't
                    closed by reflex. */}
                {isDirty ? (
                  <>
                    <span className="block h-2 w-2 rounded-full bg-blue-500 group-hover:hidden" />
                    <X size={13} className="hidden group-hover:block" />
                  </>
                ) : (
                  <X size={13} />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1 px-2">{actions}</div>}
    </div>
  );
}
