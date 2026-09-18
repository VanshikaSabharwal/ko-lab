"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { Room, RoomEvent } from "livekit-client";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import { Bell } from "lucide-react";
import { fetchWsToken } from "../../lib/wsAuth";

type CallType = "AUDIO" | "VIDEO" | "GROUP";

/**
 * Publishes the local mic (and camera, for video calls) after connecting.
 *
 * room.connect() joins the room but publishes nothing, so this is what makes a
 * call audible — without it both sides connect, see the timer run, and hear
 * silence.
 *
 * Failures are reported but not thrown: a denied camera shouldn't end a call
 * whose audio is working, and a denied mic still leaves a usable receive-only
 * session. Both are far better than dropping the user out of the call.
 */
async function publishLocalTracks(room: Room, withVideo: boolean) {
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (err) {
    console.error("Microphone unavailable:", err);
    toast.error("Couldn't access your microphone — others won't hear you.");
  }

  try {
    await room.localParticipant.setCameraEnabled(withVideo);
  } catch (err) {
    console.error("Camera unavailable:", err);
    if (withVideo) toast.error("Couldn't access your camera — joining with audio only.");
  }
}

/** Seconds as m:ss / h:mm:ss — used in the end-of-call summary. */
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

interface IncomingCall {
  callId: string;
  roomName: string;
  callerId: string;
  callerName: string;
  type: CallType;
  groupId?: string;
}

interface ActiveCall {
  callId: string;
  roomName: string;
  type: CallType;
  token: string;
  room: Room | null;
  groupId?: string;
}

/**
 * Where the call is in its lifecycle, so the UI can show progress instead of a
 * frozen button. Connecting covers the seconds spent on room.connect() plus the
 * getUserMedia permission prompt — dead time the user previously saw nothing of.
 */
type CallStatus = "idle" | "connecting" | "connected";

interface CallContextValue {
  incomingCall: IncomingCall | null;
  activeCall: ActiveCall | null;
  initiateCall: (type: CallType, targetId?: string, groupId?: string) => Promise<void>;
  acceptCall: (callId: string, startWithVideo?: boolean) => Promise<void>;
  rejectCall: (callId: string) => Promise<void>;
  endCall: () => Promise<void>;
  setIncomingCall: (call: IncomingCall | null) => void;
  setActiveCall: (call: ActiveCall | null) => void;
  isCalling: boolean;
  callStatus: CallStatus;
  // Mic/camera live here rather than in each surface: the panel and the
  // minimised bar each used to own a copy, so muting in one and then rendering
  // the other silently re-enabled the mic.
  muted: boolean;
  videoEnabled: boolean;
  toggleMute: () => void;
  toggleVideo: () => void;
  joinGroup: (groupId: string) => void;
  leaveGroup: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}

