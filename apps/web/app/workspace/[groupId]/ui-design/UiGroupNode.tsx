"use client";

import React from "react";
import type { NodeProps } from "@xyflow/react";

export interface UiGroupData {
  label: string;
  onChange: (label: string) => void;
}

// Space reserved above the members' bounding box for the title bar. The group
// origin sits this far above the topmost child, so children clear the label.
export const GROUP_HEADER_H = 22;
// Breathing room on the other three sides of the members' bounding box.
export const GROUP_PADDING = 12;

/**
 * The always-visible container for a canvas group. Members are real child
 * nodes (parentId), so React Flow moves them with this frame — nothing here
 * positions them. Its own size is recomputed from its members' bounds by
 * UiDesign, since a group auto-fits rather than being resized directly.
 */
export default function UiGroupNode({ data, selected }: NodeProps) {
  const d = data as unknown as UiGroupData;

  return (
    <div
      className={`h-full w-full rounded-lg border-2 border-dashed transition-colors ${
        selected
          ? "border-blue-500 bg-blue-500/5"
          : "border-gray-400/70 bg-gray-400/5 dark:border-gray-500/60 dark:bg-gray-500/5"
      }`}
    >
      <div className="flex h-[22px] items-center px-1.5">
        <input
          value={d.label}
          onChange={(e) => d.onChange(e.target.value)}
          placeholder="Group"
          // nodrag keeps a click in the field from starting a canvas drag.
          className={`nodrag w-full bg-transparent text-[11px] font-medium outline-none ${
            selected ? "text-blue-500 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"
          }`}
        />
      </div>
    </div>
  );
}
