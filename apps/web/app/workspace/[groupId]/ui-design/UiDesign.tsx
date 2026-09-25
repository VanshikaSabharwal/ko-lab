"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { v4 as uuid } from "uuid";
import type { Edge, Node, NodeChange, NodeTypes, OnSelectionChangeFunc, XYPosition } from "@xyflow/react";
import { useWorkspaceBoard, type PeerCursorOp } from "../../lib/useWorkspaceBoard";
import WorkspaceCanvas from "../../components/WorkspaceCanvas";
import CursorLayer from "../../components/CursorLayer";
import UiPalette from "./UiPalette";
import UiPrimitiveNode, { UI_PALETTE, DEVICE_FRAMES, type UiKind } from "./UiPrimitiveNode";
import UiGroupNode, { GROUP_HEADER_H, GROUP_PADDING } from "./UiGroupNode";
import PropertiesPanel from "./PropertiesPanel";
import BoardToolbar from "./BoardToolbar";
import { buildTemplateNodes } from "./templates";

interface UiDesignProps {
  groupId: string;
}

const NODE_TYPES: NodeTypes = { uiPrimitive: UiPrimitiveNode, uiGroup: UiGroupNode };
const HISTORY_LIMIT = 50;

type Snapshot = { nodes: Node[]; edges: Edge[] };

// Strip render-injected callbacks before storing/cloning node data
function cleanData(data: Record<string, unknown>) {
  const { onChange: _onChange, ...rest } = data;
  return rest;
}

function isTypingTarget(el: EventTarget | null) {
  const tag = (el as HTMLElement)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement)?.isContentEditable;
}

// Same precedence the properties panel uses: an explicit style wins, and
// measured is the fallback before the first render has sized the node.
function nodeSize(n: Node) {
  return {
    width: ((n.style?.width as number) ?? n.measured?.width ?? 0) || 0,
    height: ((n.style?.height as number) ?? n.measured?.height ?? 0) || 0,
  };
}

// Bounding box of nodes that all share a coordinate space.
function boundsOf(list: Node[]) {
  const xs = list.map((n) => n.position.x);
  const ys = list.map((n) => n.position.y);
  const rights = list.map((n) => n.position.x + nodeSize(n).width);
  const bottoms = list.map((n) => n.position.y + nodeSize(n).height);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    right: Math.max(...rights),
    bottom: Math.max(...bottoms),
  };
}

