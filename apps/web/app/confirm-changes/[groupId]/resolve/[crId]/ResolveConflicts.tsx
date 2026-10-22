"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, Check, FileWarning, GitMerge, Loader2, RotateCcw } from "lucide-react";
import { applyChoices, conflictCount, type ConflictChoice, type MergeRegion } from "../../../../lib/mergeText";
import type { ConflictFile, ConflictReport } from "../../../../lib/changeRequestConflicts";

interface Report extends ConflictReport {
  title: string;
  branchName: string;
}

/** One file's decisions: a choice per conflict, or a side kept whole. */
interface FileDecision {
  choices: (ConflictChoice | undefined)[];
  keep?: "mine" | "theirs";
  /** The author's own text, once they edit the result by hand. */
  edited?: string;
}

/** Unchanged lines around a conflict: enough to see where it is. */
const CONTEXT = 3;

function OkLines({ lines, first, last }: { lines: string[]; first: boolean; last: boolean }) {
  if (lines.length === 0) return null;
  const head = first ? [] : lines.slice(0, CONTEXT);
  const tail = last ? [] : lines.slice(-CONTEXT);
  const hidden = lines.length - head.length - tail.length;
  if (hidden <= 1) return <Code lines={lines} className="text-gray-400" />;
  return (
    <>
      <Code lines={head} className="text-gray-400" />
      <p className="px-3 py-1 text-[11px] italic text-gray-500">… {hidden} unchanged lines …</p>
      <Code lines={tail} className="text-gray-400" />
    </>
  );
}

function Code({ lines, className = "" }: { lines: string[]; className?: string }) {
  if (lines.length === 0) return null;
  return (
    <pre className={`overflow-x-auto px-3 py-1 font-mono text-xs leading-5 ${className}`}>
      {lines.join("\n")}
    </pre>
  );
}

function Side({
  label,
  lines,
  tone,
  picked,
  onPick,
}: {
  label: string;
  lines: string[];
  tone: "mine" | "theirs";
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <div
      className={`min-w-0 flex-1 rounded-md border ${
        picked
          ? "border-green-500 ring-1 ring-green-500/50"
          : tone === "mine"
            ? "border-blue-800/70"
            : "border-purple-800/70"
      }`}
    >
      <div
        className={`flex items-center justify-between gap-2 rounded-t-md px-3 py-1.5 text-xs font-medium ${
          tone === "mine" ? "bg-blue-950/60 text-blue-200" : "bg-purple-950/60 text-purple-200"
        }`}
      >
        {label}
        <button
          type="button"
          onClick={onPick}
          className={`flex items-center gap-1 rounded px-2 py-0.5 ${
            picked ? "bg-green-600 text-white" : "bg-gray-800 text-gray-200 hover:bg-gray-700"
          }`}
        >
          {picked && <Check size={12} />}
          {picked ? "Kept" : "Keep this"}
        </button>
      </div>
      {lines.length ? (
        <Code lines={lines} className="text-gray-100" />
      ) : (
        <p className="px-3 py-1.5 text-xs italic text-gray-500">These lines were deleted.</p>
      )}
    </div>
  );
}

