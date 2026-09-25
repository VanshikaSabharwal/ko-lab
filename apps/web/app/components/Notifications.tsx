"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

const Notifications = () => {
  const [unreadCount, setUnreadCount] = useState(0);
  const { data: session } = useSession();
  const userId = session?.user.id;

  // Only unread ones: counting every notification brought the badge back on
  // each page load, however many times it had been viewed.
  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications");
      const data = await response.json();
      if (data.success) {
        setUnreadCount(
          data.notifications.filter((n: { readAt: string | null }) => !n.readAt).length,
        );
      }
    } catch (error) {
      console.error("Error fetching notifications:", error);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetchUnreadCount();

    // New notification pushed over the socket → recount; viewed on the
    // notifications page → nothing left unread
    const onPushed = () => fetchUnreadCount();
    const onRead = () => setUnreadCount(0);
    window.addEventListener("ko-lab:notification", onPushed);
    window.addEventListener("ko-lab:notifications-read", onRead);
    return () => {
      window.removeEventListener("ko-lab:notification", onPushed);
      window.removeEventListener("ko-lab:notifications-read", onRead);
    };
  }, [userId, fetchUnreadCount]);

  return (
    <div className="flex items-center space-x-4">
      <Link
        href="/notifications"
        className="relative inline-flex text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 font-semibold text-lg transition-colors duration-200 hover:scale-105"
        onClick={() => {
          if (unreadCount === 0) return;
          setUnreadCount(0);
          // Saved on click rather than left to the notifications page, so one
          // click clears it for good even if that page never finishes loading.
          // keepalive lets the request finish while the page navigates away.
          fetch("/api/notifications", { method: "PATCH", keepalive: true }).catch(() => {});
        }}
      >
        Notifications
        {unreadCount > 0 && (
          <span className="absolute -top-2 -right-4 bg-red-600 text-white text-xs font-bold rounded-full inline-flex items-center justify-center min-w-5 h-5 px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>
    </div>
  );
};

export default Notifications;
