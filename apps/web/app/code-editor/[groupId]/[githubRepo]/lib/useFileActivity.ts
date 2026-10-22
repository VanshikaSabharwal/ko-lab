"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceSocket } from "../../../../workspace/lib/useWorkspaceSocket";

// Who else in the group has which file open in the code editor, so two people
// about to change the same file see each other before their edits collide in
// a change request.
//
// Each open editor announces the file on screen (and whether it has unsaved
// edits) over the group's live connection, again whenever that changes, and
// every so often while it stays open. Announcements that stop arriving expire.

export interface FileActivity {
  userId: string;
  name: string;
  /** Has unsaved edits to the file, not just looking at it. */
  editing: boolean;
}

interface Announcement {
  action: "file_activity";
  path: string | null;
  name: string;
  editing: boolean;
}

const HEARTBEAT_MS = 20_000;
/** Silence this long means the editor was closed or the connection dropped. */
const EXPIRE_MS = 50_000;

export function useFileActivity({
  groupId,
  userId,
  userName,
  openPath,
  editing,
}: {
  groupId: string;
  userId: string | undefined;
  userName: string;
  /** The file on screen, or null when none is. */
  openPath: string | null;
  editing: boolean;
}) {
  const [peers, setPeers] = useState<Map<string, FileActivity & { path: string; seenAt: number }>>(new Map());

  const onRemoteOp = useCallback((op: Announcement, fromUserId?: string) => {
    if (op?.action !== "file_activity" || !fromUserId) return;
    setPeers((current) => {
      const next = new Map(current);
      if (!op.path) next.delete(fromUserId);
      else
        next.set(fromUserId, {
          userId: fromUserId,
          name: op.name || "Someone",
          editing: !!op.editing,
          path: op.path,
          seenAt: Date.now(),
        });
      return next;
    });
  }, []);

  const { presence, sendOp, isConnected } = useWorkspaceSocket({
    groupId,
    board: "CODE",
    userId,
    onRemoteOp,
  });

  const announce = useRef<() => void>(() => {});
  announce.current = () =>
    sendOp({ action: "file_activity", path: openPath, name: userName, editing } satisfies Announcement);

  // On every change of file or unsaved state, and on (re)connecting
  useEffect(() => {
    if (isConnected) announce.current();
  }, [openPath, editing, userName, isConnected]);

  // Someone new arrived: tell them now rather than at the next heartbeat
  const presenceKey = presence.join(",");
  const lastPresence = useRef(presenceKey);
  useEffect(() => {
    const arrived = presence.some((id) => !lastPresence.current.split(",").includes(id));
    lastPresence.current = presenceKey;
    if (arrived && isConnected) announce.current();
    // People who left the room drop off straight away
    setPeers((current) => {
      const next = new Map([...current].filter(([id]) => presence.includes(id)));
      return next.size === current.size ? current : next;
    });
  }, [presenceKey, presence, isConnected]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") announce.current();
      // Expire anyone whose announcements stopped
      setPeers((current) => {
        const now = Date.now();
        const next = new Map([...current].filter(([, p]) => now - p.seenAt < EXPIRE_MS));
        return next.size === current.size ? current : next;
      });
    }, HEARTBEAT_MS);
    // Leaving the editor: say so, rather than waiting to expire
    return () => {
      clearInterval(timer);
      sendOp({ action: "file_activity", path: null, name: userName, editing: false });
    };
  }, [sendOp, userName]);

  /** Other people per file path. Never includes you, even in another tab. */
  const byPath = useMemo(() => {
    const map = new Map<string, FileActivity[]>();
    for (const p of peers.values()) {
      if (p.userId === userId) continue;
      map.set(p.path, [...(map.get(p.path) ?? []), { userId: p.userId, name: p.name, editing: p.editing }]);
    }
    return map;
  }, [peers, userId]);

  return byPath;
}
