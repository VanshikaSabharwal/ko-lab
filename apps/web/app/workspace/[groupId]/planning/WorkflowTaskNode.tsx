"use client";

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CalendarDays, GripVertical } from "lucide-react";
import AvatarStack from "../../components/AvatarStack";
import type { AvatarUser } from "../../components/Avatar";
import { PRIORITY_META } from "../../lib/taskMeta";
import { cn } from "../../../lib/utils";
import type { PlanningPriority } from "../../lib/usePlanningData";

/** Everything the node renders, assembled by TaskWorkflow. */
export interface WorkflowNodeData {
  title: string;
  priority: PlanningPriority | null;
  dueDate: string | null;
  /** Milestone name — the status pill. Null when the task has no milestone. */
  milestoneName: string | null;
  assignees: AvatarUser[];
  onOpen: () => void;
  [key: string]: unknown;
}

function formatDue(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function isOverdue(iso: string): boolean {
  return iso < new Date().toISOString().slice(0, 10);
}

/** Class the node's `dragHandle` points at — see the comment on the header. */
export const WORKFLOW_DRAG_HANDLE = "workflow-drag-handle";

/**
 * A task as a Workflow node. Content mirrors TaskCard so the same task doesn't
 * look like two different things across views; the difference is the connection
 * handles and that dragging moves it in 2-D rather than reordering a column.
 */
function WorkflowTaskNode({ data, selected }: NodeProps & { data: WorkflowNodeData }) {
  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-white shadow-sm dark:bg-gray-900",
        selected
          ? "border-blue-500 ring-1 ring-blue-500/40"
          : "border-gray-200 dark:border-gray-800",
      )}
    >
      {/* Left = this task's blockers arrive; right = tasks it blocks. Sized
          above the 6px default so they're reachable on a touch screen. */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-blue-500 dark:!border-gray-900"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-blue-500 dark:!border-gray-900"
      />

      {/* The header is the only drag surface: the node sets dragHandle to this
          class, so React Flow ignores the nodrag body. Without it the clickable
          body covers the node and there is nothing left to grab. */}
      <div
        className={cn(
          WORKFLOW_DRAG_HANDLE,
          "flex cursor-grab items-center gap-1 rounded-t-lg border-b border-gray-200 bg-gray-50 px-2 py-1.5 active:cursor-grabbing dark:border-gray-800 dark:bg-gray-800/60",
        )}
      >
        <GripVertical size={13} className="shrink-0 text-gray-400 dark:text-gray-600" />
        {data.milestoneName ? (
          <span className="truncate rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
            {data.milestoneName}
          </span>
        ) : (
          <span className="text-[10px] text-gray-400 dark:text-gray-600">No milestone</span>
        )}
      </div>

      <div className="p-2.5">
        <button
          onClick={data.onOpen}
          className="nodrag block w-full text-left text-sm text-gray-800 dark:text-gray-100"
        >
          {data.title || <span className="italic text-gray-400">Untitled task</span>}
        </button>

        {data.priority && (
          <span
            className={cn(
              "mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
              PRIORITY_META[data.priority].chip,
            )}
          >
            <span
              aria-hidden
              className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_META[data.priority].dot)}
            />
            {PRIORITY_META[data.priority].label}
          </span>
        )}

        {(data.dueDate || data.assignees.length > 0) && (
          <div className="mt-2 flex items-center justify-between gap-2">
            {data.dueDate ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                  isOverdue(data.dueDate)
                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    : "text-gray-500 dark:text-gray-400",
                )}
              >
                <CalendarDays size={11} />
                {formatDue(data.dueDate)}
              </span>
            ) : (
              <span />
            )}
            <AvatarStack users={data.assignees} size={22} max={3} />
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(WorkflowTaskNode);
