"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, Trash2 } from "lucide-react";
import AvatarStack from "../../components/AvatarStack";
import type { AvatarUser } from "../../components/Avatar";
import type { PlanningTask } from "../../lib/usePlanningData";
import { PRIORITY_META } from "../../lib/taskMeta";
import { cn } from "../../../lib/utils";

interface TaskCardProps {
  task: PlanningTask;
  members: Map<string, AvatarUser>;
  /** Milestone name for the status pill; omitted when the task has none. */
  milestoneName?: string | null;
  onOpen: () => void;
  onDelete: () => void;
}

/** "2026-09-14" → "Sep 14". Parsed at midday so the day never slips back. */
function formatDue(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function isOverdue(iso: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return iso < today;
}

export default function TaskCard({
  task,
  members,
  milestoneName,
  onOpen,
  onDelete,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const assignees = task.assigneeIds
    .map((id) => members.get(id))
    .filter((u): u is AvatarUser => Boolean(u));

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="group rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm transition-colors hover:border-blue-500/50 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start gap-1.5">
        {/* Drag lives on the grip alone — spreading listeners over the card
            makes every touch ambiguous between typing, dragging and scrolling. */}
        <button
          {...attributes}
          {...listeners}
          aria-label="Reorder task"
          className="mt-0.5 shrink-0 cursor-grab touch-none text-gray-300 active:cursor-grabbing dark:text-gray-600"
        >
          <GripVertical size={14} />
        </button>

        <button
          onClick={onOpen}
          className="min-w-0 flex-1 text-left text-sm text-gray-800 dark:text-gray-100"
        >
          {task.title || <span className="italic text-gray-400">Untitled task</span>}
        </button>

        <button
          onClick={onDelete}
          aria-label="Delete task"
          // Always visible on touch, where there is no hover to reveal it.
          className="shrink-0 p-0.5 text-gray-300 hover:text-red-500 dark:text-gray-600 md:opacity-0 md:group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {(task.priority || milestoneName) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
          {milestoneName && (
            <span className="max-w-full truncate rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
              {milestoneName}
            </span>
          )}
          {task.priority && (
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
          )}
        </div>
      )}

      {(task.dueDate || assignees.length > 0) && (
        <div className="mt-2 flex items-center justify-between gap-2 pl-5">
          {task.dueDate ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                isOverdue(task.dueDate)
                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  : "text-gray-500 dark:text-gray-400",
              )}
            >
              <CalendarDays size={11} />
              {formatDue(task.dueDate)}
            </span>
          ) : (
            <span />
          )}
          <AvatarStack users={assignees} size={22} max={3} />
        </div>
      )}
    </div>
  );
}
