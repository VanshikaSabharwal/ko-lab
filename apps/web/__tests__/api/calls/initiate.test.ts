import { describe, it, expect, vi, beforeEach } from "vitest";

// The ring ticket is signed with this; set before the route module loads.
vi.hoisted(() => {
  process.env.WS_AUTH_SECRET = "test-secret";
});

import { POST } from "../../../app/api/calls/initiate/route";

/** Reads a ring ticket's payload (signature checks live in the socket server). */
function ticketPayload(ticket: string) {
  return JSON.parse(Buffer.from(ticket.split(".")[0]!, "base64url").toString());
}

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  callRoom: {
    create: vi.fn(),
  },
  group: {
    findUnique: vi.fn(),
  },
  friendship: {
    findFirst: vi.fn(),
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

vi.mock("livekit-server-sdk", () => {
  // app/lib/livekit.ts constructs this at module load, so the mock must
  // provide it or importing the route throws before any test body runs.
  // Spies live in the factory (vi.mock is hoisted) and are shared across
  // instances so tests can drive the module-level client's behaviour.
  const createRoom = vi.fn();
  const deleteRoom = vi.fn();
  return {
    __spies: { createRoom, deleteRoom },
    RoomServiceClient: class {
      createRoom = createRoom;
      deleteRoom = deleteRoom;
    },
    AccessToken: class {
      addGrant = vi.fn();
      toJwt = mockToJwt;
    },
  };
});

const { __spies } = (await import("livekit-server-sdk")) as unknown as {
  __spies: { createRoom: ReturnType<typeof vi.fn>; deleteRoom: ReturnType<typeof vi.fn> };
};

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { getServerSession } from "next-auth";

beforeEach(() => {
  vi.clearAllMocks();
  // Group calls ring the group's roster, which the route looks up.
  mockPrisma.group.findUnique.mockResolvedValue({
    ownerId: "user-1",
    members: [{ userId: "user-1" }, { userId: "user-2" }],
  });
  // 1:1 calls are friends-only; user-2 is user-1's friend unless a test says not.
  mockPrisma.friendship.findFirst.mockResolvedValue({ id: "f1" });
  __spies.createRoom.mockResolvedValue({ name: "test-room" });
  __spies.deleteRoom.mockResolvedValue(undefined);
  mockFetch.mockResolvedValue({ ok: true });
  mockPrisma.callRoom.create.mockResolvedValue({
    id: "call-room-id",
    livekitRoom: "call-mock-uuid",
    type: "VIDEO",
    status: "RINGING",
    initiatorId: "user-1",
    groupId: null,
    startedAt: new Date(),
    endedAt: null,
    participants: [
      { id: "p1", userId: "user-1", callId: "call-room-id" },
      { id: "p2", userId: "user-2", callId: "call-room-id" },
    ],
  });
});

describe("POST /api/calls/initiate", () => {
  function makeRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost:3000/api/calls/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(makeRequest({ type: "VIDEO", targetId: "user-2" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when type is missing", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ targetId: "user-2" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when targetId and groupId are missing", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ type: "VIDEO" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid call type", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ type: "INVALID", targetId: "user-2" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid call type");
  });

  it("returns 201 for valid 1-on-1 VIDEO call", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ type: "VIDEO", targetId: "user-2" }));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.callRoom).toBeDefined();
    expect(json.token).toBe("mock-jwt-token");
    expect(json.roomName).toContain("call-");
  });

  it("returns 201 for AUDIO call", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ type: "AUDIO", targetId: "user-2" }));
    expect(res.status).toBe(201);
  });

  it("returns 201 for GROUP call with a ticket to ring the roster", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ type: "GROUP", groupId: "group-1" }));
    const json = await res.json();
    expect(res.status).toBe(201);
    const ticket = ticketPayload(json.ringTicket);
    // The caller is excluded — you don't ring yourself.
    expect(ticket).toMatchObject({
      kind: "ring",
      callerId: "user-1",
      callId: "call-room-id",
      groupId: "group-1",
      invitees: ["user-2"],
    });
  });

  it("returns 403 when the caller isn't in the group", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "outsider" } });
    const res = await POST(makeRequest({ type: "GROUP", groupId: "group-1" }));
    expect(res.status).toBe(403);
    expect(mockPrisma.callRoom.create).not.toHaveBeenCalled();
  });

  it("returns 403 for a 1-on-1 call to someone who isn't a friend", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.friendship.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest({ type: "VIDEO", targetId: "stranger" }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe("You can only call people on your friend list");
    expect(mockPrisma.callRoom.create).not.toHaveBeenCalled();
  });

  it("signs a 1-on-1 ticket that rings only the friend", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ type: "VIDEO", targetId: "user-2" }));
    const json = await res.json();
    expect(ticketPayload(json.ringTicket)).toMatchObject({
      groupId: null,
      invitees: ["user-2"],
    });
  });

  it("returns 404 when the group does not exist", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.group.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ type: "GROUP", groupId: "nope" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the caller is the group's only member", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.group.findUnique.mockResolvedValue({
      ownerId: "user-1",
      members: [{ userId: "user-1" }],
    });
    const res = await POST(makeRequest({ type: "GROUP", groupId: "group-1" }));
    expect(res.status).toBe(400);
  });

  it("handles LiveKit room already existing (409)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    __spies.createRoom.mockRejectedValue(
      Object.assign(new Error("Conflict"), { status: 409 }),
    );
    const res = await POST(makeRequest({ type: "AUDIO", targetId: "user-2" }));
    expect(res.status).toBe(201);
  });

  it("handles LiveKit server error", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    __spies.createRoom.mockRejectedValue(
      Object.assign(new Error("Server Error"), { status: 500 }),
    );
    const res = await POST(makeRequest({ type: "VIDEO", targetId: "user-2" }));
    expect(res.status).toBe(500);
  });

  it("handles database errors", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.callRoom.create.mockRejectedValue(new Error("DB error"));
    const res = await POST(makeRequest({ type: "VIDEO", targetId: "user-2" }));
    expect(res.status).toBe(500);
  });
});
