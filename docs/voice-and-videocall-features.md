# Voice & Video Call Architecture

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Architecture Overview](#2-architecture-overview)
3. [Network Topology](#3-network-topology)
4. [Data Flow](#4-data-flow)
5. [Database Schema Changes](#5-database-schema-changes)
6. [API Routes](#6-api-routes)
7. [WebSocket Message Types](#7-websocket-message-types)
8. [Frontend Component Tree](#8-frontend-component-tree)
9. [Recording Architecture](#9-recording-architecture)
10. [Infrastructure & Deployment](#10-infrastructure--deployment)
11. [Push Notification Flow](#11-push-notification-flow)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Cost Breakdown](#13-cost-breakdown)
14. [Performance & Scale Considerations](#14-performance--scale-considerations)

---

## 1. Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **SFU Server** | [LiveKit Server](https://github.com/livekit/livekit) (open-source, self-hosted) | SFU architecture scales to 1000+ concurrent participants; simulcast + SVC for adaptive quality |
| **Client SDK** | `@livekit/components-react` + `livekit-client` | First-class React support, hooks for room/participant/track management |
| **Recording** | LiveKit Egress API + FFmpeg | Server-side recording at independent resolution; stores to S3/MinIO |
| **TURN/STUN** | Built into LiveKit ICE (coturn optional fallback) | Handles NAT traversal for peer-to-peer fallback |
| **Storage** | MinIO (self-hosted S3-compatible) | Stores call recordings at 1080p+ |
| **Call Signaling** | Existing WS server (`apps/web-socket`) | Extend for call offers/accepts/rejects/hangup |
| **Push Notifications** | Existing Web Notifications API + WebSocket | Ring incoming calls |
| **Codec** | VP9 (preferred) / H.264 fallback | VP9 gives 50% better quality at same bitrate; H.264 for legacy compat |
| **Containers** | Docker Compose | LiveKit server + Redis + MinIO |

### Why LiveKit Over Other Options?

| Factor | LiveKit | Mediasoup | Daily (managed) |
|---|---|---|---|
| Self-hosted | Yes (AGPL) | Yes (MIT) | No |
| React SDK | First-class | Community wrappers | Good |
| Simulcast/SVC | Built-in | Manual config | Built-in |
| Recording API | Native Egress | Manual FFmpeg | Built-in (paid) |
| Docs & Community | Excellent | Good | Excellent |
| Scale (single node) | 1000+ participants | 500+ participants | Managed |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Next.js App                                                │   │
│  │  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  │   │
│  │  │ Call UI       │  │ LiveKit Room     │  │ WS Client    │  │   │
│  │  │ (React comps) │──│ (livekit-client) │  │ (call signal) │  │   │
│  │  └──────────────┘  └────────┬─────────┘  └──────┬───────┘  │   │
│  └──────────────────────────────┼───────────────────┼──────────┘   │
└─────────────────────────────────┼───────────────────┼──────────────┘
                                  │                   │
                    ┌─────────────▼─────┐     ┌──────▼────────┐
                    │  LiveKit Server   │     │  WebSocket    │
                    │  (SFU, port 7880) │     │  Server       │
                    │                   │     │  (port 8080)  │
                    │  - Media routing  │     │              │
                    │  - Simulcast/SVC  │     │  - Call       │
                    │  - Recording      │     │    signaling  │
                    │  - Webhooks       │     │  - Presence   │
                    └────────┬──────────┘     └──────────────┘
                             │
                    ┌────────▼────────┐
                    │  LiveKit Webhook│
                    │  (to Next.js    │
                    │   API)          │
                    └─────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         Server Side                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────┐ │
│  │  Next.js API │  │  PostgreSQL  │  │  Redis       │  │ MinIO  │ │
│  │  Routes      │  │  (Prisma)    │  │  (LiveKit    │  │(Record)│ │
│  │              │  │              │  │   state)     │  │        │ │
│  │  - Token gen │  │  - CallRoom  │  └──────────────┘  └────────┘ │
│  │  - Webhooks  │  │  - Recording │                                   │
│  └──────────────┘  └──────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Service Ports

| Service | Port | Notes |
|---|---|---|
| Next.js (web) | 3000 | Application server |
| WebSocket Server | 8080 | Call signaling, chat |
| LiveKit (HTTP) | 7880 | REST API + token generation |
| LiveKit (WS) | 7881 | Media (UDP also used) |
| LiveKit (UDP) | 50000-60000 | Media relay ports |
| MinIO Console | 9001 | Recording storage |
| MinIO API | 9000 | S3-compatible API |
| Redis | 6379 | LiveKit state store |

---

## 3. Network Topology

```
                    ┌─────────────────────┐
                    │     Internet        │
                    └──────┬──────────────┘
                           │
              ┌────────────┴─────────────┐
              │                          │
     ┌────────▼────────┐       ┌────────▼────────┐
     │  Client A       │       │  Client B       │
     │  (behind NAT)   │       │  (open IP)      │
     └────────┬────────┘       └────────┬────────┘
              │                          │
              │   WebRTC (VP9/H.264)     │
              │◄────────────────────────►│  P2P candidate
              │                          │
              │                          │
              └──────────┬───────────────┘
                         │
              ┌──────────▼───────────┐
              │   LiveKit SFU        │
              │   (cloud VPS)        │
              │                      │
              │   - Packet routing   │
              │   - Simulcast layers │
              │   - Recording        │
              │   - TURN relay       │
              └──────────────────────┘
```

For **group calls**, all media goes through LiveKit SFU (star topology — no mesh). Each client sends one stream, SFU selectively forwards to others. This is why LiveKit scales: send once, relay N times server-side.

---

## 4. Data Flow

### 4.1 Initiating a 1-on-1 Call

```
User A clicks "Call" button in DM chat

  A's Browser                    Next.js API           LiveKit Server           WS Server           B's Browser
      │                              │                      │                    │                    │
      │  POST /api/calls/initiate    │                      │                    │                    │
      │ ──────────────────────────►  │                      │                    │                    │
      │                              │  1. Create CallRoom  │                    │                    │
      │                              │     in DB (status:   │                    │                    │
      │                              │     "ringing")       │                    │                    │
      │                              │                      │                    │                    │
      │                              │  2. Generate LiveKit │                    │                    │
      │                              │     room + token     │                    │                    │
      │                              │  ──────────────────► │                    │                    │
      │                              │  ◄────── token ──────│                    │                    │
      │                              │                      │                    │                    │
      │  ◄── { room, token } ────────│                      │                    │                    │
      │                              │                      │                    │                    │
      │  3. Join LiveKit room        │                      │                    │                    │
      │  ───────────────────────────────────────────────►   │                    │                    │
      │                              │                      │                    │                    │
      │  4. Send call_offer via WS   │                      │                    │                    │
      │  ───────────────────────────────────────────────────────────────────────►│                    │
      │                              │                      │                    │  ┌─────────────────│
      │                              │                      │                    │  │ Show incoming   │
      │                              │                      │                    │  │ call UI + push  │
      │                              │                      │                    │  │ notification    │
      │                              │                      │                    │  └─────────────────│
      │                              │                      │                    │                    │
      │                              │                      │                    │                    │
      │                              │  B accepts                           │                    │
      │                              │  ◄─────────────────────────────────────────────────────────────│
      │                              │                      │                    │                    │
      │                              │  5. PUT /api/calls/  │                    │                    │
      │                              │     :id/accept       │                    │                    │
      │                              │  ◄─────────────────────────────────────────────────────────────│
      │                              │                      │                    │                    │
      │                              │  6. Generate B's     │                    │                    │
      │                              │     LiveKit token    │                    │                    │
      │                              │  ──────────────────► │                    │                    │
      │                              │  ◄────── token ──────│                    │                    │
      │                              │                      │                    │                    │
      │                              │  7. Send call_accepted via WS            │                    │
      │  ◄───────────────────────────────────────────────────────────────────────│                    │
      │                              │                      │                    │                    │
      │                              │                      │  B joins room      │                    │
      │                              │                      │ ◄───────────────────────────────────────│
      │                              │                      │                    │                    │
      │  ◄────── Media flowing (LiveKit handles) ─────────► │ ◄────── Media ────│                    │
  ```

### 4.2 Group Call Flow

```
User A clicks "Start Call" in group chat

  1. POST /api/calls/initiate { groupId, type: "group" }
  2. Creates CallRoom with all group members as participants
  3. Generates single LiveKit room + distinct tokens per participant
  4. WS broadcasts `call_started` to all online group members
  5. Each member receives push notification if offline
  6. Members join LiveKit room with their token
  7. LiveKit handles fan-out: each member's video/audio selectively forwarded
```

### 4.3 Screen Sharing

```
  1. User clicks "Share Screen" in-call
  2. livekit-client: createScreenShareTrack()
  3. LiveKit SFU treats screen share as a second video track
  4. Other participants receive it as a separate track
  5. Toggle in UI: switch between camera view and screen share

  For code editor sharing:
  - Option A: Share entire screen (standard WebRTC)
  - Option B: Share specific app window
  - Option C: Future: direct CodeMirror frame capture
```

---

## 5. Database Schema Changes

Add to `apps/web/prisma/schema.prisma`:

```prisma
// === CALL MODELS ===

enum CallStatus {
  RINGING
  ONGOING
  ENDED
  MISSED
  REJECTED
}

enum CallType {
  AUDIO
  VIDEO
  GROUP
}

model CallRoom {
  id              String          @id @default(cuid())
  livekitRoom     String          @unique
  type            CallType
  status          CallStatus      @default(RINGING)
  groupId         String?         // null for 1-on-1
  initiatorId     String
  startedAt       DateTime        @default(now())
  endedAt         DateTime?

  participants    CallParticipant[]
  recordings      CallRecording[]
  initiator       User            @relation(fields: [initiatorId], references: [id])

  @@index([status])
  @@index([groupId])
  @@index([livekitRoom])
}

model CallParticipant {
  id              String          @id @default(cuid())
  callId          String
  userId          String
  joinedAt        DateTime?
  leftAt          DateTime?
  isScreenSharing Boolean         @default(false)
  isMuted         Boolean         @default(false)
  isVideoOff      Boolean         @default(false)

  call            CallRoom        @relation(fields: [callId], references: [id], onDelete: Cascade)
  user            User            @relation(fields: [userId], references: [id])

  @@unique([callId, userId])
  @@index([userId])
}

model CallRecording {
  id              String          @id @default(cuid())
  callId          String
  startedAt       DateTime        @default(now())
  endedAt         DateTime?
  filePath        String?         // S3/MinIO path
  fileSize        Int?            // bytes
  durationMs      Int?            // milliseconds
  resolution      String          @default("1080p")
  status          RecordingStatus @default(RECORDING)
  initiatedById   String

  call            CallRoom        @relation(fields: [callId], references: [id], onDelete: Cascade)
  initiatedBy     User            @relation(fields: [initiatedById], references: [id])

  @@index([callId])
}

enum RecordingStatus {
  RECORDING
  COMPLETED
  FAILED
}

// Push subscription for call notifications (separate from existing Notifications model)
model PushSubscription {
  id              String          @id @default(cuid())
  userId          String
  endpoint        String
  p256dh          String
  auth            String
  createdAt       DateTime        @default(now())

  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, endpoint])
}
```

---

## 6. API Routes

Create these routes in `apps/web/app/api/calls/`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/calls/initiate` | POST | Create call room, generate LiveKit room + initiator token |
| `/api/calls/[id]/accept` | PUT | Accept call, generate caller's token |
| `/api/calls/[id]/reject` | PUT | Reject incoming call |
| `/api/calls/[id]/end` | PUT | End call for all participants |
| `/api/calls/[id]/participants` | GET | Get current participants + statuses |
| `/api/calls/[id]/token` | POST | Generate LiveKit token for rejoin |
| `/api/calls/livekit-webhook` | POST | Webhook receiver (participant join/leave, room ended) |
| `/api/calls/recordings` | GET | List user's recordings |
| `/api/calls/recordings/[id]` | GET | Get recording details |
| `/api/calls/recordings/[id]/start` | POST | Start recording a call |
| `/api/calls/recordings/[id]/stop` | POST | Stop recording |
| `/api/calls/push-subscribe` | POST | Save push subscription |
| `/api/calls/push-unsubscribe` | POST | Remove push subscription |
| `/api/calls/history` | GET | Get user's call history |

### Token Generation (Key Security Piece)

```typescript
// apps/web/app/api/calls/token/route.ts
import { AccessToken } from "livekit-server-sdk";

export async function createLiveKitToken(
  identity: string,
  roomName: string,
  canPublish: boolean = true,
): Promise<string> {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity, ttl: "10m" },
  );

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
  });

  return at.toJwt();
}
```

---

## 7. WebSocket Message Types

Extend the existing WebSocket server in `apps/web-socket/src/index.ts` with these message types:

### Call Signaling Messages

| Type | Direction | Payload | Description |
|---|---|---|---|
| `call_offer` | A → WS → B | `{ callId, roomName, callerId, callerName, type }` | Incoming call notification |
| `call_accepted` | B → WS → A | `{ callId, roomName, token, participantId }` | Other party accepted |
| `call_rejected` | B → WS → A | `{ callId, reason }` | Other party rejected/busy |
| `call_ended` | WS → all | `{ callId, endedBy }` | Call ended (hangup) |
| `call_missed` | WS → A | `{ callId, targetId }` | Other party didn't answer |
| `call_participant_joined` | WS → all | `{ callId, userId, userName }` | Someone joined (group) |
| `call_participant_left` | WS → all | `{ callId, userId, userName }` | Someone left (group) |
| `call_mute_changed` | WS → all | `{ callId, userId, isMuted }` | Mute status change |
| `call_video_toggle` | WS → all | `{ callId, userId, isVideoOff }` | Video toggle |
| `call_screen_share` | WS → all | `{ callId, userId, isSharing }` | Screen share started/stopped |
| `call_raise_hand` | WS → all | `{ callId, userId, userName }` | Hand raised |

### WebSocket Server Code Addition

```typescript
// In the message handler switch
if (parsedMessage.type.startsWith("call_")) {
  handleCallSignal(ws, parsedMessage, userId);
  return;
}

function handleCallSignal(ws: WebSocket, msg: any, userId: string) {
  switch (msg.type) {
    case "call_offer":
    case "call_accepted":
    case "call_rejected":
    case "call_ended": {
      // Route to specific recipient
      const targetWs = individualClients.get(msg.targetId);
      if (targetWs?.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({ ...msg, senderId: userId }));
      }
      break;
    }
    case "call_mute_changed":
    case "call_video_toggle":
    case "call_screen_share":
    case "call_raise_hand": {
      // Broadcast to all group call participants
      if (msg.groupId) {
        const members = groupClients.get(msg.groupId);
        if (members) {
          const outbound = JSON.stringify({ ...msg, senderId: userId });
          for (const [mid, mws] of members) {
            if (mid !== userId && mws.readyState === WebSocket.OPEN) {
              mws.send(outbound);
            }
          }
        }
      }
      break;
    }
  }
}
```

---

## 8. Frontend Component Tree

```
app/
├── components/
│   ├── call/
│   │   ├── CallProvider.tsx            # Context provider wrapping the app
│   │   │   • Manages active call state
│   │   │   • LiveKit room connection
│   │   │   • Incoming call handler
│   │   │
│   │   ├── IncomingCallModal.tsx       # Overlay when someone calls
│   │   │   • Shows caller name, avatar
│   │   │   • Accept (audio/video) / Reject buttons
│   │   │   • Ringtone + vibration
│   │   │
│   │   ├── ActiveCallBar.tsx           # Persistent bar when in call
│   │   │   • PiP mode indicator
│   │   │   • Call duration timer
│   │   │   • Quick mute/video toggle
│   │   │   • Expand / End call buttons
│   │   │
│   │   ├── CallPanel.tsx              # Full call UI (modal / page)
│   │   │   ├── VideoGrid.tsx          # Grid of participant videos
│   │   │   │   • Auto-layout (1:1, 2x2, 3x3 based on count)
│   │   │   │   • Active speaker highlight
│   │   │   │   • Pin participant
│   │   │   │
│   │   │   ├── VideoTile.tsx          # Single participant video
│   │   │   │   • Avatar fallback when video off
│   │   │   │   • Name label + mute indicator
│   │   │   │   • Speaking indicator
│   │   │   │
│   │   │   ├── ScreenShareView.tsx    # Full-screen screen share
│   │   │   │
│   │   │   ├── CallControls.tsx       # Bottom control bar
│   │   │   │   • Mute/Unmute mic
│   │   │   │   • Video on/off toggle
│   │   │   │   • Screen share button
│   │   │   │   • Raise hand button
│   │   │   │   • Participant list toggle
│   │   │   │   • Chat toggle (in-call text chat)
│   │   │   │   • Record button
│   │   │   │   • End call (red) button
│   │   │   │
│   │   │   ├── ParticipantList.tsx     # Slide-out panel
│   │   │   │   • List with mute/video status
│   │   │   │   • Raised hands
│   │   │   │
│   │   │   └── InCallChat.tsx         # Side panel text chat
│   │   │       • Messages sent during call
│   │   │
│   │   ├── CallHistory.tsx            # Past calls list
│   │   │   • Date, duration, participants
│   │   │   • Recording playback links
│   │   │
│   │   └── hooks/
│   │       ├── useCall.ts             # Core call logic hook
│   │       ├── useLiveKitRoom.ts      # LiveKit connection lifecycle
│   │       ├── useScreenShare.ts      # Screen share management
│   │       ├── useCallNotifications.ts# Incoming call detection
│   │       └── useCallRecording.ts    # Recording start/stop
│   │
│   ├── Group-Chat.tsx                 # Add call button to group chat header
│   └── Chats.tsx                      # Add call button to 1-on-1 chat header
```

### Key Component: LiveKit Room Connection Hook

```typescript
// components/call/hooks/useLiveKitRoom.ts
import { useEffect, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

export function useLiveKitRoom(token: string | null, roomName: string | null) {
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !roomName) return;

    const r = new Room({
      adaptiveStream: true,     // saves bandwidth
      dynacast: true,           // enables simulcast
      videoCaptureDefaults: {
        resolution: { width: 1280, height: 720 },
        facingMode: "user",
      },
    });

    r.on(RoomEvent.ParticipantConnected, (p) => {
      setParticipants([...r.remoteParticipants.values()]);
    });
    r.on(RoomEvent.ParticipantDisconnected, () => {
      setParticipants([...r.remoteParticipants.values()]);
    });
    r.on(RoomEvent.TrackSubscribed, (track) => {
      track.attach();
    });
    r.on(RoomEvent.Disconnected, () => setRoom(null));
    r.on(RoomEvent.MediaDevicesError, (e) => setError(e.message));

    r.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token)
      .then(() => {
        setRoom(r);
        setParticipants([...r.remoteParticipants.values()]);
      })
      .catch(setError);

    return () => {
      r.disconnect();
    };
  }, [token, roomName]);

  return { room, participants, error };
}
```

---

## 9. Recording Architecture

### Goal
Record at **1080p+ resolution** regardless of the caller's send quality.

### How LiveKit Egress Works

LiveKit Egress spawns a headless browser (Chromium) that joins the room as a "bot" participant and renders the composition at your specified resolution. This means:

- **Recording resolution is independent** of participant send quality
- Uses simulcast: the egress bot subscribes to the highest available layer
- Can composite multiple participants into one video or record individual tracks

### Components

```
LiveKit Server
     │
     ├── Room Composite Egress ──► FFmpeg ──► MP4 ──► MinIO/S3
     │     • All participants in one video
     │     • Configurable layout (grid, spotlight, etc.)
     │     • 1080p @ 30fps, CRF 18 (high quality)
     │
     └── Track Egress (optional) ──► FFmpeg ──► MP4 ──► MinIO/S3
           • Individual participant recordings
           • Screen share separate from camera
```

### Recording Flow

```
User clicks "Record" in call UI

  1. POST /api/calls/recordings/:id/start
  2. Next.js API creates CallRecording in DB
  3. API calls LiveKit Egress API to start RoomCompositeEgress
  4. LiveKit launches headless Chrome, joins as bot
  5. Bot renders at 1920x1080, encodes with H.264/AVC (CRF 18)
  6. Output segments uploaded to MinIO during recording
  7. User clicks "Stop" → POST endpoint → LiveKit stops egress
  8. Final MP4 assembled in MinIO
  9. DB updated with filePath, duration, size
```

### Egress API Call

```typescript
// server-side: start recording
const response = await fetch(`${LIVEKIT_HOST}/twirp/livekit.Egress/CreateRoomCompositeEgress`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${livekitServerToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    room_name: roomName,
    layout: "grid",
    video_only: false,
    output: {
      file: {
        filepath: `recordings/${callId}/${Date.now()}.mp4`,
        s3: {
          access_key: MINIO_ACCESS_KEY,
          secret: MINIO_SECRET_KEY,
          endpoint: MINIO_ENDPOINT,
          bucket: "call-recordings",
          region: "us-east-1",
        },
      },
    },
    options: {
      // Force 1080p recording regardless of source quality
      video_codec: "H264_MAIN",
      width: 1920,
      height: 1080,
      depth: 24,
      framerate: 30,
      // CRF-like quality control
      bitrate: 8000000, // 8 Mbps for 1080p
    },
  }),
});
```

### Storage Structure in MinIO

```
call-recordings/
├── recordings/
│   ├── <callId>/
│   │   ├── 1688000000000.mp4        # Main composite recording
│   │   └── 1688000000000_metadata.json
│   └── ...
└── thumbnails/
    └── ...
```

---

## 10. Infrastructure & Deployment

### Docker Compose (`docker-compose.livekit.yml`)

```yaml
version: "3.8"

services:
  livekit-server:
    image: livekit/livekit-server:latest
    restart: unless-stopped
    ports:
      - "7880:7880"   # HTTP
      - "7881:7881"   # WebSocket
      - "50000-60000:50000-60000/udp"  # Media
    environment:
      LIVEKIT_KEYS: "${LIVEKIT_API_KEY}:${LIVEKIT_API_SECRET}"
      LIVEKIT_ADDRESS: "0.0.0.0"
      LIVEKIT_PORT: 7880
      LIVEKIT_RTC_PORT_RANGE: "50000-60000"
      LIVEKIT_REDIS_ADDRESS: "redis:6379"
      LIVEKIT_TURN_ENABLED: "true"
      LIVEKIT_TURN_DOMAIN: "${TURN_DOMAIN}"
      LIVEKIT_TURN_TLS: "false"
    volumes:
      - livekit_data:/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    expose:
      - "6379"

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: "${MINIO_ACCESS_KEY}"
      MINIO_ROOT_PASSWORD: "${MINIO_SECRET_KEY}"
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

  # Optional: coturn for TURN relay fallback
  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    ports:
      - "3478:3478"
      - "3478:3478/udp"
    command: >
      -n --realm=${TURN_DOMAIN}
      --listening-port=3478
      --min-port=50000 --max-port=60000
      --user=${TURN_USER}:${TURN_PASS}
      --fingerprint --lt-cred-mech
      --no-cli --no-tlsv1 --no-dtlsv1

volumes:
  livekit_data:
  minio_data:
```

### Environment Variables

Add to `.env`:

```bash
# LiveKit
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
LIVEKIT_HOST=http://localhost:7880
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880

# MinIO (recording storage)
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_ENDPOINT=http://localhost:9000
MINIO_BUCKET=call-recordings

# TURN (for NAT traversal)
TURN_DOMAIN=yourdomain.com
TURN_USER=ko-lab-turn
TURN_PASS=turn-secret-password
```

### Production Deployment (single VPS)

```
1 VPS (4 vCPU, 8 GB RAM, 100 GB SSD)
├── LiveKit Server
├── Redis (container)
├── MinIO (container, recording storage)
├── WebSocket Server (existing)
└── Next.js (existing)

For 100-1000 concurrent:
- Scale LiveKit horizontally behind a load balancer
- Separate MinIO to dedicated storage
- Add more VPS nodes for LiveKit
- Use shared Redis cluster
```

**Minimum VPS Specs for Self-Hosted LiveKit:**

| Concurrent Calls | CPU | RAM | Bandwidth |
|---|---|---|---|
| 10-20 | 2 vCPU | 4 GB | 100 Mbps |
| 50-100 | 4 vCPU | 8 GB | 500 Mbps |
| 200-500 | 8 vCPU | 16 GB | 1 Gbps |
| 500-1000 | 16 vCPU | 32 GB | 2 Gbps+ |

---

## 11. Push Notification Flow

### Web Push (for incoming calls when user is on another tab/away)

```
1. User opts in → browser gives PushSubscription { endpoint, p256dh, auth }
2. POST /api/calls/push-subscribe → saves to PushSubscription table
3. When call initiated:
   a. Check WebSocket: is target user connected?
   b. If NOT connected (or no answer after 10s):
      - Server sends Web Push via VAPID
      - Uses existing Web Notifications API + Service Worker
4. Clicking notification: navigates to chat with call UI
```

### VAPID Setup (free, no third-party)

```typescript
// Using web-push (npm install web-push)
import webpush from "web-push";

webpush.setVapidDetails(
  "mailto:your@email.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

export async function sendCallPushNotification(
  subscription: PushSubscription,
  callerName: string,
  callId: string,
) {
  await webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: `Incoming Call from ${callerName}`,
      body: "Tap to answer",
      icon: "/logo.png",
      tag: `call-${callId}`,
      data: { callId, url: `/chat/${callId}` },
    }),
  );
}
```

---

## 12. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [x] Deploy LiveKit server + Redis + MinIO via Docker Compose
- [x] Add Prisma models (`CallRoom`, `CallParticipant`, `CallRecording`)
- [x] Run `prisma migrate dev`
- [x] Create API routes: token generation, room management
- [x] Create `CallProvider` context with LiveKit SDK setup
- [x] Add env vars for LiveKit URLs

**Testing**
- [x] Verify LiveKit server health endpoint (`/api/calls/health`) returns 200
- [x] Unit test token generation API: valid/invalid room names, expired tokens
- [x] Unit test room creation API: duplicate rooms, missing fields
- [x] Verify `CallRoom`, `CallParticipant`, `CallRecording` Prisma models via `prisma db push --force-reset` + seed script
- [x] Integration test `CallProvider` renders without error in a test component
- [x] Docker Compose smoke test: all three services (LiveKit, Redis, MinIO) report healthy
- [x] Write API route tests with vitest: `POST /api/calls/token`, `POST /api/calls/initiate`, `PUT /api/calls/[id]/accept`, `PUT /api/calls/[id]/reject`, `PUT /api/calls/[id]/end`, `POST /api/calls/livekit-webhook`, `POST /api/calls/push-subscribe`
- [x] Verify env vars are validated on startup (missing `LIVEKIT_URL` throws clear error)

#### How to Run Phase 1 Tests

```bash
# From apps/web/
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report

