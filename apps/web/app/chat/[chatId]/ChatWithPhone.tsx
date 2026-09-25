"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import Cookies from "js-cookie";
import { Phone, Video } from "lucide-react";
import { useCall } from "../../components/call/CallProvider";
import UserAvatar from "../../components/UserAvatar";
import { fetchWsToken } from "../../lib/wsAuth";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

interface ChatWithPhoneProps {
  phone: string;
}

interface GuestData {
  guestId: string;
}

type MessageStatus = "sending" | "delivered" | "read";

interface Message {
  id?: string;
  chatId: string;
  senderId: string;
  content: string;
  recipientId: string;
  timestamp: number;
  status?: MessageStatus;
  isNew?: boolean; // true = arrived while offline, shown above divider
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

const ChatWithPhone: React.FC<ChatWithPhoneProps> = ({ phone }) => {
  const { data: session, status } = useSession();
  const { initiateCall, isCalling } = useCall();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const [chatId, setChatId] = useState("");
  const [userId, setUserId] = useState(""); // my phone number
  const [guestData, setGuestData] = useState<GuestData | null>(null);
  const [recipientName, setRecipientName] = useState<string>("");
  const [recipientImage, setRecipientImage] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState<string>("");
  // The socket handler is created once, so it reads the latest id from here
  const recipientIdRef = useRef("");
  recipientIdRef.current = recipientId;
  const [newMsgDividerIndex, setNewMsgDividerIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const BG_OPTIONS = [
    { label: "Default", value: "bg-gray-50 dark:bg-gray-950" },
    { label: "Midnight", value: "bg-gray-900 dark:bg-gray-900" },
    { label: "Sky", value: "bg-sky-50 dark:bg-sky-950" },
    { label: "Sage", value: "bg-emerald-50 dark:bg-emerald-950" },
    { label: "Rose", value: "bg-rose-50 dark:bg-rose-950" },
    { label: "Sand", value: "bg-amber-50 dark:bg-amber-950" },
  ];
  const [chatBg, setChatBg] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem(`chatBg_${phone}`) || BG_OPTIONS[0]!.value) : BG_OPTIONS[0]!.value
  );

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

  // ── Emoji reactions ─────────────────────────────────────────────────────────
  const [activeEmojiPicker, setActiveEmojiPicker] = useState<number | null>(null);
  const [reactions, setReactions] = useState<Record<number, Record<string, string[]>>>({});
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDownTime = useRef<number>(0);


  const handleMsgPointerDown = useCallback((idx: number) => {
    pointerDownTime.current = Date.now();
    longPressTimer.current = setTimeout(() => {
      setActiveEmojiPicker((prev) => (prev === idx ? null : idx));
    }, 500);
  }, []);

