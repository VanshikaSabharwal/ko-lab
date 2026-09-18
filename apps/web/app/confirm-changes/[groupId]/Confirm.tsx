"use client";

import { useState, useEffect, useCallback } from "react";
import { diffLines } from "diff";
import toast from "react-hot-toast";
import { useSession } from "next-auth/react";

interface GroupProps {
  group: string;
}

interface DraftFile {
  path: string;
  content?: string; // plain text, hydrated from the author's draft clone
  userId?: string; // author of the draft (owners see everyone's drafts)
}

interface ChangeRequest {
  id: string;
  title: string;
  branchName: string;
  prNumber: number | null;
  prUrl: string | null;
  status: "OPEN" | "MERGED" | "REJECTED" | "CONFLICT";
  files: DraftFile[] | null;
  createdAt: string;
  author: { name: string | null; image: string | null };
}

// Build aligned split-diff rows from two texts. Each row has an optional left
// (old) and right (new) line; type drives the red/green highlight.
type DiffRow = {
  left: string | null;
  right: string | null;
  leftNo: number | null;
  rightNo: number | null;
  type: "same" | "removed" | "added";
};

function buildSplitRows(original: string, modified: string): DiffRow[] {
  const parts = diffLines(original ?? "", modified ?? "");
  const rows: DiffRow[] = [];
  let leftNo = 1;
  let rightNo = 1;
  let i = 0;

  const toLines = (v: string) => {
    const lines = v.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };

  while (i < parts.length) {
    const part = parts[i]!;
    const lines = toLines(part.value);

    if (!part.added && !part.removed) {
      for (const l of lines) {
        rows.push({ left: l, right: l, leftNo: leftNo++, rightNo: rightNo++, type: "same" });
      }
      i++;
      continue;
    }

    // Pair a removed block immediately followed by an added block (a change)
    if (part.removed) {
      const removedLines = lines;
      const next = parts[i + 1];
      const addedLines = next?.added ? toLines(next.value) : [];
      const max = Math.max(removedLines.length, addedLines.length);
      for (let k = 0; k < max; k++) {
        const l = k < removedLines.length ? removedLines[k]! : null;
        const r = k < addedLines.length ? addedLines[k]! : null;
        rows.push({
          left: l,
          right: r,
          leftNo: l !== null ? leftNo++ : null,
          rightNo: r !== null ? rightNo++ : null,
          type: r !== null && l !== null ? "removed" : l !== null ? "removed" : "added",
        });
        // when both present it's a modification — mark left removed / right added handled by cell colors below
      }
      i += next?.added ? 2 : 1;
      continue;
    }

    // Lone added block
    if (part.added) {
      for (const l of lines) {
        rows.push({ left: null, right: l, leftNo: null, rightNo: rightNo++, type: "added" });
      }
      i++;
      continue;
    }
  }
  return rows;
}