# Specific test files
npx vitest run __tests__/api/calls/token.test.ts
npx vitest run __tests__/api/calls/initiate.test.ts
npx vitest run __tests__/api/calls/accept.test.ts
npx vitest run __tests__/api/calls/livekit-lib.test.ts
npx vitest run __tests__/components/CallProvider.test.tsx

# Docker Compose smoke test (from project root):
bash scripts/smoke-test-livekit.sh

# Prisma model seed verification:
npm run test:seed     # Requires DATABASE_URL in .env pointing to running DB
```

### Phase 2 & 3 Testing

**Automated Tests**

```bash
# From apps/web/
npm run test -- --reporter=verbose  # Run all tests including Phase 2/3

# Specific test files
npx vitest run __tests__/components/CallUI.test.tsx
npx vitest run __tests__/components/CallComponents.test.tsx
npx vitest run __tests__/components/CallSignaling.test.ts
```

| Test File | Tests | What It Covers |
|---|---|---|
| `__tests__/components/CallUI.test.tsx` | 7 | Incoming call modal rendering, accept/reject buttons, active call bar, expand/minimize, end call flow |
| `__tests__/components/CallComponents.test.tsx` | 14 | IncomingCallModal null state, ActiveCallBar null state, CallControls all variants and callbacks, VideoTile rendering with/without video, VideoGrid empty state, ParticipantList rendering, speaking/mute indicators |
| `__tests__/components/CallSignaling.test.ts` | 8 | WS message construction (offer/accepted/rejected/ended/missed), initiateCall flow, acceptCall flow, rejectCall flow, endCall flow |
| **Phase 2/3 Total** | **29** | |

**Manual Test Steps — 1-on-1 Audio/Video Call**

Prerequisites:
- Two browser windows logged in as different users (e.g., User A and User B)
- Both users must be friends
- LiveKit server, Redis, MinIO running (`docker-compose -f docker-compose.livekit.yml up -d`)
- WebSocket server running (`npm run dev` from `apps/web-socket/`)
- Next.js dev server running (`npm run dev` from `apps/web/`)

Step-by-step:
1. **Open Chats page** — User A navigates to `/chats`. Verify audio call button (green phone) and video call button (blue camera) appear next to each friend.
2. **Initiate audio call** — User A clicks the green phone icon next to User B's name.
   - User A's call provider creates a LiveKit room and connects.
   - User A sees the `ActiveCallBar` at the top displaying "Audio Call — 00:00".
3. **Verify incoming call on B** — User B sees the `IncomingCallModal` overlay with:
   - User A's name displayed
   - "Audio call incoming..." description
   - Reject and Accept Audio buttons
4. **Accept call** — User B clicks "Accept Audio".
   - Modal disappears; `ActiveCallBar` appears on B's window.
   - Both A and B see the timer running on the bar.
5. **Mute/unmute** — Click the mute button on either side's ActiveCallBar.
   - Verify microphone toggling (mic icon changes between mic/mic-off).
6. **End call** — Either user clicks "End" on the ActiveCallBar.
   - Bar disappears on both sides.
   - Verify `PUT /api/calls/[id]/end` was called.
7. **Initiate video call** — User A clicks the blue camera icon next to User B.
   - CallPanel opens full-screen with VideoGrid, VideoTile for local participant.
8. **Accept video call** — User B receives incoming modal with "Accept Video" and "Accept Audio" options.
   - Click "Accept Video" → both enter full-screen CallPanel.
9. **Video controls** — In CallPanel:
   - Toggle mute → verify mic icon changes.
   - Toggle video → verify video tile shows avatar fallback and "Video Off" label.
   - Toggle participant list → verify slide-out panel shows participants.
   - Click "Minimize" → verify minimized bar appears.
   - Click "Expand" → verify full CallPanel returns.
10. **End video call** — Click "End Call" red button in CallControls.
    - Both users return to normal app state.
11. **Reject incoming call** — Initiate a call from A, B clicks "Reject".
    - Verify A's call provider receives rejection and ends the call.
12. **Missed call** — Initiate a call from A when B is not connected.
    - Verify A gets a "call_missed" message after timeout (or disconnect B's WS and try).

**Manual Test Steps — Group Video Call**

Prerequisites:
- Three browser windows logged in as User A (owner), User B, User C (members of same group)
- All prerequisites from 1-on-1 test

Step-by-step:
1. **Navigate to group chat** — User A opens the group chat page.
2. **Initiate group call** — User A clicks the green video button in the group chat header.
   - A enters full-screen CallPanel.
   - VideoGrid shows A's video tile.
3. **Verify B and C receive notification** — Both B and C see the incoming call modal with caller info.
4. **B and C join** — B clicks "Accept Video", then C clicks "Accept Video".
   - VideoGrid auto-layouts: with 3 participants, expect a 2-column grid.
   - Each participant tile shows participant name.
5. **Verify participant list** — Click the Users icon in CallControls.
   - Slide-out panel shows all 3 participants with names.
   - Active speaker gets a green ring highlight on their tile.
6. **Mute indicator in list** — A mutes. Verify A shows mute icon in participant list and on their VideoTile.
7. **End group call** — Click "End Call". All participants return to normal app. Verify call ended for all.

#### Test Coverage Summary

| Test File | Tests | What It Covers |
|---|---|---|
| `__tests__/api/calls/token.test.ts` | 6 | Auth, validation, identity check, token generation, error handling |
| `__tests__/api/calls/initiate.test.ts` | 9 | Auth, validation (type, targetId), all call types (AUDIO/VIDEO/GROUP), LiveKit integration, DB errors |
| `__tests__/api/calls/accept.test.ts` | 6 | Auth, room existence, participant check, status update, joinedAt timestamp |
| `__tests__/api/calls/reject.test.ts` | 5 | Auth, room existence, ringing check, status update, LiveKit cleanup |
| `__tests__/api/calls/end.test.ts` | 4 | Auth, room existence, status update, LiveKit cleanup |
| `__tests__/api/calls/livekit-webhook.test.ts` | 8 | Input validation, participant join/leave, room finished, idempotency |
| `__tests__/api/calls/push-subscribe.test.ts` | 5 | Auth, all field validations, upsert behavior |
| `__tests__/api/calls/health.test.ts` | 4 | Auth, LiveKit reachability, service status reporting |
| `__tests__/api/calls/livekit-lib.test.ts` | 8 | Token generation, room creation, room deletion, 409 handling |
| `__tests__/api/calls/env-validation.test.ts` | 6 | Required env vars set, URL format validation |
| `__tests__/api/calls/prisma-models.test.ts` | 11 | Schema structure, all model fields, relations, indexes, enums |
| `__tests__/components/CallProvider.test.tsx` | 3 | Rendering, context defaults, error when used outside provider |
| `__tests__/components/CallUI.test.tsx` | 7 | Incoming call modal, active call bar, expand/minimize, end call, accept/reject flows |
| `__tests__/components/CallComponents.test.tsx` | 14 | CallControls variants/callbacks, VideoTile rendering, VideoGrid empty state, ParticipantList speaking/mute indicators |
| `__tests__/components/CallSignaling.test.ts` | 8 | WS message construction, initiate/accept/reject/end call WS flow |
| **Total** | **104** | |

#### Prisma Model Verification (Manual)

```bash
# Reset database and push schema
cd apps/web
npx prisma db push --force-reset

