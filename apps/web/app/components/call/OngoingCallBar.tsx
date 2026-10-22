"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Video } from "lucide-react";
import { useCall } from "./CallProvider";

interface OngoingCall {
  callId: string;
  startedAt: string;
  participants: { id: string; name: string | null }[];
}

const POLL_MS = 8_000;

/** "Asha", "Asha and Bilal", "Asha, Bilal and 2 others". */
function namesOf(people: OngoingCall["participants"]): string {
  const names = people.map((p) => p.name?.split(" ")[0] || "Someone");
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}

/**
 * Shown in a group's chat while the group has a call going that you aren't on:
 * who's there, and a way in. This is how someone rejoins after leaving, or
 * joins after missing the ring.
 *
 * `onChange` fires whenever the call's state changes (started, someone joined
 * or left, ended), so the chat can reload and show the new call-log lines.
 */
export default function OngoingCallBar({
  groupId,
  onChange,
}: {
  groupId: string;
  onChange?: () => void;
}) {
  const { activeCall, callStatus, joinCall } = useCall();
  const [call, setCall] = useState<OngoingCall | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // What the call looked like last time, to tell a change from a repeat
  const lastSeen = useRef("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/calls/active?groupId=${encodeURIComponent(groupId)}`);
      if (!res.ok) return;
      const next: OngoingCall | null = (await res.json()).call ?? null;
      const signature = next
        ? `${next.callId}:${next.participants.map((p) => p.id).sort().join(",")}`
        : "";
      if (signature !== lastSeen.current) {
        const first = lastSeen.current === "" && signature === "";
        lastSeen.current = signature;
        setCall(next);
        if (!first) onChangeRef.current?.();
      }
    } catch {
      // A missed check is fine: the next one is seconds away
    }
  }, [groupId]);

  useEffect(() => {
    lastSeen.current = "";
    setCall(null);
    void refresh();

    // Only poll a tab someone is looking at
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // Sent by the call provider when a call rings, ends, or you join or leave one
    const onCallChanged = (e: Event) => {
      const changed = (e as CustomEvent).detail?.groupId;
      if (!changed || changed === groupId) void refresh();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("ko-lab:call-changed", onCallChanged);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("ko-lab:call-changed", onCallChanged);
    };
  }, [groupId, refresh]);

  // Nothing to offer if there's no call, or you're already on it
  if (!call || activeCall?.callId === call.callId) return null;

  const busy = callStatus !== "idle";
  const count = call.participants.length;
  const button =
    "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-green-200 bg-green-50 px-4 py-2 dark:border-green-900/60 dark:bg-green-950/40"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
      </span>
      <p className="min-w-0 flex-1 text-sm text-green-900 dark:text-green-100">
        <span className="font-semibold">Call in progress</span>
        <span className="text-green-800/80 dark:text-green-200/80">
          {" · "}
          {namesOf(call.participants)} {count === 1 ? "is" : "are"} on it
        </span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => joinCall(call.callId, false)}
          disabled={busy}
          className={`${button} bg-green-600 hover:bg-green-700`}
        >
          <Phone size={13} />
          {callStatus === "connecting" ? "Joining…" : "Join"}
        </button>
        <button
          type="button"
          onClick={() => joinCall(call.callId, true)}
          disabled={busy}
          className={`${button} bg-blue-600 hover:bg-blue-700`}
        >
          <Video size={13} />
          Join with video
        </button>
      </div>
    </div>
  );
}
