"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodePositionChange,
  type XYPosition,
} from "@xyflow/react";
import { useWorkspaceSocket, type WorkspaceBoardType } from "./useWorkspaceSocket";

type GraphBoardOp =
  | { action: "nodes_change"; changes: NodeChange[] }
  | { action: "edges_change"; changes: EdgeChange[] }
  | { action: "connect"; connection: Connection | Edge }
  | { action: "node_add"; node: Node }
  | { action: "nodes_add"; nodes: Node[] }
  | { action: "node_update"; id: string; patch: Partial<Node> }
  | { action: "node_data_update"; id: string; data: Record<string, unknown> }
  | { action: "edge_label_update"; id: string; label: string }
  | { action: "replace"; nodes: Node[]; edges: Edge[] }
  // Grouping rewrites parentId on N nodes and inserts a container. Sent as one
  // op so a concurrent peer edit can't land mid-rewrite and leave a half-formed
  // group. `positions` carries the already-converted coordinates so every peer
  // stores identical values instead of recomputing from its own local state.
  | {
      action: "group_nodes";
      container: Node;
      childIds: string[];
      positions: Record<string, XYPosition>;
    }
  | { action: "ungroup_nodes"; containerId: string; positions: Record<string, XYPosition> };

// Transient ops (cursors etc.) share the WS channel but never touch board state.
export interface PeerCursorOp {
  action: "cursor";
  userId: string;
  name: string;
  x: number;
  y: number;
}

interface UseWorkspaceBoardOptions {
  groupId: string;
  type: WorkspaceBoardType;
  slug: string;
  userId: string | undefined;
  /** Optional hook for transient peer ops (live cursors). */
  onPeerCursor?: (op: PeerCursorOp) => void;
}

const SAVE_DEBOUNCE_MS = 1500;
// Matches the cadence CursorLayer already uses for its own throttled sends.
const DRAG_BROADCAST_MS = 50;

// React Flow requires a parent node to sit before its children in the array,
// otherwise the children silently fail to render. Both helpers below preserve
// that invariant, and are shared by the local and remote paths so the two can
// never drift apart.
function applyGroupNodes(
  nds: Node[],
  container: Node,
  childIds: string[],
  positions: Record<string, XYPosition>,
): Node[] {
  const ids = new Set(childIds);
  const children: Node[] = [];
  const rest: Node[] = [];
  for (const n of nds) {
    if (ids.has(n.id)) {
      children.push({ ...n, parentId: container.id, position: positions[n.id] ?? n.position });
    } else {
      rest.push(n);
    }
  }
  // Container first, then its members, then everything else.
  return [container, ...children, ...rest];
}

function applyUngroupNodes(
  nds: Node[],
  containerId: string,
  positions: Record<string, XYPosition>,
): Node[] {
  return nds
    .filter((n) => n.id !== containerId)
    .map((n) => {
      if (n.parentId !== containerId) return n;
      // parentId must be dropped, not set to undefined on a spread copy only —
      // a lingering key would keep React Flow treating the node as parented.
      const { parentId: _parentId, extent: _extent, ...rest } = n;
      return { ...rest, position: positions[n.id] ?? n.position } as Node;
    });
}

