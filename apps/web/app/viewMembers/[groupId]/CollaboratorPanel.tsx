"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import toast from "react-hot-toast";
import { FaGithub } from "react-icons/fa";
import { CheckCircle, Clock, UserPlus } from "lucide-react";

type CodeAccess = "NONE" | "PENDING_GITHUB" | "INVITED" | "ACTIVE";

interface Member {
  userId: string;
  codeAccess: CodeAccess;
  user: { name: string | null; image: string | null; email: string | null };
}

interface OwnerData {
  isOwner: true;
  repo: string;
  members: Member[];
}

const STATUS: Record<CodeAccess, { label: string; cls: string; icon?: React.ReactNode }> = {
  ACTIVE: {
    label: "Collaborator",
    cls: "text-green-600 dark:text-green-400",
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  INVITED: {
    label: "Invite sent",
    cls: "text-amber-600 dark:text-amber-400",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  PENDING_GITHUB: {
    label: "Awaiting GitHub link",
    cls: "text-gray-500",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  NONE: { label: "No code access", cls: "text-gray-400" },
};

// Owner-only panel: shows each member's code-access status and lets the owner
// send a GitHub collaborator invite (with a plain-language consequences modal).
export default function CollaboratorPanel({ groupId }: { groupId: string }) {
  const [data, setData] = useState<OwnerData | null>(null);
  const [confirmFor, setConfirmFor] = useState<Member | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/github/collaborator?groupId=${groupId}`);
    if (!res.ok) return; // non-owners get a 4xx / different shape — panel stays hidden
    const json = await res.json();
    if (json.isOwner) setData(json);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const invite = async (member: Member) => {
    setBusyId(member.userId);
    setConfirmFor(null);
    try {
      const res = await fetch("/api/github/collaborator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, memberUserId: member.userId }),
      });
      const json = await res.json();
      if (res.ok) {
        if (json.codeAccess === "PENDING_GITHUB") {
          toast("They haven't connected GitHub yet — the invite will send automatically once they do.");
        } else if (json.codeAccess === "ACTIVE") {
          toast.success("Already a collaborator");
        } else {
          toast.success("Collaborator invite sent");
        }
        load();
      } else if (res.status === 403) {
        // Org restrictions — fall back to GitHub's own settings page
        toast.error("GitHub blocked the invite — opening repo settings");
        window.open(`https://github.com/${data?.repo}/settings/access`, "_blank");
      } else {
        toast.error(json.error ?? "Failed to send invite");
      }
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setBusyId(null);
    }
  };

  // Nobody to give access to yet: an empty "Code access" heading just confused people
  if (!data || data.members.length === 0) return null;

  return (
    <div className="w-full max-w-md mt-8">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <FaGithub /> Code access
      </h2>
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
        Only you can see this. Invite members as GitHub collaborators so they can edit code
        and open change requests on {data.repo}.
      </p>
      <ul className="space-y-2">
        {data.members.map((member) => {
          const s = STATUS[member.codeAccess];
          const canInvite = member.codeAccess === "NONE" || member.codeAccess === "PENDING_GITHUB";
          return (
            <li
              key={member.userId}
              className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
            >
              <button
                onClick={() => canInvite && setConfirmFor(member)}
                disabled={!canInvite}
                title={canInvite ? "Make GitHub collaborator" : undefined}
                className="relative shrink-0"
              >
                {member.user.image ? (
                  <Image
                    src={member.user.image}
                    alt=""
                    width={36}
                    height={36}
                    className={`rounded-full object-cover ${canInvite ? "hover:opacity-80" : ""}`}
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {(member.user.name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                {canInvite && (
                  <span className="absolute -bottom-1 -right-1 rounded-full bg-blue-600 p-0.5 text-white">
                    <UserPlus className="h-3 w-3" />
                  </span>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.user.name ?? member.user.email}</p>
                <p className={`flex items-center gap-1 text-xs ${s.cls}`}>
                  {s.icon}
                  {s.label}
                </p>
              </div>

              {canInvite && (
                <button
                  onClick={() => setConfirmFor(member)}
                  disabled={busyId === member.userId}
                  className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
                >
                  {busyId === member.userId ? "Sending…" : "Invite"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Consequences modal */}
      {confirmFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <h3 className="mb-2 text-base font-semibold">Send collaborator invite?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              This sends{" "}
              <span className="font-medium">{confirmFor.user.name ?? confirmFor.user.email}</span> a
              GitHub invite for <span className="font-medium">write access to {data.repo}</span>.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Once accepted, they can push to this repository from anywhere — not just Ko-Lab. Their
              commits and change-requests will show under their own GitHub name.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmFor(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => invite(confirmFor)}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Send invite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
