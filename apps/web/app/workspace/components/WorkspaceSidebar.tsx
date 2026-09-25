"use client";

import React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  LayoutGrid,
  KanbanSquare,
  MessageSquareHeart,
  LogOut,
  X,
} from "lucide-react";
import AvatarStack from "./AvatarStack";
import GroupAvatar from "../../components/GroupAvatar";
import type { AvatarUser } from "./Avatar";
import { cn } from "../../lib/utils";

interface WorkspaceSidebarProps {
  groupId: string;
  groupName: string;
  groupImage?: string | null;
  members: AvatarUser[];
  /** 0–1, or null when the board has no tasks to measure. */
  progress: number | null;
  /** Which nav entry is current. */
  active?: "overview" | "planning";
  /** Mobile drawer state; ignored at md: and up where the sidebar is static. */
  open?: boolean;
  onClose?: () => void;
}

/** Nav entries — only sections that exist; unbuilt ones aren't advertised. */
const NAV = [
  { key: "overview", label: "Overview", icon: LayoutGrid, href: (g: string) => `/workspace/${g}` },
  {
    key: "planning",
    label: "Planning & Milestones",
    icon: KanbanSquare,
    href: (g: string) => `/workspace/${g}/planning`,
  },
] as const;

export default function WorkspaceSidebar({
  groupId,
  groupName,
  groupImage,
  members,
  progress,
  active,
  open,
  onClose,
}: WorkspaceSidebarProps) {
  const pct = progress === null ? null : Math.round(progress * 100);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50 transition-transform duration-200 dark:border-gray-800 dark:bg-gray-950",
        "md:static md:z-auto md:!translate-x-0 md:transition-none",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
            Ko-lab
          </span>
        </Link>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="rounded p-1 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800 md:hidden"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2.5 px-4 pb-4">
        <GroupAvatar name={groupName} image={groupImage} size={32} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{groupName}</p>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Active workspace
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        {NAV.map(({ key, label, icon: Icon, href }) => (
          <Link
            key={key}
            href={href(groupId)}
            onClick={onClose}
            className={cn(
              "mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
              key === active
                ? "bg-blue-600/10 font-medium text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                : "text-gray-600 hover:bg-gray-200/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white",
            )}
          >
            <Icon size={16} className="shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="m-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Team progress</span>
          <span className="text-xs font-semibold text-gray-900 dark:text-white">
            {pct === null ? "No tasks yet" : `${pct}%`}
          </span>
        </div>
        {/* The bar is hidden with no tasks rather than shown empty: a 0%-looking
            bar reads as "nothing done" when the truth is "nothing to do". */}
        {pct !== null && (
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Team progress"
            className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {members.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-gray-400 dark:text-gray-500">
              Members
            </p>
            <AvatarStack users={members} size={24} />
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 px-2 py-2 dark:border-gray-800">
        <Link
          href="/bugs"
          onClick={onClose}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-gray-600 hover:bg-gray-200/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        >
          <MessageSquareHeart size={16} />
          Give feedback
        </Link>
        <button
          onClick={() => signOut()}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-gray-600 hover:bg-gray-200/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
