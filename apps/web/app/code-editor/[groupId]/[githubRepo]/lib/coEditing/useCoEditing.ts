"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { yCollab } from "y-codemirror.next";
import type { Extension } from "@codemirror/state";
import { useWorkspaceSocket } from "../../../../../workspace/lib/useWorkspaceSocket";
import { CoEditSession, type CoMessage, type CoStatus, type Participant } from "./session";

export interface CoEditing {
  status: CoStatus;
  host: { id: string; name: string } | null;
  /** Everyone in the file, you included. */
  participants: Participant[];
  /** The shared text; read it when joining as a guest. */
  sharedText: () => string;
  /** Match the shared text to this screen just before binding (host). */
  syncFrom: (text: string) => void;
  /** CodeMirror extension that keeps the editor and the shared text in step. */
  binding: Extension | null;
  /** A guest's Save: asks the host to save. */
  requestSave: () => void;
}

const idle = (): CoEditing => ({
  status: "solo",
  host: null,
  participants: [],
  sharedText: () => "",
  syncFrom: () => {},
  binding: null,
  requestSave: () => {},
});

/**
 * Live co-editing for the file on screen. `path` is null when there's nothing
 * to share (no file open, or one that isn't editable text).
 */
export function useCoEditing({
  groupId,
  userId,
  userName,
  branch,
  path,
  canHost,
  getText,
  onSaveRequest,
}: {
  groupId: string;
  userId: string | undefined;
  userName: string;
  branch: string;
  path: string | null;
  canHost: boolean;
  getText: () => string;
  onSaveRequest: () => void;
}): CoEditing {
  const [session, setSession] = useState<CoEditSession | null>(null);
  const sessionRef = useRef<CoEditSession | null>(null);
  const getTextRef = useRef(getText);
  getTextRef.current = getText;
  const onSaveRef = useRef(onSaveRequest);
  onSaveRef.current = onSaveRequest;

  // Its own connection to the room, so co-editing traffic has the whole
  // per-connection message allowance to itself
  const { sendOp, isConnected } = useWorkspaceSocket({
    groupId,
    board: "CODE",
    userId,
    onRemoteOp: (op: CoMessage, from?: string) => {
      if (op?.action === "co" && from) sessionRef.current?.receive(op, from);
    },
  });

  const key = path && branch ? `${branch}:${path}` : null;

  useEffect(() => {
    // Nothing to share, or no live connection (then everyone just edits alone)
    if (!key || !userId || !isConnected) return;
    const next = new CoEditSession(
      key,
      { id: userId, name: userName, canHost },
      (message) => sendOp(message),
      () => getTextRef.current(),
      () => onSaveRef.current(),
    );
    sessionRef.current = next;
    setSession(next);
    next.start();
    return () => {
      next.leave();
      sessionRef.current = null;
      setSession(null);
    };
    // A new name or access level shouldn't restart a session mid-edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId, isConnected, sendOp]);

  // Re-render on the session's status, host and participant changes
  const version = useSyncExternalStore(
    (onChange) => session?.subscribe(onChange) ?? (() => {}),
    () => (session ? `${session.status}|${session.host?.id}|${session.participants().map((p) => p.userId).join(",")}` : ""),
    () => "",
  );

  const binding = useMemo(
    () => (session ? yCollab(session.text, session.awareness) : null),
    [session],
  );

  return useMemo(() => {
    if (!session) return idle();
    return {
      status: session.status,
      host: session.host,
      participants: session.participants(),
      sharedText: () => session.text.toString(),
      syncFrom: (text: string) => session.syncFrom(text),
      binding,
      requestSave: () => session.requestSave(),
    };
    // `version` stands in for the session's internal state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, binding, version]);
}
