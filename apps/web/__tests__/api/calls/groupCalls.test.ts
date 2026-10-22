// @vitest-environment node
/**
 * Group calls outlive any one person.
 *
 * They used to behave like one-to-one calls: the first person to hang up, or
 * one member declining, ended the call for everybody and deleted its room, so
 * there was never anything to rejoin. These cover leaving, declining, finding
 * the call in progress, joining it, and the log lines written to the chat.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.WS_AUTH_SECRET = "test-secret";
});

const prisma = vi.hoisted(() => ({
  callRoom: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  callParticipant: { updateMany: vi.fn(), upsert: vi.fn() },
  groupMessage: { create: vi.fn() },
  user: { findMany: vi.fn() },
  group: { findUnique: vi.fn() },
  friendship: { findFirst: vi.fn() },
}));
vi.mock("../../../app/lib/prisma", () => ({ default: prisma }));

const livekit = vi.hoisted(() => ({
  listRoomIdentities: vi.fn(),
  deleteLiveKitRoom: vi.fn(),
  ensureLiveKitRoom: vi.fn(),
  createLiveKitToken: vi.fn(),
}));
vi.mock("../../../app/lib/livekit", () => livekit);

const auth = vi.hoisted(() => ({ user: null as null | { id: string; name: string }, member: true }));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => (auth.user ? { user: auth.user } : null)),
}));
vi.mock("../../../app/lib/auth", () => ({ authOptions: {} }));
vi.mock("../../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(async () => auth.user),
  isGroupMember: vi.fn(async () => auth.member),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: (message: string) => new Response(JSON.stringify({ error: message }), { status: 403 }),
}));

import { PUT as endCall } from "../../../app/api/calls/[id]/end/route";
import { PUT as rejectCall } from "../../../app/api/calls/[id]/reject/route";
import { PUT as joinCall } from "../../../app/api/calls/[id]/join/route";
import { PUT as acceptCall } from "../../../app/api/calls/[id]/accept/route";
import { GET as activeCall } from "../../../app/api/calls/active/route";
import { POST as startCall } from "../../../app/api/calls/initiate/route";
import { isSystemMessage, systemMessageText } from "../../../app/lib/systemMessages";
import { EMPTY_CALL_GRACE_MS } from "../../../app/lib/calls";

const ASHA = { id: "asha", name: "Asha Tester" };
const BILAL = { id: "bilal", name: "Bilal Friend" };
const params = { params: { id: "call-1" } };
const put = () => new Request("http://localhost/api/calls/call-1", { method: "PUT" });

function groupCall(over: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    livekitRoom: "room-1",
    groupId: "g1",
    type: "GROUP",
    status: "ONGOING",
    startedAt: new Date(Date.now() - 12 * 60_000),
    initiatorId: ASHA.id,
    initiator: { name: ASHA.name },
    participants: [
      { userId: ASHA.id, leftAt: null },
      { userId: BILAL.id, leftAt: null },
    ],
    ...over,
  };
}

/** The call-log lines written to the group's chat, as a reader would see them. */
function chatLog(viewerId?: string): string[] {
  return prisma.groupMessage.create.mock.calls.map(([arg]) => {
    expect(arg.data.groupId).toBe("g1");
    expect(isSystemMessage(arg.data.message)).toBe(true);
    return systemMessageText(arg.data.message, { viewerId });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = ASHA;
  auth.member = true;
  prisma.callRoom.findUnique.mockResolvedValue(groupCall());
  prisma.callRoom.findMany.mockResolvedValue([]);
  prisma.callRoom.updateMany.mockResolvedValue({ count: 1 });
  prisma.user.findMany.mockResolvedValue([]);
  livekit.listRoomIdentities.mockResolvedValue([]);
  livekit.createLiveKitToken.mockResolvedValue("token");
});

describe("hanging up a group call", () => {
  it("only removes you while others are still on it", async () => {
    livekit.listRoomIdentities.mockResolvedValue([ASHA.id, BILAL.id]);

    const res = await endCall(put(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ended).toBe(false);
    expect(body.remaining).toBe(1);
    // The call and its room are left alone for the people still talking
    expect(prisma.callRoom.updateMany).not.toHaveBeenCalled();
    expect(prisma.callRoom.update).not.toHaveBeenCalled();
    expect(livekit.deleteLiveKitRoom).not.toHaveBeenCalled();
    expect(prisma.callParticipant.updateMany).toHaveBeenCalledWith({
      where: { callId: "call-1", userId: ASHA.id },
      data: { leftAt: expect.any(Date) },
    });
    expect(chatLog()).toEqual(["Asha Tester left the call"]);
  });

  it("ends the call when you were the last one there", async () => {
    // Still listed for a moment after disconnecting: that mustn't count as "someone's here"
    livekit.listRoomIdentities.mockResolvedValue([ASHA.id]);

    const body = await (await endCall(put(), params)).json();

    expect(body.ended).toBe(true);
    expect(prisma.callRoom.updateMany).toHaveBeenCalledWith({
      where: { id: "call-1", status: { in: ["RINGING", "ONGOING"] } },
      data: { status: "ENDED", endedAt: expect.any(Date) },
    });
    expect(livekit.deleteLiveKitRoom).toHaveBeenCalledWith("room-1");
    // One line, with how long it ran; not "left" followed by "ended"
    expect(chatLog()).toEqual(["Call ended · 12 min"]);
  });

  it("logs the end once when two people leave at the same moment", async () => {
    prisma.callRoom.updateMany.mockResolvedValue({ count: 0 }); // the other request got there first
    await endCall(put(), params);
    expect(chatLog()).toEqual([]);
  });

  it("does nothing more to a call that has already ended", async () => {
    prisma.callRoom.findUnique.mockResolvedValue(groupCall({ status: "ENDED" }));

    const body = await (await endCall(put(), params)).json();

    expect(body.ended).toBe(true);
    expect(prisma.callParticipant.updateMany).not.toHaveBeenCalled();
    expect(livekit.deleteLiveKitRoom).not.toHaveBeenCalled();
    expect(chatLog()).toEqual([]);
  });

  it("refuses someone who was never on the call", async () => {
    auth.user = { id: "stranger", name: "Stranger" };
    expect((await endCall(put(), params)).status).toBe(403);
  });

  it("still ends a one-to-one call for both people, with no chat log", async () => {
    prisma.callRoom.findUnique.mockResolvedValue(groupCall({ groupId: null, type: "VIDEO" }));

    const body = await (await endCall(put(), params)).json();

    expect(body.ended).toBe(true);
    expect(prisma.callRoom.update).toHaveBeenCalledWith({
      where: { id: "call-1" },
      data: { status: "ENDED", endedAt: expect.any(Date) },
    });
    expect(livekit.deleteLiveKitRoom).toHaveBeenCalledWith("room-1");
    expect(prisma.groupMessage.create).not.toHaveBeenCalled();
  });
});

describe("declining a group call", () => {
  it.each(["RINGING", "ONGOING"])("leaves a %s call running for everyone else", async (status) => {
    prisma.callRoom.findUnique.mockResolvedValue(groupCall({ status }));
    auth.user = BILAL;

    const res = await rejectCall(put(), params);

    expect(res.status).toBe(200);
    expect((await res.json()).ended).toBe(false);
    expect(prisma.callRoom.update).not.toHaveBeenCalled();
    expect(livekit.deleteLiveKitRoom).not.toHaveBeenCalled();
  });

  it("still rejects a one-to-one call outright", async () => {
    prisma.callRoom.findUnique.mockResolvedValue(
      groupCall({ groupId: null, type: "VIDEO", status: "RINGING" }),
    );
    auth.user = BILAL;

    await rejectCall(put(), params);

    expect(prisma.callRoom.update).toHaveBeenCalledWith({
      where: { id: "call-1" },
      data: { status: "REJECTED" },
    });
    expect(livekit.deleteLiveKitRoom).toHaveBeenCalledWith("room-1");
  });
});

describe("answering a group call", () => {
  it("lets a member in and logs it", async () => {
    auth.user = BILAL;
    const res = await acceptCall(put(), params);

    expect(res.status).toBe(200);
    expect(chatLog()).toEqual(["Bilal Friend joined the call"]);
  });

  it("refuses someone who was rung but has since been removed from the group", async () => {
    auth.user = BILAL; // still on the call's ring list
    auth.member = false;

    const res = await acceptCall(put(), params);

    expect(res.status).toBe(403);
    expect(livekit.createLiveKitToken).not.toHaveBeenCalled();
    expect(prisma.callRoom.update).not.toHaveBeenCalled();
  });
});

describe("joining a call in progress", () => {
  it("lets a member back in and logs it", async () => {
    const res = await joinCall(put(), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      token: "token",
      roomName: "room-1",
      callId: "call-1",
      groupId: "g1",
    });
    // Works for someone who left, and for someone who was never rung
    expect(prisma.callParticipant.upsert).toHaveBeenCalledWith({
      where: { callId_userId: { callId: "call-1", userId: ASHA.id } },
      update: { joinedAt: expect.any(Date), leftAt: null },
      create: { callId: "call-1", userId: ASHA.id, joinedAt: expect.any(Date) },
    });
    expect(prisma.callRoom.update).toHaveBeenCalledWith({
      where: { id: "call-1" },
      data: { status: "ONGOING" },
    });
    expect(livekit.ensureLiveKitRoom).toHaveBeenCalledWith("room-1");
    expect(livekit.createLiveKitToken).toHaveBeenCalledWith(ASHA.id, "room-1", true, ASHA.name);
    expect(chatLog()).toEqual(["Asha Tester joined the call"]);
  });

  it("refuses someone outside the group", async () => {
    auth.member = false;
    const res = await joinCall(put(), params);
    expect(res.status).toBe(403);
    expect(livekit.createLiveKitToken).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    auth.user = null;
    expect((await joinCall(put(), params)).status).toBe(401);
  });

  it("says so when the call has ended", async () => {
    prisma.callRoom.findUnique.mockResolvedValue(groupCall({ status: "ENDED" }));
    const res = await joinCall(put(), params);
    expect(res.status).toBe(410);
    expect(livekit.createLiveKitToken).not.toHaveBeenCalled();
  });

  it("can't be used to get into a one-to-one call", async () => {
    prisma.callRoom.findUnique.mockResolvedValue(groupCall({ groupId: null }));
    const res = await joinCall(put(), params);
    expect(res.status).toBe(404);
    expect(livekit.createLiveKitToken).not.toHaveBeenCalled();
  });
});

describe("finding the group's call in progress", () => {
  const get = (query = "?groupId=g1") => activeCall(new Request(`http://localhost/api/calls/active${query}`));

  it("returns the call and who is on it right now", async () => {
    prisma.callRoom.findMany.mockResolvedValue([groupCall()]);
    livekit.listRoomIdentities.mockResolvedValue([BILAL.id]);
    prisma.user.findMany.mockResolvedValue([{ ...BILAL, image: null }]);

    const body = await (await get()).json();

    expect(body.call.callId).toBe("call-1");
    expect(body.call.participants).toEqual([{ ...BILAL, image: null }]);
    expect(prisma.callRoom.updateMany).not.toHaveBeenCalled();
  });

  it("returns nothing when there is no call", async () => {
    expect((await (await get()).json()).call).toBeNull();
  });

  it("closes a call nobody has been on for a while", async () => {
    // Everyone closed their tab: the database still says ONGOING
    prisma.callRoom.findMany.mockResolvedValue([
      groupCall({
        participants: [{ userId: ASHA.id, leftAt: new Date(Date.now() - EMPTY_CALL_GRACE_MS - 1000) }],
      }),
    ]);

    const body = await (await get()).json();

    expect(body.call).toBeNull();
    expect(prisma.callRoom.updateMany).toHaveBeenCalled();
    expect(livekit.deleteLiveKitRoom).toHaveBeenCalledWith("room-1");
    expect(chatLog()).toEqual(["Call ended · 12 min"]);
  });

  it("gives a call that has only just started time for someone to connect", async () => {
    prisma.callRoom.findMany.mockResolvedValue([
      groupCall({ status: "RINGING", startedAt: new Date(), participants: [] }),
    ]);

    const body = await (await get()).json();

    expect(body.call).toBeNull();
    expect(prisma.callRoom.updateMany).not.toHaveBeenCalled();
  });

  it("is only for members of the group", async () => {
    auth.member = false;
    expect((await get()).status).toBe(403);
    expect(prisma.callRoom.findMany).not.toHaveBeenCalled();
  });

  it("needs to be told which group", async () => {
    expect((await get("")).status).toBe(400);
  });
});

describe("starting a group call", () => {
  const start = () =>
    startCall(
      new Request("http://localhost/api/calls/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "GROUP", groupId: "g1" }),
      }),
    );

  beforeEach(() => {
    prisma.group.findUnique.mockResolvedValue({
      ownerId: ASHA.id,
      members: [{ userId: BILAL.id }],
    });
    prisma.callRoom.create.mockResolvedValue({ id: "call-2", participants: [] });
  });

  it("points to the call already in progress instead of starting a second", async () => {
    prisma.callRoom.findMany.mockResolvedValue([groupCall()]);
    livekit.listRoomIdentities.mockResolvedValue([BILAL.id]);

    const res = await start();

    expect(res.status).toBe(409);
    expect((await res.json()).existingCallId).toBe("call-1");
    expect(prisma.callRoom.create).not.toHaveBeenCalled();
  });

  it("logs who started it, phrased for whoever reads the chat", async () => {
    const res = await start();

    expect(res.status).toBe(201);
    expect(chatLog()).toEqual(["Asha Tester started a call"]);
    expect(chatLog(ASHA.id)).toEqual(["You started a call"]);
  });
});
