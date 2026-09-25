"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import FriendSearch from "../components/FriendSearch";
import Notifications from "./Notifications";
import { motion } from "framer-motion";
import GroupChat from "../group/[groupId]/GroupChat";
import ChatWithPhone from "../chat/[chatId]/ChatWithPhone";
import PageTour from "./PageTour";
import UserAvatar from "./UserAvatar";
import { GrChat } from "react-icons/gr";
import { Phone, Video } from "lucide-react";
import { useCall } from "./call/CallProvider";
import GroupAvatar from "./GroupAvatar";

interface Group {
  ownerName: string;
  id: string;
  groupName: string;
  githubRepo: string;
  image: string | null;
}

interface Friend {
  id: string;
  name: string | null;
  phone: string | null;
  image: string | null;
}

export default function Component() {
  const { initiateCall, isCalling } = useCall();
  const { data: session, status } = useSession();
  const [selectedChat, setSelectedChat] = useState<Group | null>(null);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [isMobileView, setIsMobileView] = useState(false);

  const userId = session?.user?.id;

  const fetchFriends = useCallback(async () => {
    try {
      const res = await fetch("/api/friends");
      const data = await res.json();
      console.log("[Friends]", res.status, data);
      setFriends(Array.isArray(data.friends) ? data.friends : []);
    } catch (err) {
      console.error("[Friends] fetch failed", err);
      setFriends([]);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    const fetchGroups = async () => {
      try {
        const res = await fetch(`/api/my-groups?userId=${userId}`);
        const data = await res.json();
        setGroups(Array.isArray(data.groups) ? data.groups : []);
      } catch {
        setGroups([]);
      }
    };

    fetchGroups();
    fetchFriends();

    const handleResize = () => setIsMobileView(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [userId, fetchFriends]);

  const handleGroupClick = (group: Group) => {
    if (isMobileView) {
      window.location.href = `/group/${group.id}`;
    } else {
      setSelectedFriend(null);
      setSelectedChat(group);
    }
  };

  const handleFriendClick = (friend: Friend) => {
    if (!friend.phone) return;
    if (isMobileView) {
      window.location.href = `/chat/${friend.phone}`;
    } else {
      setSelectedChat(null);
      setSelectedFriend(friend);
    }
  };

  if (status === "loading") {
    return <p className="text-center text-gray-400">Loading...</p>;
  }

  if (!session) {
    return <p className="text-center text-gray-400">Please Sign In to see chats</p>;
  }

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-56px)] bg-gradient-to-br from-gray-100 to-white dark:from-gray-900 dark:to-black text-gray-900 dark:text-white overflow-hidden">
      <PageTour
        storageKey="ko-lab-tour-chatroom"
        steps={[
          {
            id: "chatroom-welcome",
            text: `<strong>Welcome to the Chat Room!</strong><br/><br/>
              This is your collaboration hub — find contacts, join group chats, and see notifications all in one place.`,
          },
          {
            id: "chatroom-profile",
            attachTo: { element: "#tour-chatroom-profile", on: "right" },
            text: `<strong>Your profile & notifications</strong><br/><br/>
              See your name, email and any pending notifications at a glance.`,
          },
          {
            id: "chatroom-search",
            attachTo: { element: "#tour-chatroom-search", on: "right" },
            text: `<strong>Find a contact</strong><br/><br/>
              Search for a friend by phone number to start a one-on-one chat.`,
          },
          {
            id: "chatroom-friends",
            attachTo: { element: "#tour-chatroom-friends", on: "right" },
            text: `<strong>Your friends</strong><br/><br/>
              Friends you've added appear here for quick access to their chat.`,
          },
          {
            id: "chatroom-groups",
            attachTo: { element: "#tour-chatroom-groups", on: "right" },
            text: `<strong>Your groups</strong><br/><br/>
              Click any group to open its chat. On mobile you'll be taken to the group page directly.`,
          },
          {
            id: "chatroom-area",
            attachTo: { element: "#tour-chatroom-area", on: "left" },
            text: `<strong>Chat area</strong><br/><br/>
              Select a group from the sidebar and messages will appear here in real time.`,
          },
        ]}
      />

      {/* Sidebar */}
      <div className="w-full md:w-1/4 flex flex-col h-full bg-white dark:bg-gray-900 border-b md:border-r border-gray-200 dark:border-gray-700 overflow-y-auto">

        {/* Profile strip */}
        <div id="tour-chatroom-profile" className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <Notifications />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
            {session.user?.name || "No Name"} · {session.user?.email || ""}
          </p>
        </div>

        {/* Find contact */}
        <div id="tour-chatroom-search" className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <FriendSearch onFriendAdded={fetchFriends} />
        </div>

        {/* My Friends */}
        <div id="tour-chatroom-friends" className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
            My Friends
          </h2>
          {friends.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">
              No friends yet — search and add above.
            </p>
          ) : (
            <ul className="space-y-1">
              {friends.map((f) => (
                <li
                  key={f.id}
                  onClick={() => handleFriendClick(f)}
                  className={`flex items-center justify-between py-1.5 px-1 rounded-lg cursor-pointer transition-colors ${
                    selectedFriend?.id === f.id
                      ? "bg-indigo-50 dark:bg-indigo-900/30"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <UserAvatar src={f.image} name={f.name ?? f.phone} size={28} />
                    <span className="text-sm text-gray-800 dark:text-gray-100 truncate">
                      {f.name ?? f.phone}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {f.phone && (
                      <>
                        {/* <button
                          onClick={(e) => {
                            e.stopPropagation();
                            initiateCall("AUDIO", f.id);
                          }}
                          disabled={isCalling}
                          title="Audio call"
                          className="p-1.5 bg-green-500 hover:bg-green-400 text-white rounded-full transition shrink-0 disabled:opacity-40"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </button> */}
                        {/* <button
                          onClick={(e) => {
                            e.stopPropagation();
                            initiateCall("VIDEO", f.id);
                          }}
                          disabled={isCalling}
                          title="Video call"
                          className="p-1.5 bg-blue-500 hover:bg-blue-400 text-white rounded-full transition shrink-0 disabled:opacity-40"
                        >
                          <Video className="w-3.5 h-3.5" />
                        </button> */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFriendClick(f);
                          }}
                          title="Open chat"
                          className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition shrink-0"
                        >
                          <GrChat className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* My Groups */}
        <div id="tour-chatroom-groups" className="px-4 py-3 flex-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
            My Groups
          </h2>
          {groups.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">No groups yet.</p>
          ) : (
            <ul className="space-y-1">
              {groups.map((group) => (
                <li
                  key={group.id}
                  onClick={() => handleGroupClick(group)}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                >
                  <GroupAvatar name={group.groupName} image={group.image} size={28} />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{group.groupName}</p>
                    {/* <a
                      href={`https://github.com/${group.ownerName}/${group.githubRepo}`}
                      className="text-xs text-blue-500 hover:text-blue-400 truncate block"
                      onClick={(e) => e.stopPropagation()}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {group.githubRepo}
                    </a> */}
                  </div>
                  {/* <button
                    onClick={(e) => { e.stopPropagation(); initiateCall("GROUP", undefined, group.id); }}
                    disabled={isCalling}
                    title="Group video call"
                    className="p-1.5 bg-green-500 hover:bg-green-400 text-white rounded-full transition shrink-0 disabled:opacity-40"
                  >
                    <Video className="w-3.5 h-3.5" />
                  </button> */}
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>

      {/* Chat Area */}
      <motion.div
        id="tour-chatroom-area"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full md:w-3/4 bg-gray-50 dark:bg-gray-900 flex flex-col justify-between h-full hidden md:block"
      >
        {selectedChat ? (
          <GroupChat group={selectedChat.id} />
        ) : selectedFriend?.phone ? (
          <ChatWithPhone key={selectedFriend.id} phone={selectedFriend.phone} />
        ) : (
          <div className="text-gray-500 dark:text-gray-300 text-lg text-center mt-10">
            Select a group or friend to start chatting
          </div>
        )}
      </motion.div>
    </div>
  );
}