// Shared load/save/sync logic for the three node-graph workspace boards
// (mind map, DB schema, UI design). Planning & milestones uses its own
// hook since its content shape (columns/cards/milestones) isn't a graph.
export function useWorkspaceBoard({ groupId, type, slug, userId, onPeerCursor }: UseWorkspaceBoardOptions) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPeerCursorRef = useRef(onPeerCursor);
  onPeerCursorRef.current = onPeerCursor;

  const applyRemoteOp = useCallback((op: GraphBoardOp | PeerCursorOp) => {
    if (op.action === "cursor") {
      onPeerCursorRef.current?.(op);
      return;
    }
    switch (op.action) {
      case "nodes_change":
        setNodes((nds) => applyNodeChanges(op.changes, nds));
        break;
      case "edges_change":
        setEdges((eds) => applyEdgeChanges(op.changes, eds));
        break;
      case "connect":
        setEdges((eds) => addEdge(op.connection, eds));
        break;
      case "node_add":
        setNodes((nds) => [...nds, op.node]);
        break;
      case "nodes_add":
        setNodes((nds) => [...nds, ...op.nodes]);
        break;
      case "node_update":
        setNodes((nds) => nds.map((n) => (n.id === op.id ? ({ ...n, ...op.patch } as Node) : n)));
        break;
      case "replace":
        setNodes(op.nodes);
        setEdges(op.edges);
        break;
      case "node_data_update":
        setNodes((nds) =>
          nds.map((n) => (n.id === op.id ? { ...n, data: { ...n.data, ...op.data } } : n)),
        );
        break;
      case "edge_label_update":
        setEdges((eds) => eds.map((e) => (e.id === op.id ? { ...e, label: op.label } : e)));
        break;
      case "group_nodes":
        setNodes((nds) => applyGroupNodes(nds, op.container, op.childIds, op.positions));
        break;
      case "ungroup_nodes":
        setNodes((nds) => applyUngroupNodes(nds, op.containerId, op.positions));
        break;
    }
  }, []);

  const { isConnected, isOffline, presence, sendOp } = useWorkspaceSocket({
    groupId,
    board: type,
    userId,
    onRemoteOp: applyRemoteOp,
  });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/workspace/${groupId}/${slug}?userId=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setNodes(data.content?.nodes ?? []);
        setEdges(data.content?.edges ?? []);
        setUpdatedAt(data.updatedAt ?? null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, slug, userId]);

  useEffect(() => {
    if (!loaded || !userId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/workspace/${groupId}/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, content: { nodes, edges } }),
      })
        .then((res) => res.json())
        .then((data) => setUpdatedAt(data.updatedAt ?? null))
        .catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, loaded, groupId, slug, userId]);

  // A continuous drag fires ~60 position changes/second. The WS server caps
  // both message size and messages-per-second and answers with {type:"error"},
  // which this client ignores — so unthrottled dragging silently drops ops and
  // desyncs peers. Local state still updates on every change (dragging stays
  // smooth); only the broadcast is rate-limited.
  const lastDragSend = useRef(0);
  const pendingDrag = useRef<Map<string, NodePositionChange>>(new Map());
  const dragFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDragOps = useCallback(() => {
    if (dragFlushTimer.current) {
      clearTimeout(dragFlushTimer.current);
      dragFlushTimer.current = null;
    }
    if (pendingDrag.current.size === 0) return;
    const changes = [...pendingDrag.current.values()];
    pendingDrag.current.clear();
    lastDragSend.current = Date.now();
    sendOp({ action: "nodes_change", changes });
  }, [sendOp]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));

      // In-flight drag ticks are coalesced per node id — only the latest
      // position matters. Everything else (add/remove/select/dimensions, and
      // the final dragging:false resting position) goes out immediately.
      const deferred: NodePositionChange[] = [];
      const immediate: NodeChange[] = [];
      for (const c of changes) {
        if (c.type === "position" && c.dragging) deferred.push(c);
        else immediate.push(c);
      }

      if (deferred.length) {
        for (const c of deferred) pendingDrag.current.set(c.id, c);
        const elapsed = Date.now() - lastDragSend.current;
        if (elapsed >= DRAG_BROADCAST_MS) {
          flushDragOps();
        } else if (!dragFlushTimer.current) {
          // Trailing flush so the last tick of a drag is never lost.
          dragFlushTimer.current = setTimeout(flushDragOps, DRAG_BROADCAST_MS - elapsed);
        }
      }

      if (immediate.length) {
        // Order matters: a queued move must land before the drag-end position.
        flushDragOps();
        sendOp({ action: "nodes_change", changes: immediate });
      }
    },
    [sendOp, flushDragOps],
  );

  useEffect(() => () => {
    if (dragFlushTimer.current) clearTimeout(dragFlushTimer.current);
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      sendOp({ action: "edges_change", changes });
    },
    [sendOp],
  );

  // Accepts a plain Connection, or a Connection enriched with edge fields
  // (type/label) so boards can stamp their own defaults at creation time.
  const onConnect = useCallback(
    (connection: Connection | Edge) => {
      setEdges((eds) => addEdge(connection, eds));
      sendOp({ action: "connect", connection });
    },
    [sendOp],
  );

  const addNode = useCallback(
    (node: Node) => {
      setNodes((nds) => [...nds, node]);
      sendOp({ action: "node_add", node });
    },
    [sendOp],
  );

  const updateNodeData = useCallback(
    (id: string, data: Record<string, unknown>) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)));
      sendOp({ action: "node_data_update", id, data });
    },
    [sendOp],
  );

  const updateEdgeLabel = useCallback(
    (id: string, label: string) => {
      setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, label } : e)));
      sendOp({ action: "edge_label_update", id, label });
    },
    [sendOp],
  );

  const addNodes = useCallback(
    (newNodes: Node[]) => {
      setNodes((nds) => [...nds, ...newNodes]);
      sendOp({ action: "nodes_add", nodes: newNodes });
    },
    [sendOp],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<Node>) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? ({ ...n, ...patch } as Node) : n)));
      sendOp({ action: "node_update", id, patch });
    },
    [sendOp],
  );

  const groupNodes = useCallback(
    (container: Node, childIds: string[], positions: Record<string, XYPosition>) => {
      setNodes((nds) => applyGroupNodes(nds, container, childIds, positions));
      sendOp({ action: "group_nodes", container, childIds, positions });
    },
    [sendOp],
  );

  const ungroupNodes = useCallback(
    (containerId: string, positions: Record<string, XYPosition>) => {
      setNodes((nds) => applyUngroupNodes(nds, containerId, positions));
      sendOp({ action: "ungroup_nodes", containerId, positions });
    },
    [sendOp],
  );

  // Replace the whole graph (undo/redo, template insertion into empty board)
  const setGraph = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      setNodes(nextNodes);
      setEdges(nextEdges);
      sendOp({ action: "replace", nodes: nextNodes, edges: nextEdges });
    },
    [sendOp],
  );

  // Transient — broadcast only, never persisted
  const sendCursor = useCallback(
    (op: Omit<PeerCursorOp, "action">) => {
      sendOp({ action: "cursor", ...op });
    },
    [sendOp],
  );

  return {
    nodes,
    edges,
    loaded,
    updatedAt,
    isConnected,
    isOffline,
    presence,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    addNodes,
    updateNode,
    updateNodeData,
    updateEdgeLabel,
    groupNodes,
    ungroupNodes,
    setGraph,
    sendCursor,
  };
}