const WS_BASE = (process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws").replace(/\/ws$/, "");

export function CallProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activeCallRef = useRef(activeCall);
  activeCallRef.current = activeCall;
  const currentGroupRef = useRef<string | null>(null);
  // When the active call connected, so its duration can be reported on hang-up.
  // A ref rather than state: it must survive the render that clears activeCall.
  const callStartedAtRef = useRef<number | null>(null);
  // Guards against a second call being set up while one is already connecting.
  // Without it, double-clicking Accept built two Rooms and leaked the first.
  const busyRef = useRef(false);

  // Announce the end of a call once, with how long it ran.
  const reportCallEnded = useCallback(() => {
    const startedAt = callStartedAtRef.current;
    callStartedAtRef.current = null;
    if (startedAt === null) {
      toast("Call ended");
      return;
    }
    toast(`Call ended · ${formatDuration((Date.now() - startedAt) / 1000)}`);
  }, []);

  /** Return every call surface to its resting state. Safe to call twice. */
  const resetCallState = useCallback(() => {
    busyRef.current = false;
    setActiveCall(null);
    setCallStatus("idle");
    setIsCalling(false);
    setMuted(false);
    setVideoEnabled(false);
  }, []);

  // ── WebSocket connection for call signaling ──────────────────────────
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let closed = false;

    async function connect() {
      if (closed) return;
      try {
        // Tokens are short-lived, so fetch a fresh one on every (re)connect
        const token = await fetchWsToken();
        if (!token || closed) {
          if (!closed) reconnectTimer = setTimeout(connect, 3000);
          return;
        }
        const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            handleSignalingMessage(msg);
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (!closed) {
            reconnectTimer = setTimeout(connect, 3000);
          }
        };

        ws.onopen = () => {
          if (currentGroupRef.current) {
            ws.send(JSON.stringify({ type: "join_group", groupId: currentGroupRef.current }));
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      }
    }

    function handleSignalingMessage(msg: any) {
      switch (msg.type) {
        case "call_offer":
          setIncomingCall({
            callId: msg.callId,
            roomName: msg.roomName,
            callerId: msg.callerId,
            callerName: msg.callerName,
            // msg.type is the envelope ("call_offer"), never the call kind —
            // the kind travels as callType. A groupId is the authoritative
            // signal that this is a group call.
            type: msg.groupId ? "GROUP" : msg.callType || "VIDEO",
            groupId: msg.groupId,
          });
          break;
        case "call_ended": {
          const ac = activeCallRef.current;
          if (ac && ac.callId === msg.callId) {
            ac.room?.disconnect();
            resetCallState();
            reportCallEnded();
          }
          break;
        }
        case "call_accepted":
          toast.success("Call accepted");
          break;
        case "call_rejected":
          toast.error("Call rejected");
          activeCallRef.current?.room?.disconnect();
          callStartedAtRef.current = null;
          resetCallState();
          break;
        case "call_missed":
          toast.error("Call missed");
          break;
        // Not call signalling, but this provider holds the only app-wide
        // socket, so routing it here means a notification lands on whatever
        // page the recipient is on rather than only on /notifications.
        case "notification":
          if (typeof msg.message === "string") {
            toast(msg.message, {
              icon: <Bell className="w-4 h-4 text-blue-500" />,
            });
            window.dispatchEvent(
              new CustomEvent("ko-lab:notification", { detail: msg }),
            );
          }
          break;
      }
    }

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [session?.user?.id, resetCallState, reportCallEnded]);

  // ── Room cleanup on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      activeCall?.room?.disconnect();
    };
  }, []);

  // ── Connection health ────────────────────────────────────────────────
  // A dropped media connection otherwise looked identical to a call where
  // nobody happens to be talking.
  useEffect(() => {
    const room = activeCall?.room;
    if (!room) return;

    let reconnectToast: string | undefined;

    const onReconnecting = () => {
      reconnectToast = toast.loading("Connection lost — reconnecting…");
    };
    const onReconnected = () => {
      if (reconnectToast) toast.dismiss(reconnectToast);
      reconnectToast = undefined;
      toast.success("Reconnected");
    };
    const onDisconnected = () => {
      if (reconnectToast) toast.dismiss(reconnectToast);
      reconnectToast = undefined;
      // Only act if this is still the current call: a disconnect fired by our
      // own hang-up has already cleared it, and re-reporting would double-toast.
      if (activeCallRef.current?.room !== room) return;
      resetCallState();
      reportCallEnded();
    };

    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      if (reconnectToast) toast.dismiss(reconnectToast);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [activeCall?.room, resetCallState, reportCallEnded]);

  // ── Send via WebSocket helper ────────────────────────────────────────
  const wsSend = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // ── initiateCall ─────────────────────────────────────────────────────
  const initiateCall = useCallback(async (
    type: CallType,
    targetId?: string,
    groupId?: string,
  ) => {
    if (!session?.user?.id) return;
    // One call setup at a time — a second click would build another Room and
    // orphan the first.
    if (busyRef.current) return;
    busyRef.current = true;
    setIsCalling(true);
    setCallStatus("connecting");

    try {
      const res = await fetch("/api/calls/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, targetId, groupId }),
      });

      if (!res.ok) throw new Error("Failed to initiate call");

      const data = await res.json();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {},
        videoCaptureDefaults: {
          resolution: { width: 1280, height: 720 },
          facingMode: "user",
        },
      });

      await room.connect(
        process.env.NEXT_PUBLIC_LIVEKIT_URL!,
        data.token,
      );

      // Publish local tracks. Connecting alone publishes nothing, so without
      // this the call looks connected but transmits silence.
      await publishLocalTracks(room, type !== "AUDIO");
      callStartedAtRef.current = Date.now();

      // Seed the controls from what actually got published — a denied camera
      // must not leave the UI claiming video is on.
      setMuted(room.localParticipant.isMicrophoneEnabled === false);
      setVideoEnabled(room.localParticipant.isCameraEnabled ?? false);

      setActiveCall({
        callId: data.callRoom.id,
        roomName: data.roomName,
        type,
        token: data.token,
        room,
        groupId,
      });
      setCallStatus("connected");

      // Notify via WebSocket
      if (groupId) {
        wsSend({
          type: "call_offer",
          callId: data.callRoom.id,
          roomName: data.roomName,
          groupId,
          // Resolved server-side from the group's membership, so the ring
          // reaches members wherever they are in the app.
          inviteeIds: data.inviteeIds ?? [],
          callerName: session.user.name || session.user.email || "Unknown",
          callType: type,
        });
      } else if (targetId) {
        wsSend({
          type: "call_offer",
          callId: data.callRoom.id,
          roomName: data.roomName,
          targetId,
          callerName: session.user.name || session.user.email || "Unknown",
          callType: type,
        });
      }
    } catch (error) {
      console.error("Initiate call error:", error);
      // Previously this failed in silence: the button un-pressed and nothing
      // else happened, so the user just clicked again.
      toast.error("Couldn't start the call. Please try again.");
      callStartedAtRef.current = null;
      resetCallState();
    } finally {
      busyRef.current = false;
      setIsCalling(false);
    }
  }, [session, wsSend, resetCallState]);

  // ── acceptCall ──────────────────────────────────────────────────────
  const acceptCall = useCallback(async (callId: string, startWithVideo: boolean = true) => {
    if (busyRef.current) return;
    busyRef.current = true;

    // Snapshot the offer before clearing it: the fields below are read after
    // several awaits, by which point the state is gone.
    const offer = incomingCall;

    // Dismiss the modal and stop the ringtone now rather than after the room
    // connects — that handshake plus the mic/camera prompt is seconds long, and
    // a modal that ignores the click reads as broken.
    setIncomingCall(null);
    setCallStatus("connecting");

    try {
      const res = await fetch(`/api/calls/${callId}/accept`, {
        method: "PUT",
      });

      if (!res.ok) throw new Error("Failed to accept call");

      const data = await res.json();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {},
        videoCaptureDefaults: {
          resolution: { width: 1280, height: 720 },
          facingMode: "user",
        },
      });

      await room.connect(
        process.env.NEXT_PUBLIC_LIVEKIT_URL!,
        data.token,
      );

      // Mic is always published; the camera only when joining with video.
      await publishLocalTracks(room, startWithVideo);
      callStartedAtRef.current = Date.now();

      setMuted(room.localParticipant.isMicrophoneEnabled === false);
      setVideoEnabled(room.localParticipant.isCameraEnabled ?? false);

      setActiveCall({
        callId: data.callId,
        roomName: data.roomName,
        type: offer?.type || "VIDEO",
        token: data.token,
        room,
        groupId: offer?.groupId,
      });
      setCallStatus("connected");

      // Notify initiator via WebSocket
      if (offer?.callerId) {
        wsSend({
          type: "call_accepted",
          callId: data.callId,
          roomName: data.roomName,
          token: data.token,
          initiatorId: offer.callerId,
        });
      }
    } catch (error) {
      console.error("Accept call error:", error);
      toast.error("Couldn't join the call. Please try again.");
      callStartedAtRef.current = null;
      resetCallState();
    } finally {
      busyRef.current = false;
    }
  }, [incomingCall, wsSend, resetCallState]);

  // ── rejectCall ──────────────────────────────────────────────────────
  const rejectCall = useCallback(async (callId: string) => {
    const offer = incomingCall;

    // Dismiss first, report to the server after. Awaiting the API before
    // clearing left the modal up — ringtone still playing — for the length of a
    // round-trip, which is exactly the lag users noticed on Dismiss.
    setIncomingCall(null);

    if (offer) {
      wsSend({
        type: "call_rejected",
        callId,
        initiatorId: offer.callerId,
        reason: "rejected",
      });
    }

    try {
      await fetch(`/api/calls/${callId}/reject`, { method: "PUT" });
    } catch (error) {
      // The caller has already been told over the socket, so a failed
      // bookkeeping request is not worth interrupting the user for.
      console.error("Reject call error:", error);
    }
  }, [incomingCall, wsSend]);

  // ── endCall ─────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    const call = activeCall;
    if (!call) {
      // Cancelled while still connecting: there's no room or callId to report
      // yet, so just release the UI rather than stranding the user on the
      // connecting screen.
      if (callStatus === "connecting") {
        callStartedAtRef.current = null;
        resetCallState();
      }
      return;
    }

    // Tear the UI down immediately. The LiveKit disconnect handshake and the
    // /end request together took long enough that the panel visibly hung on
    // after the click; neither can fail in a way the user could act on, so both
    // run behind the closed UI. Nothing sets isEnding here on purpose — the
    // panel is gone within the same render, so there is no button left to
    // put in a pending state.
    wsSend({
      type: "call_ended",
      callId: call.callId,
      ...(call.groupId ? { groupId: call.groupId } : {}),
    });
    resetCallState();
    reportCallEnded();

    try {
      call.room?.disconnect();
      await fetch(`/api/calls/${call.callId}/end`, { method: "PUT" });
    } catch (error) {
      console.error("End call error:", error);
    }
  }, [activeCall, callStatus, wsSend, reportCallEnded, resetCallState]);

  // ── Device toggles ──────────────────────────────────────────────────
  // Optimistic: flip the icon now, ask the device after, and roll back only if
  // it refuses. Awaiting LiveKit first made every tap feel sticky.
  const toggleMute = useCallback(() => {
    const local = activeCallRef.current?.room?.localParticipant;
    if (!local) return;
    const next = !muted;
    setMuted(next);
    local.setMicrophoneEnabled(!next).catch((err) => {
      console.error("Microphone toggle failed:", err);
      toast.error("Couldn't change your microphone.");
      setMuted(!next);
    });
  }, [muted]);

  const toggleVideo = useCallback(() => {
    const local = activeCallRef.current?.room?.localParticipant;
    if (!local) return;
    const next = !videoEnabled;
    setVideoEnabled(next);
    local.setCameraEnabled(next).catch((err) => {
      console.error("Camera toggle failed:", err);
      toast.error("Couldn't access your camera.");
      setVideoEnabled(!next);
    });
  }, [videoEnabled]);

  const joinGroup = useCallback((groupId: string) => {
    currentGroupRef.current = groupId;
    wsSend({ type: "join_group", groupId });
  }, [wsSend]);

  const leaveGroup = useCallback(() => {
    const gId = currentGroupRef.current;
    currentGroupRef.current = null;
    if (gId) {
      wsSend({ type: "leave_group", groupId: gId });
    }
  }, [wsSend]);

  return (
    <CallContext.Provider value={{
      incomingCall,
      activeCall,
      initiateCall,
      acceptCall,
      rejectCall,
      endCall,
      setIncomingCall,
      setActiveCall,
      isCalling,
      callStatus,
      muted,
      videoEnabled,
      toggleMute,
      toggleVideo,
      joinGroup,
      leaveGroup,
    }}>
      {children}
    </CallContext.Provider>
  );
}
