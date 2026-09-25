"use client";

import React, { useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";

export type UiKind =
  | "frame"
  | "container"
  | "navbar"
  | "tabs"
  | "card"
  | "divider"
  | "button"
  | "input"
  | "checkbox"
  | "toggle"
  | "dropdown"
  | "text"
  | "image"
  | "avatar"
  | "badge"
  | "table"
  | "chart";

export interface UiPrimitiveData {
  kind: UiKind;
  label: string;
  /** Optional style overrides, editable from the properties panel */
  fill?: string;
  radius?: number;
  fontSize?: number;
  opacity?: number;
  onChange: (label: string) => void;
}

export interface PaletteItem {
  kind: UiKind;
  label: string;
  width: number;
  height: number;
  category: "Layout" | "Controls" | "Content";
}

export const UI_PALETTE: PaletteItem[] = [
  // Layout
  { kind: "frame", label: "Frame", width: 320, height: 220, category: "Layout" },
  { kind: "container", label: "Container", width: 160, height: 100, category: "Layout" },
  { kind: "navbar", label: "Navbar", width: 320, height: 44, category: "Layout" },
  { kind: "tabs", label: "Tabs", width: 240, height: 36, category: "Layout" },
  { kind: "card", label: "Card", width: 200, height: 120, category: "Layout" },
  { kind: "divider", label: "Divider", width: 200, height: 8, category: "Layout" },
  // Controls
  { kind: "button", label: "Button", width: 120, height: 36, category: "Controls" },
  { kind: "input", label: "Input", width: 160, height: 36, category: "Controls" },
  { kind: "checkbox", label: "Checkbox", width: 140, height: 24, category: "Controls" },
  { kind: "toggle", label: "Toggle", width: 140, height: 24, category: "Controls" },
  { kind: "dropdown", label: "Dropdown", width: 160, height: 36, category: "Controls" },
  // Content
  { kind: "text", label: "Text", width: 140, height: 24, category: "Content" },
  { kind: "image", label: "Image", width: 160, height: 100, category: "Content" },
  { kind: "avatar", label: "Avatar", width: 48, height: 48, category: "Content" },
  { kind: "badge", label: "Badge", width: 72, height: 22, category: "Content" },
  { kind: "table", label: "Table", width: 240, height: 140, category: "Content" },
  { kind: "chart", label: "Chart", width: 220, height: 130, category: "Content" },
];

export const DEVICE_FRAMES: { id: string; label: string; width: number; height: number }[] = [
  { id: "phone", label: "iPhone 390", width: 390, height: 700 },
  { id: "tablet", label: "Tablet 834", width: 834, height: 620 },
  { id: "desktop", label: "Desktop 1440", width: 1024, height: 640 },
];

const KIND_CLASSES: Record<UiKind, string> = {
  frame: "border-2 border-dashed border-gray-500 bg-gray-900/30",
  container: "rounded-md border border-gray-600 bg-gray-800/60",
  navbar: "flex items-center gap-2 rounded-md border border-gray-600 bg-gray-800 px-3",
  tabs: "flex items-end gap-1 border-b border-gray-600",
  card: "rounded-lg border border-gray-600 bg-gray-800/80 shadow-sm",
  divider: "flex items-center",
  button: "flex items-center justify-center rounded-md bg-blue-600 text-sm font-medium text-white",
  input: "flex items-center rounded border border-gray-600 bg-gray-900 px-2 text-sm text-gray-400",
  checkbox: "flex items-center gap-2 text-sm text-gray-300",
  toggle: "flex items-center gap-2 text-sm text-gray-300",
  dropdown: "flex items-center justify-between rounded border border-gray-600 bg-gray-900 px-2 text-sm text-gray-400",
  text: "flex items-center text-sm text-gray-200",
  image: "flex items-center justify-center rounded border border-gray-600 bg-gray-700 text-xs text-gray-500",
  avatar: "flex items-center justify-center rounded-full bg-gray-600 text-xs font-semibold text-gray-300",
  badge: "flex items-center justify-center rounded-full bg-purple-600/80 text-[10px] font-semibold text-white",
  table: "rounded border border-gray-600 bg-gray-900/60 overflow-hidden",
  chart: "rounded border border-gray-600 bg-gray-900/60 flex items-end justify-around p-2",
};

// Kinds whose label renders as a small tag in the top-left corner
const CORNER_LABELED: UiKind[] = ["frame", "container", "card", "table", "chart"];
// Kinds that render decorative content instead of an editable label
const DECORATIVE: UiKind[] = ["divider", "table", "chart", "avatar", "image"];

function DecorativeContent({ kind, label }: { kind: UiKind; label: string }) {
  switch (kind) {
    case "divider":
      return <div className="h-px w-full bg-gray-600" />;
    case "avatar":
      return <span>{(label || "A").slice(0, 2).toUpperCase()}</span>;
    case "image":
      return <span>{label || "Image"}</span>;
    case "table":
      return (
        <div className="flex h-full w-full flex-col">
          <div className="h-6 shrink-0 border-b border-gray-600 bg-gray-800" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-1 border-b border-gray-700/60 last:border-0">
              <div className="w-1/3 border-r border-gray-700/60" />
              <div className="w-1/3 border-r border-gray-700/60" />
            </div>
          ))}
        </div>
      );
    case "chart":
      return (
        <>
          {[40, 70, 55, 85, 62].map((h, i) => (
            <div key={i} className="w-[12%] rounded-t bg-blue-500/70" style={{ height: `${h}%` }} />
          ))}
        </>
      );
    default:
      return null;
  }
}

