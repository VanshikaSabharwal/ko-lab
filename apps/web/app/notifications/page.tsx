"use client";
import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import PageTour from "../components/PageTour";

interface NotificationsType {
  id: string;
  userId: string;
  groupId: string;
  userName: string;
  ownerName: string;
  groupName: string;
  ownerId?: string;
  recipientId?: string | null;
  /** GROUP_INVITE, CODE_ACCESS, … Absent on older change-request rows. */
  type?: string | null;
  message?: string | null;
  status: "raised" | "accepted" | "rejected";
  reason?: string;
}

interface RejectedCrType {
  id: string;
  userId: string;
  userName: string;
  groupId: string;
  groupName: string;
  message: string;
}

interface DmNotification {
  name: string;
  phone: string;
  count: number;
  lastMessage: string;
  lastAt: number;
}

const NotificationsPage = () => {
  const [notifications, setNotifications] = useState<NotificationsType[]>([]);
  const [rejections, setRejections] = useState<RejectedCrType[]>([]);
  const [dmNotifications, setDmNotifications] = useState<DmNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: session } = useSession();
  const userId = session?.user.id;

  useEffect(() => {
    // `background` refetches without flipping back to the loading screen, so a
    // live update doesn't blank out the list the user is already reading.
    const fetchNotifications = async ({ background = false } = {}) => {
      if (!background) setLoading(true);
      setError(null);
      try {
        // Fetch my phone number first for DM notifications
        const phoneRes = await fetch(`/api/get-user-number?id=${userId}`);
        const phoneData = await phoneRes.json();
        const myPhone = phoneData?.phone;

        const [notificationsRes, rejectionsRes] = await Promise.all([
          fetch(`/api/notifications?userId=${userId}`),
          fetch(`/api/rejected-cr?userId=${userId}`),
        ]);
        const notificationsData = await notificationsRes.json();
        const rejectionsData = await rejectionsRes.json();

        if (notificationsData.success) {
          setNotifications(notificationsData.notifications);
          // They're on screen now, so they're seen: clear the unread badge for good
          if (notificationsData.notifications.some((n: { readAt: string | null }) => !n.readAt)) {
            fetch("/api/notifications", { method: "PATCH" })
              .then(() => window.dispatchEvent(new Event("ko-lab:notifications-read")))
              .catch(() => {});
          }
        }
        if (rejectionsData.success) setRejections(rejectionsData.rejectedNotification);

        if (myPhone) {
          const dmRes = await fetch(`/api/direct-message/unread?phone=${myPhone}`);
          const dmData = await dmRes.json();
          if (dmData.unread) setDmNotifications(dmData.unread);
        }
      } catch (error) {
        console.error("Error fetching notifications:", error);
        setError("Failed to fetch notifications.");
      } finally {
        setLoading(false);
      }
    };
    if (!userId) return;

    fetchNotifications();

    // A notification pushed over the socket while this page is open should
    // appear without a manual reload. CallProvider holds the app-wide socket
    // and re-emits what it receives as this event.
    const onPushed = () => fetchNotifications({ background: true });
    window.addEventListener("ko-lab:notification", onPushed);
    return () => window.removeEventListener("ko-lab:notification", onPushed);
  }, [userId]);

  if (loading)
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading notifications...</p>
      </div>
    );

  if (error)
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );

  // Typed notifications are addressed to a person and carry their own copy;
  // the CR cards below hardcode "raised a CR" and link to a review page, which
  // would be wrong for them. An absent type means a legacy change-request row.
  const personalNotifications = notifications.filter((n) => !!n.type);
  const crNotifications = notifications.filter((n) => !n.type);

  const isEmpty = notifications.length === 0 && rejections.length === 0 && dmNotifications.length === 0;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gray-50 dark:bg-gray-950 px-4 py-8 sm:py-10">
      <PageTour
        storageKey="ko-lab-tour-notifications"
        steps={[
          {
            id: "notif-welcome",
            text: `<strong>Notifications</strong><br/><br/>
              Stay up to date with everything that matters — unread DMs, code review requests, and rejected change requests all land here.`,
          },
          {
            id: "notif-dm",
            attachTo: { element: "#tour-notif-dm", on: "bottom" },
            text: `<strong>Unread messages</strong><br/><br/>
              Direct messages you haven't read yet show up here with a count badge. Click any to open the chat.`,
          },
          {
            id: "notif-cr",
            attachTo: { element: "#tour-notif-cr", on: "bottom" },
            text: `<strong>Change requests</strong><br/><br/>
              When a teammate raises a CR in one of your groups, it appears here. Click <em>Review →</em> to accept or reject it.`,
          },
          {
            id: "notif-rejected",
            attachTo: { element: "#tour-notif-rejected", on: "bottom" },
            text: `<strong>Rejected change requests</strong><br/><br/>
              CRs that were rejected are listed here with the reason. You can view the diff and resubmit if needed.`,
          },
        ]}
      />
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Notifications</h1>

        {isEmpty ? (
          <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">You&apos;re all caught up!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {dmNotifications.length > 0 && (
              <div id="tour-notif-dm">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                  Unread Messages
                </h2>
                <ul className="space-y-2">
                  {dmNotifications.map((dm) => (
                    <li key={dm.phone}>
                      <Link
                        href={`/chat/${dm.phone}`}
                        className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-gray-900 border border-blue-100 dark:border-blue-900/40 shadow-sm hover:border-blue-300 dark:hover:border-blue-700 transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                            {dm.name[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{dm.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{dm.lastMessage}</p>
                          </div>
                        </div>
                        <span className="ml-3 flex-shrink-0 bg-blue-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                          {dm.count}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {personalNotifications.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                  Groups
                </h2>
                <ul className="space-y-2">
                  {personalNotifications.map((n) => (
                    <li
                      key={n.id}
                      className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm flex items-start justify-between gap-3 flex-wrap"
                    >
                      <p className="text-sm text-gray-800 dark:text-gray-200 min-w-0">
                        {n.message}
                      </p>
                      {/* A code-access invite is accepted on the profile page,
                          not in the group — sending them to the group would be
                          a dead end. */}
                      <Link
                        href={n.type === "CODE_ACCESS" ? "/profile" : `/group/${n.groupId}`}
                        className="text-xs font-medium text-blue-500 hover:underline flex-shrink-0"
                      >
                        {n.type === "CODE_ACCESS" ? "Go to profile →" : "Open group →"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {crNotifications.length > 0 && (
              <div id="tour-notif-cr">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                  Change Requests
                </h2>
                <ul className="space-y-2">
                  {crNotifications.map((n) => (
                    <li
                      key={n.id}
                      className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm flex items-start justify-between gap-3 flex-wrap"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800 dark:text-gray-200">
                          <span className="font-medium">{n.userName}</span> raised a CR in{" "}
                          <span className="font-medium">{n.groupName}</span>
                        </p>
                      </div>
                      <Link
                        href={`/confirm-changes/${n.groupId}`}
                        className="text-xs font-medium text-blue-500 hover:underline flex-shrink-0"
                      >
                        Review →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rejections.length > 0 && (
              <div id="tour-notif-rejected">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                  Rejected Change Requests
                </h2>
                <ul className="space-y-2">
                  {rejections.map((r) => (
                    <li
                      key={r.id}
                      className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-red-100 dark:border-red-900/30 shadow-sm"
                    >
                      <p className="text-sm text-gray-800 dark:text-gray-200">
                        <span className="font-medium">{r.userName}</span> raised a CR in{" "}
                        <span className="font-medium">{r.groupName}</span>
                      </p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{r.message}</p>
                      <Link
                        href={`/confirm-changes/${r.groupId}`}
                        className="text-xs font-medium text-blue-500 hover:underline mt-2 inline-block"
                      >
                        View Changes →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
