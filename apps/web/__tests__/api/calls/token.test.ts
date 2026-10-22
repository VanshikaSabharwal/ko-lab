import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../../../app/api/calls/token/route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  callRoom: { findUnique: vi.fn() },
  group: { findUnique: vi.fn() },
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor() {
      return mockPrisma;
    }
  },
}));

/** A one-to-one call in progress that user-1 is on. */
const myCall = { status: "ONGOING", groupId: null, participants: [{ id: "p1" }] };

const mockToJwt = vi.hoisted(() => vi.fn().mockReturnValue("mock-jwt-token"));

vi.mock("livekit-server-sdk", () => ({
  // app/lib/livekit.ts constructs this at module load, so the mock must
  // provide it or importing the route throws before any test body runs.
  RoomServiceClient: class {
    createRoom = vi.fn().mockResolvedValue({ name: "test-room" });
    deleteRoom = vi.fn().mockResolvedValue(undefined);
    listRooms = vi.fn().mockResolvedValue([]);
    listParticipants = vi.fn().mockResolvedValue([]);
    removeParticipant = vi.fn().mockResolvedValue(undefined);
  },
  AccessToken: class {
    addGrant = vi.fn();
    toJwt = mockToJwt;
  },
}));

import { getServerSession } from "next-auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockToJwt.mockReturnValue("mock-jwt-token");
  mockPrisma.callRoom.findUnique.mockResolvedValue(myCall);
  // user-1 owns the group, user-2 is a member
  mockPrisma.group.findUnique.mockResolvedValue({ ownerId: "user-1", members: [{ userId: "user-2" }] });
});

describe("POST /api/calls/token", () => {
  function makeRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost:3000/api/calls/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(makeRequest({ roomName: "test-room", identity: "user-1" }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 when roomName is missing", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ identity: "user-1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when identity is missing", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ roomName: "test-room" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when identity does not match session", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ roomName: "test-room", identity: "attacker-id" }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe("Identity mismatch");
  });

  it("returns a token for a call the user is on", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ roomName: "test-room", identity: "user-1" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.token).toBe("mock-jwt-token");
    // Looked up by the room, and only this user's own participant row
    expect(mockPrisma.callRoom.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { livekitRoom: "test-room" } }),
    );
  });

  // Any signed-in user who knew a room's name used to be handed a token for it.
  describe("only people who belong to the call", () => {
    const ask = async (userId: string) => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } });
      return POST(makeRequest({ roomName: "test-room", identity: userId }));
    };

    it("refuses a room name that isn't a call at all", async () => {
      mockPrisma.callRoom.findUnique.mockResolvedValue(null);
      const res = await ask("user-1");
      expect(res.status).toBe(403);
      expect(mockToJwt).not.toHaveBeenCalled();
    });

    it("refuses someone who isn't on a one-to-one call", async () => {
      mockPrisma.callRoom.findUnique.mockResolvedValue({ ...myCall, participants: [] });
      const res = await ask("stranger");
      expect(res.status).toBe(403);
      expect(mockToJwt).not.toHaveBeenCalled();
    });

    it("gives the same answer for a missing room and someone else's call", async () => {
      mockPrisma.callRoom.findUnique.mockResolvedValue(null);
      const missing = await (await ask("stranger")).json();
      mockPrisma.callRoom.findUnique.mockResolvedValue({ ...myCall, participants: [] });
      const notMine = await (await ask("stranger")).json();
      // Otherwise the difference would reveal which room names are real
      expect(missing).toEqual(notMine);
    });

    it("lets a group member onto the group's call even if they weren't rung", async () => {
      mockPrisma.callRoom.findUnique.mockResolvedValue({ status: "ONGOING", groupId: "g1", participants: [] });
      expect((await ask("user-2")).status).toBe(200);
    });

    it("refuses someone outside the group", async () => {
      mockPrisma.callRoom.findUnique.mockResolvedValue({ status: "ONGOING", groupId: "g1", participants: [] });
      const res = await ask("stranger");
      expect(res.status).toBe(403);
      expect(mockToJwt).not.toHaveBeenCalled();
    });

    it("refuses someone who was rung but has since been removed from the group", async () => {
      mockPrisma.callRoom.findUnique.mockResolvedValue({
        status: "ONGOING",
        groupId: "g1",
        participants: [{ id: "p9" }],
      });
      const res = await ask("removed-member");
      expect(res.status).toBe(403);
      expect(mockToJwt).not.toHaveBeenCalled();
    });

    it.each(["ENDED", "REJECTED", "MISSED"])("refuses a call that is %s", async (status) => {
      mockPrisma.callRoom.findUnique.mockResolvedValue({ ...myCall, status });
      const res = await ask("user-1");
      expect(res.status).toBe(410);
      expect(mockToJwt).not.toHaveBeenCalled();
    });
  });

  it("handles token generation failure gracefully", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    mockToJwt.mockImplementation(() => { throw new Error("LiveKit error"); });
    const res = await POST(makeRequest({ roomName: "test-room", identity: "user-1" }));
    expect(res.status).toBe(500);
  });
});
