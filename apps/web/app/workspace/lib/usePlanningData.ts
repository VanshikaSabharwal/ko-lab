"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useWorkspaceSocket } from "./useWorkspaceSocket";

/**
 * Planning board state, backed by the relational API.
 *
 * Replaces usePlanningBoard's whole-content broadcast. That shipped the entire
 * board on every keystroke and fell back to invalidate-and-refetch past ~7KB —
 * a board with assignees and dates crosses that constantly. Every mutation here
 * is an entity delta instead, orders of magnitude under the WS frame limit.
 *
 * Writes are optimistic: apply locally, call the API, broadcast the delta. If
 * the call fails the local change is rolled back, so the UI never claims a
 * change the server rejected.
 */

export interface PlanningColumn {
  id: string;
  title: string;
  position: number;
  color: string | null;
}

export type PlanningPriority = "LOW" | "MEDIUM" | "HIGH";

export interface PlanningTask {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  startDate: string | null;
  dueDate: string | null;
  color: string | null;
  priority: PlanningPriority | null;
  milestoneId: string | null;
  assigneeIds: string[];
  /** Workflow canvas position; null until the task is first dragged there. */
  flowX: number | null;
  flowY: number | null;
}

/** "blocker must finish before dependent starts" — a Workflow arrow. */
export interface PlanningDependency {
  id: string;
  blockerId: string;
  dependentId: string;
}

export interface PlanningMilestone {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string;
  done: boolean;
}

export interface GroupMemberSummary {
  id: string;
  name: string | null;
  image: string | null;
  role: string;
}

interface BoardState {
  columns: PlanningColumn[];
  tasks: PlanningTask[];
  milestones: PlanningMilestone[];
  dependencies: PlanningDependency[];
}

type PlanningOp =
  | { action: "column_upsert"; column: PlanningColumn }
  | { action: "column_delete"; id: string }
  | { action: "task_upsert"; task: PlanningTask }
  | { action: "task_delete"; id: string }
  | { action: "milestone_upsert"; milestone: PlanningMilestone }
  | { action: "milestone_delete"; id: string }
  | { action: "dependency_add"; dependency: PlanningDependency }
  | { action: "dependency_delete"; blockerId: string; dependentId: string };

const EMPTY: BoardState = { columns: [], tasks: [], milestones: [], dependencies: [] };

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
}

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

