"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { ArrowLeft, PanelLeft, PanelRight, WifiOff, X } from "lucide-react";
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type ColorMode,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import PresenceBar from "./PresenceBar";
import { useCoarsePointer } from "../lib/useCoarsePointer";

interface WorkspaceCanvasProps {
  groupId: string;
  title: string;
  nodes: Node[];
  edges: Edge[];
  nodeTypes?: NodeTypes;
  edgeTypes?: EdgeTypes;
  presence: string[];
  currentUserId?: string;
  /**
   * True only after live sync has been down past the grace period — a routine
   * reconnect shouldn't warn the user. Work still saves over HTTP; only live
   * collaboration is affected.
   */
  isOffline?: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  toolbar?: React.ReactNode;
  sidebar?: React.ReactNode;
  /** Optional panel rendered to the right of the canvas (properties panel). */
  rightPanel?: React.ReactNode;
  /** Optional children rendered inside <ReactFlow> (cursor overlays etc.). */
  overlay?: React.ReactNode;
  snapToGrid?: boolean;
  snapGrid?: [number, number];
  onSelectionChange?: OnSelectionChangeFunc;
  // Called with the dropped item's drag payload and its position translated
  // into flow coordinates — used by the UI/UX design palette.
  onDropItem?: (payload: string, position: { x: number; y: number }) => void;
  /**
   * Renders the left panel. Given `insertAtCenter`, which drops a palette
   * payload at the middle of the current viewport — the tap-to-insert path for
   * touch, where HTML5 drag events never fire. Passed as a render prop because
   * translating to flow coordinates requires being inside ReactFlowProvider.
   */
  renderSidebar?: (insertAtCenter: (payload: string) => void) => React.ReactNode;
}