function SplitDiff({ original, modified }: { original: string; modified: string }) {
  const rows = buildSplitRows(original, modified);
  const cell = "px-3 py-0.5 font-mono text-xs whitespace-pre-wrap break-all align-top";
  const gutter =
    "select-none px-2 py-0.5 text-right font-mono text-[10px] text-gray-600 align-top";

  return (
    <div className="h-full overflow-auto rounded border border-gray-700 bg-gray-950">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row, idx) => {
            const leftBg = row.left !== null && row.type !== "same" ? "bg-red-950/50" : "";
            const rightBg = row.right !== null && row.type !== "same" ? "bg-green-950/50" : "";
            const leftText = row.left !== null && row.type !== "same" ? "text-red-200" : "text-gray-300";
            const rightText =
              row.right !== null && row.type !== "same" ? "text-green-200" : "text-gray-300";
            return (
              <tr key={idx}>
                <td className={`${gutter} ${leftBg}`}>{row.leftNo ?? ""}</td>
                <td className={`${cell} ${leftBg} ${leftText} w-1/2`}>
                  {row.left !== null && (
                    <span>
                      {row.type !== "same" && <span className="mr-1 text-red-500">-</span>}
                      {row.left || " "}
                    </span>
                  )}
                </td>
                <td className={`${gutter} ${rightBg}`}>{row.rightNo ?? ""}</td>
                <td className={`${cell} ${rightBg} ${rightText} w-1/2`}>
                  {row.right !== null && (
                    <span>
                      {row.type !== "same" && <span className="mr-1 text-green-500">+</span>}
                      {row.right || " "}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_STYLE: Record<ChangeRequest["status"], string> = {
  OPEN: "bg-blue-900/50 text-blue-300",
  MERGED: "bg-green-900/50 text-green-300",
  REJECTED: "bg-red-900/50 text-red-300",
  CONFLICT: "bg-amber-900/50 text-amber-300",
};

const Confirm = ({ group }: GroupProps) => {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [isOwner, setIsOwner] = useState(false);
  const [crs, setCrs] = useState<ChangeRequest[]>([]);
  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  // Diff viewer state
  const [selectedPath, setSelectedPath] = useState("");
  const [panes, setPanes] = useState({ original: "", modified: "" });
  const [activeFiles, setActiveFiles] = useState<DraftFile[]>([]); // drafts or a CR's files
  // The CR awaiting a rejection reason, plus the reason being typed. Replaces
  // window.prompt(), which is unstyled and blocked outright by some browsers.
  const [rejecting, setRejecting] = useState<ChangeRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadCrs = useCallback(async () => {
    const res = await fetch(`/api/vcs/change-request?groupId=${group}`);
    if (res.ok) {
      const data = await res.json();
      setIsOwner(data.isOwner);
      setCrs(data.changeRequests ?? []);
    }
  }, [group]);

  useEffect(() => {
    if (!group || !userId) return;
    const init = async () => {
      try {
        await loadCrs();
        // A member's own not-yet-submitted drafts
        const draftsRes = await fetch(`/api/modified-files?group=${group}`);
        if (draftsRes.ok) {
          const data = await draftsRes.json();
          const list: DraftFile[] = Array.isArray(data)
            ? data.map((f: any) => ({ path: f.path, content: f.content, userId: f.userId }))
            : [];
          setDrafts(list);
          setActiveFiles(list);
          if (list.length) loadDiff(list[0]!.path, list);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, userId, loadCrs]);

  // Show a file: GitHub original (left) vs draft/CR content (right)
  const loadDiff = async (path: string, fileSet: DraftFile[]) => {
    setSelectedPath(path);
    const file = fileSet.find((f) => f.path === path);
    const modified = file?.content || "";

    let original = "";
    try {
      const res = await fetch("/api/file-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group, filePath: path }),
      });
      if (res.ok) original = (await res.json()).content ?? "";
    } catch {
      /* new file — no original */
    }
    setPanes({ original, modified });
  };

  const submitChangeRequest = async () => {
    if (!title.trim()) return toast.error("Describe your change first.");
    setBusyId("submit");
    try {
      const res = await fetch("/api/vcs/change-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group, title }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Change request opened${data.prNumber ? ` (PR #${data.prNumber})` : ""}`);
        setTitle("");
        setDrafts([]);
        await loadCrs();
      } else if (res.status === 409 && data.status === "CONFLICT") {
        toast.error(data.message ?? "Your branch conflicts with main.");
        await loadCrs();
      } else {
        toast.error(data.error ?? "Failed to submit change request");
      }
    } catch {
      toast.error("Failed to submit change request");
    } finally {
      setBusyId(null);
    }
  };

  const mergeCr = async (cr: ChangeRequest) => {
    setBusyId(cr.id);
    try {
      const res = await fetch("/api/vcs/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeRequestId: cr.id }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Merged into the default branch");
      } else if (data.status === "CONFLICT") {
        toast.error("Now conflicts with main — the author must resync.");
      } else {
        toast.error(data.error ?? "Merge failed");
      }
      await loadCrs();
    } finally {
      setBusyId(null);
    }
  };

  /** Open the reason dialog; the request itself is sent by confirmReject. */
  const rejectCr = (cr: ChangeRequest) => {
    setRejectReason("");
    setRejecting(cr);
  };

  const confirmReject = async () => {
    const cr = rejecting;
    if (!cr) return;
    // The reason stays optional, as it was with the prompt.
    const reason = rejectReason.trim() || undefined;
    setBusyId(cr.id);
    try {
      const res = await fetch("/api/vcs/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeRequestId: cr.id, reason }),
      });
      if (res.ok) toast.success("Change request rejected");
      else toast.error("Failed to reject");
      setRejecting(null);
      await loadCrs();
    } finally {
      setBusyId(null);
    }
  };

  const reviewCr = (cr: ChangeRequest) => {
    const files = cr.files ?? [];
    setActiveFiles(files);
    if (files.length) loadDiff(files[0]!.path, files);
  };

  // Drafts the current user can submit as a change request. Members see only
  // their own; owners see everyone's in the review diff, so filter to own.
  const myDrafts = userId ? drafts.filter((d) => d.userId === userId) : [];

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900">
        <div className="h-10 w-10 animate-spin rounded-full border-t-4 border-pink-500" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-white">
      <div className="flex-none space-y-4 bg-gray-800 p-4">
        <h2 className="text-lg font-bold">Change Requests</h2>

        {/* Submit your own drafts as a change request */}
        {myDrafts.length > 0 ? (
          <div className="rounded-lg border border-gray-700 p-3">
            <p className="mb-2 text-sm text-gray-300">
              You have {myDrafts.length} changed file
              {myDrafts.length > 1 ? "s" : ""} ready to submit.
            </p>
            <div className="flex gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Describe your change (becomes the PR title)…"
                className="flex-1 rounded border border-gray-300 bg-white p-2 text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
              />
              <button
                onClick={submitChangeRequest}
                disabled={busyId === "submit" || !title.trim()}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {busyId === "submit" ? "Submitting…" : "Submit change request"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-700 p-3">
            <p className="text-sm text-gray-400">
              No pending changes. Edit files in the code editor, then come back here to submit.
            </p>
          </div>
        )}

        {/* CR list */}
        <div className="space-y-2">
          {crs.length === 0 && (
            <p className="text-sm text-gray-400">No change requests yet.</p>
          )}
          {crs.map((cr) => (
            <div
              key={cr.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-700 p-3"
            >
              <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[cr.status]}`}>
                {cr.status}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{cr.title}</p>
                <p className="text-xs text-gray-400">
                  {cr.author.name ?? "Member"} · {cr.branchName}
                  {cr.prUrl && (
                    <>
                      {" · "}
                      <a href={cr.prUrl} target="_blank" className="underline hover:text-blue-300">
                        PR #{cr.prNumber}
                      </a>
                    </>
                  )}
                </p>
              </div>

              {cr.files && cr.files.length > 0 && (
                <button
                  onClick={() => reviewCr(cr)}
                  className="rounded border border-gray-600 px-3 py-1 text-xs hover:bg-gray-700"
                >
                  Review diff
                </button>
              )}

              {isOwner && cr.status === "OPEN" && (
                <>
                  <button
                    onClick={() => mergeCr(cr)}
                    disabled={busyId === cr.id}
                    className="rounded bg-green-600 px-3 py-1 text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {busyId === cr.id ? "…" : "Merge"}
                  </button>
                  <button
                    onClick={() => rejectCr(cr)}
                    disabled={busyId === cr.id}
                    className="rounded bg-red-600 px-3 py-1 text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* File tabs for whatever's being reviewed */}
        {activeFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeFiles.map((f) => (
              <button
                key={f.path}
                onClick={() => loadDiff(f.path, activeFiles)}
                className={`rounded px-2 py-1 text-xs ${
                  selectedPath === f.path ? "bg-gray-600" : "bg-gray-700/50 hover:bg-gray-700"
                }`}
              >
                {f.path}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Split diff: red = removed (original), green = added (proposed) */}
      <div className="flex flex-grow flex-col overflow-hidden p-4">
        <div className="mb-2 flex items-center gap-4 text-xs">
          <span className="font-bold">{selectedPath || "Select a file"}</span>
          <span className="flex items-center gap-1 text-red-400">
            <span className="inline-block h-2 w-2 rounded-sm bg-red-500" /> removed
          </span>
          <span className="flex items-center gap-1 text-green-400">
            <span className="inline-block h-2 w-2 rounded-sm bg-green-500" /> added
          </span>
        </div>
        <div className="flex-grow overflow-hidden">
          {selectedPath ? (
            <SplitDiff original={panes.original} modified={panes.modified} />
          ) : (
            <p className="text-sm text-gray-500">Pick a file above to see its diff.</p>
          )}
        </div>
      </div>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900">
            <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">
              Reject change request
            </h3>
            <p className="mb-3 truncate text-xs text-gray-500 dark:text-gray-400">
              {rejecting.title}
            </p>

            <label
              htmlFor="reject-reason"
              className="mb-1 block text-sm text-gray-600 dark:text-gray-300"
            >
              Reason <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="reject-reason"
              autoFocus
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Let the author know what needs changing"
              className="mb-4 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejecting(null)}
                disabled={busyId === rejecting.id}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={confirmReject}
                disabled={busyId === rejecting.id}
                aria-busy={busyId === rejecting.id}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {busyId === rejecting.id ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function safeAtob(b64: string): string {
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    try {
      return atob(b64);
    } catch {
      return b64;
    }
  }
}

export default Confirm;