  const handleMsgPointerUp = useCallback((e: React.PointerEvent, idx: number) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (e.pointerType === "mouse" && Date.now() - pointerDownTime.current < 300) {
      setActiveEmojiPicker((prev) => (prev === idx ? null : idx));
    }
  }, []);

  const handleMsgPointerCancel = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const handleReact = useCallback((idx: number, emoji: string, currentUserId: string) => {
    setReactions((prev) => {
      const msgReactions = { ...(prev[idx] || {}) };
      const users = [...(msgReactions[emoji] || [])];
      const i = users.indexOf(currentUserId);
      if (i >= 0) users.splice(i, 1);
      else users.push(currentUserId);
      if (users.length === 0) delete msgReactions[emoji];
      else msgReactions[emoji] = users;
      return { ...prev, [idx]: msgReactions };
    });
    setActiveEmojiPicker(null);
  }, []);

  // ── Fetch my phone + recipient name ─────────────────────────────────────────
  useEffect(() => {
    const fetchUserPhone = async () => {
      if (session?.user?.email) {
        try {
          const res = await fetch(`/api/get-user-number?email=${session.user.email}`);
          const data = await res.json();
          if (res.ok) {
            setUserId(data.phone || "");
            setChatId([data.phone, phone].sort().join("-"));
          }
        } catch (err) {
          console.error("Error fetching phone:", err);
        }
      }
    };

    const fetchRecipient = async () => {
      try {
        const res = await fetch(`/api/get-user-number?phone=${phone}`);
        const data = await res.json();
        setRecipientName(res.ok && data.name ? data.name : phone);
        setRecipientId(res.ok && data.id ? data.id : "");
        setRecipientImage(res.ok ? data.image ?? null : null);
      } catch {
        setRecipientName(phone);
      }
    };

    if (status === "authenticated") {
      fetchUserPhone();
      fetchRecipient();
    }
  }, [status, session?.user?.email, phone]);

  // ── Guest cookie ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const guestId = Cookies.get("guestId");
    if (guestId) setGuestData({ guestId });
  }, []);

  // ── Load messages from DB when userId is ready ───────────────────────────────
  useEffect(() => {
    if (!userId || !phone) return;

    const loadMessages = async () => {
      try {
        console.log("[LOAD] fetching messages, senderPhone:", userId, "recipientPhone:", phone);
        const res = await fetch(`/api/direct-message?senderPhone=${userId}&recipientPhone=${phone}`);
        const data = await res.json();
        console.log("[LOAD] response status:", res.status, "data:", data);
        if (!res.ok || !data.messages) {
          console.error("[LOAD] failed:", data);
          return;
        }

        const lastSeenKey = `lastSeen_${chatId}`;
        const lastSeen = parseInt(localStorage.getItem(lastSeenKey) || "0", 10);

        const formatted: Message[] = data.messages.map((m: any) => ({
          id: m.id,
          chatId: chatId || [userId, phone].sort().join("-"),
          senderId: m.senderId,
          recipientId: m.recipientId,
          content: m.content,
          timestamp: m.createdAt,
          status: m.senderId === userId
            ? (m.isRead ? "read" : "delivered")
            : "read",
          isNew: m.senderId !== userId && m.createdAt > lastSeen,
        }));

        // Find where new messages start for the divider
        const firstNewIdx = formatted.findIndex((m) => m.isNew);
        setNewMsgDividerIndex(firstNewIdx >= 0 ? firstNewIdx : null);
        setMessages(formatted);

        // Update lastSeen to now
        localStorage.setItem(lastSeenKey, String(Date.now()));
      } catch (err) {
        console.error("Error loading messages from DB:", err);
      }
    };

    loadMessages();
  }, [userId, phone]);

  // ── Auto-scroll to bottom ────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── WebSocket connection ─────────────────────────────────────────────────────
  const getWebSocketBase = () => {
    if (process.env.NODE_ENV === "development") return "ws://localhost:8080";
    return process.env.NEXT_PUBLIC_WEB_SOCKET_URL;
  };

  useEffect(() => {
    if (!userId) return;
    isMountedRef.current = true;

    const connect = async () => {
      if (!isMountedRef.current) return;
      // Tokens are short-lived, so fetch a fresh one on every (re)connect
      const token = await fetchWsToken();
      if (!token || !isMountedRef.current) return;

      const ws = new WebSocket(`${getWebSocketBase()}/ws?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttempts.current = 0;
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 25_000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "pong" || message.type === "connection_established") return;

          if (message.type === "message_delivered") {
            setMessages((prev) =>
              prev.map((m) =>
                m.timestamp === message.timestamp && m.status === "sending"
                  ? { ...m, status: "delivered" }
                  : m
              )
            );
            return;
          }

          if (message.type === "read_receipt") {
            setMessages((prev) =>
              prev.map((m) => (m.status !== "read" ? { ...m, status: "read" } : m))
            );
            return;
          }

          // Incoming message from the other person. chatId is chosen by the
          // sender, so it alone can't prove who wrote this — anyone could make
          // a message appear in this conversation. senderId is stamped by the
          // socket server from the sender's signed token, so it can.
          const incomingChatId = chatId || [userId, phone].sort().join("-");
          if (
            message.chatId === incomingChatId &&
            recipientIdRef.current &&
            message.senderId === recipientIdRef.current
          ) {
            if (!message.timestamp) message.timestamp = Date.now();
            // Stored and optimistic messages identify senders by phone
            setMessages((prev) => [
              ...prev,
              { ...message, senderId: phone, recipientId: userId, status: "read" as MessageStatus },
            ]);
            setNewMsgDividerIndex(null);
            sendBrowserNotification(recipientName || phone, message.content);
            // Send read receipt
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "read_receipt", chatId: message.chatId, senderId: message.senderId }));
            }
          }
        } catch (err) {
          console.error("Error parsing message:", err);
        }
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        wsRef.current = null;
        setIsConnected(false);
        if (!isMountedRef.current) return;
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30_000);
        reconnectAttempts.current++;
        setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      isMountedRef.current = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [userId]);

  // ── Send message ─────────────────────────────────────────────────────────────
  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    if (guestData && !session) {
      toast.error("Please Sign Up/Login to send messages");
      return;
    }

    const timestamp = Date.now();
    const optimisticMsg: Message = {
      chatId,
      senderId: userId,
      recipientId: phone,
      content: newMessage,
      timestamp,
      status: "sending",
    };

    // Optimistic update
    setMessages((prev) => [...prev, optimisticMsg]);
    setNewMessage("");

    // Send via WebSocket for real-time delivery. The socket server addresses
    // people by user id, not phone — sending the phone meant every live DM
    // came back "Recipient not connected". The DB save below still runs if
    // the id hasn't loaded yet.
    if (wsRef.current?.readyState === WebSocket.OPEN && recipientIdRef.current) {
      wsRef.current.send(
        JSON.stringify({
          chatId,
          recipientId: recipientIdRef.current,
          content: optimisticMsg.content,
          timestamp,
        }),
      );
    }

    // Always save to DB (ensures offline recipient gets it)
    try {
      console.log("[SAVE] senderPhone:", userId, "recipientPhone:", phone, "content:", newMessage);
      const res = await fetch("/api/direct-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderPhone: userId, recipientPhone: phone, content: newMessage }),
      });
      const data = await res.json();
      console.log("[SAVE] response status:", res.status, "data:", data);
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setMessages((prev) =>
        prev.map((m) =>
          m.timestamp === timestamp && m.status === "sending" ? { ...m, status: "delivered" } : m
        )
      );
    } catch (err: any) {
      console.error("[SAVE] error:", err);
      toast.error(`Save failed: ${err.message}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setNewMsgDividerIndex(null);
    setMenuOpen(false);
    toast.success("Chat cleared");
  };

  const handleChangeBg = (value: string) => {
    setChatBg(value);
    localStorage.setItem(`chatBg_${phone}`, value);
    setMenuOpen(false);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={`relative flex flex-col h-[calc(100vh-56px)] ${chatBg} transition-colors duration-500`}>
      {/* Header */}
      <div className="px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between relative">
        <div className="flex items-center gap-3">
          <UserAvatar src={recipientImage} name={recipientName || phone} size={36} />
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{recipientName || phone}</p>
            <p className="text-xs text-gray-400">{phone}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => initiateCall("AUDIO", recipientId, undefined)}
            disabled={isCalling || !recipientId}
            title="Audio call"
            className="p-2 rounded-full bg-green-500 hover:bg-green-400 text-white transition disabled:opacity-40"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => initiateCall("VIDEO", recipientId, undefined)}
            disabled={isCalling || !recipientId}
            title="Video call"
            className="p-2 rounded-full bg-blue-500 hover:bg-blue-400 text-white transition disabled:opacity-40"
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
            <div className={`absolute right-0 top-10 w-52 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden transition-all duration-200 origin-top-right ${
              menuOpen ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
            }`}>
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

              <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Background</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {BG_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleChangeBg(opt.value)}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all ${
                        chatBg === opt.value ? "ring-2 ring-blue-500" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 ${opt.value.split(" ")[0]}`} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-grow overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm mt-16">
            No messages yet. Say hello!
          </div>
        ) : (
          messages.map((msg, index) => {
            const isOwn = msg.senderId === userId;
            const msgReactions = reactions[index] || {};
            const hasReactions = Object.keys(msgReactions).length > 0;
            const showDivider = newMsgDividerIndex !== null && index === newMsgDividerIndex;

            return (
              <React.Fragment key={index}>
                {/* New messages divider */}
                {showDivider && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="flex-1 h-px bg-blue-200 dark:bg-blue-800" />
                    <span className="text-xs text-blue-500 dark:text-blue-400 font-medium whitespace-nowrap px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 rounded-full">
                      New messages
                    </span>
                    <div className="flex-1 h-px bg-blue-200 dark:bg-blue-800" />
                  </div>
                )}

                <div className={`flex items-end gap-2 mb-2 ${isOwn ? "justify-end" : "justify-start"}`}>
                  {!isOwn && (
                    <UserAvatar src={recipientImage} name={recipientName || phone} size={28} />
                  )}
                  <div className="relative max-w-xs sm:max-w-sm">
                    {/* Bubble */}
                    <div
                      className={`break-words px-3 py-2 rounded-2xl cursor-pointer select-none ${
                        isOwn
                          ? "bg-blue-500 text-white rounded-br-sm"
                          : "bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-bl-sm"
                      }`}
                      onPointerDown={() => handleMsgPointerDown(index)}
                      onPointerUp={(e) => handleMsgPointerUp(e, index)}
                      onPointerCancel={handleMsgPointerCancel}
                    >
                      {!isOwn && (
                        <p className="text-xs font-semibold mb-0.5 opacity-70">
                          {recipientName || msg.senderId}
                        </p>
                      )}
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-xs opacity-60">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
                            onClick={() => handleReact(index, emoji, userId)}
                            className={`text-xs rounded-full px-1.5 py-0.5 border flex items-center gap-0.5 transition-colors ${
                              users.includes(userId)
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
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating emoji picker — above the input, outside the scroll container */}
      {activeEmojiPicker !== null && (
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
                onClick={() => handleReact(activeEmojiPicker, emoji, userId)}
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
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-grow px-4 py-2.5 text-sm rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSendMessage}
          disabled={!newMessage.trim()}
          className="px-4 py-2.5 text-sm font-semibold rounded-full bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatWithPhone;