export default function UiDesign({ groupId }: UiDesignProps) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const userName = session?.user?.name || session?.user?.email?.split("@")[0] || "Someone";

  // CursorLayer registers its handler here; the board hook feeds it peer ops.
  const cursorHandlerRef = useRef<((op: PeerCursorOp) => void) | null>(null);
  const subscribeCursor = useCallback((handler: (op: PeerCursorOp) => void) => {
    cursorHandlerRef.current = handler;
  }, []);
  const onPeerCursor = useCallback((op: PeerCursorOp) => {
    cursorHandlerRef.current?.(op);
  }, []);

  const {
    nodes,
    edges,
    presence,
    isOffline,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    addNodes,
    updateNode,
    updateNodeData,
    groupNodes,
    ungroupNodes,
    setGraph,
    sendCursor,
  } = useWorkspaceBoard({ groupId, type: "UI_DESIGN", slug: "ui-design", userId, onPeerCursor });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [snap, setSnap] = useState(false);

  // ── Undo / redo (structural changes: add, delete, duplicate, template) ──
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0); // re-render for button state
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const snapshotNow = useCallback(
    (): Snapshot => ({
      nodes: nodesRef.current.map((n) => ({ ...n, data: cleanData(n.data) })),
      edges: [...edgesRef.current],
    }),
    [],
  );

  const pushHistory = useCallback(() => {
    undoStack.current.push(snapshotNow());
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    setHistoryVersion((v) => v + 1);
  }, [snapshotNow]);

  const undo = useCallback(() => {
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    redoStack.current.push(snapshotNow());
    setGraph(snapshot.nodes, snapshot.edges);
    setHistoryVersion((v) => v + 1);
  }, [setGraph, snapshotNow]);

  const redo = useCallback(() => {
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    undoStack.current.push(snapshotNow());
    setGraph(snapshot.nodes, snapshot.edges);
    setHistoryVersion((v) => v + 1);
  }, [setGraph, snapshotNow]);

  // Capture deletions triggered by xyflow (Backspace/Delete) in the history
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.some((c) => c.type === "remove")) pushHistory();
      onNodesChange(changes);
    },
    [onNodesChange, pushHistory],
  );

  // ── Selection ──
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: sel }) => {
    setSelectedIds(sel.map((n) => n.id));
  }, []);
  const selectedNode = useMemo(
    () => (selectedIds.length === 1 ? (nodes.find((n) => n.id === selectedIds[0]) ?? null) : null),
    [nodes, selectedIds],
  );

  // ── Actions ──
  const duplicateSelection = useCallback(() => {
    // Duplicating a group has to bring its members along, otherwise the copy
    // is an empty frame.
    const ids = new Set(selectedIds);
    for (const n of nodesRef.current) {
      if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
    }
    const selected = nodesRef.current.filter((n) => ids.has(n.id));
    if (!selected.length) return;
    pushHistory();

    // Clone ids first so a copied child can be re-pointed at the copied
    // container rather than the original it was parented to.
    const idMap = new Map(selected.map((n) => [n.id, uuid()]));
    const clones = selected.map((n) => {
      const clone: Node = {
        ...n,
        id: idMap.get(n.id)!,
        selected: false,
        data: cleanData(n.data),
      };
      if (n.parentId && idMap.has(n.parentId)) {
        // Offsetting a child too would double-shift it: the parent already moved.
        clone.parentId = idMap.get(n.parentId)!;
      } else {
        clone.position = { x: n.position.x + 16, y: n.position.y + 16 };
      }
      return clone;
    });
    // Parents must precede their children in the array.
    clones.sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
    addNodes(clones);
  }, [selectedIds, addNodes, pushHistory]);

  const deleteSelection = useCallback(() => {
    if (!selectedIds.length) return;
    // Deleting a group takes its members with it — left behind, they'd keep a
    // parentId pointing at a node that no longer exists and vanish from the
    // canvas while still sitting in the saved graph.
    const ids = new Set(selectedIds);
    for (const n of nodesRef.current) {
      if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
    }
    const doomed = [...ids];
    const edgeRemovals = edgesRef.current
      .filter((e) => ids.has(e.source) || ids.has(e.target))
      .map((e) => ({ id: e.id, type: "remove" as const }));
    // handleNodesChange pushes history for remove changes
    handleNodesChange(doomed.map((id) => ({ id, type: "remove" as const })));
    if (edgeRemovals.length) onEdgesChange(edgeRemovals);
    setSelectedIds([]);
  }, [selectedIds, handleNodesChange, onEdgesChange]);

  /** Remove everything on the board. Undo brings it back. */
  const clearBoard = useCallback(() => {
    if (!nodesRef.current.length) return;
    const edgeRemovals = edgesRef.current.map((e) => ({ id: e.id, type: "remove" as const }));
    // handleNodesChange pushes history for remove changes
    handleNodesChange(nodesRef.current.map((n) => ({ id: n.id, type: "remove" as const })));
    if (edgeRemovals.length) onEdgesChange(edgeRemovals);
    setSelectedIds([]);
  }, [handleNodesChange, onEdgesChange]);

  // ── Grouping ──
  // Selection is groupable only when 2+ top-level nodes are picked. Nodes that
  // already belong to a group are excluded: nesting isn't supported yet, and
  // silently re-parenting them would tear them out of their current group.
  const groupableIds = useMemo(() => {
    const picked = nodes.filter((n) => selectedIds.includes(n.id));
    if (picked.some((n) => n.parentId)) return [];
    return picked.filter((n) => n.type !== "uiGroup").map((n) => n.id);
  }, [nodes, selectedIds]);
  const canGroup = groupableIds.length >= 2;

  // Ungroup targets the selected container, or the container of a selected child.
  const ungroupTargetId = useMemo(() => {
    const picked = nodes.filter((n) => selectedIds.includes(n.id));
    const container = picked.find((n) => n.type === "uiGroup");
    if (container) return container.id;
    const child = picked.find((n) => n.parentId);
    return child?.parentId ?? null;
  }, [nodes, selectedIds]);

  const groupSelection = useCallback(() => {
    const members = nodesRef.current.filter((n) => groupableIds.includes(n.id));
    if (members.length < 2) return;

    // Members are all top-level here, so their positions share one space.
    const b = boundsOf(members);
    const origin = { x: b.x - GROUP_PADDING, y: b.y - GROUP_HEADER_H };
    const container: Node = {
      id: uuid(),
      type: "uiGroup",
      position: origin,
      // Behind its members so the frame never covers them.
      zIndex: -1,
      style: {
        width: b.right - b.x + GROUP_PADDING * 2,
        height: b.bottom - b.y + GROUP_HEADER_H + GROUP_PADDING,
      },
      data: { label: `Group ${nodesRef.current.filter((n) => n.type === "uiGroup").length + 1}` },
    };

    // A child's position becomes relative to its parent once parentId is set,
    // so every member has to be rebased or it jumps on the next render.
    const positions: Record<string, XYPosition> = {};
    for (const m of members) {
      positions[m.id] = { x: m.position.x - origin.x, y: m.position.y - origin.y };
    }

    pushHistory();
    groupNodes(container, groupableIds, positions);
    setSelectedIds([container.id]);
  }, [groupableIds, groupNodes, pushHistory]);

  const ungroupSelection = useCallback(() => {
    if (!ungroupTargetId) return;
    const container = nodesRef.current.find((n) => n.id === ungroupTargetId);
    if (!container) return;

    // Back to absolute before parentId is dropped, or the children collapse
    // onto the canvas origin.
    const positions: Record<string, XYPosition> = {};
    for (const child of nodesRef.current.filter((n) => n.parentId === ungroupTargetId)) {
      positions[child.id] = {
        x: child.position.x + container.position.x,
        y: child.position.y + container.position.y,
      };
    }

    pushHistory();
    ungroupNodes(ungroupTargetId, positions);
    setSelectedIds(Object.keys(positions));
  }, [ungroupTargetId, ungroupNodes, pushHistory]);

  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      // A child whose parent is also selected is skipped: React Flow already
      // moves it with the parent, so nudging both would shift it twice.
      const selected = nodesRef.current.filter(
        (n) => selectedIds.includes(n.id) && !(n.parentId && selectedIds.includes(n.parentId)),
      );
      if (!selected.length) return;
      onNodesChange(
        selected.map((n) => ({
          id: n.id,
          type: "position" as const,
          position: { x: n.position.x + dx, y: n.position.y + dy },
          dragging: false,
        })),
      );
    },
    [selectedIds, onNodesChange],
  );

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      const step = e.shiftKey ? 10 : 2;
      if (e.key === "ArrowUp") { e.preventDefault(); nudgeSelection(0, -step); }
      else if (e.key === "ArrowDown") { e.preventDefault(); nudgeSelection(0, step); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); nudgeSelection(-step, 0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nudgeSelection(step, 0); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [duplicateSelection, nudgeSelection, undo, redo, groupSelection, ungroupSelection]);

  // ── Render ──
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          onChange: (label: string) => updateNodeData(n.id, { label }),
        },
      })),
    [nodes, updateNodeData],
  );

  const handleDropItem = (payload: string, position: { x: number; y: number }) => {
    // Template: instantiate a saved arrangement
    if (payload.startsWith("template:")) {
      pushHistory();
      addNodes(buildTemplateNodes(payload.slice("template:".length), position));
      return;
    }
    // Device frame preset
    if (payload.startsWith("frame:")) {
      const preset = DEVICE_FRAMES.find((f) => f.id === payload.slice("frame:".length));
      if (!preset) return;
      pushHistory();
      addNode({
        id: uuid(),
        type: "uiPrimitive",
        position,
        zIndex: 0,
        style: { width: preset.width, height: preset.height },
        data: { kind: "frame" as UiKind, label: preset.label },
      });
      return;
    }
    // Plain primitive
    const item = UI_PALETTE.find((p) => p.kind === payload);
    if (!item) return;
    pushHistory();
    addNode({
      id: uuid(),
      type: "uiPrimitive",
      position,
      style: { width: item.width, height: item.height },
      data: { kind: item.kind, label: "" },
    });
  };

  // historyVersion re-renders this component so button state stays fresh
  void historyVersion;
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  return (
    <WorkspaceCanvas
      groupId={groupId}
      title="UI/UX Design"
      nodes={displayNodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      presence={presence}
      currentUserId={userId}
      isOffline={isOffline}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onSelectionChange={onSelectionChange}
      snapToGrid={snap}
      snapGrid={[8, 8]}
      // Render prop so the palette gets an insert-at-centre callback for taps —
      // HTML5 drag events never fire on touch, which left this board unusable
      // on mobile.
      renderSidebar={(insertAtCenter) => <UiPalette onPick={insertAtCenter} />}
      rightPanel={
        <PropertiesPanel
          node={selectedNode}
          onPatchData={updateNodeData}
          onPatchNode={updateNode}
          onDuplicate={duplicateSelection}
          onDelete={deleteSelection}
        />
      }
      toolbar={
        <BoardToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          snap={snap}
          onToggleSnap={() => setSnap((s) => !s)}
          canGroup={canGroup}
          canUngroup={!!ungroupTargetId}
          onGroup={groupSelection}
          onUngroup={ungroupSelection}
          canClear={nodes.length > 0}
          onClear={clearBoard}
        />
      }
      overlay={
        <CursorLayer
          userId={userId}
          userName={userName}
          subscribe={subscribeCursor}
          sendCursor={sendCursor}
        />
      }
      onDropItem={handleDropItem}
    />
  );
}
