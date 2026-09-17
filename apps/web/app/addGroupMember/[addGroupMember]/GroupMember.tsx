"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import toast from "react-hot-toast";

interface AddGroupProps {
  groupId: string;
}

/** Inline busy indicator for buttons that span a multi-request submit. */
const Spinner = () => (
  <span
    aria-hidden
    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white align-[-2px]"
  />
);

type InviteBy = "phone" | "email";

const AddGroupMember: React.FC<AddGroupProps> = ({ groupId }) => {
  const [inviteBy, setInviteBy] = useState<InviteBy>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [inviteSent, setInviteSent] = useState(false);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [mailtoUrl, setMailtoUrl] = useState<string | null>(null);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const { status } = useSession();
  const [backToGroup, setBackToGroup] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // Submitting spans a lookup then an add, so without this the button sat
  // inert for the whole round-trip and looked like nothing had happened.
  const [submitting, setSubmitting] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);

  const byEmail = inviteBy === "email";
  /** Whichever identifier the inviter is currently typing. */
  const identifier = byEmail ? email.trim() : phoneNumber.trim();
  /** The query string the lookup endpoint accepts. */
  const lookupQuery = byEmail
    ? `email=${encodeURIComponent(identifier)}`
    : `phone=${encodeURIComponent(identifier)}`;

  // Switching the invite method clears the other field and any result from it,
  // so a stale "user exists" answer can't apply to the new identifier.
  const switchInviteBy = (next: InviteBy) => {
    setInviteBy(next);
    setUserExists(null);
    setInviteSent(false);
    setWhatsappUrl(null);
    setMailtoUrl(null);
    setInvitationLink(null);
  };

  /**
   * One request answering both "does this account exist" and "what is its id".
   * These were two identical sequential lookups; the second could only return
   * what the first already had.
   */
  const lookupUser = async (): Promise<
    { exists: true; userId: string } | { exists: false } | null
  > => {
    try {
      const res = await fetch(`/api/lookup-user?${lookupQuery}`);
      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
        return null;
      }
      setUserExists(data.exists);
      if (data.exists && data.userId) {
        setUserId(data.userId);
        return { exists: true, userId: data.userId };
      }
      return { exists: false };
    } catch (err) {
      console.error("Error looking up user:", err);
      toast.error("Couldn't reach the server. Check your connection.");
      return null;
    }
  };

  const sendInvite = async () => {
    setSendingInvite(true);
    try {
      const res = await fetch(`/api/send-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          byEmail
            ? { groupId, email: identifier }
            : { groupId, phoneNumber: identifier },
        ),
      });
      const data = await res.json();

      if (data.success) {
        setInviteSent(true);
        setWhatsappUrl(data.whatsappUrl ?? null);
        setMailtoUrl(data.mailtoUrl ?? null);
        setInvitationLink(data.invitationLink ?? null);
        toast.success(`Invite created for ${identifier}`);
      } else {
        console.error("Failed to send invite:", data.error);
        toast.error(data.error || "Failed to send the invite.");
      }
    } catch (err) {
      console.error("Error sending invite:", err);
      toast.error("An error occurred while sending the invite.");
    } finally {
      setSendingInvite(false);
    }
  };

  const addGroupMember = async (userId: string) => {
    try {
      const res = await fetch(`/api/add-group-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, groupId }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success("Member added successfully!");
        setBackToGroup(true);
      } else if (data.error) {
        toast.error(data.error);
        setBackToGroup(true);
      }
    } catch (err) {
      console.error("Error adding group member:", err);
      toast.error("An error occurred while adding the member.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      const result = await lookupUser();
      if (!result) return; // lookupUser has already surfaced the reason
      if (result.exists) {
        await addGroupMember(result.userId);
      } else {
        await sendInvite();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading") {
    return <div>Loading...</div>;
  }

  if (status === "unauthenticated") {
    return <div>You are not authorized to view this page.</div>;
  }

  return (
    <div className="max-w-lg mx-auto mt-10 p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-xl font-semibold text-center mb-6">
        Add Group Member
      </h1>
      <form onSubmit={handleSubmit}>
        <div className="mb-4 flex gap-2" role="group" aria-label="Invite by">
          {(["phone", "email"] as InviteBy[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => switchInviteBy(option)}
              aria-pressed={inviteBy === option}
              className={`flex-1 rounded-lg border p-2 text-sm capitalize ${
                inviteBy === option
                  ? "border-blue-500 bg-blue-50 font-medium text-blue-600"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="mb-4">
          {byEmail ? (
            <>
              <label htmlFor="email" className="block text-gray-700 font-medium">
                Enter Email:
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-2 p-2 border border-gray-300 rounded-lg"
                placeholder="Enter email address"
                required
              />
            </>
          ) : (
            <>
              <label
                htmlFor="phoneNumber"
                className="block text-gray-700 font-medium"
              >
                Enter Phone Number:
              </label>
              <input
                type="tel"
                id="phoneNumber"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full mt-2 p-2 border border-gray-300 rounded-lg"
                placeholder="Enter phone number"
                required
              />
            </>
          )}
        </div>

        {userExists === false && (
          <div>
            <h1 className="mb-4 text-red-500">
              This {byEmail ? "email" : "phone number"} is not associated with
              any account. You can send an invite to create an account.
            </h1>
            <button
              onClick={sendInvite}
              type="button"
              disabled={sendingInvite}
              aria-busy={sendingInvite}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 p-3 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sendingInvite && <Spinner />}
              {sendingInvite ? "Sending invite…" : "Send Invite"}
            </button>
          </div>
        )}

        {userExists === true && (
          <div className="mb-4 text-green-500">
            User exists! You can add them to the group.
          </div>
        )}

        {userExists === null && (
          <button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 p-3 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Spinner />}
            {submitting ? "Adding member…" : "Check and Add Member"}
          </button>
        )}

        {inviteSent && (
          <div className="mt-4 text-green-500">
            Send Invite to {identifier}. The user can join after registering.
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 underline"
              >
                Send invite via WhatsApp
              </a>
            )}
            {mailtoUrl && (
              <a
                href={mailtoUrl}
                className="ml-1 text-blue-500 underline"
              >
                Send invite via email
              </a>
            )}
            {invitationLink && (
              // Not every inviter has a mail client wired to mailto:, so the
              // raw link is always available to copy by hand.
              <div className="mt-2 flex items-center gap-2 text-gray-700">
                <input
                  readOnly
                  value={invitationLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded border border-gray-300 p-1 text-xs"
                  aria-label="Invitation link"
                />
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard?.writeText(invitationLink)
                  }
                  className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}
        {backToGroup && (
          <div className="mt-4">
            <Link
              href={`/group/${groupId}`}
              className="text-blue-500 underline"
            >
              Back to Group
            </Link>
          </div>
        )}
      </form>
    </div>
  );
};

export default AddGroupMember;
