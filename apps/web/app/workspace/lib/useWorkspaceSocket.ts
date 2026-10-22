"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWsToken } from "../../lib/wsAuth";

// CODE is the code editor's room: who has which file open
export type WorkspaceBoardType = "MIND_MAP" | "PLANNING" | "DB_SCHEMA" | "UI_DESIGN" | "CODE";

// How long live sync must stay down before the UI says anything.
const OFFLINE_GRACE_MS = 10_000;

interface UseWorkspaceSocketOptions {
  groupId: string;
  board: WorkspaceBoardType;
  userId: string | undefined;
  /** `fromUserId` is who sent it, as the server stamped it (not the sender's say-so). */
  onRemoteOp: (op: any, fromUserId?: string) => void;
}

// Mirrors the WS connection lifecycle used by GroupChat.tsx (ping/reconnect/cleanup),
// scoped to a single workspace board room instead of group chat.
export function useWorkspaceSocket({ groupId, board, userId, onRemoteOp }: UseWorkspaceSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  // Separate from isConnected: true only once we've been down long enough that
  // it's worth telling the user. A momentary blip during a normal reconnect
  // shouldn't flash a warning at them.
  const [isOffline, setIsOffline] = useState(false);
  const [presence, setPresence] = useState<string[]>([]);
  const reconnectAttempts = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const onRemoteOpRef = useRef(onRemoteOp);
  onRemoteOpRef.current = onRemoteOp;

  useEffect(() => {
    if (!userId) return;
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
      const ws = new WebSocket(`${wsBase}/ws?token=${token}&groupId=${groupId}&board=${board}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsOffline(false);
        if (offlineTimer.current) {
          clearTimeout(offlineTimer.current);
          offlineTimer.current = null;
        }
        reconnectAttempts.current = 0;
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 25_000);
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "pong" || message.type === "connection_established") return;
        if (message.type === "workspace_presence") {
          setPresence(message.userIds ?? []);
          return;
        }
        if (message.type === "workspace_op") {
          onRemoteOpRef.current(message.op, message.userId);
        }
      };

      ws.onclose = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        wsRef.current = null;
        setIsConnected(false);
        if (!isMountedRef.current) return;
        // Only surface the outage after the grace period, so a routine
        // reconnect never flashes a warning.
        if (!offlineTimer.current) {
          offlineTimer.current = setTimeout(() => {
            if (isMountedRef.current) setIsOffline(true);
          }, OFFLINE_GRACE_MS);
        }
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
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [groupId, board, userId]);

  const sendOp = useCallback(
    (op: unknown) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "workspace_op", groupId, board, op }));
      }
    },
    [groupId, board],
  );

  return { isConnected, isOffline, presence, sendOp };
}