# Run seed script to verify all models
npm run test:seed
```

### Phase 2: 1-on-1 Calls (Week 3-4)
- [x] Implement `useLiveKitRoom` hook
- [x] Build `CallPanel.tsx` with `VideoGrid` and `VideoTile`
- [x] Build `CallControls.tsx` (mute, video toggle, end call)
- [x] Build `IncomingCallModal.tsx` (ringtone, accept/reject)
- [x] Build `ActiveCallBar.tsx` (persistent minimized bar with timer)
- [x] Add call buttons (audio + video) to `Chats.tsx` (1-on-1 DM)
- [x] Add call buttons to `ChatWithPhone.tsx`
- [x] Wire WebSocket signaling (offer/accept/reject/end)
- [x] WebSocket server: handle `call_*` message types
- [x] Create `CallUI.tsx` integration wrapper for modal + bar + panel
- [x] End-to-end: click call → ring → accept → media flowing

### Phase 3: Group Calls (Week 5)
- [x] Add group call initiation to group chat header (`GroupChat.tsx`)
- [x] Participant list panel (`ParticipantList.tsx`)
- [x] Active speaker detection (ring highlight on `VideoTile`)
- [x] Handle join/leave events via WebSocket
- [x] Group call: `VideoGrid` auto-layout for 3+ participants

### Phase 4: Screen Sharing (Week 6)
- [ ] `useScreenShare` hook
- [ ] `ScreenShareView.tsx` component
- [ ] Toggle between camera/screen views
- [ ] WebSocket broadcast `call_screen_share` events

### Phase 5: Enhanced Features (Week 7-8)
- [ ] In-call text chat (`InCallChat.tsx`)
- [ ] Raise hand feature
- [ ] Picture-in-Picture mode
- [ ] Call history page
- [ ] Push notifications for incoming calls (VAPID + Service Worker)

### Phase 6: Recording (Week 9-10)
- [ ] LiveKit Egress API integration
- [ ] Record button in `CallControls`
- [ ] Store recordings in MinIO
- [ ] Recording list + playback UI
- [ ] Force 1080p recording independent of source quality

### Phase 7: Polish & Scale (Week 11-12)
- [ ] Adaptive quality (simulcast + SVC tuning)
- [ ] Load testing with 100+ simulated participants
- [ ] Horizontal scaling setup
- [ ] Monitoring & logging (LiveKit metrics)
- [ ] Error handling, reconnection logic
- [ ] Security audit (token expiration, room access control)

---

## 13. Cost Breakdown

### Fully Self-Hosted (recommended)

| Resource | Cost | Notes |
|---|---|---|
| VPS (4 vCPU, 8 GB) | ~$20-40/mo | DigitalOcean/Linode/Hetzner |
| Domain + DNS | ~$10-15/yr | For TURN cert |
| Total Monthly | **~$20-40** | Scales linearly with VPS size |

### If Using Managed LiveKit Cloud (alternative)

| Tier | Price | Limits |
|---|---|---|
| LiveKit Cloud Free | $0/mo | 50 monthly active participants |
| LiveKit Cloud Team | $99/mo | 1,000 monthly active participants |
| LiveKit Cloud Enterprise | Custom | Unlimited |

### Managed TURN (if not self-hosting LiveKit)
- Twilio Network Traversal: ~$0.005/participant/hour (cheap)
- Metered TURN: $10/mo for 50 GB

---

## 14. Performance & Scale Considerations

### Adaptive Quality Strategy

```
┌─────────────────────────────────────────────────────────┐
│  Simulcast: send 3 layers per participant               │
│                                                         │
│  Layer 0: 180p @ 30fps   (low bandwidth)               │
│  Layer 1: 360p @ 30fps   (medium)                       │
│  Layer 2: 720p @ 30fps   (high)                         │
│                                                         │
│  Receiver subscribes to appropriate layer based on:     │
│  - Available bandwidth (LiveKit adaptiveStream)          │
│  - Screen size of participant tile                      │
│  - If pinned/spotlight: highest layer                   │
└─────────────────────────────────────────────────────────┘
```

### Bandwidth Estimates

| Scenario | Send (per user) | Receive (per user) | Total (server) |
|---|---|---|---|
| 1-on-1 audio only | ~50 kbps | ~50 kbps | ~100 kbps |
| 1-on-1 video (720p) | ~1.5 Mbps | ~1.5 Mbps | ~3 Mbps |
| Group call, 5 ppl | ~1.5 Mbps | ~6 Mbps | ~7.5 Mbps |
| Group call, 10 ppl | ~1.5 Mbps | ~13.5 Mbps | ~15 Mbps |
| 100 ppl (1 speaker) | ~1.5 Mbps | ~1.5 Mbps (SFU selective) | ~150 Mbps |

### Bottlenecks & Mitigations

| Bottleneck | Mitigation |
|---|---|
| Server bandwidth | Use LiveKit's `max_publish_video_resolution` per room; enable VP9 for 50% bitrate savings |
| CPU on server | FFmpeg hardware acceleration (VAAPI/NVENC); limit per-room participants |
| Client CPU | `adaptiveStream` disables unused video tracks; `dynacast` reduces encoder load |
| NAT traversal | LiveKit built-in ICE + coturn TURN as fallback |
| Recording storage | MinIO lifecycle policies: auto-delete recordings older than N days; compress with HEVC |

### LiveKit Configuration for Scale (production `livekit.yaml`)

```yaml
port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  port_range: "50000-60000"
  use_external_ip: true
  udp_buffer_size: 2097152  # 2MB buffer for high throughput
  stun_servers:
    - "stun.l.google.com:19302"
  turn:
    enabled: true
    domain: turn.yourdomain.com
    tls: false

redis:
  address: "redis:6379"

room:
  max_participants: 50       # per room
  empty_timeout: 300         # 5 min
  max_metadata_size: 1024

signal:
  room_leave_timeout: 10000  # 10s

webhook:
  url: "https://yourdomain.com/api/calls/livekit-webhook"
  api_key: "${LIVEKIT_API_KEY}"
  api_secret: "${LIVEKIT_API_SECRET}"

video:
  use_external_ip: true
  max_bitrate: 8000000        # 8 Mbps max per publisher
  dynacast_pause_delay: 5000  # 5s before pausing unused layers
```

---

## Appendix: Key Packages to Install

```bash
# Web app (apps/web)
npm install livekit-client @livekit/components-react livekit-server-sdk web-push

# WebSocket server (apps/web-socket)
npm install livekit-server-sdk
```

## Appendix: .env Additions

```bash
# LiveKit
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
LIVEKIT_HOST=http://localhost:7880
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880

# MinIO (recording storage)
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_ENDPOINT=http://localhost:9000
MINIO_BUCKET=call-recordings

# VAPID keys (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# TURN (optional, for NAT traversal)
TURN_DOMAIN=
TURN_USER=
TURN_PASS=
```