function TextFile({
  file,
  decision,
  onChange,
}: {
  file: Extract<ConflictFile, { kind: "text" }>;
  decision: FileDecision;
  onChange: (d: FileDecision) => void;
}) {
  const [editing, setEditing] = useState(false);
  const allChosen = decision.choices.every(Boolean) && decision.choices.length === conflictCount(file.regions);
  const result = allChosen ? applyChoices(file.regions, decision.choices as ConflictChoice[]) : null;

  let conflictIndex = 0;
  return (
    <div className="space-y-2">
      {file.regions.map((region: MergeRegion, i) => {
        if (region.type === "ok") {
          return (
            <OkLines key={i} lines={region.lines} first={i === 0} last={i === file.regions.length - 1} />
          );
        }
        const index = conflictIndex++;
        const choice = decision.choices[index];
        const pick = (c: ConflictChoice) => {
          const choices = [...decision.choices];
          choices[index] = choice === c ? undefined : c;
          // Changing a choice replaces any hand-edited result built on the old ones
          onChange({ ...decision, choices, edited: undefined });
        };
        return (
          <div key={i} className="rounded-lg border border-amber-700/50 bg-amber-950/10 p-2">
            <p className="mb-2 text-xs font-medium text-amber-300">Conflict {index + 1}</p>
            <div className="flex flex-col gap-2 md:flex-row">
              <Side
                label="Your change"
                lines={region.mine}
                tone="mine"
                picked={choice === "mine"}
                onPick={() => pick("mine")}
              />
              <Side
                label="Latest main"
                lines={region.theirs}
                tone="theirs"
                picked={choice === "theirs"}
                onPick={() => pick("theirs")}
              />
            </div>
            <button
              type="button"
              onClick={() => pick("both")}
              className={`mt-2 rounded px-2 py-1 text-xs ${
                choice === "both" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {choice === "both" ? "✓ Keeping both (yours first)" : "Keep both"}
            </button>
          </div>
        );
      })}

      {result !== null && (
        <div className="rounded-lg border border-gray-700">
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-300">
            <span>{decision.edited !== undefined ? "Result (edited by you)" : "Result"}</span>
            <span className="flex gap-2">
              {decision.edited !== undefined && (
                <button
                  type="button"
                  onClick={() => onChange({ ...decision, edited: undefined })}
                  className="flex items-center gap-1 text-gray-400 hover:text-white"
                >
                  <RotateCcw size={12} /> Undo edits
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                className="text-blue-400 hover:underline"
              >
                {editing ? "Done editing" : "Edit the result"}
              </button>
            </span>
          </div>
          {editing ? (
            <textarea
              value={decision.edited ?? result}
              onChange={(e) => onChange({ ...decision, edited: e.target.value })}
              spellCheck={false}
              rows={Math.min(24, (decision.edited ?? result).split("\n").length + 1)}
              className="block w-full resize-y border-t border-gray-700 bg-gray-950 p-3 font-mono text-xs text-gray-100 outline-none"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

const WHOLE_REASON = {
  "deleted-by-you": "You deleted this file, but it was changed on main since.",
  "deleted-on-main": "This file was deleted on main, but you changed it.",
  binary: "This isn't a text file, so it can't be merged line by line.",
};

function WholeFile({
  file,
  decision,
  onChange,
}: {
  file: Extract<ConflictFile, { kind: "whole" }>;
  decision: FileDecision;
  onChange: (d: FileDecision) => void;
}) {
  const label = (side: "mine" | "theirs") => {
    const gone = side === "mine" ? file.reason === "deleted-by-you" : file.reason === "deleted-on-main";
    if (gone) return side === "mine" ? "Keep it deleted" : "Delete it, as main did";
    return side === "mine" ? "Keep your version" : "Keep main's version";
  };
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm text-amber-200">
        <FileWarning size={15} /> {WHOLE_REASON[file.reason]}
      </p>
      <div className="flex flex-wrap gap-2">
        {(["mine", "theirs"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => onChange({ ...decision, keep: side })}
            className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs ${
              decision.keep === side ? "bg-green-600 text-white" : "bg-gray-800 text-gray-200 hover:bg-gray-700"
            }`}
          >
            {decision.keep === side && <Check size={12} />}
            {label(side)}
          </button>
        ))}
      </div>
    </div>
  );
}

const isDone = (file: ConflictFile, d: FileDecision | undefined) =>
  !!d &&
  (file.kind === "whole"
    ? !!d.keep
    : d.choices.length === conflictCount(file.regions) && d.choices.every(Boolean));

export default function ResolveConflicts({
  groupId,
  changeRequestId,
}: {
  groupId: string;
  changeRequestId: string;
}) {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, FileDecision>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setReport(null);
    setDecisions({});
    try {
      const res = await fetch(`/api/vcs/conflicts?changeRequestId=${encodeURIComponent(changeRequestId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load the conflicts");
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the conflicts");
    }
  }, [changeRequestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const files = report?.files ?? [];
    return { files: files.length, done: files.filter((f) => isDone(f, decisions[f.path])).length };
  }, [report, decisions]);

  const save = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const resolutions = report.files.map((file) => {
        const d = decisions[file.path]!;
        if (file.kind === "whole") return { path: file.path, keep: d.keep };
        return {
          path: file.path,
          content: d.edited ?? applyChoices(file.regions, d.choices as ConflictChoice[]),
        };
      });
      const res = await fetch("/api/vcs/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeRequestId,
          seen: { branchHead: report.branchHead, mainHead: report.mainHead },
          resolutions,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === "STALE") {
        toast.error(data.error);
        await load();
        return;
      }
      if (!res.ok) throw new Error(data.error || "Couldn't save the resolution");
      toast.success("Conflicts resolved. The change request is open again.");
      router.push(`/confirm-changes/${groupId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the resolution");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-57px)] bg-gray-900 pb-24 text-white">
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Link
          href={`/confirm-changes/${groupId}`}
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white"
        >
          <ArrowLeft size={14} /> Change requests
        </Link>

        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <GitMerge size={20} className="text-amber-400" /> Resolve conflicts
          </h1>
          {report && (
            <p className="mt-1 text-sm text-gray-400">
              <span className="text-gray-200">{report.title}</span> · {report.branchName}
            </p>
          )}
          <p className="mt-2 max-w-3xl text-sm text-gray-400">
            These lines were changed both in this change request and on {report?.mainBranch ?? "main"} since
            it started. Choose what to keep. Every other change merges on its own.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
            {error}
            <button type="button" onClick={load} className="ml-3 underline">
              Try again
            </button>
          </div>
        )}

        {!report && !error && (
          <p className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Comparing with the latest {"main"}…
          </p>
        )}

        {report && report.files.length === 0 && (
          <div className="rounded-lg border border-green-800 bg-green-950/30 p-4 text-sm text-green-200">
            Nothing conflicts any more: main has caught up with these changes. Save to reopen the change
            request.
          </div>
        )}

        {report?.files.map((file) => {
          const decision = decisions[file.path] ?? { choices: [] };
          const set = (d: FileDecision) => setDecisions((all) => ({ ...all, [file.path]: d }));
          return (
            <section key={file.path} className="rounded-xl border border-gray-700 bg-gray-800/40">
              <header className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-2">
                <span className="truncate font-mono text-sm">{file.path}</span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${
                    isDone(file, decision) ? "bg-green-900/60 text-green-300" : "bg-amber-900/50 text-amber-300"
                  }`}
                >
                  {isDone(file, decision)
                    ? "Resolved"
                    : file.kind === "text"
                      ? `${conflictCount(file.regions)} to decide`
                      : "To decide"}
                </span>
              </header>
              <div className="p-3">
                {file.kind === "text" ? (
                  <TextFile file={file} decision={decision} onChange={set} />
                ) : (
                  <WholeFile file={file} decision={decision} onChange={set} />
                )}
              </div>
            </section>
          );
        })}
      </div>

      {report && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-700 bg-gray-900/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <span className="text-sm text-gray-400">
              {totals.files === 0
                ? "Ready to reopen"
                : `${totals.done} of ${totals.files} file${totals.files === 1 ? "" : "s"} resolved`}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={saving || totals.done < totals.files}
              className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <GitMerge size={15} />}
              {saving ? "Saving…" : "Save and reopen change request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
