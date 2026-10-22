"use client";

import { useState, useCallback, useEffect } from "react";
import { Track, RoomEvent } from "livekit-client";
import { useCall } from "./CallProvider";
import { useScreenShare } from "./hooks/useScreenShare";
import VideoGrid from "./VideoGrid";
import CallControls from "./CallControls";
import ParticipantList from "./ParticipantList";
import ScreenShareView from "./ScreenShareView";
import { X } from "lucide-react";

interface CallPanelProps {
  onMinimize: () => void;
}

export default function CallPanel({ onMinimize }: CallPanelProps) {
  // Mic/camera state is owned by CallProvider so this panel and the minimised
  // bar can never disagree about whether you're muted.
  const { activeCall, endCall, muted, videoEnabled, toggleMute, toggleVideo } = useCall();

  const [participantListOpen, setParticipantListOpen] = useState(false);
  const [screenShareOpen, setScreenShareOpen] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);

  const room = activeCall?.room ?? null;
  const { isSharing, startScreenShare, stopScreenShare } = useScreenShare(room);

  useEffect(() => {
    if (!room) return;
    const update = () => setParticipants([...room.remoteParticipants.values()]);
    update(); // populate with already-connected participants
    // Track events matter as much as join/leave: someone who joins with their
    // camera off and enables it later publishes a track without any
    // participantConnected firing, so their video would never appear.
    const events = [
      "participantConnected",
      "participantDisconnected",
      "trackPublished",
      "trackUnpublished",
      "trackSubscribed",
      "trackUnsubscribed",
      "trackMuted",
      "trackUnmuted",
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events.forEach((e) => room.on(e as any, update));
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events.forEach((e) => room.off(e as any, update));
    };
  }, [room]);

  // Auto-open the screen-share view when anyone (local or remote) starts
  // sharing, and close it when the share ends.
  useEffect(() => {
    if (!room) return;
    const hasActiveShare = () => {
      const parts = [room.localParticipant, ...room.remoteParticipants.values()];
      return parts.some((p) =>
        [...p.trackPublications.values()].some(
          (pub) => pub.source === Track.Source.ScreenShare,
        ),
      );
    };
    const sync = () => setScreenShareOpen(hasActiveShare());
    sync();
    room.on(RoomEvent.TrackSubscribed, sync);
    room.on(RoomEvent.TrackUnsubscribed, sync);
    room.on(RoomEvent.LocalTrackPublished, sync);
    room.on(RoomEvent.LocalTrackUnpublished, sync);
    return () => {
      room.off(RoomEvent.TrackSubscribed, sync);
      room.off(RoomEvent.TrackUnsubscribed, sync);
      room.off(RoomEvent.LocalTrackPublished, sync);
      room.off(RoomEvent.LocalTrackUnpublished, sync);
    };
  }, [room]);

  const handleToggleScreenShare = useCallback(() => {
    if (isSharing) {
      stopScreenShare();
      setScreenShareOpen(false);
    } else {
      startScreenShare();
      setScreenShareOpen(true);
    }
  }, [isSharing, startScreenShare, stopScreenShare]);

  if (!activeCall) return null;

  // ── Unified call UI (always shown; camera off just shows avatars) ────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between bg-gray-800 px-4 py-2">
        <span className="text-sm font-medium text-white">
          {activeCall.type === "VIDEO"
            ? "Video Call"
            : activeCall.type === "AUDIO"
              ? "Audio Call"
              : "Group Call"}
        </span>
        <button
          onClick={onMinimize}
          className="rounded-full p-1 text-gray-400 transition hover:bg-gray-700 hover:text-white"
          title="Minimize"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Screen Share Overlay */}
      {screenShareOpen && room && (
        <ScreenShareView room={room} onClose={() => setScreenShareOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <VideoGrid
            participants={participants}
            localParticipant={room?.localParticipant ?? null}
          />
        </div>

        {participantListOpen && (
          <div className="w-64 flex-shrink-0">
            <ParticipantList
              participants={participants}
              localParticipant={room?.localParticipant ?? null}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="border-t border-gray-700 bg-gray-800">
        <CallControls
          muted={muted}
          videoEnabled={videoEnabled}
          screenSharing={isSharing}
          participantListOpen={participantListOpen}
          onToggleMute={toggleMute}
          onToggleVideo={toggleVideo}
          onToggleScreenShare={handleToggleScreenShare}
          onToggleParticipantList={() => setParticipantListOpen((p) => !p)}
          onEndCall={endCall}
          endLabel={activeCall.groupId ? "Leave Call" : "End Call"}
        />
      </div>
    </div>
  );
}
