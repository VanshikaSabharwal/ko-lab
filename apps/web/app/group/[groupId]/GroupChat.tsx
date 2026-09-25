"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { MdSend } from "react-icons/md";
import { FaUserPlus, FaUsers, FaCrown, FaGithub, FaEdit } from "react-icons/fa";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, Video, Phone, Image as ImageIcon } from "lucide-react";
import GroupAvatar from "../../components/GroupAvatar";
import UserAvatar from "../../components/UserAvatar";
import GroupPhotoDialog from "../../components/GroupPhotoDialog";
import { useCall } from "../../components/call/CallProvider";
import { useTheme } from "next-themes";
import { fetchWsToken } from "../../lib/wsAuth";
import { isSystemMessage, systemMessageText } from "../../lib/systemMessages";
import ChatBackgroundPicker from "../../components/ChatBackgroundPicker";
import {
  BG_GROUPS,
  DEFAULT_BG,
  bgLabel,
  bgStyles,
  findBgOption,
} from "../../lib/chatBackgrounds";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

/** The handful shown inline in the menu; the rest live behind "More colors". */
const QUICK_BG_OPTIONS = BG_GROUPS[0]!.options;

interface GroupChatProps {
  group: string;
}

type MessageStatus = "sending" | "delivered" | "read";

interface Message {
  id: string;
  senderId: string | undefined;
  senderName: string | undefined;
  groupId: string;
  content: string;
  createdAt: number;
  status?: MessageStatus;
}

interface GroupDetails {
  id: string;
  ownerId: string;
  ownerName: string;
  githubRepo: string;
  groupName: string;
  liveUrl?: string;
  image?: string | null;
}

function sendBrowserNotification(title: string, body: string) {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("notificationsEnabled") === "false") return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  } else if (Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") new Notification(title, { body, icon: "/favicon.ico" });
    });
  }
}