/**
 * What an element shows before anyone has named it. Buttons and badges read as
 * real text; controls like a toggle show nothing, since the switch is the point
 * (the raw kind used to appear as placeholder text, e.g. "toggle").
 */
const DEFAULT_TEXT: Partial<Record<UiKind, { text: string; muted: boolean }>> = {
  button: { text: "Button", muted: false },
  badge: { text: "Badge", muted: false },
  text: { text: "Text", muted: false },
  input: { text: "Input", muted: true },
  dropdown: { text: "Select…", muted: true },
  frame: { text: "Frame", muted: true },
  container: { text: "Container", muted: true },
  card: { text: "Card", muted: true },
  // Tabs are a comma-separated list; each item becomes one tab
  tabs: { text: "Tab 1, Tab 2, Tab 3", muted: false },
};

function TabStrip({ text }: { text: string }) {
  const tabs = text.split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <>
      {tabs.map((tab, i) => (
        <span
          key={i}
          className={
            i === 0
              ? "rounded-t border border-b-0 border-gray-500 bg-gray-800 px-3 py-1 text-[11px] text-white"
              : "px-3 py-1 text-[11px] text-gray-500"
          }
        >
          {tab}
        </span>
      ))}
    </>
  );
}

/**
 * Shows the label as plain text so a press anywhere on the element drags it;
 * double-click switches to an input. An always-on input covered the whole
 * element and, being `nodrag`, made buttons, badges and text impossible to move.
 */
function EditableLabel({
  kind,
  value,
  onChange,
  className,
  display,
}: {
  kind: UiKind;
  value: string;
  onChange: (label: string) => void;
  className: string;
  /** Custom rendering of the (non-editing) text, e.g. tabs from a list. */
  display?: (text: string) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const fallback = DEFAULT_TEXT[kind];

  const finish = (commit: boolean) => {
    if (commit && draft !== value) onChange(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
        placeholder={fallback?.text}
        className={`nodrag bg-transparent outline-none ring-1 ring-blue-400/60 ${className}`}
      />
    );
  }

  const shown = value || fallback?.text || "";
  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      title="Double-click to edit text"
      className={`truncate ${!value && fallback?.muted ? "opacity-50" : ""} ${className}`}
    >
      {display ? display(shown) : shown}
    </span>
  );
}

export default function UiPrimitiveNode({ data, selected }: NodeProps) {
  const d = data as unknown as UiPrimitiveData;
  const isCornerLabel = CORNER_LABELED.includes(d.kind);
  const isDecorative = DECORATIVE.includes(d.kind);

  const style: React.CSSProperties = {
    backgroundColor: d.fill || undefined,
    borderRadius: d.radius !== undefined ? d.radius : undefined,
    fontSize: d.fontSize || undefined,
    opacity: d.opacity !== undefined ? d.opacity / 100 : undefined,
  };

  return (
    <div className={`relative h-full w-full ${KIND_CLASSES[d.kind]}`} style={style}>
      <NodeResizer isVisible={selected} minWidth={24} minHeight={8} />

      {d.kind === "checkbox" && <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-500" />}
      {d.kind === "toggle" && (
        <span className="relative h-4 w-7 shrink-0 rounded-full bg-blue-600">
          <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white" />
        </span>
      )}
      {d.kind === "navbar" && <span className="h-3 w-3 shrink-0 rounded-sm bg-gray-500" />}

      {isDecorative ? (
        <DecorativeContent kind={d.kind} label={d.label} />
      ) : d.kind === "tabs" ? (
        <EditableLabel
          kind="tabs"
          value={d.label}
          onChange={d.onChange}
          className="flex h-full w-full items-end gap-1"
          display={(text) => <TabStrip text={text} />}
        />
      ) : (
        <EditableLabel
          kind={d.kind}
          value={d.label}
          onChange={d.onChange}
          className={
            isCornerLabel
              ? "absolute left-2 top-1 w-2/3 text-[11px] text-gray-400"
              : d.kind === "dropdown" || d.kind === "checkbox" || d.kind === "toggle" || d.kind === "navbar"
                ? "min-w-0 flex-1 px-1"
                : d.kind === "text"
                  ? "block w-full px-2"
                  : "block w-full px-2 text-center"
          }
        />
      )}
      {d.kind === "dropdown" && <span className="shrink-0 text-gray-500">▾</span>}
    </div>
  );
}
