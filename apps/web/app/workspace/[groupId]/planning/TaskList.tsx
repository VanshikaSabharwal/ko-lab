"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays } from "lucide-react";
import AvatarStack from "../../components/AvatarStack";
import type { AvatarUser } from "../../components/Avatar";
import type {
  PlanningColumn,
  PlanningMilestone,
  PlanningTask,
} from "../../lib/usePlanningData";
import { PRIORITY_META, PRIORITY_ORDER } from "../../lib/taskMeta";
import { cn } from "../../../lib/utils";

/**
 * List view — every task in one flat, sortable table.
 *
 * The board answers "what's in flight"; this answers "what's due next" and
 * "what has no owner", which a column layout hides.
 */

type SortKey = "title" | "milestone" | "due" | "priority" | "status";
type SortDir = "asc" | "desc";

interface TaskListProps {
  tasks: PlanningTask[];
  columns: PlanningColumn[];
  milestones: PlanningMilestone[];
  members: Map<string, AvatarUser>;
  onOpenTask: (task: PlanningTask) => void;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function isOverdue(iso: string): boolean {
  return iso < new Date().toISOString().slice(0, 10);
}

/** Nulls always sort last, whichever direction — an empty cell is never "first". */
function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export default function TaskList({
  tasks,
  columns,
  milestones,
  members,
  onOpenTask,
}: TaskListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const columnTitles = useMemo(
    () => new Map(columns.map((c) => [c.id, c.title])),
    [columns],
  );
  const milestoneNames = useMemo(
    () => new Map(milestones.map((m) => [m.id, m.title])),
    [milestones],
  );

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const milestoneOf = (t: PlanningTask) =>
      t.milestoneId ? (milestoneNames.get(t.milestoneId) ?? null) : null;

    return [...tasks].sort((a, b) => {
      switch (sortKey) {
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "milestone":
          return dir * compareNullable(milestoneOf(a), milestoneOf(b));
        case "due":
          return dir * compareNullable(a.dueDate, b.dueDate);
        case "priority": {
          // By severity, not alphabetically — "High" before "Low".
          const rank = (t: PlanningTask) =>
            t.priority ? PRIORITY_ORDER.indexOf(t.priority) : PRIORITY_ORDER.length;
          return dir * (rank(a) - rank(b));
        }
        case "status":
          return (
            dir *
            compareNullable(
              columnTitles.get(a.columnId) ?? null,
              columnTitles.get(b.columnId) ?? null,
            )
          );
        default:
          return 0;
      }
    });
  }, [tasks, sortKey, sortDir, milestoneNames, columnTitles]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <th scope="col" className="px-3 py-2 text-left font-medium">
      <button
        onClick={() => toggleSort(k)}
        aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        className="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white"
      >
        {label}
        {sortKey === k &&
          (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  const assigneesOf = (task: PlanningTask) =>
    task.assigneeIds.map((id) => members.get(id)).filter((u): u is AvatarUser => Boolean(u));

  if (tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No tasks to show.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {/* Table below sm would need six columns in ~400px, so small screens get
          stacked cards with the same fields instead. */}
      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead className="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          <tr className="border-b border-gray-200 dark:border-gray-800">
            <SortHeader label="Task" k="title" />
            <SortHeader label="Status" k="status" />
            <SortHeader label="Milestone" k="milestone" />
            <SortHeader label="Priority" k="priority" />
            <SortHeader label="Due" k="due" />
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Assignees
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((task) => (
            <tr
              key={task.id}
              onClick={() => onOpenTask(task)}
              className="cursor-pointer border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-900/60"
            >
              <td className="max-w-[20rem] truncate px-3 py-2 text-gray-800 dark:text-gray-100">
                {task.title || <span className="italic text-gray-400">Untitled task</span>}
              </td>
              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                {columnTitles.get(task.columnId) ?? "—"}
              </td>
              <td className="px-3 py-2">
                {task.milestoneId ? (
                  <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    {milestoneNames.get(task.milestoneId) ?? "Unknown"}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-600">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                {task.priority ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                      PRIORITY_META[task.priority].chip,
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_META[task.priority].dot)}
                    />
                    {PRIORITY_META[task.priority].label}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-600">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {task.dueDate ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs",
                      isOverdue(task.dueDate)
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-gray-500 dark:text-gray-400",
                    )}
                  >
                    <CalendarDays size={11} />
                    {formatDate(task.dueDate)}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-600">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end">
                  <AvatarStack users={assigneesOf(task)} size={22} max={3} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 sm:hidden">
        {sorted.map((task) => (
          <li key={task.id}>
            <button
              onClick={() => onOpenTask(task)}
              className="w-full px-3 py-2.5 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-100">
                  {task.title || <span className="italic text-gray-400">Untitled task</span>}
                </span>
                <AvatarStack users={assigneesOf(task)} size={20} max={3} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {columnTitles.get(task.columnId) ?? "—"}
                </span>
                {task.milestoneId && (
                  <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                    {milestoneNames.get(task.milestoneId) ?? "Unknown"}
                  </span>
                )}
                {task.priority && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      PRIORITY_META[task.priority].chip,
                    )}
                  >
                    {PRIORITY_META[task.priority].label}
                  </span>
                )}
                {task.dueDate && (
                  <span
                    className={cn(
                      "text-[10px]",
                      isOverdue(task.dueDate)
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-gray-500 dark:text-gray-400",
                    )}
                  >
                    {formatDate(task.dueDate)}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
