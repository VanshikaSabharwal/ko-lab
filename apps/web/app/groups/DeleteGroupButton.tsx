"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { X, AlertTriangle, Loader2 } from "lucide-react";

export default function DeleteGroupButton({
  groupId,
  ownerId,
  userId,
}: {
  groupId: string;
  ownerId: string;
  userId: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  // Replaces window.confirm(), which can't be styled, ignores dark mode and is
  // suppressible by the browser — a poor gate for an irreversible delete.
  const [confirming, setConfirming] = useState(false);

  if (ownerId !== userId) return null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/create-group-data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to delete group");
        return;
      }
      setConfirming(false);
      toast.success("Group deleted");
      router.refresh();
    } catch {
      toast.error("An error occurred");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={deleting}
        className="text-xs text-red-500 hover:underline disabled:opacity-50"
      >
        {deleting ? "Deleting..." : "Delete"}
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900">
            <div className="mb-3 flex items-start justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Delete this group?
              </h3>
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                aria-label="Cancel"
                className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
              This permanently deletes the group along with all messages, files
              and member data. <strong>This cannot be undone.</strong>
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                aria-busy={deleting}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                {deleting ? "Deleting…" : "Delete group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
