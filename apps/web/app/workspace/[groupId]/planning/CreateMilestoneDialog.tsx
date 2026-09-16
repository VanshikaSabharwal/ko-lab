"use client";

import React, { useState } from "react";
import { X } from "lucide-react";

interface CreateMilestoneDialogProps {
  onCreate: (fields: {
    title: string;
    dueDate: string;
    startDate?: string;
  }) => Promise<unknown>;
  onClose: () => void;
}

/** Today as YYYY-MM-DD, matching the API's date format. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Minimal milestone creation for the Quick Actions block. A dialog rather than
 * an inline row because dueDate is required server-side, so a blank milestone
 * would just fail.
 */
export default function CreateMilestoneDialog({
  onCreate,
  onClose,
}: CreateMilestoneDialogProps) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState(today());
  const [saving, setSaving] = useState(false);

  const invalidRange = Boolean(startDate) && startDate > dueDate;
  const canSubmit = title.trim().length > 0 && Boolean(dueDate) && !invalidRange && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const created = await onCreate({
      title: title.trim(),
      dueDate,
      ...(startDate ? { startDate } : {}),
    });
    setSaving(false);
    // Only close on success — the hook toasts the failure, and closing would
    // throw away what was typed.
    if (created) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/50" aria-hidden />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">New milestone</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={15} />
          </button>
        </div>

        <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400">
          Title
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Beta release"
            className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400">
            Start (optional)
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </label>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400">
            Due
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </label>
        </div>

        {invalidRange && (
          <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
            Start must be on or before the due date.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create milestone"}
          </button>
        </div>
      </form>
    </div>
  );
}
