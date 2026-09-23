"use client";

import { useSession, signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FaGithub, FaGoogle } from "react-icons/fa";
import { CheckCircle, User, Bell, BellOff, Pencil, Loader2 } from "lucide-react";
import Image from "next/image";

type ProfileData = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  image: string | null;
  connectedProviders: string[];
};

type GithubStatus = {
  linked: boolean;
  username?: string | null;
  hasRepoScope?: boolean;
};

type RepoInvitation = {
  id: number;
  repo: string;
  inviter: string;
};

export default function ProfilePage() {
  const { status } = useSession();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>("default");
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [invitations, setInvitations] = useState<RepoInvitation[]>([]);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const loadGithub = async () => {
    try {
      const [statusRes, invitesRes] = await Promise.all([
        fetch("/api/github/status"),
        fetch("/api/github/invitations"),
      ]);
      if (statusRes.ok) setGithub(await statusRes.json());
      if (invitesRes.ok) {
        const data = await invitesRes.json();
        setInvitations(data.invitations ?? []);
      }
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    loadGithub();
    // Surface the outcome of the GitHub link redirect
    const params = new URLSearchParams(window.location.search);
    const gh = params.get("github");
    if (gh === "linked") {
      toast.success(`GitHub connected as ${params.get("login") ?? "your account"}`);
      window.history.replaceState({}, "", "/profile");
    } else if (gh === "error") {
      const reason = params.get("reason") ?? "unknown";
      const msg =
        reason === "github_account_taken"
          ? "That GitHub account is already linked to another Ko-Lab user"
          : "Couldn't connect GitHub — please try again";
      toast.error(msg);
      window.history.replaceState({}, "", "/profile");
    }
  }, [status]);

  const acceptInvite = async (invitationId: number) => {
    setAcceptingId(invitationId);
    try {
      const res = await fetch("/api/github/invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId }),
      });
      if (res.ok) {
        toast.success("Invitation accepted — you can now edit code");
        setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
      } else {
        const d = await res.json();
        toast.error(d.error ?? "Failed to accept invitation");
      }
    } catch {
      toast.error("Failed to accept invitation");
    } finally {
      setAcceptingId(null);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setNotificationsEnabled(localStorage.getItem("notificationsEnabled") !== "false");
    if ("Notification" in window) setBrowserPermission(Notification.permission);
  }, []);

  const toggleNotifications = async (enabled: boolean) => {
    if (enabled && "Notification" in window && Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      setBrowserPermission(perm);
      if (perm === "denied") return; // can't enable if browser denied
    }
    setNotificationsEnabled(enabled);
    localStorage.setItem("notificationsEnabled", String(enabled));
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: ProfileData) => {
        setProfile(data);
        setName(data.name ?? "");
        setPhone(data.phone ?? "");
      });
  }, [status]);

  const handleAvatarUpload = async (file: File) => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
    setUploadingAvatar(true);
    const toastId = toast.loading("Uploading avatar…");
    let succeeded = false;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const { image } = await res.json();
        toast.success("Avatar updated", { id: toastId });
        setProfile((p) => (p ? { ...p, image } : p));
        succeeded = true;
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Failed to upload avatar", { id: toastId });
      }
    } catch {
      toast.error("Failed to upload avatar", { id: toastId });
    } finally {
      setUploadingAvatar(false);
      // On success keep showing the local preview; swapping straight to the
      // remote URL makes the avatar blank while it downloads.
      if (!succeeded) {
        URL.revokeObjectURL(objectUrl);
        setAvatarPreview(null);
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      if (res.ok) {
        toast.success("Profile updated");
        setProfile((p) => p ? { ...p, name, phone } : p);
      } else {
        const d = await res.json();
        toast.error(d.error ?? "Failed to update profile");
      }
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || (status === "authenticated" && !profile)) {
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to view your profile.</p>
        <button
          onClick={() => signIn()}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Sign in
        </button>
      </div>
    );
  }

  const isGithubConnected = profile!.connectedProviders.includes("github");
  const isGoogleConnected = profile!.connectedProviders.includes("google");

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gray-50 dark:bg-gray-950 px-4 py-10">
      <div className="w-full max-w-lg mx-auto space-y-4">

        {/* Avatar + name */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 flex items-center gap-4">
          <label
            title="Change profile photo"
            className={`relative group shrink-0 ${uploadingAvatar ? "cursor-wait" : "cursor-pointer"}`}
          >
            {avatarPreview || profile!.image ? (
              <Image
                src={avatarPreview ?? profile!.image!}
                alt="Avatar"
                width={64}
                height={64}
                unoptimized={!!avatarPreview}
                className={`w-16 h-16 rounded-full object-cover ${uploadingAvatar ? "opacity-50" : ""}`}
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <User className="w-8 h-8 text-gray-400" />
              </div>
            )}
            <div
              className={`absolute inset-0 rounded-full bg-black/40 transition flex items-center justify-center text-white text-xs font-medium ${
                uploadingAvatar ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              {uploadingAvatar ? <Loader2 className="w-5 h-5 animate-spin" /> : "Change"}
            </div>
            {!uploadingAvatar && (
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-blue-600 border-2 border-white dark:border-gray-900 flex items-center justify-center shadow"
              >
                <Pencil className="w-3 h-3 text-white" />
              </span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={uploadingAvatar}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAvatarUpload(file);
                e.target.value = "";
              }}
            />
          </label>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white text-lg">
              {profile!.name ?? "No name set"}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{profile!.email}</p>
          </div>
        </div>

        {/* Connected accounts */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Connected Accounts</h2>
          <div className="space-y-3">

            {/* GitHub */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FaGithub className="w-5 h-5 text-gray-900 dark:text-white" />
                <div>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">GitHub</span>
                  {github?.linked && github.username && (
                    <span className="ml-1.5 text-xs text-gray-400">@{github.username}</span>
                  )}
                </div>
              </div>
              {github?.linked ? (
                github.hasRepoScope ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                    <CheckCircle className="w-4 h-4" /> Connected
                  </span>
                ) : (
                  // Linked but token lacks the repo scope — must re-link to edit code
                  <button
                    onClick={() => (window.location.href = "/api/github/link")}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:opacity-90 transition"
                  >
                    Re-authorize
                  </button>
                )
              ) : (
                <button
                  onClick={() => (window.location.href = "/api/github/link")}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90 transition"
                >
                  Connect
                </button>
              )}
            </div>

            {/* Google */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FaGoogle className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Google</span>
              </div>
              {isGoogleConnected ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4" /> Connected
                </span>
              ) : (
                <button
                  onClick={() => signIn("google")}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Connect
                </button>
              )}
            </div>

          </div>
        </div>

        {/* Repository invitations */}
        {invitations.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Repository invitations
            </h2>
            <div className="space-y-3">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                      {inv.repo}
                    </p>
                    <p className="text-xs text-gray-400">invited by @{inv.inviter}</p>
                  </div>
                  <button
                    onClick={() => acceptInvite(inv.id)}
                    disabled={acceptingId === inv.id}
                    className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 transition"
                  >
                    {acceptingId === inv.id ? "Accepting…" : "Accept"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Edit profile */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Profile Details</h2>
          <div className="space-y-3">

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={profile!.email}
                disabled
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 234 567 8900"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Notifications</h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {notificationsEnabled && browserPermission === "granted" ? (
                <Bell className="w-4 h-4 text-blue-500" />
              ) : (
                <BellOff className="w-4 h-4 text-gray-400" />
              )}
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Browser notifications</p>
                {browserPermission === "denied" && (
                  <p className="text-xs text-red-500 mt-0.5">Blocked by browser — enable in browser settings</p>
                )}
                {browserPermission === "default" && (
                  <p className="text-xs text-gray-400 mt-0.5">Permission not yet granted</p>
                )}
              </div>
            </div>

            <button
              onClick={() => toggleNotifications(!notificationsEnabled)}
              disabled={browserPermission === "denied"}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                notificationsEnabled && browserPermission === "granted"
                  ? "bg-blue-600"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  notificationsEnabled && browserPermission === "granted" ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
