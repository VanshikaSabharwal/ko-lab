"use client";

import React, { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Check, Copy, Github, KeyRound, Link2, Loader2, RefreshCw, ShieldCheck, ShieldOff, UserPlus, X,
} from "lucide-react";
import Avatar from "../../../../workspace/components/Avatar";
import { cn } from "../../../../lib/utils";

type CodeAccess = "NONE" | "PENDING_GITHUB" | "INVITED" | "ACTIVE";

interface Member {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
  codeAccess: CodeAccess;
}

/**
 * What each access state means and what happens next.
 *
 * The states are only useful if each one says what to do about it — "INVITED"
 * alone leaves an owner wondering whether to wait or act.
 */
const ACCESS_META: Record<
  CodeAccess,
  { label: string; hint: string; chip: string }
> = {
  ACTIVE: {
    label: "Has push access",
    hint: "Can push and open change requests.",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  INVITED: {
    label: "Invite sent",
    hint: "Waiting for them to accept the GitHub invitation.",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  PENDING_GITHUB: {
    label: "Awaiting GitHub link",
    hint: "The invite is queued and sends itself once they connect GitHub.",
    chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  NONE: {
    label: "No code access",
    hint: "Read-only — they can browse but not push.",
    chip: "bg-gray-500/10 text-gray-500 dark:text-gray-400",
  },
};

interface CollaborationPanelProps {
  groupId: string;
  repo: string;
}

export default function CollaborationPanel({ groupId, repo }: CollaborationPanelProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [myAccess, setMyAccess] = useState<CodeAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ member: Member; revoke: boolean } | null>(null);
  const [requested, setRequested] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // The roster and the access states come from different routes; merge on
      // userId so a member with no GroupMember access row still appears.
      const [rosterRes, accessRes] = await Promise.all([
        fetch(`/api/groups/${groupId}/members`),
        fetch(`/api/github/collaborator?groupId=${groupId}`),
      ]);

      const roster = rosterRes.ok ? await rosterRes.json() : { members: [] };
      const access = accessRes.ok ? await accessRes.json() : null;

      const accessById = new Map<string, CodeAccess>(
        (access?.members ?? []).map((m: { userId: string; codeAccess: CodeAccess }) => [
          m.userId,
          m.codeAccess,
        ]),
      );

      setIsOwner(Boolean(access?.isOwner));
      setMembers(
        (roster.members ?? []).map((m: Omit<Member, "codeAccess">) => ({
          ...m,
          // The owner's access comes from holding the repo token, not a row.
          codeAccess: m.role === "OWNER" ? "ACTIVE" : (accessById.get(m.id) ?? "NONE"),
        })),
      );

      if (access?.isOwner) {
        const linkRes = await fetch(`/api/groups/${groupId}/invite-link`);
        if (linkRes.ok) setInviteUrl((await linkRes.json()).url ?? null);
      }

      // Non-owners get their own status from the same route in self mode.
      if (!access?.isOwner) {
        const selfRes = await fetch(`/api/github/collaborator?groupId=${groupId}&self=1`);
        if (selfRes.ok) setMyAccess((await selfRes.json()).codeAccess ?? "NONE");
      }
    } catch {
      toast.error("Couldn't load collaborators");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const changeAccess = async (member: Member, revoke: boolean) => {
    setBusyId(member.id);
    setConfirming(null);
    try {
      const res = await fetch("/api/github/collaborator", {
        method: revoke ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, memberUserId: member.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      toast.success(revoke ? "Access revoked" : "Invitation sent");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  };

  const manageLink = async (method: "POST" | "DELETE") => {
    setLinkBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/invite-link`, { method });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setInviteUrl(method === "POST" ? data.url : null);
      toast.success(method === "POST" ? "Invite link ready" : "Invite link revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the link");
    } finally {
      setLinkBusy(false);
    }
  };

  const copyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Link copied");
    } catch {
      // Clipboard access is blocked in some contexts; the input is selectable.
      toast.error("Couldn't copy — select the link and copy manually");
    }
  };

  const requestAccess = async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/access-request`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setRequested(true);
      toast.success("The owner has been notified");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the request");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 size={15} className="animate-spin" />
        Loading collaborators…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-2xl">
        <header className="mb-5">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Collaboration</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Who can work on <span className="font-mono text-xs">{repo}</span>. Group membership and
            repository push access are separate — being in the group doesn&apos;t grant push rights.
          </p>
        </header>

        {/* Member's own status — the owner never needs this, their access is implicit. */}
        {!isOwner && myAccess && (
          <section className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2">
              <KeyRound size={15} className="text-blue-500" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Your access</h2>
              <span
                className={cn(
                  "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
                  ACCESS_META[myAccess].chip,
                )}
              >
                {ACCESS_META[myAccess].label}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {ACCESS_META[myAccess].hint}
            </p>

            <div className="mt-3">
              {myAccess === "NONE" && (
                <button
                  onClick={requestAccess}
                  disabled={requested}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  <UserPlus size={13} />
                  {requested ? "Request sent" : "Request code access"}
                </button>
              )}
              {myAccess === "PENDING_GITHUB" && (
                <a
                  href="/api/github/link"
                  className="flex w-fit items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900"
                >
                  <Github size={13} /> Connect GitHub
                </a>
              )}
              {myAccess === "INVITED" && (
                <a
                  href="/profile"
                  className="flex w-fit items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  <Check size={13} /> Accept invitation
                </a>
              )}
            </div>
          </section>
        )}

        {isOwner && (
          <section className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2">
              <Link2 size={15} className="text-blue-500" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Invite link</h2>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Anyone with this link joins the group. It does <strong>not</strong> grant push access
              — you still approve that per member below.
            </p>

            {inviteUrl ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Invite link"
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-2 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300"
                />
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500"
                >
                  <Copy size={13} /> Copy
                </button>
                <button
                  onClick={() => manageLink("POST")}
                  disabled={linkBusy}
                  title="Generate a new link and invalidate this one"
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs dark:border-gray-700"
                >
                  <RefreshCw size={13} /> Regenerate
                </button>
                <button
                  onClick={() => manageLink("DELETE")}
                  disabled={linkBusy}
                  className="rounded-lg px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  Revoke
                </button>
              </div>
            ) : (
              <button
                onClick={() => manageLink("POST")}
                disabled={linkBusy}
                className="mt-3 flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <Link2 size={13} /> Create invite link
              </button>
            )}
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
            Members ({members.length})
          </h2>

          <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {members.map((member) => {
              const meta = ACCESS_META[member.codeAccess];
              const isGroupOwner = member.role === "OWNER";
              // Two accounts can share a display name. When they do, the email
              // is the only thing that tells them apart, so it replaces the
              // access hint for those rows only.
              const nameIsAmbiguous =
                !!member.name &&
                members.filter((other) => other.name === member.name).length > 1;
              return (
                <li
                  key={member.id}
                  className="flex items-center gap-3 bg-white p-3 dark:bg-gray-900"
                >
                  <Avatar user={member} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {member.name ?? "Unknown"}
                      {/* The group owner is surfaced as Admin: the schema's
                          GroupRole is ADMIN|MEMBER, and "Owner" was a third
                          word for the same authority. Labelling every role —
                          not just the owner's — also disambiguates two
                          accounts that happen to share a display name. */}
                      <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-gray-400">
                        {isGroupOwner || member.role === "ADMIN" ? "Admin" : "Member"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {nameIsAmbiguous && member.email ? member.email : meta.hint}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      meta.chip,
                    )}
                  >
                    {meta.label}
                  </span>

                  {/* Owner-only actions are hidden from members rather than
                      shown disabled, which would just invite confusion. */}
                  {isOwner && !isGroupOwner && (
                    <div className="shrink-0">
                      {busyId === member.id ? (
                        <Loader2 size={15} className="animate-spin text-gray-400" />
                      ) : member.codeAccess === "ACTIVE" ? (
                        <button
                          onClick={() => setConfirming({ member, revoke: true })}
                          className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-red-600 hover:border-red-400 dark:border-gray-700 dark:text-red-400"
                        >
                          <ShieldOff size={12} /> Revoke
                        </button>
                      ) : member.codeAccess === "PENDING_GITHUB" ? null : (
                        <button
                          onClick={() => setConfirming({ member, revoke: false })}
                          className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                        >
                          <ShieldCheck size={12} />
                          {/* GitHub's PUT is idempotent, so re-sending a stale
                              invite is safe and often what's needed. */}
                          {member.codeAccess === "INVITED" ? "Resend" : "Grant access"}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900">
            <div className="mb-3 flex items-start justify-between">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                {confirming.revoke ? "Revoke access?" : "Grant push access?"}
              </h3>
              <button
                onClick={() => setConfirming(null)}
                aria-label="Cancel"
                className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
              {confirming.revoke ? (
                <>
                  <strong>{confirming.member.name ?? "This member"}</strong> will lose push access to{" "}
                  <span className="font-mono text-xs">{repo}</span> on GitHub, including from
                  outside Ko-lab.
                </>
              ) : (
                <>
                  <strong>{confirming.member.name ?? "This member"}</strong> will be able to push to{" "}
                  <span className="font-mono text-xs">{repo}</span> — from anywhere, not just
                  Ko-lab.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => changeAccess(confirming.member, confirming.revoke)}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium text-white",
                  confirming.revoke
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-blue-600 hover:bg-blue-500",
                )}
              >
                {confirming.revoke ? "Revoke" : "Grant access"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
