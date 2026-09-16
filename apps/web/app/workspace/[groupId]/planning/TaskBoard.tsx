"use client";

import React from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import TaskColumn from "./TaskColumn";
import type { AvatarUser } from "../../components/Avatar";
import type { PlanningColumn, PlanningTask } from "../../lib/usePlanningData";
import { positionForMove } from "../../lib/position";

interface TaskBoardProps {
  columns: PlanningColumn[];
  tasksByColumn: Map<string, PlanningTask[]>;
  members: Map<string, AvatarUser>;
  /** Task id → milestone name, for the status pill. */
  milestoneNames: Map<string, string>;
  searching: boolean;
  onAddColumn: () => void;
  onRenameColumn: (id: string, title: string) => void;
  onDeleteColumn: (id: string) => void;
  onAddTask: (columnId: string) => void;
  onOpenTask: (task: PlanningTask) => void;
  onDeleteTask: (id: string) => void;
  onMoveTask: (id: string, columnId: string, position: number) => void;
}

export default function TaskBoard({
  columns,
  tasksByColumn,
  members,
  milestoneNames,
  searching,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onAddTask,
  onOpenTask,
  onDeleteTask,
  onMoveTask,
}: TaskBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // The delay is what lets a vertical swipe scroll instead of dragging.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);
    if (taskId === overId) return;

    // The drop target is either a column (empty area) or another task.
    const targetColumn =
      columns.find((c) => c.id === overId) ??
      columns.find((c) => (tasksByColumn.get(c.id) ?? []).some((t) => t.id === overId));
    if (!targetColumn) return;

    const targetTasks = tasksByColumn.get(targetColumn.id) ?? [];
    const overIndex = targetTasks.findIndex((t) => t.id === overId);
    // Dropping on the column itself appends; dropping on a task takes its slot.
    const toIndex = overIndex === -1 ? targetTasks.length : overIndex;

    const position = positionForMove(targetTasks, taskId, toIndex);
    if (position === null) {
      // Gap exhausted after many drops into the same slot. Rare, but colliding
      // positions would corrupt the order, so refuse rather than guess.
      return;
    }

    onMoveTask(taskId, targetColumn.id, position);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto p-3 sm:p-4">
        {columns.map((column) => (
          <TaskColumn
            key={column.id}
            column={column}
            tasks={tasksByColumn.get(column.id) ?? []}
            members={members}
            milestoneNames={milestoneNames}
            filtered={searching}
            onRename={(title) => onRenameColumn(column.id, title)}
            onDelete={() => onDeleteColumn(column.id)}
            onAddTask={() => onAddTask(column.id)}
            onOpenTask={onOpenTask}
            onDeleteTask={onDeleteTask}
          />
        ))}

        {/* Matches the column cards in height so the row reads as one shelf. */}
        <div className="flex w-[85vw] max-w-xs shrink-0 snap-start flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center dark:border-gray-700 md:w-72 md:max-w-none">
          <span
            aria-hidden
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-purple-400/40 text-purple-500 dark:text-purple-400"
          >
            <Plus size={20} />
          </span>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Add new column</p>
          <p className="mt-1 max-w-[14rem] text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Create a new column to organize your workflow.
          </p>
          <button
            onClick={onAddColumn}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:border-blue-500/60 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:border-blue-600/60 dark:hover:text-white"
          >
            <Plus size={13} /> Add column
          </button>
        </div>
      </div>
    </DndContext>
  );
}
