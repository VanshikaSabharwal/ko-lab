"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { Menu, Search, Settings, Moon, Sun, Check, Loader2, WifiOff } from "lucide-react";
import Avatar, { type AvatarUser } from "./Avatar";
import AvatarStack from "./AvatarStack";
import { cn } from "../../lib/utils";

interface WorkspaceTopBarProps {
  groupId: string;
  /** Breadcrumb trail; the last entry renders as the current page. */
  crumbs: { label: string; href?: string }[];
  isSaving: boolean;
  /** True only after live sync has been down past the grace period. */
  isOffline: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  /** Members currently viewing this board. */
  presentMembers: AvatarUser[];
  /** Current user, preferred over the session (whose image goes stale). */
  currentUser?: AvatarUser & { role?: string };
  onOpenMenu: () => void;
}

/**
 * Reflects write state: offline beats in-flight beats saved.
 *
 * `isOffline` only goes true after live sync has been down for a while, so a
 * routine reconnect never flashes a warning. Even then it's a muted dot with a
 * tooltip rather than a coloured pill — work is still saved over HTTP; only
 * live collaboration is affected.
 */
function SaveStatus({
  isSaving,
  isOffline,
}: {
  isSaving: boolean;
  isOffline: boolean;
}) {
  if (isOffline) {
    return (
      <span
        title="Live sync is offline — your changes are still saved, but you won't see teammates' edits until it reconnects."
        className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500"
      >
        <WifiOff size={11} />
        Offline
      </span>
    );
  }
  if (isSaving) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
        <Loader2 size={11} className="animate-spin" />
        Saving…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      <Check size={11} />
      All changes saved
    </span>
  );
}

export default function WorkspaceTopBar({
  crumbs,
  isSaving,
  isOffline,
  search,
  onSearchChange,
  presentMembers,
  currentUser,
  onOpenMenu,
}: WorkspaceTopBarProps) {
  const { data: session } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  // Below lg: the search box is collapsed behind an icon — the top bar has no
  // room for it there. Opening it is what makes ⌘K reachable on small screens,
  // where the input previously wasn't rendered at all.
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl+K focuses search. Not a command palette — cmdk isn't installed,
  // and a filter over the loaded board is what this page actually needs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        // Wait a frame so the input exists before focusing it when it was
        // collapsed a moment ago.
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        searchRef.current?.blur();
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const user: AvatarUser = currentUser ?? {
    id: session?.user?.id ?? "me",
    name: session?.user?.name ?? null,
    image: session?.user?.image ?? null,
  };

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950 sm:px-4">
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 md:hidden"
      >
        <Menu size={18} />
      </button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <React.Fragment key={`${crumb.label}-${i}`}>
              {i > 0 && <span className="text-gray-300 dark:text-gray-700">/</span>}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="shrink-0 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    "truncate",
                    last
                      ? "font-semibold text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-gray-400",
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          );
        })}
        <span className="ml-1.5 hidden shrink-0 sm:inline">
          <SaveStatus isSaving={isSaving} isOffline={isOffline} />
        </span>
      </nav>

      <div className={cn("relative", searchOpen ? "block w-full order-last lg:order-none lg:w-auto" : "hidden lg:block")}>
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tasks…"
          className="w-full rounded-md border border-gray-200 lg:w-56 bg-gray-50 py-1.5 pl-8 pr-12 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-gray-200 px-1 py-0.5 font-mono text-[10px] text-gray-400 dark:border-gray-700">
          ⌘K
        </kbd>
      </div>

      <button
        onClick={() => {
          setSearchOpen((v) => !v);
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        aria-label="Search tasks"
        aria-expanded={searchOpen}
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden"
      >
        <Search size={16} />
      </button>

      <div className="flex shrink-0 items-center gap-2">
        {presentMembers.length > 0 && (
          <AvatarStack users={presentMembers} size={26} max={3} />
        )}

        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <Link
          href="/profile"
          aria-label="Settings"
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <Settings size={16} />
        </Link>

        <Link href="/profile" className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800">
          <Avatar user={user} size={28} />
          <span className="hidden leading-tight sm:block">
            <span className="block max-w-[9rem] truncate text-xs font-semibold text-gray-900 dark:text-white">
              {user.name ?? "You"}
            </span>
            {currentUser?.role && (
              <span className="block text-[10px] capitalize text-gray-500 dark:text-gray-400">
                {currentUser.role === "OWNER" ? "Project admin" : currentUser.role.toLowerCase()}
              </span>
            )}
          </span>
        </Link>
      </div>

      {/* Save status moves below the breadcrumb when the row gets tight. */}
      <span className="w-full sm:hidden">
        <SaveStatus isSaving={isSaving} isOffline={isOffline} />
      </span>
    </header>
  );
}
