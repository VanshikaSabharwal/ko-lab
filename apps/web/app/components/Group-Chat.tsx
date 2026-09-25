"use client";
import React, { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { FaUsers, FaPaperPlane, FaUserPlus } from "react-icons/fa";
import toast from "react-hot-toast";
import Link from "next/link";
import { fetchWsToken } from "../lib/wsAuth";

interface GroupChatProps {
  group: string;
}

interface Message {
  id: string;
  senderId: string | undefined;
  senderName: string | undefined;
  groupId: string;
  content: string;
  createdAt: number;
}

interface GroupDetails {
  id: string;
  ownerId: string;
  githubRepo: string;
  groupName: string;
}

const GroupChat: React.FC<GroupChatProps> = ({ group }) => {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [loadingGroupDetails, setLoadingGroupDetails] = useState(true);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const groupName = groupDetails?.groupName;
  const githubRepo = groupDetails?.githubRepo;
  console.log("groupName: ", groupName);
  console.log("githubRepo: ", githubRepo);

  const senderId = session?.user?.id;
  const senderName = session?.user?.name;
  const isOwner = session?.user.id === groupDetails?.ownerId;

  const reconnectAttempts = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const [isConnected, setIsConnected] = useState(false);

  const fetchMessages = async () => {
    if (group) {
      console.log("[FETCH] Loading messages for group:", group);
      try {
        const res = await fetch(`/api/save-group-message?group=${group}`, {
          method: "GET",
        });
        console.log("[FETCH] Response status:", res.status);
        const data: Message[] = await res.json();
        console.log("[FETCH] Messages loaded:", data.length, data);
        setMessages(data);
      } catch (err) {
        console.error("[FETCH] ❌ Error fetching messages:", err);
        toast.error("Failed to fetch messages");
      }
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      const fetchGroupDetails = async () => {
        try {
          const response = await fetch(`/api/create-group-data?group=${group}`);
          const data = await response.json();
          setGroupDetails(data);
        } catch (err) {
          console.error("Error fetching details: ", err);
          toast.error("Failed to fetch group details");
        } finally {
          setLoadingGroupDetails(false);
        }
      };

      fetchMessages();
      fetchGroupDetails();

      // Simulate loading percentage
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
        console.log("[MEMBER] Checking membership for userId:", senderId, "groupId:", group);
        try {
          const res = await fetch(
            `/api/check-group-member?group=${group}&userId=${senderId}`,
          );
          const data = await res.json();
          console.log("[MEMBER] Response:", data, "isMember:", data.exists);
          console.log("[MEMBER] groupDetails.ownerId:", groupDetails?.ownerId, "session.user.id:", session?.user?.id);
          console.log("[MEMBER] isOwner:", session?.user?.id === groupDetails?.ownerId);
          setIsMember(data.exists);
        } catch (err) {
          console.error("[MEMBER] ❌ Error:", err);
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
          console.log("[WS] ✅ Connected! readyState:", ws.readyState);
          setIsConnected(true);
          reconnectAttempts.current = 0;
          heartbeatRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, 25_000);
        };

        ws.onmessage = (event) => {
          console.log("[WS] 📨 Raw message received:", event.data);
          const message = JSON.parse(event.data);
          console.log("[WS] Parsed message:", message);
          if (message.type === "pong" || message.type === "connection_established") {
            console.log("[WS] System message, ignoring:", message.type);
            return;
          }
          // Call signalling and workspace traffic share this socket. Appending
          // them rendered empty bubbles stamped "Invalid Date" — they have no
          // content or createdAt. Only chat messages belong here.
          if (message.type || !message.content) return;
          // Direct messages reach every socket a user has; keep only this group's
          if (message.groupId !== group) return;
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              id: message.id,
              senderId: message.senderId,
              senderName: message.senderName,
              groupId: message.groupId,
              content: message.content,
              createdAt: message.createdAt,
            },
          ]);
        };

        ws.onclose = (event) => {
          console.log("[WS] ❌ Connection closed. Code:", event.code, "Reason:", event.reason, "Clean:", event.wasClean);
          if (heartbeatRef.current) clearInterval(heartbeatRef.current);
          wsRef.current = null;
          setIsConnected(false);
          if (!isMountedRef.current) return;
          const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30_000);
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
          reconnectAttempts.current += 1;
          setTimeout(connect, delay);
        };

        ws.onerror = (event) => {
          console.error("[WS] 🔴 Error event:", event);
          ws.close();
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
    }
  }, [session, groupDetails, group, senderId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    const canSend = isMember || session?.user.id === groupDetails?.ownerId;

    console.log("[SEND] handleSendMessage called");
    console.log("[SEND] newMessage:", newMessage);
    console.log("[SEND] isMember:", isMember, "isOwner:", session?.user.id === groupDetails?.ownerId);
    console.log("[SEND] canSend:", canSend);
    console.log("[SEND] wsRef.current:", wsRef.current);
    console.log("[SEND] ws readyState:", wsRef.current?.readyState, "(1=OPEN, 0=CONNECTING, 2=CLOSING, 3=CLOSED)");

    if (!newMessage.trim()) return;

    if (!canSend) {
      console.warn("[SEND] Blocked — isMember:", isMember, "| session.user.id:", session?.user.id, "| groupDetails.ownerId:", groupDetails?.ownerId);
      toast.error(`Cannot send: isMember=${isMember}, isOwner=${session?.user.id === groupDetails?.ownerId}, groupLoaded=${!!groupDetails}`);
      return;
    }

    const message = {
      id: `${Date.now()}-${Math.random()}`,
      content: newMessage,
      groupId: group,
      senderId,
      senderName,
      createdAt: Date.now(),
    };

    console.log("[SEND] Message object:", message);

    // Optimistic update
    setMessages((prev) => [...prev, message]);
    setNewMessage("");

    // Send via WebSocket if connected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("[SEND] ✅ Sending via WebSocket");
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("[SEND] ⚠️ WebSocket not open, skipping WS send. readyState:", wsRef.current?.readyState);
    }

    // Always save to DB
    console.log("[SEND] Saving to DB...");
    try {
      const response = await fetch("/api/save-group-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      console.log("[SEND] DB response status:", response.status);
      if (!response.ok) {
        const err = await response.json();
        console.error("[SEND] DB error body:", err);
        throw new Error("Failed to save message");
      }
      console.log("[SEND] ✅ Saved to DB");
    } catch (error) {
      console.error("[SEND] ❌ DB save failed:", error);
      toast.error("Message sent but failed to save. It may not appear after refresh.");
    }
  };

  if (loadingGroupDetails) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
          <div className="mt-4 text-xl">{loadingPercentage}%</div>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
          <div className="mt-4 text-xl">{loadingPercentage}%</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex justify-center items-center h-screen text-2xl font-bold text-red-500">
        You are not logged in
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900">
      <div className="flex-1 overflow-hidden">
        <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden flex flex-col h-full">
          <div className="bg-blue-500 dark:bg-blue-700 text-white p-4">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-bold text-center">
                {groupDetails?.groupName}
              </h1>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isConnected ? "bg-green-400" : "bg-yellow-400 animate-pulse"}`} title={isConnected ? "Connected" : "Reconnecting..."} />
            </div>
            <h2 className="text-sm text-center mt-1">Group ID: {group}</h2>
            <Link href={`/code-editor/${group}/${groupName}`}>
              <button className="mt-2 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition duration-300">
                Code Editor
              </button>
            </Link>
          </div>
          <div
            className="flex-1 overflow-y-auto p-4"
            style={{ maxHeight: "calc(100vh - 240px)" }}
          >
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex mb-4 ${
                  msg.senderId === session?.user?.id
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                <div
                  className={`max-w-xs lg:max-w-md xl:max-w-lg break-words p-3 rounded-lg ${
                    msg.senderId === session?.user?.id
                      ? "bg-blue-500 text-white"
                      : "bg-gray-200 dark:bg-gray-700 text-black dark:text-white"
                  }`}
                >
                  <p className="font-bold mb-1">{msg.senderName}</p>
                  <p>{msg.content}</p>
                  <p className="text-xs mt-1 opacity-75">
                    {new Date(msg.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {/* Debug status bar — remove after confirming it works */}
          <div className="text-xs px-4 py-1 bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800 flex gap-3 flex-wrap">
            <span>WS: <b>{isConnected ? "✅ connected" : "❌ disconnected"}</b></span>
            <span>member: <b>{String(isMember)}</b></span>
            <span>owner: <b>{String(session?.user.id === groupDetails?.ownerId)}</b></span>
            <span>userId: <b>{session?.user.id ?? "undefined"}</b></span>
            <span>ownerId: <b>{groupDetails?.ownerId ?? "loading…"}</b></span>
          </div>

          <div className="bg-gray-100 dark:bg-gray-900 p-4">
            <div className="flex items-center">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-l-lg p-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
              />
              <button
                onClick={handleSendMessage}
                className="bg-blue-500 text-white p-2 rounded-r-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <FaPaperPlane />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg mt-4 p-8 max-w-3xl mx-auto">
        <div className="flex justify-between items-center gap-2">
          {isOwner && (
            <a
              href={`/addGroupMember/${group}`}
              className="flex items-center gap-2 bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600 transition duration-300"
            >
              <FaUserPlus />
              Add Member
            </a>
          )}
          <a
            href={`/viewMembers/${group}`}
            className="flex items-center text-blue-600 hover:text-blue-800 transition duration-300"
          >
            <FaUsers className="mr-2" />
            View Members
          </a>
          <a
            href={groupDetails?.githubRepo}
            className="bg-gray-800 text-white py-2 px-4 rounded hover:bg-gray-700 transition duration-300"
          >
            GitHub Repo
          </a>
        </div>
      </div>
    </div>
  );
};

export default GroupChat;
