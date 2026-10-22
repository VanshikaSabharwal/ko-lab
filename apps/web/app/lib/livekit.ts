import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;
const LIVEKIT_HOST = process.env.LIVEKIT_HOST || "http://localhost:7880";

const roomService = new RoomServiceClient(LIVEKIT_HOST, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

export async function createLiveKitToken(
  identity: string,
  roomName: string,
  canPublish: boolean = true,
  name?: string,
): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: "10m",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
  });

  return at.toJwt();
}

export async function ensureLiveKitRoom(roomName: string) {
  try {
    await roomService.createRoom({
      name: roomName,
      emptyTimeout: 300,
    });
  } catch (err: any) {
    if (err?.status !== 409) throw err;
  }
}

/**
 * Identities (user ids) connected to a room right now. This is the source of
 * truth for "is anyone still on this call": the database only knows what the
 * app was told, and misses a closed tab or a dropped connection. A room that
 * no longer exists has nobody in it.
 */
export async function listRoomIdentities(roomName: string): Promise<string[]> {
  try {
    const participants = await roomService.listParticipants(roomName);
    return participants.map((p) => p.identity);
  } catch (err: any) {
    if (err?.status === 404 || err?.code === "not_found") return [];
    throw err;
  }
}

export async function deleteLiveKitRoom(roomName: string) {
  try {
    await roomService.deleteRoom(roomName);
  } catch (err) {
    console.error("Failed to delete LiveKit room:", err);
  }
}
