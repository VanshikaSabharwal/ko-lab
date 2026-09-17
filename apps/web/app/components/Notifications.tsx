"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

const Notifications = () => {
  const [notificationCount, setNotificationCount] = useState(0);
  const { data: session } = useSession();
  const userId = session?.user.id;

  useEffect(() => {
    const fetchNotificationCount = async () => {
      try {
        const response = await fetch(`/api/notifications?userId=${userId}`);
        const data = await response.json();

        if (data.success) {
          setNotificationCount(data.notifications.length);
        }
      } catch (error) {
        console.error("Error fetching notifications:", error);
      }
    };

    if (userId) {
      fetchNotificationCount();
    }
  }, [userId]);

  const handleViewNotifications = () => {
    setNotificationCount(0); 
  };

  return (
    <div className="flex items-center space-x-4">
      <Link
        href="/notifications"
        className="relative inline-flex text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 font-semibold text-lg transition-colors duration-200 hover:scale-105"
        onClick={handleViewNotifications} 
      >
        Notifications
        {notificationCount > 0 && (
          <span className="absolute -top-2 -right-4 bg-red-600 text-white text-xs font-bold rounded-full inline-flex items-center justify-center min-w-5 h-5 px-1">
            {notificationCount}
          </span>
        )}
      </Link>
    </div>
  );
};

export default Notifications;
