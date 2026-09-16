"use client";

import React, { useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AvatarUser } from "../../components/Avatar";
import type {
  PlanningColumn,
  PlanningDependency,
  PlanningMilestone,
  PlanningTask,
} from "../../lib/usePlanningData";
import WorkflowTaskNode, {
  WORKFLOW_DRAG_HANDLE,
  type WorkflowNodeData,
} from "./WorkflowTaskNode";

/**
 * Workflow view — tasks as nodes, dependencies as arrows.
 *
 * Deliberately built on usePlanningData rather than useWorkspaceBoard: that
 * hook persists an opaque {nodes, edges} blob, but a dependency has to be a
 * queryable row (it drives ordering elsewhere), and a task is already a row.
 * So React Flow here is a renderer over relational state, not the source of it.
 */

const NODE_TYPES: NodeTypes = { task: WorkflowTaskNode };

// Auto-layout geometry for tasks that have never been dragged.
const COL_WIDTH = 280;
const ROW_HEIGHT = 150;
const ORIGIN = 40;

interface TaskWorkflowProps {
  tasks: PlanningTask[];
  columns: PlanningColumn[];
  milestones: PlanningMilestone[];
  members: Map<string, AvatarUser>;
  onOpenTask: (task: PlanningTask) => void;
  onConnectTasks: (blockerId: string, dependentId: string) => void;
  onDisconnectTasks: (blockerId: string, dependentId: string) => void;
  onMoveTask: (id: string, x: number, y: number) => void;
  dependencies: PlanningDependency[];
}

export default function TaskWorkflow({
  tasks,
  columns,
  milestones,
  members,
  dependencies,
  onOpenTask,
  onConnectTasks,
  onDisconnectTasks,
  onMoveTask,
}: TaskWorkflowProps) {
  const milestoneNames = useMemo(
    () => new Map(milestones.map((m) => [m.id, m.title])),
    [milestones],
  );

  /**
   * Tasks predate flowX/flowY, so most start null. Fall back to a grid banded
   * by column — which reads as a left-to-right pipeline, matching how the board
   * is already arranged. Positions are only persisted when the user actually
   * drags, so an untouched board writes nothing on load.
   */
  const nodes = useMemo<Node[]>(() => {
    const columnIndex = new Map(columns.map((c, i) => [c.id, i]));
    const seenPerColumn = new Map<string, number>();

    return tasks.map((task) => {
      const band = columnIndex.get(task.columnId) ?? 0;
      const row = seenPerColumn.get(task.columnId) ?? 0;
      seenPerColumn.set(task.columnId, row + 1);

      const assignees = task.assigneeIds
        .map((id) => members.get(id))
        .filter((u): u is AvatarUser => Boolean(u));

      const data: WorkflowNodeData = {
        title: task.title,
        priority: task.priority,
        dueDate: task.dueDate,
        milestoneName: task.milestoneId
          ? (milestoneNames.get(task.milestoneId) ?? null)
          : null,
        assignees,
        onOpen: () => onOpenTask(task),
      };

      return {
        id: task.id,
        type: "task",
        position: {
          x: task.flowX ?? ORIGIN + band * COL_WIDTH,
          y: task.flowY ?? ORIGIN + row * ROW_HEIGHT,
        },
        // Restricts dragging to the header grip; the body is a button.
        dragHandle: `.${WORKFLOW_DRAG_HANDLE}`,
        data,
      };
    });
  }, [tasks, columns, members, milestoneNames, onOpenTask]);

  /** Only edges whose endpoints are both present — a stale edge would throw. */
  const edges = useMemo<Edge[]>(() => {
    const present = new Set(tasks.map((t) => t.id));
    return dependencies
      .filter((d) => present.has(d.blockerId) && present.has(d.dependentId))
      .map((d) => ({
        id: d.id,
        source: d.blockerId,
        target: d.dependentId,
        animated: true,
        style: { strokeWidth: 2 },
      }));
  }, [dependencies, tasks]);

  const existingPairs = useMemo(
    () => new Set(dependencies.map((d) => `${d.blockerId}->${d.dependentId}`)),
    [dependencies],
  );

  /**
   * Client-side guards for instant feedback. The server still re-checks and
   * owns cycle rejection, which needs the whole graph.
   */
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const { source, target } = connection;
      if (!source || !target || source === target) return false;
      return !existingPairs.has(`${source}->${target}`);
    },
    [existingPairs],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      onConnectTasks(connection.source, connection.target);
    },
    [onConnectTasks],
  );

  // Persist on drop rather than on every frame of the drag — one request per
  // move instead of dozens.
  const handleNodeDragStop = useCallback(
    (_e: React.MouseEvent | MouseEvent | TouchEvent, node: Node) => {
      onMoveTask(node.id, Math.round(node.position.x), Math.round(node.position.y));
    },
    [onMoveTask],
  );

  const handleEdgeClick = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.stopPropagation();
      onDisconnectTasks(edge.source, edge.target);
    },
    [onDisconnectTasks],
  );

  if (tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
            No tasks to lay out yet
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Add tasks on the Board, then drag between them here to set what blocks what.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={handleNodeDragStop}
        onEdgeClick={handleEdgeClick}
        fitView
        // Nodes are positioned from props each render, so React Flow must not
        // also keep its own copy — otherwise a remote move fights the local one.
        nodesConnectable
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-gray-900/70 px-2 py-1 text-[10px] text-white md:bottom-3">
        Drag handle to handle to link tasks · click a link to remove it
      </p>
    </div>
  );
}
