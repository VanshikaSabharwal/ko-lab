"use client";

import React from "react";
import { UI_PALETTE, DEVICE_FRAMES, type PaletteItem } from "./UiPrimitiveNode";
import { TEMPLATE_IDS, templateLabel } from "./templates";

const CATEGORIES: PaletteItem["category"][] = ["Layout", "Controls", "Content"];

function Chip({
  payload,
  onPick,
  children,
}: {
  payload: string;
  onPick: (payload: string) => void;
  children: React.ReactNode;
}) {
  return (
    // Drag works on desktop; HTML5 dragstart never fires on touch, so tapping
    // is the mobile path to the same insertion.
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-workspace-item", payload);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onPick(payload)}
      className="cursor-grab rounded border border-gray-300 bg-white px-2 py-2 text-left text-xs text-gray-700 hover:border-blue-500/60 hover:text-gray-900 active:cursor-grabbing dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-blue-600/60 dark:hover:text-white md:py-1.5"
    >
      {children}
    </button>
  );
}

interface UiPaletteProps {
  /** Tap-to-insert — the touch equivalent of dragging a chip onto the canvas. */
  onPick: (payload: string) => void;
}

export default function UiPalette({ onPick }: UiPaletteProps) {
  return (
    <div className="w-44 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-3 pt-12 dark:border-gray-700/50 dark:bg-gray-800/80 md:pt-3">
      {CATEGORIES.map((category) => (
        <div key={category} className="mb-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            {category}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {UI_PALETTE.filter((item) => item.category === category).map((item) => (
              <Chip key={item.kind} payload={item.kind} onPick={onPick}>
                {item.label}
              </Chip>
            ))}
          </div>
        </div>
      ))}

      <div className="mb-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Device frames
        </p>
        <div className="flex flex-col gap-1.5">
          {DEVICE_FRAMES.map((frame) => (
            <Chip key={frame.id} payload={`frame:${frame.id}`} onPick={onPick}>
              {frame.label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Templates
        </p>
        <div className="flex flex-col gap-1.5">
          {TEMPLATE_IDS.map((id) => (
            <Chip key={id} payload={`template:${id}`} onPick={onPick}>
              {templateLabel(id)}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
