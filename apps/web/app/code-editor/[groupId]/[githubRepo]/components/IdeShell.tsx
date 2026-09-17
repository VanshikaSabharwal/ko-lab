"use client";

import React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  Folder, Users, Settings, Menu, Search, LogOut, Plus, X, Sparkles, Trash2,
} from "lucide-react";
import { cn } from "../../../../lib/utils";

export type IdeSection = "files" | "collaboration" | "trash" | "settings";

interface IdeShellProps {
  repo: string;
  section: IdeSection;
  onSectionChange: (s: IdeSection) => void;
  search: string;
  onSearchChange: (v: string) => void;
  /** File explorer, rendered inside the sidebar. */
  explorer: React.ReactNode;
  children: React.ReactNode;
  /** Opens the AI panel on mobile, where it can't be docked. */
  onOpenAi?: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** Staged deletions expiring within a day; shown as a badge on Trash. */
  trashWarningCount?: number;
}

const NAV: { key: IdeSection; label: string; short: string; icon: typeof Folder }[] = [
  { key: "files", label: "Files", short: "Files", icon: Folder },
  { key: "collaboration", label: "Collaboration", short: "Collab", icon: Users },
  { key: "trash", label: "Trash", short: "Trash", icon: Trash2 },
  { key: "settings", label: "Settings", short: "Settings", icon: Settings },
];

export default function IdeShell({
  repo, section, onSectionChange, search, onSearchChange,
  explorer, children, onOpenAi, menuOpen, onMenuOpenChange,
  trashWarningCount = 0,
}: IdeShellProps) {
  return (
    <div className="flex h-[100dvh] flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-white">
      {/* Top nav */}
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <button
          onClick={() => onMenuOpenChange(true)}
          aria-label="Open menu"
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 md:hidden"
        >
          <Menu size={18} />
        </button>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onSectionChange(key)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                section === key
                  ? "border-b-2 border-blue-500 font-medium text-gray-900 dark:text-white"
                  : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white",
              )}
            >
              {label}
              {key === "trash" && trashWarningCount > 0 && <NavBadge n={trashWarningCount} />}
            </button>
          ))}
        </nav>

        <div className="relative ml-auto hidden min-w-0 flex-1 justify-end sm:flex md:max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files…"
            aria-label="Search files"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white"
          />
        </div>

      </header>

      <div className="relative flex min-h-0 flex-1">
        {menuOpen && (
          <div
            onClick={() => onMenuOpenChange(false)}
            className="absolute inset-0 z-30 bg-black/40 md:hidden"
            aria-hidden
          />
        )}

        {/* Sidebar — a drawer on phones, docked from md: up */}
        <aside
          className={cn(
            "absolute inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50 transition-transform dark:border-gray-800 dark:bg-gray-950",
            "md:relative md:z-auto md:!translate-x-0 md:transition-none",
            menuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-gray-900 dark:text-white">Ko-lab IDE</p>
              <p className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-widest text-gray-400">
                {repo || "Active workspace"}
              </p>
            </div>
            <button
              onClick={() => onMenuOpenChange(false)}
              aria-label="Close menu"
              className="rounded p-1 text-gray-500 md:hidden"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-3 pb-3">
            <Link
              href="/create-group"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              <Plus size={15} /> New Project
            </Link>
          </div>

          <nav className="px-2">
            {NAV.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { onSectionChange(key); onMenuOpenChange(false); }}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  section === key
                    ? "bg-blue-600/10 font-medium text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                    : "text-gray-600 hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-gray-800",
                )}
              >
                <Icon size={16} /> {label}
                {key === "trash" && trashWarningCount > 0 && (
                  <NavBadge n={trashWarningCount} />
                )}
              </button>
            ))}
          </nav>

          <p className="mt-4 px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Project explorer
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">{explorer}</div>

          <div className="border-t border-gray-200 px-2 py-2 dark:border-gray-800">
            <button
              onClick={() => signOut()}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-gray-600 hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>

      {/* Mobile: floating AI button + bottom tab bar */}
      {onOpenAi && (
        <button
          onClick={onOpenAi}
          aria-label="Open AI assistant"
          className="fixed bottom-20 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white shadow-lg lg:hidden"
        >
          <Sparkles size={20} />
        </button>
      )}

      <nav className="flex shrink-0 items-center justify-around border-t border-gray-200 bg-gray-50 py-1.5 dark:border-gray-800 dark:bg-gray-900 md:hidden">
        {NAV.map(({ key, short, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onSectionChange(key)}
            className={cn(
              "relative flex flex-col items-center gap-0.5 rounded-lg px-4 py-1 text-[11px] transition-colors",
              section === key
                ? "bg-blue-600 text-white"
                : "text-gray-500 dark:text-gray-400",
            )}
          >
            <Icon size={18} /> {short}
            {key === "trash" && trashWarningCount > 0 && (
              <span className="absolute right-2 top-0 h-2 w-2 rounded-full bg-amber-500" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Count of staged deletions about to expire. Amber, not red: expiry restores
    the file, so it is a nudge rather than a warning about data loss. */
function NavBadge({ n }: { n: number }) {
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
      {n}
    </span>
  );
}