export function usePlanningData({ groupId, userId }: { groupId: string; userId?: string }) {
  const [state, setState] = useState<BoardState>(EMPTY);
  const [members, setMembers] = useState<GroupMemberSummary[]>([]);
  const [groupName, setGroupName] = useState("Workspace");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(0);

  // Remote ops mutate the same state as local writes; keeping a ref lets
  // rollback restore an exact prior snapshot without stale closures.
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyOp = useCallback((op: PlanningOp) => {
    setState((prev) => {
      switch (op.action) {
        case "column_upsert":
          return { ...prev, columns: upsertById(prev.columns, op.column).sort(byPosition) };
        case "column_delete": {
          // Tasks cascade server-side; mirror that locally — and with them the
          // dependency edges of every task that went away.
          const goneIds = new Set(
            prev.tasks.filter((t) => t.columnId === op.id).map((t) => t.id),
          );
          return {
            ...prev,
            columns: prev.columns.filter((c) => c.id !== op.id),
            tasks: prev.tasks.filter((t) => t.columnId !== op.id),
            dependencies: prev.dependencies.filter(
              (d) => !goneIds.has(d.blockerId) && !goneIds.has(d.dependentId),
            ),
          };
        }
        case "task_upsert":
          return { ...prev, tasks: upsertById(prev.tasks, op.task).sort(byPosition) };
        case "task_delete":
          return {
            ...prev,
            tasks: prev.tasks.filter((t) => t.id !== op.id),
            // The server cascades the task's dependency rows; mirror that here
            // or the Workflow view keeps edges pointing at a node that's gone.
            dependencies: prev.dependencies.filter(
              (d) => d.blockerId !== op.id && d.dependentId !== op.id,
            ),
          };
        case "milestone_upsert":
          return { ...prev, milestones: upsertById(prev.milestones, op.milestone) };
        case "milestone_delete":
          return {
            ...prev,
            milestones: prev.milestones.filter((m) => m.id !== op.id),
            // Server uses SetNull, so tasks survive with the link cleared.
            tasks: prev.tasks.map((t) => (t.milestoneId === op.id ? { ...t, milestoneId: null } : t)),
          };
        case "dependency_add":
          // Keyed on the pair, not the id: an optimistic edge and the server's
          // confirmation of it are the same arrow with different ids.
          return prev.dependencies.some(
            (d) =>
              d.blockerId === op.dependency.blockerId &&
              d.dependentId === op.dependency.dependentId,
          )
            ? {
                ...prev,
                dependencies: prev.dependencies.map((d) =>
                  d.blockerId === op.dependency.blockerId &&
                  d.dependentId === op.dependency.dependentId
                    ? op.dependency
                    : d,
                ),
              }
            : { ...prev, dependencies: [...prev.dependencies, op.dependency] };
        case "dependency_delete":
          return {
            ...prev,
            dependencies: prev.dependencies.filter(
              (d) => !(d.blockerId === op.blockerId && d.dependentId === op.dependentId),
            ),
          };
        default:
          return prev;
      }
    });
  }, []);

  const { isConnected, isOffline, presence, sendOp } = useWorkspaceSocket({
    groupId,
    board: "PLANNING",
    userId,
    onRemoteOp: applyOp,
  });

  // ── Load ──────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    const res = await fetch(`/api/workspace/${groupId}/planning/board`);
    if (!res.ok) return;
    const data = await res.json();
    setState({
      columns: (data.columns ?? []).sort(byPosition),
      tasks: (data.tasks ?? []).sort(byPosition),
      milestones: data.milestones ?? [],
      dependencies: data.dependencies ?? [],
    });
    setLoaded(true);
  }, [groupId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/workspace/${groupId}/planning/board`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/groups/${groupId}/members`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([board, memberData]) => {
        if (cancelled) return;
        if (board) {
          setState({
            columns: (board.columns ?? []).sort(byPosition),
            tasks: (board.tasks ?? []).sort(byPosition),
            milestones: board.milestones ?? [],
            dependencies: board.dependencies ?? [],
          });
        }
        if (memberData) {
          setMembers(memberData.members ?? []);
          if (memberData.groupName) setGroupName(memberData.groupName);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [groupId, userId]);

  /**
   * Apply locally, persist, broadcast. On failure restore the snapshot taken
   * before the optimistic write — the server is the authority.
   */
  const mutate = useCallback(
    async <T>(
      optimistic: PlanningOp | null,
      request: () => Promise<Response>,
      onSuccess: (data: T) => PlanningOp | null,
      failureMessage: string,
    ): Promise<T | null> => {
      const snapshot = stateRef.current;
      if (optimistic) applyOp(optimistic);
      setSaving((n) => n + 1);
      try {
        const res = await request();
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as T;
        const confirmed = onSuccess(data);
        if (confirmed) {
          applyOp(confirmed);
          sendOp(confirmed);
        }
        return data;
      } catch {
        setState(snapshot);
        toast.error(failureMessage);
        return null;
      } finally {
        setSaving((n) => n - 1);
      }
    },
    [applyOp, sendOp],
  );

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // ── Columns ───────────────────────────────────────────────────────────
  const addColumn = useCallback(
    (title: string, color?: string) =>
      mutate<PlanningColumn>(
        null,
        () => fetch(`/api/workspace/${groupId}/planning/columns`, json({ title, color })),
        (column) => ({ action: "column_upsert", column }),
        "Couldn't add the column",
      ),
    [groupId, mutate],
  );

  const updateColumn = useCallback(
    (id: string, patch: Partial<Pick<PlanningColumn, "title" | "color" | "position">>) => {
      const existing = stateRef.current.columns.find((c) => c.id === id);
      return mutate<PlanningColumn>(
        existing ? { action: "column_upsert", column: { ...existing, ...patch } } : null,
        () =>
          fetch(`/api/workspace/${groupId}/planning/columns/${id}`, {
            ...json(patch),
            method: "PATCH",
          }),
        (column) => ({ action: "column_upsert", column }),
        "Couldn't update the column",
      );
    },
    [groupId, mutate],
  );

  const deleteColumn = useCallback(
    (id: string) =>
      mutate<{ id: string }>(
        { action: "column_delete", id },
        () =>
          fetch(`/api/workspace/${groupId}/planning/columns/${id}`, { method: "DELETE" }),
        () => ({ action: "column_delete", id }),
        "Couldn't delete the column",
      ),
    [groupId, mutate],
  );

  // ── Tasks ─────────────────────────────────────────────────────────────
  const addTask = useCallback(
    (columnId: string, fields: Partial<PlanningTask> = {}) =>
      mutate<PlanningTask>(
        null,
        () =>
          fetch(
            `/api/workspace/${groupId}/planning/tasks`,
            json({ columnId, title: fields.title ?? "", ...fields }),
          ),
        (task) => ({ action: "task_upsert", task }),
        "Couldn't add the task",
      ),
    [groupId, mutate],
  );

  const updateTask = useCallback(
    (id: string, patch: Partial<PlanningTask>) => {
      const existing = stateRef.current.tasks.find((t) => t.id === id);
      return mutate<PlanningTask>(
        existing ? { action: "task_upsert", task: { ...existing, ...patch } } : null,
        () =>
          fetch(`/api/workspace/${groupId}/planning/tasks/${id}`, {
            ...json(patch),
            method: "PATCH",
          }),
        (task) => ({ action: "task_upsert", task }),
        "Couldn't save the task",
      );
    },
    [groupId, mutate],
  );

  const deleteTask = useCallback(
    (id: string) =>
      mutate<{ id: string }>(
        { action: "task_delete", id },
        () => fetch(`/api/workspace/${groupId}/planning/tasks/${id}`, { method: "DELETE" }),
        () => ({ action: "task_delete", id }),
        "Couldn't delete the task",
      ),
    [groupId, mutate],
  );

  // ── Milestones ────────────────────────────────────────────────────────
  const addMilestone = useCallback(
    (fields: { title: string; dueDate: string; startDate?: string }) =>
      mutate<PlanningMilestone>(
        null,
        () => fetch(`/api/workspace/${groupId}/planning/milestones`, json(fields)),
        (milestone) => ({ action: "milestone_upsert", milestone }),
        "Couldn't add the milestone",
      ),
    [groupId, mutate],
  );

  const updateMilestone = useCallback(
    (id: string, patch: Partial<PlanningMilestone>) => {
      const existing = stateRef.current.milestones.find((m) => m.id === id);
      return mutate<PlanningMilestone>(
        existing ? { action: "milestone_upsert", milestone: { ...existing, ...patch } } : null,
        () =>
          fetch(`/api/workspace/${groupId}/planning/milestones/${id}`, {
            ...json(patch),
            method: "PATCH",
          }),
        (milestone) => ({ action: "milestone_upsert", milestone }),
        "Couldn't save the milestone",
      );
    },
    [groupId, mutate],
  );

  const deleteMilestone = useCallback(
    (id: string) =>
      mutate<{ id: string }>(
        { action: "milestone_delete", id },
        () => fetch(`/api/workspace/${groupId}/planning/milestones/${id}`, { method: "DELETE" }),
        () => ({ action: "milestone_delete", id }),
        "Couldn't delete the milestone",
      ),
    [groupId, mutate],
  );

  // ── Dependencies (Workflow arrows) ────────────────────────────────────
  const addDependency = useCallback(
    (blockerId: string, dependentId: string) =>
      mutate<PlanningDependency>(
        // Optimistic edge with a placeholder id; the server's row replaces it,
        // matched on the pair rather than the id.
        {
          action: "dependency_add",
          dependency: { id: `pending:${blockerId}:${dependentId}`, blockerId, dependentId },
        },
        () =>
          fetch(
            `/api/workspace/${groupId}/planning/dependencies`,
            json({ blockerId, dependentId }),
          ),
        (dependency) => ({ action: "dependency_add", dependency }),
        "Couldn't link those tasks",
      ),
    [groupId, mutate],
  );

  const removeDependency = useCallback(
    (blockerId: string, dependentId: string) =>
      mutate<{ blockerId: string; dependentId: string }>(
        { action: "dependency_delete", blockerId, dependentId },
        () =>
          fetch(
            `/api/workspace/${groupId}/planning/dependencies?blockerId=${encodeURIComponent(
              blockerId,
            )}&dependentId=${encodeURIComponent(dependentId)}`,
            { method: "DELETE" },
          ),
        () => ({ action: "dependency_delete", blockerId, dependentId }),
        "Couldn't remove that link",
      ),
    [groupId, mutate],
  );

  /**
   * Workflow canvas position. Separate from `updateTask` only for intent — it
   * goes through the same PATCH, but callers shouldn't have to know that moving
   * a node on the canvas is a task patch.
   */
  const moveTaskOnCanvas = useCallback(
    (id: string, flowX: number, flowY: number) => updateTask(id, { flowX, flowY }),
    [updateTask],
  );

  // Tasks grouped by column, in position order — what the board renders from.
  const tasksByColumn = useMemo(() => {
    const map = new Map<string, PlanningTask[]>();
    for (const column of state.columns) map.set(column.id, []);
    for (const task of state.tasks) {
      const list = map.get(task.columnId);
      if (list) list.push(task);
    }
    for (const list of map.values()) list.sort(byPosition);
    return map;
  }, [state.columns, state.tasks]);

  const membersById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  return {
    columns: state.columns,
    tasks: state.tasks,
    milestones: state.milestones,
    dependencies: state.dependencies,
    tasksByColumn,
    members,
    membersById,
    groupName,
    loaded,
    isConnected,
    isOffline,
    presence,
    /** True while any write is in flight — drives the save-status pill. */
    isSaving: saving > 0,
    reload,
    addColumn,
    updateColumn,
    deleteColumn,
    addTask,
    updateTask,
    deleteTask,
    addMilestone,
    updateMilestone,
    deleteMilestone,
    addDependency,
    removeDependency,
    moveTaskOnCanvas,
  };
}
