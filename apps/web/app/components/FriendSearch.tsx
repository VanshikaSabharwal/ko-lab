"use client";
import Link from "next/link";
import React, { useState } from "react";
import { GrChat } from "react-icons/gr";
import { UserPlus, Check, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface Friend {
  name: string;
  phone: string;
}

const FriendSearch = ({ onFriendAdded }: { onFriendAdded?: () => void }) => {
  const [friendNumber, setFriendNumber] = useState("");
  const [friend, setFriend] = useState<Friend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [addingFriend, setAddingFriend] = useState(false);
  const [added, setAdded] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFriend(null);
    setAdded(false);

    try {
      const phoneCheck = await fetch("/api/check-phone-number");
      const phoneData = await phoneCheck.json();

      if (!phoneCheck.ok || !phoneData.exists) {
        setShowPhoneModal(true);
        setLoading(false);
        return;
      }

      const response = await fetch("/api/friend-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: friendNumber }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.message || "Something went wrong");
        setLoading(false);
        return;
      }

      const data = await response.json();
      setFriend(data);
      setError(null);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddFriend() {
    if (!friend) return;
    setAddingFriend(true);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: friend.phone }),
      });
      const data = await res.json();
      if (res.ok) {
        setAdded(true);
        toast.success(`${friend.name} added to friends!`);
        onFriendAdded?.();
      } else {
        toast.error(data.error || "Failed to add friend");
      }
    } catch {
      toast.error("Failed to add friend");
    } finally {
      setAddingFriend(false);
    }
  }

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSavingPhone(true);
    try {
      const response = await fetch("/api/set-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.message || "Failed to update phone");
        return;
      }
      setShowPhoneModal(false);
      setError(null);
      toast.success("Phone number saved!");
    } catch {
      toast.error("Error updating phone number");
    } finally {
      setSavingPhone(false);
    }
  }

  return (
    <div className="w-full py-2 px-3 bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Find a Contact</h2>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          placeholder="Phone number"
          value={friendNumber}
          onChange={(e) => setFriendNumber(e.target.value)}
          required
          className="flex-1 px-3 py-2 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white transition"
        >
          {loading ? "..." : "Search"}
        </button>
      </form>

      {error && <p className="text-red-500 mt-2 text-xs">{error}</p>}

      {friend && (
        <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{friend.name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleAddFriend}
              disabled={addingFriend || added}
              aria-busy={addingFriend}
              title={added ? "Added!" : addingFriend ? "Adding…" : "Add Friend"}
              className={`p-1.5 rounded-full transition ${
                added
                  ? "bg-green-100 dark:bg-green-900/40 text-green-600"
                  : "bg-gray-200 dark:bg-gray-600 hover:bg-green-100 dark:hover:bg-green-900/40 text-gray-600 dark:text-gray-300 hover:text-green-600"
              }`}
            >
              {added ? (
                <Check className="w-4 h-4" />
              ) : addingFriend ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
            </button>
            <Link
              href={`/chat/${friend.phone}`}
              title="Chat"
              className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition"
            >
              <GrChat className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      {showPhoneModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-xl w-80 border border-gray-200 dark:border-gray-700">
            <h2 className="text-base font-bold mb-3 text-gray-800 dark:text-gray-100">
              Add your phone number to find friends
            </h2>
            <form onSubmit={handlePhoneSubmit} className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Your phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={savingPhone}
                aria-busy={savingPhone}
                className="flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2 rounded-lg text-sm font-semibold transition"
              >
                {savingPhone && <Loader2 className="w-4 h-4 animate-spin" />}
                {savingPhone ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setShowPhoneModal(false)} className="text-sm text-gray-500 hover:text-gray-700 underline">
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FriendSearch;