// Small dismiss affordance shown only while a panel is acting as a mobile
// drawer — tapping the backdrop also works, but this is more discoverable.
function DrawerClose({ onClick, side }: { onClick: () => void; side: "left" | "right" }) {
  return (
    // Sits in its own bar rather than floating over the panel: absolutely
    // positioning it on top meant the ✕ overlapped whatever the panel rendered
    // in its top corner, since no panel reserves space for it.
    <div
      className={`absolute inset-x-0 top-0 z-10 flex bg-gray-50/95 px-2 py-1.5 backdrop-blur dark:bg-gray-800/95 md:hidden ${
        side === "left" ? "justify-end" : "justify-start"
      }`}
    >
      <button
        onClick={onClick}
        aria-label="Close panel"
        className="rounded-full bg-gray-200 p-1.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// Supplies the sidebar with an insert-at-viewport-centre callback. Lives inside
// ReactFlowProvider so it can translate screen to flow coordinates; the boards
// themselves render outside the provider and cannot.
function SidebarSlot({
  render,
  onDropItem,
  onInserted,
}: {
  render: (insertAtCenter: (payload: string) => void) => React.ReactNode;
  onDropItem?: WorkspaceCanvasProps["onDropItem"];
  onInserted: () => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const insertAtCenter = (payload: string) => {
    if (!onDropItem) return;
    const pane = document.querySelector(".react-flow");
    const rect = pane?.getBoundingClientRect();
    const center = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    onDropItem(payload, screenToFlowPosition(center));
    onInserted();
  };
  return <>{render(insertAtCenter)}</>;
}

function CanvasArea({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  onNodesChange,
  onEdgesChange,
  onConnect,
  toolbar,
  overlay,
  snapToGrid,
  snapGrid,
  onSelectionChange,
  onDropItem,
}: Pick<
  WorkspaceCanvasProps,
  | "nodes"
  | "edges"
  | "nodeTypes"
  | "edgeTypes"
  | "onNodesChange"
  | "onEdgesChange"
  | "onConnect"
  | "toolbar"
  | "overlay"
  | "snapToGrid"
  | "snapGrid"
  | "onSelectionChange"
  | "onDropItem"
>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const isCoarsePointer = useCoarsePointer();
  const { resolvedTheme } = useTheme();
  // React Flow restyles its Background/Controls/MiniMap from this.
  const colorMode: ColorMode = resolvedTheme === "light" ? "light" : "dark";

  return (
    <div
      ref={wrapperRef}
      className="relative flex-1"
      onDragOver={(e) => {
        if (!onDropItem) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!onDropItem) return;
        e.preventDefault();
        const payload = e.dataTransfer.getData("application/x-workspace-item");
        if (!payload) return;
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        onDropItem(payload, position);
      }}
    >
      {/* On phones the toolbar moves to the bottom so it clears the drawer
          toggles in the header, and wraps rather than overflowing. */}
      {toolbar && (
        <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap gap-2 md:bottom-auto md:right-auto md:top-3">
          {toolbar}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        snapToGrid={snapToGrid}
        snapGrid={snapGrid}
        // Loose mode lets either end of a connection start or receive the drag,
        // which is far more forgiving — especially with a finger.
        connectionMode={ConnectionMode.Loose}
        connectionRadius={isCoarsePointer ? 44 : 30}
        colorMode={colorMode}
        zoomOnPinch
        panOnScroll
        fitView
      >
        <Background />
        <Controls className="!bottom-16 md:!bottom-4" />
        {/* The minimap would eat a quarter of a phone screen. */}
        <MiniMap pannable zoomable className="!hidden md:!block" />
        {overlay}
      </ReactFlow>
    </div>
  );
}

export default function WorkspaceCanvas({
  groupId,
  title,
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  presence,
  currentUserId,
  isOffline,
  onNodesChange,
  onEdgesChange,
  onConnect,
  toolbar,
  sidebar,
  rightPanel,
  overlay,
  snapToGrid,
  snapGrid,
  onSelectionChange,
  onDropItem,
  renderSidebar,
}: WorkspaceCanvasProps) {
  // Which side panel is open as an overlay on small screens. At md: and up both
  // panels are always inline and this is ignored.
  const [panel, setPanel] = useState<"none" | "left" | "right">("none");
  const hasSidebar = Boolean(sidebar || renderSidebar);

  return (
    // 100dvh, not h-screen: vh is measured against the largest viewport, so the
    // canvas would sit clipped behind mobile browser chrome.
    <div className="flex h-[100dvh] flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-white">
      <div className="flex flex-wrap items-center justify-between gap-y-1.5 border-b border-gray-200 bg-gray-50/80 px-3 py-2.5 dark:border-gray-700/50 dark:bg-gray-800/80 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {/* Mobile-only panel toggles, rendered only when a panel exists. */}
          {hasSidebar && (
            <button
              onClick={() => setPanel((p) => (p === "left" ? "none" : "left"))}
              aria-label="Toggle palette"
              className="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white md:hidden"
            >
              <PanelLeft size={16} />
            </button>
          )}
          <Link
            href={`/workspace/${groupId}`}
            className="flex shrink-0 items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Workspace</span>
          </Link>
          <span className="hidden text-gray-400 dark:text-gray-600 sm:inline">/</span>
          <h1 className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </h1>
          {isOffline && (
            <span
              title="Live sync is offline — your changes are still saved, but you won't see teammates' edits until it reconnects."
              className="inline-flex shrink-0 items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500"
            >
              <WifiOff size={11} />
              Offline
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PresenceBar userIds={presence} currentUserId={currentUserId} />
          {rightPanel && (
            <button
              onClick={() => setPanel((p) => (p === "right" ? "none" : "right"))}
              aria-label="Toggle properties"
              className="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white md:hidden"
            >
              <PanelRight size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        <ReactFlowProvider>
          {/* Backdrop for the mobile drawers. */}
          {panel !== "none" && (
            <div
              onClick={() => setPanel("none")}
              className="absolute inset-0 z-20 bg-black/40 md:hidden"
              aria-hidden
            />
          )}

          {/* Below md: these are slide-over drawers. At md: and up the
              transform/position resets make them ordinary flex siblings, so the
              desktop layout is unchanged. */}
          {hasSidebar && (
            <div
              className={`absolute inset-y-0 left-0 z-30 flex md:relative md:z-auto md:!translate-x-0 ${
                panel === "left" ? "translate-x-0" : "-translate-x-full"
              } transition-transform duration-200 md:transition-none`}
            >
              {renderSidebar ? (
                <SidebarSlot
                  render={renderSidebar}
                  onDropItem={onDropItem}
                  // Close the drawer after a tap-insert so the result is visible.
                  onInserted={() => setPanel("none")}
                />
              ) : (
                sidebar
              )}
              <DrawerClose onClick={() => setPanel("none")} side="left" />
            </div>
          )}

          <CanvasArea
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            toolbar={toolbar}
            overlay={overlay}
            snapToGrid={snapToGrid}
            snapGrid={snapGrid}
            onSelectionChange={onSelectionChange}
            onDropItem={onDropItem}
          />

          {rightPanel && (
            <div
              className={`absolute inset-y-0 right-0 z-30 flex md:relative md:z-auto md:!translate-x-0 ${
                panel === "right" ? "translate-x-0" : "translate-x-full"
              } transition-transform duration-200 md:transition-none`}
            >
              <DrawerClose onClick={() => setPanel("none")} side="right" />
              {rightPanel}
            </div>
          )}
        </ReactFlowProvider>
      </div>
    </div>
  );
}
