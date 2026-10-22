"use client";

import React from "react";
import type { FileActivity } from "../lib/useFileActivity";

const COLORS = ["bg-pink-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-rose-500"];

/** Same person, same colour, everywhere. */
function colorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

/** "Asha is editing", "Asha and Bilal have it open". */
export function describeActivity(people: FileActivity[]): string {
  const names = people.map((p) => p.name.split(" ")[0] || "Someone");
  const who = names.length <= 2 ? names.join(" and ") : `${names[0]} and ${names.length - 1} others`;
  const anyEditing = people.some((p) => p.editing);
  const plural = names.length > 1;
  return anyEditing
    ? `${who} ${plural ? "are" : "is"} editing this file`
    : `${who} ${plural ? "have" : "has"} this file open`;
}

/**
 * Small initials showing who else has a file open. Solid when they have
 * unsaved edits to it, outlined when they're only looking.
 */
export default function FileActivityBadge({ people }: { people: FileActivity[] | undefined }) {
  if (!people?.length) return null;
  const shown = people.slice(0, 2);
  return (
    <span className="ml-1 flex shrink-0 -space-x-1" title={describeActivity(people)} aria-label={describeActivity(people)}>
      {shown.map((p) => (
        <span
          key={p.userId}
          className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold leading-none ${
            p.editing ? `${colorFor(p.userId)} text-white` : "border border-gray-400 text-gray-300"
          }`}
        >
          {initial(p.name)}
        </span>
      ))}
      {people.length > shown.length && (
        <span className="flex h-4 items-center pl-1.5 text-[9px] text-gray-400">+{people.length - shown.length}</span>
      )}
    </span>
  );
}
