"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, GitBranch } from "lucide-react";

export interface Branch {
  name: string;
  sha: string;
  isDefault: boolean;
  isChangeRequest: boolean;
}

interface BranchMenuProps {
  branches: Branch[];
  current: string;
  onSelect: (name: string) => void;
  disabled?: boolean;
}

/** Past this many branches the list gets a filter box. */
const FILTER_FROM = 8;

/** The editor's branch switcher. Change-request branches are listed apart. */
export default function BranchMenu({ branches, current, onSelect, disabled }: BranchMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? branches.filter((b) => b.name.toLowerCase().includes(q)) : branches;
    return [
      { label: "Branches", items: shown.filter((b) => !b.isChangeRequest) },
      { label: "Change requests", items: shown.filter((b) => b.isChangeRequest) },
    ].filter((g) => g.items.length > 0);
  }, [branches, query]);

  if (branches.length === 0) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => {
          setQuery("");
          setOpen((o) => !o);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch branch"
        className="flex items-center gap-1.5 rounded bg-gray-700 px-2.5 py-1.5 text-xs text-gray-100 transition-colors hover:bg-gray-600 disabled:opacity-50"
      >
        <GitBranch size={13} />
        <span className="max-w-[8rem] truncate">{current || "Branch"}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
          {branches.length > FILTER_FROM && (
            <div className="px-2 pb-1 pt-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a branch…"
                aria-label="Find a branch"
                className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
              />
            </div>
          )}
          <div role="listbox" aria-label="Branches" className="max-h-64 overflow-y-auto">
            {groups.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-500">No matching branches</p>
            )}
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  {group.label}
                </p>
                {group.items.map((b) => (
                  <button
                    key={b.name}
                    role="option"
                    aria-selected={b.name === current}
                    onClick={() => {
                      setOpen(false);
                      onSelect(b.name);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                  >
                    <Check
                      size={12}
                      className={b.name === current ? "shrink-0 text-blue-400" : "shrink-0 opacity-0"}
                    />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {b.isDefault && <span className="shrink-0 text-[10px] text-gray-500">default</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
