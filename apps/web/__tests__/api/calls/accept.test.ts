import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "../../../app/api/calls/[id]/accept/route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  callRoom: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  callParticipant: {
    updateMany: vi.fn(),
  },
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor() {
      return mockPrisma;
    }
  },
}));

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

const mockCallRoom = {
  id: "call-1",
  livekitRoom: "call-room-name",
  type: "VIDEO",
  status: "RINGING",
  initiatorId: "user-1",
  groupId: null,
  startedAt: new Date(),
  endedAt: null,
  participants: [
    { id: "p1", userId: "user-1", callId: "call-1" },
    { id: "p2", userId: "user-2", callId: "call-1" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.callRoom.findUnique.mockResolvedValue(mockCallRoom);
  mockPrisma.callRoom.update.mockResolvedValue({ ...mockCallRoom, status: "ONGOING" });
  mockPrisma.callParticipant.updateMany.mockResolvedValue({ count: 1 });
});

describe("PUT /api/calls/[id]/accept", () => {
  function makeRequest(id: string): Request {
    return new Request(`http://localhost:3000/api/calls/${id}/accept`, { method: "PUT" });
  }

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await PUT(makeRequest("call-1"), { params: { id: "call-1" } });
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 404 when call not found", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-2" } });
    mockPrisma.callRoom.findUnique.mockResolvedValue(null);
    const res = await PUT(makeRequest("call-1"), { params: { id: "call-1" } });
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe("Call not found");
  });

  it("returns 403 when user is not a participant", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "unauthorized-user" } });
    const res = await PUT(makeRequest("call-1"), { params: { id: "call-1" } });
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe("Not a participant");
  });

  it("returns 200 with token for valid participant", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-2" } });
    const res = await PUT(makeRequest("call-1"), { params: { id: "call-1" } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.token).toBe("mock-jwt-token");
    expect(json.roomName).toBe("call-room-name");
    expect(json.callId).toBe("call-1");
  });

  it("updates call status to ONGOING", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-2" } });
    await PUT(makeRequest("call-1"), { params: { id: "call-1" } });
    expect(mockPrisma.callRoom.update).toHaveBeenCalledWith({
      where: { id: "call-1" },
      data: { status: "ONGOING" },
    });
  });

  it("records joinedAt for accepting participant", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-2" } });
    await PUT(makeRequest("call-1"), { params: { id: "call-1" } });
    expect(mockPrisma.callParticipant.updateMany).toHaveBeenCalledWith({
      where: { callId: "call-1", userId: "user-2" },
      // leftAt is cleared too: accepting after having left is a rejoin
      data: { joinedAt: expect.any(Date), leftAt: null },
    });
  });
});