const GroupChat: React.FC<GroupChatProps> = ({ group }) => {
  const { data: session, status } = useSession();
  const { initiateCall, isCalling, joinGroup, leaveGroup } = useCall();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const [memberImages, setMemberImages] = useState<Record<string, string | null>>({});
  const [isMember, setIsMember] = useState(false);
  const [loadingGroupDetails, setLoadingGroupDetails] = useState(true);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 3-dot menu
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Delete confirm
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [showPhotoDialog, setShowPhotoDialog] = useState(false);

  // Background
  const [chatBg, setChatBg] = useState(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem(`groupChatBg_${group}`) || DEFAULT_BG)
      : DEFAULT_BG
  );
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const bgOption = findBgOption(chatBg);
  const chatBgStyles = bgStyles(bgOption, isDarkTheme);

  // WS reconnect
  const reconnectAttempts = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // Emoji reactions
  const [activeEmojiPicker, setActiveEmojiPicker] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDownTime = useRef<number>(0);

  const senderId = session?.user?.id;
  const senderName = session?.user?.name;
  const isOwner = session?.user?.id === groupDetails?.ownerId;
  const githubRepo = groupDetails?.githubRepo;

  // Register group for call signaling so this user receives group call offers
  useEffect(() => {
    joinGroup(group);
    return () => leaveGroup();
  }, [group, joinGroup, leaveGroup]);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);


  const handleMsgPointerDown = useCallback((msgId: string) => {
    pointerDownTime.current = Date.now();
    longPressTimer.current = setTimeout(() => {
      setActiveEmojiPicker((prev) => (prev === msgId ? null : msgId));
    }, 500);
  }, []);

  const handleMsgPointerUp = useCallback((e: React.PointerEvent, msgId: string) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (e.pointerType === "mouse" && Date.now() - pointerDownTime.current < 300) {
      setActiveEmojiPicker((prev) => (prev === msgId ? null : msgId));
    }
  }, []);

  const handleMsgPointerCancel = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const handleReact = useCallback((msgId: string, emoji: string, userId: string) => {
    setReactions((prev) => {
      const msgReactions = { ...(prev[msgId] || {}) };
      const users = [...(msgReactions[emoji] || [])];
      const idx = users.indexOf(userId);
      if (idx >= 0) users.splice(idx, 1);
      else users.push(userId);
      if (users.length === 0) delete msgReactions[emoji];
      else msgReactions[emoji] = users;
      return { ...prev, [msgId]: msgReactions };
    });
    setActiveEmojiPicker(null);
  }, []);

  const fetchMessages = async () => {
    if (group) {
      try {
        const res = await fetch(`/api/save-group-message?group=${group}`);
        const data: Message[] = await res.json();
        setMessages(data);
        greetIfJustAdded(data);
      } catch (err) {
        console.error("Error fetching messages:", err);
        toast.error("Failed to fetch messages");
      }
    }
  };

  /**
   * Welcome a member the first time they open a group they were just added to.
   *
   * Keyed per group in localStorage so it fires once rather than on every
   * visit, and only for a recent event — an old "added" line shouldn't greet
   * someone who has been in the group for weeks.
   */
  const greetIfJustAdded = (history: Message[]) => {
    if (!group) return;
    const key = `ko-lab-greeted-${group}`;
    try {
      if (localStorage.getItem(key)) return;
      const recent = [...history]
        .reverse()
        .find(
          (m) =>
            isSystemMessage(m.content) &&
            Date.now() - new Date(m.createdAt).getTime() < 24 * 60 * 60 * 1000,
        );
      if (!recent) return;
      localStorage.setItem(key, "1");
      toast(
        systemMessageText(recent.content, { viewerId: session?.user?.id, senderId: recent.senderId }),
      );
    } catch {
      // Private browsing can throw on localStorage; a missing greeting is fine.
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      const fetchGroupDetails = async () => {
        try {
          const response = await fetch(`/api/create-group-data?group=${group}`);
          const data = await response.json();
          if (!response.ok) {
            console.error("Failed to fetch group details:", data);
            toast.error(data.error ?? "Failed to fetch group details");
          } else {
            setGroupDetails(data);
          }
        } catch (err) {
          console.error("Error fetching details:", err);
          toast.error("Failed to fetch group details");
        } finally {
          setLoadingGroupDetails(false);
        }
      };

      // Photos by user id, for the avatar beside each member's messages. Live
      // socket messages carry only the sender id, so this lookup covers both.
      const fetchMemberImages = async () => {
        try {
          const res = await fetch(`/api/groups/${group}/members`);
          if (!res.ok) return;
          const data: { members: { id: string; image: string | null }[] } = await res.json();
          setMemberImages(Object.fromEntries(data.members.map((m) => [m.id, m.image])));
        } catch {
          // Avatars fall back to initials
        }
      };

      fetchMessages();
      fetchGroupDetails();
      fetchMemberImages();

      let interval = setInterval(() => {
        setLoadingPercentage((prev) => {
          if (prev < 100) return prev + 1;
          clearInterval(interval);
          return prev;
        });
      }, 10);
      return () => clearInterval(interval);
    }
  }, [group, status]);

  useEffect(() => {
    if (session && groupDetails) {
      const fetchMembers = async () => {
        try {
          const res = await fetch(`/api/check-group-member?group=${group}&userId=${senderId}`);
          const data = await res.json();
          setIsMember(data.exists);
        } catch (err) {
          console.log("Error:", err);
          toast.error("Failed to check group membership");
        }
      };

      fetchMembers();
      isMountedRef.current = true;

      const wsBase =
        process.env.NODE_ENV === "development"
          ? "ws://localhost:8080"
          : process.env.NEXT_PUBLIC_WEB_SOCKET_URL;

      const connect = async () => {
        if (!isMountedRef.current) return;
        // Tokens are short-lived, so fetch a fresh one on every (re)connect
        const token = await fetchWsToken();
        if (!token || !isMountedRef.current) return;
        const ws = new WebSocket(`${wsBase}/ws?token=${token}&groupId=${group}`);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          reconnectAttempts.current = 0;
          heartbeatRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
          }, 25_000);
        };

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "pong" || message.type === "connection_established") return;
          // Only chat messages belong in the transcript. Call signalling and
          // workspace/presence traffic share this socket, and appending those
          // rendered empty bubbles stamped "Invalid Date" — they carry no
          // content or createdAt. CallProvider handles them separately.
          if (message.type || !message.content) return;
          // Direct messages are delivered to every socket a user has, this one
          // included; only this group's messages belong in its transcript.
          if (message.groupId !== group) return;
          setMessages((prev) => [
            ...prev,
            {
              id: message.id,
              senderId: message.senderId,
              senderName: message.senderName,
              groupId: message.groupId,
              content: message.content,
              createdAt: message.createdAt,
            },
          ]);
          if (message.senderId !== senderId) {
            // A system announcement isn't from a person, so it would read as
            // "Vanshika: __system__:… " in an OS notification.
            if (isSystemMessage(message.content)) {
              toast(
                systemMessageText(message.content, {
                  viewerId: session?.user?.id,
                  senderId: message.senderId,
                }),
              );
            } else {
              sendBrowserNotification(
                `${message.senderName ?? "Someone"} in ${groupDetails?.groupName ?? "a group"}`,
                message.content
              );
            }
          }
        };

        ws.onclose = () => {
          if (heartbeatRef.current) clearInterval(heartbeatRef.current);
          wsRef.current = null;
          setIsConnected(false);
          if (!isMountedRef.current) return;
          const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30_000);
          reconnectAttempts.current += 1;
          setTimeout(connect, delay);
        };

        ws.onerror = () => ws.close();
      };

      connect();

      return () => {
        isMountedRef.current = false;
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        wsRef.current?.close();
        wsRef.current = null;
        setIsConnected(false);
      };
    }
  }, [session, groupDetails, group, senderId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    const canSend = isMember || isOwner;
    if (!newMessage.trim()) return;
    if (!canSend) {
      toast.error("You are not a member of this group.");
      return;
    }

    const msgId = `${Date.now()}-${Math.random()}`;
    const message = {
      id: msgId,
      content: newMessage,
      groupId: group,
      senderId,
      senderName,
      createdAt: Date.now(),
      status: "sending" as MessageStatus,
    };

    setMessages((prev) => [...prev, message]);
    setNewMessage("");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }

    try {
      const response = await fetch("/api/save-group-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      if (!response.ok) throw new Error("Failed to save message");
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: "delivered" as MessageStatus } : m))
      );
    } catch (error) {
      console.error("Failed to save message:", error);
      toast.error("Message sent but failed to save. It may not appear after refresh.");
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setMenuOpen(false);
    toast.success("Chat cleared");
  };

  const handleRenameGroup = async () => {
    const name = renameValue.trim();
    if (!name) return;
    setRenaming(true);
    try {
      const res = await fetch("/api/create-group-data", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group, groupName: name }),
      });
      const data = await res.json();
      if (res.ok) {
        setGroupDetails((prev) => (prev ? { ...prev, groupName: data.groupName } : prev));
        toast.success("Group renamed");
        setShowRenameModal(false);
      } else {
        toast.error(data.error ?? "Failed to rename group");
      }
    } catch {
      toast.error("Failed to rename group");
    } finally {
      setRenaming(false);
    }
  };

  const handleChangeBg = (value: string) => {
    setChatBg(value);
    try {
      localStorage.setItem(`groupChatBg_${group}`, value);
    } catch {
      // Private browsing can refuse writes; the choice still applies for the
      // session, it just won't be remembered.
    }
    setMenuOpen(false);
    setBgPickerOpen(false);
  };

  const handleDeleteGroup = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/create-group-data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group, userId: senderId }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to delete group");
        return;
      }
      toast.success("Group deleted");
      router.push("/groups");
    } catch {
      toast.error("An error occurred");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (loadingGroupDetails || status === "loading") {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-56px)]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
          <p className="text-sm text-gray-400">{loadingPercentage}%</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-56px)] text-red-500 font-bold text-xl">
        You are not logged in
      </div>
    );
  }

  return (
    <div
      style={chatBgStyles.style}
      className={`relative flex flex-col h-[calc(100vh-56px)] ${chatBgStyles.className} transition-colors duration-500`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between relative">
        <div className="flex items-center gap-3 min-w-0">
          {/* Group avatar — the owner can tap it to change the photo */}
          {isOwner ? (
            <button
              onClick={() => setShowPhotoDialog(true)}
              title="Change group photo"
              className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <GroupAvatar name={groupDetails?.groupName} image={groupDetails?.image} size={36} />
            </button>
          ) : (
            <GroupAvatar name={groupDetails?.groupName} image={groupDetails?.image} size={36} />
          )}
          <div className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate min-w-0">
                {groupDetails?.groupName}
              </p>
              {isOwner && (
                <span className="flex items-center gap-0.5 text-xs font-semibold text-amber-500 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-full px-1.5 py-0.5 flex-shrink-0">
                  <FaCrown className="w-2.5 h-2.5" />
                  Owner
                </span>
              )}
            </div>
            {groupDetails?.liveUrl && (
              <a
                href={groupDetails.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline flex items-center gap-1 mt-0.5"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                {groupDetails.liveUrl}
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Voice call — starts the same call (everyone joins muted, camera off) */}
          <button
            onClick={() => initiateCall("GROUP", undefined, group)}
            disabled={isCalling}
            title="Group voice call"
            className="p-2 rounded-full bg-green-500 hover:bg-green-400 text-white transition disabled:opacity-40"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => initiateCall("GROUP", undefined, group)}
            disabled={isCalling}
            title="Group video call"
            className="p-2 rounded-full bg-green-500 hover:bg-green-400 text-white transition disabled:opacity-40"
          >
            <Video className="w-4 h-4" />
          </button>

          {isConnected && (
            <span className="w-2 h-2 rounded-full bg-green-500" title="Online" />
          )}

          {/* 3-dot menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                <circle cx="10" cy="4" r="1.5" />
                <circle cx="10" cy="10" r="1.5" />
                <circle cx="10" cy="16" r="1.5" />
              </svg>
            </button>

            {/* Dropdown */}
            <div className={`absolute right-0 top-10 w-56 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden transition-all duration-200 origin-top-right ${
              menuOpen ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
            }`}>
              {/* Code Editor */}
              <Link
                href={`/code-editor/${group}/${githubRepo}`}
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                Code Editor
              </Link>

              {/* Group Photo — owner only */}
              {isOwner && (
                <button
                  onClick={() => {
                    setShowPhotoDialog(true);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <ImageIcon className="w-4 h-4" />
                  Group Photo
                </button>
              )}

              {/* Workspace */}
              <Link
                href={`/workspace/${group}`}
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <LayoutGrid className="w-4 h-4" />
                Workspace
              </Link>

              {/* View Members */}
              <Link
                href={`/viewMembers/${group}`}
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <FaUsers className="w-4 h-4" />
                View Members
              </Link>

              {/* GitHub Repo */}
              {groupDetails?.githubRepo && (
                <a
                  href={`https://github.com/${groupDetails.ownerName}/${groupDetails.githubRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <FaGithub className="w-4 h-4" />
                  GitHub Repo
                </a>
              )}

              {/* Live Site */}
              {groupDetails?.liveUrl && (
                <a
                  href={groupDetails.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Live Site
                </a>
              )}

              {/* Add Member — owner only */}
              {isOwner && (
                <Link
                  href={`/addGroupMember/${group}`}
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <FaUserPlus className="w-4 h-4" />
                  Add Member
                </Link>
              )}

              {/* Edit Group Name — owner only */}
              {isOwner && (
                <button
                  onClick={() => {
                    setRenameValue(groupDetails?.groupName ?? "");
                    setShowRenameModal(true);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <FaEdit className="w-4 h-4" />
                  Edit Group Name
                </button>
              )}

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* Clear chat */}
              <button
                onClick={handleClearChat}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear Chat
              </button>

              {/* Delete Group — owner only */}
              {isOwner && (
                <button
                  onClick={() => { setMenuOpen(false); setShowDeleteConfirm(true); }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete Group
                </button>
              )}

              {/* Background picker */}
              <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Background</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {QUICK_BG_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleChangeBg(opt.value)}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all ${
                        chatBg === opt.value ? "ring-2 ring-blue-500" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 ${isDarkTheme ? opt.dark ?? "" : opt.light}`} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">{bgLabel(opt, isDarkTheme)}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setMenuOpen(false); setBgPickerOpen(true); }}
                  className="mt-2 w-full rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  More colors…
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-grow overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm mt-16">
            No messages yet. Start the conversation!
          </div>
        ) : (
          messages.map((msg, index) => {
            const isOwn = msg.senderId === session?.user?.id;
            const msgReactions = reactions[msg.id] || {};
            const hasReactions = Object.keys(msgReactions).length > 0;

            // Membership events are announcements, not messages from a person:
            // no bubble, no sender, no reactions.
            if (isSystemMessage(msg.content)) {
              return (
                <div key={index} className="my-2 flex justify-center">
                  <span className="rounded-full bg-gray-200/70 px-3 py-1 text-center text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    {systemMessageText(msg.content, {
                      viewerId: session?.user?.id,
                      senderId: msg.senderId,
                    })}
                  </span>
                </div>
              );
            }

            return (
              <div key={index} className={`flex items-end gap-2 mb-2 ${isOwn ? "justify-end" : "justify-start"}`}>
                {!isOwn && (
                  <UserAvatar
                    src={msg.senderId ? memberImages[msg.senderId] : null}
                    name={msg.senderName}
                    size={28}
                  />
                )}
                <div className="relative max-w-xs sm:max-w-sm">
                  {/* Bubble */}
                  <div
                    className={`break-words px-3 py-2 rounded-2xl cursor-pointer select-none ${
                      isOwn
                        ? "bg-blue-500 text-white rounded-br-sm"
                        : "bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-bl-sm"
                    }`}
                    onPointerDown={() => handleMsgPointerDown(msg.id)}
                    onPointerUp={(e) => handleMsgPointerUp(e, msg.id)}
                    onPointerCancel={handleMsgPointerCancel}
                  >
                    {!isOwn && (
                      <p className="text-xs font-semibold mb-0.5 opacity-70">{msg.senderName}</p>
                    )}
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-xs opacity-60">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {isOwn && (
                        <span className="text-xs leading-none">
                          {msg.status === "read" ? (
                            <span className="text-blue-200 font-bold">✓✓</span>
                          ) : msg.status === "delivered" ? (
                            <span className="opacity-70">✓✓</span>
                          ) : (
                            <span className="opacity-40">✓</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Reactions */}
                  {hasReactions && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? "justify-end" : "justify-start"}`}>
                      {Object.entries(msgReactions).map(([emoji, users]) => (
                        <button
                          key={emoji}
                          onClick={() => handleReact(msg.id, emoji, session?.user?.id || "")}
                          className={`text-xs rounded-full px-1.5 py-0.5 border flex items-center gap-0.5 transition-colors ${
                            users.includes(session?.user?.id || "")
                              ? "bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200"
                              : "bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {emoji} <span>{users.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating emoji picker — above the input, outside the scroll container */}
      {activeEmojiPicker && (
        <div
          className="flex justify-center py-2"
          onClick={() => setActiveEmojiPicker(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-full shadow-xl border border-gray-200 dark:border-gray-700 flex gap-1 p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReact(activeEmojiPicker, emoji, session?.user?.id || "")}
                className="text-xl hover:scale-125 transition-transform leading-none px-1"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
          placeholder="Type a message..."
          className="flex-grow px-4 py-2.5 text-sm rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSendMessage}
          disabled={!newMessage.trim()}
          className="p-2.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <MdSend size={18} />
        </button>
      </div>

      {/* Rename group modal */}
      {showPhotoDialog && groupDetails && (
        <GroupPhotoDialog
          groupId={group}
          groupName={groupDetails.groupName}
          image={groupDetails.image ?? null}
          onClose={() => setShowPhotoDialog(false)}
          onChange={(image) =>
            setGroupDetails((prev) => (prev ? { ...prev, image } : prev))
          }
        />
      )}

      {showRenameModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Edit Group Name</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameGroup()}
              placeholder="Group name"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowRenameModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameGroup}
                disabled={renaming || !renameValue.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {renaming ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Delete Group?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              This will permanently delete the group, all messages, files, and member data. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteGroup}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bgPickerOpen && (
        <ChatBackgroundPicker
          current={chatBg}
          onSelect={handleChangeBg}
          onClose={() => setBgPickerOpen(false)}
        />
      )}
    </div>
  );
};

export default GroupChat;
