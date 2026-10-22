"use client";

import { PhoneOff, Mic, MicOff, Video, VideoOff, MonitorUp, Users } from "lucide-react";

interface CallControlsProps {
  muted: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  participantListOpen: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleParticipantList: () => void;
  onEndCall: () => void;
  /** "Leave Call" for a group call, which carries on without you. */
  endLabel?: string;
}

export default function CallControls({
  muted,
  videoEnabled,
  screenSharing,
  participantListOpen,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onToggleParticipantList,
  onEndCall,
  endLabel = "End Call",
}: CallControlsProps) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-3">
      <ControlButton
        active={!muted}
        icon={muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        label={muted ? "Unmute" : "Mute"}
        variant={muted ? "destructive" : "default"}
        onClick={onToggleMute}
      />
      <ControlButton
        active={videoEnabled}
        icon={videoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        label={videoEnabled ? "Video On" : "Video Off"}
        variant={videoEnabled ? "default" : "destructive"}
        onClick={onToggleVideo}
      />
      <ControlButton
        active={screenSharing}
        icon={<MonitorUp className="h-5 w-5" />}
        label={screenSharing ? "Stop Share" : "Share Screen"}
        variant={screenSharing ? "active" : "default"}
        onClick={onToggleScreenShare}
      />
      <ControlButton
        active={participantListOpen}
        icon={<Users className="h-5 w-5" />}
        label="Participants"
        variant={participantListOpen ? "active" : "default"}
        onClick={onToggleParticipantList}
      />
      <button
        onClick={onEndCall}
        className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-white shadow-lg transition hover:bg-red-700"
      >
        <PhoneOff className="h-5 w-5" />
        <span className="text-sm font-medium">{endLabel}</span>
      </button>
    </div>
  );
}

interface ControlButtonProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  variant: "default" | "destructive" | "active";
  onClick: () => void;
}

function ControlButton({ icon, label, variant, onClick }: ControlButtonProps) {
  const bg =
    variant === "destructive"
      ? "bg-red-500 hover:bg-red-600"
      : variant === "active"
        ? "bg-green-500 hover:bg-green-600"
        : "bg-gray-700 hover:bg-gray-600";

  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center rounded-full p-3 text-white transition ${bg}`}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}
