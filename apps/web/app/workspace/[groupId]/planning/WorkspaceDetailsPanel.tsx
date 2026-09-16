"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import toast from "react-hot-toast";
import { Check, Flag, Pencil, Plus, UserPlus, X } from "lucide-react";
import AvatarStack from "../../components/AvatarStack";
import type { AvatarUser } from "../../components/Avatar";
import { boardProgress } from "../../lib/boardProgress";
import type {
  PlanningColumn,
  PlanningMilestone,
  PlanningTask,
} from "../../lib/usePlanningData";
import { cn } from "../../../lib/utils";

/**
 * Right-hand details panel: what this project is, and how far each milestone
 * has got. Milestone progress reuses boardProgress() over that milestone's
 * tasks, so it can't disagree with the sidebar's overall figure.
 */

interface WorkspaceDetailsPanelProps {
  groupId: string;
  groupName: string;
  columns: PlanningColumn[];
  tasks: PlanningTask[];
  milestones: PlanningMilestone[];
  members: AvatarUser[];
  onAddTask: () => void;
  onAddMilestone: () => void;
  onClose?: () => void;
}

interface GroupDetails {
  description: string | null;
  coverImage: string | null;
  isOwner: boolean;
}

function formatDue(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

export default function WorkspaceDetailsPanel({
  groupId,
  groupName,
  columns,
  tasks,
  milestones,
  members,
  onAddTask,
  onAddMilestone,
  onClose,
}: WorkspaceDetailsPanelProps) {
  const [details, setDetails] = useState<GroupDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/groups/${groupId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setDetails({
          description: data.description ?? null,
          coverImage: data.coverImage ?? null,
          isOwner: Boolean(data.isOwner),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Progress per milestone, from that milestone's own tasks. A milestone with
  // no tasks yet returns null rather than 0% — "nothing planned" isn't "nothing
  // done", and showing an empty bar reads as being behind.
  const milestoneRows = useMemo(
    () =>
      milestones.map((m) => {
        const own = tasks.filter((t) => t.milestoneId === m.id);
        return { milestone: m, count: own.length, progress: boardProgress(columns, own) };
      }),
    [milestones, tasks, columns],
  );

  const saveDescription = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: draft.trim() || null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setDetails((prev) =>
        prev ? { ...prev, description: data.description ?? null } : prev,
      );
      setEditing(false);
    } catch {
      toast.error("Couldn't save the description");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40">
      <div className="flex items-center justify-between px-3 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Workspace details
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close details"
            className="rounded p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {details?.coverImage && (
        <div className="relative mx-3 mb-3 h-28 overflow-hidden rounded-lg">
          <Image
            src={details.coverImage}
            alt=""
            fill
            className="object-cover"
            unoptimized
          />
        </div>
      )}

      <div className="px-3">
        <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
          {groupName}
        </h3>

        {editing ? (
          <div className="mt-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="What is this project about?"
              className="w-full resize-none rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                onClick={saveDescription}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-60"
              >
                <Check size={11} />
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 flex items-start gap-1.5">
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
              {details?.description || (
                <span className="italic text-gray-400 dark:text-gray-600">
                  No description yet.
                </span>
              )}
            </p>
            {/* Only the owner can PATCH this, so only they get the affordance —
                offering it to members would just produce a 403. */}
            {details?.isOwner && (
              <button
                onClick={() => {
                  setDraft(details.description ?? "");
                  setEditing(true);
                }}
                aria-label="Edit description"
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 px-3">
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Team
        </h4>
        <div className="flex items-center gap-2">
          <AvatarStack users={members} size={24} max={5} />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {members.length} member{members.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="mt-4 px-3">
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Milestones
        </h4>
        {milestoneRows.length === 0 ? (
          <p className="text-[11px] text-gray-400 dark:text-gray-600">No milestones yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {milestoneRows.map(({ milestone, count, progress }) => (
              <li key={milestone.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Flag
                      size={11}
                      className={cn(
                        "shrink-0",
                        milestone.done
                          ? "text-emerald-500"
                          : "text-gray-400 dark:text-gray-600",
                      )}
                    />
                    <span className="truncate text-xs text-gray-700 dark:text-gray-200">
                      {milestone.title}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                    {formatDue(milestone.dueDate)}
                  </span>
                </div>
                {progress === null ? (
                  <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-600">
                    No tasks yet
                  </p>
                ) : (
                  <div className="mt-1 flex items-center gap-1.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                      {Math.round(progress * 100)}%
                    </span>
                  </div>
                )}
                {count > 0 && (
                  <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-600">
                    {count} task{count === 1 ? "" : "s"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 px-3 pb-4">
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Quick actions
        </h4>
        <div className="space-y-1.5">
          <button
            onClick={onAddTask}
            className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700 hover:border-blue-500/60 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            <Plus size={13} />
            New task
          </button>
          <button
            onClick={onAddMilestone}
            className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700 hover:border-blue-500/60 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            <Flag size={13} />
            New milestone
          </button>
          <a
            href={`/code-editor/${groupId}`}
            className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700 hover:border-blue-500/60 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            <UserPlus size={13} />
            Manage collaborators
          </a>
        </div>
      </div>
    </aside>
  );
}
