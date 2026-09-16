"use client";

import React, { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import TaskCard from "./TaskCard";
import type { AvatarUser } from "../../components/Avatar";
import ColumnEmptyState from "./ColumnEmptyState";
import type { PlanningColumn, PlanningTask } from "../../lib/usePlanningData";
import { columnKind, defaultColumnColor } from "../../lib/taskMeta";
import { cn } from "../../../lib/utils";

interface TaskColumnProps {
  column: PlanningColumn;
  tasks: PlanningTask[];
  members: Map<string, AvatarUser>;
  /** Task id → milestone name, for the status pill. */
  milestoneNames: Map<string, string>;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAddTask: () => void;
  onOpenTask: (task: PlanningTask) => void;
  onDeleteTask: (id: string) => void;
  /** True when a search is active and this column matched nothing. */
  filtered?: boolean;
}

export default function TaskColumn({
  column,
  tasks,
  members,
  milestoneNames,
  onRename,
  onDelete,
  onAddTask,
  onOpenTask,
  onDeleteTask,
  filtered,
}: TaskColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [menuOpen, setMenuOpen] = useState(false);
  // Drives both the dot colour and which empty state this column shows.
  const kind = columnKind(column.title);

  return (
    <div className="flex w-[85vw] max-w-xs shrink-0 snap-start flex-col rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60 md:w-72 md:max-w-none">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: column.color ?? defaultColumnColor(kind) }}
        />
        <input
          value={column.title}
          onChange={(e) => onRename(e.target.value)}
          aria-label="Column name"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-gray-900 outline-none dark:text-white"
        />
        <span className="shrink-0 rounded-full bg-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {tasks.length}
        </span>

        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Column options"
            aria-expanded={menuOpen}
            className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <>
              {/* Click-away layer, so the menu closes without a global listener. */}
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={12} />
                  Delete column
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 space-y-2 px-2 pb-2 transition-colors",
          isOver && "bg-blue-100/50 dark:bg-blue-900/20",
        )}
        style={{ minHeight: 80 }}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              members={members}
              milestoneName={milestoneNames.get(task.id) ?? null}
              onOpen={() => onOpenTask(task)}
              onDelete={() => onDeleteTask(task.id)}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <ColumnEmptyState kind={kind} filtered={filtered} onAddTask={onAddTask} />
        )}
      </div>

      <button
        onClick={onAddTask}
        className="flex items-center justify-center gap-1 border-t border-gray-200 py-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-white"
      >
        <Plus size={13} /> Add task
      </button>
    </div>
  );
}
