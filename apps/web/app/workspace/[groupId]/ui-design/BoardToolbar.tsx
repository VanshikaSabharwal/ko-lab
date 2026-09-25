"use client";

import React, { useEffect, useState } from "react";
import { getNodesBounds, getViewportForBounds, useReactFlow } from "@xyflow/react";
import { useTheme } from "next-themes";
import { toPng } from "html-to-image";
import { Undo2, Redo2, Magnet, ImageDown, Group, Ungroup, Eraser } from "lucide-react";
import toast from "react-hot-toast";

interface BoardToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  snap: boolean;
  onToggleSnap: () => void;
  canGroup: boolean;
  canUngroup: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  canClear: boolean;
  onClear: () => void;
}

const btnCls =
  "flex items-center gap-1.5 rounded-md border border-gray-300 bg-white/90 px-2.5 py-1.5 text-xs text-gray-700 hover:border-blue-500/60 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-300 dark:hover:border-blue-600/60 dark:hover:text-white";

export default function BoardToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  snap,
  onToggleSnap,
  canGroup,
  canUngroup,
  onGroup,
  onUngroup,
  canClear,
  onClear,
}: BoardToolbarProps) {
  const { getNodes } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const [exporting, setExporting] = useState(false);
  // Clearing wipes the board for everyone in the group, so it takes a second click
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const handleClear = () => {
    if (!confirmClear) return setConfirmClear(true);
    setConfirmClear(false);
    onClear();
    toast("Board cleared. Undo brings it back.");
  };

  const exportPng = async () => {
    const nodes = getNodes();
    if (!nodes.length) {
      toast.error("Nothing to export yet");
      return;
    }
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) return;

    setExporting(true);
    try {
      const bounds = getNodesBounds(nodes);
      const width = Math.min(Math.max(Math.ceil(bounds.width) + 80, 320), 4096);
      const height = Math.min(Math.max(Math.ceil(bounds.height) + 80, 240), 4096);
      const vp = getViewportForBounds(bounds, width, height, 0.2, 2, 0.05);

      const dataUrl = await toPng(viewport, {
        backgroundColor: resolvedTheme === "light" ? "#ffffff" : "#111827",
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      });

      const link = document.createElement("a");
      link.download = `ui-design-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={btnCls} onClick={onUndo} disabled={!canUndo} title="Undo (structural changes)">
        <Undo2 size={13} /> <span className="hidden sm:inline">Undo</span>
      </button>
      <button className={btnCls} onClick={onRedo} disabled={!canRedo} title="Redo">
        <Redo2 size={13} /> <span className="hidden sm:inline">Redo</span>
      </button>
      <button
        className={btnCls}
        onClick={onGroup}
        disabled={!canGroup}
        title="Group selection (Ctrl+G)"
      >
        <Group size={13} /> <span className="hidden sm:inline">Group</span>
      </button>
      <button
        className={btnCls}
        onClick={onUngroup}
        disabled={!canUngroup}
        title="Ungroup (Ctrl+Shift+G)"
      >
        <Ungroup size={13} /> <span className="hidden sm:inline">Ungroup</span>
      </button>
      <button
        className={`${btnCls} ${snap ? "border-blue-600/60 text-blue-300" : ""}`}
        onClick={onToggleSnap}
        title="Snap to grid"
      >
        <Magnet size={13} /> <span className="hidden sm:inline">Snap {snap ? "on" : "off"}</span>
      </button>
      <button className={btnCls} onClick={exportPng} disabled={exporting} title="Export board as PNG">
        <ImageDown size={13} />
        <span className="hidden sm:inline">{exporting ? "Exporting…" : "Export PNG"}</span>
      </button>
      <button
        className={`${btnCls} ${confirmClear ? "!border-red-500 !bg-red-600 !text-white" : ""}`}
        onClick={handleClear}
        disabled={!canClear}
        title="Remove everything from the board (Undo restores it)"
      >
        <Eraser size={13} />
        <span className={confirmClear ? "inline" : "hidden sm:inline"}>
          {confirmClear ? "Click again to clear" : "Clear board"}
        </span>
      </button>
    </div>
  );
}
