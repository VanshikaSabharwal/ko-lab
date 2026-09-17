"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

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
  // Submitting spans three sequential requests (check-user, get-user-id,
  // add-group-member), so without this the button sat inert for the whole
  // round-trip and looked like nothing had happened.
  const [submitting, setSubmitting] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);

  const byEmail = inviteBy === "email";
  /** Whichever identifier the inviter is currently typing. */
  const identifier = byEmail ? email.trim() : phoneNumber.trim();
  /** The query string both lookup endpoints accept. */
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

  const getUserId = async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/get-user-id?${lookupQuery}`);
      const data = await res.json();

      if (data.exists && data.userId) {
        setUserId(data.userId);
        return data.userId;
      } else if (data.error) {
        alert(`Error: ${data.error}`);
        setBackToGroup(true);
      }
      return null;
    } catch (err) {
      console.error("Error getting user ID:", err);
      return null;
    }
  };

  const checkUserExists = async () => {
    try {
      const response = await fetch(`/api/check-user?${lookupQuery}`);
      const data = await response.json();
      setUserExists(data.exists);
      return data.exists;
    } catch (err) {
      console.error("Error checking user:", err);
      return false;
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
      } else {
        console.error("Failed to send invite:", data.error);
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error("Error sending invite:", err);
      alert("An error occurred while sending the invite.");
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
        alert("Member added successfully!");
        setBackToGroup(true);
      } else if (data.error) {
        alert(`Error: ${data.error}`);
        setBackToGroup(true);
      }
    } catch (err) {
      console.error("Error adding group member:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      const exists = await checkUserExists();
      if (exists === true) {
        const userId = await getUserId();
        if (userId) {
          await addGroupMember(userId);
        } else {
          alert("Failed to get user ID.");
        }
      } else if (exists === false) {
        await sendInvite();
      } else {
        alert("Failed to check if user exists.");
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
