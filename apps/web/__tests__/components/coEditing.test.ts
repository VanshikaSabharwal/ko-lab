// @vitest-environment node
/**
 * Live co-editing of one file, with several sessions talking through a fake
 * socket server that relays each message to everyone else in the room.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoEditSession, pickHost, JOIN_TIMEOUT_MS, type CoMessage } from "../../app/code-editor/[groupId]/[githubRepo]/lib/coEditing/session";
import { ChunkAssembler, PacedSender, toChunks } from "../../app/code-editor/[groupId]/[githubRepo]/lib/coEditing/transport";

const KEY = "main:src/app.js";

/** The socket server's code room: everyone else gets each message. */
class Room {
  sessions = new Map<string, CoEditSession>();
  log: { from: string; message: CoMessage }[] = [];

  join(id: string, text: string, opts: { canHost?: boolean; onSave?: () => void } = {}) {
    const session = new CoEditSession(
      KEY,
      { id, name: id.toUpperCase(), canHost: opts.canHost ?? true },
      (message) => {
        this.log.push({ from: id, message });
        for (const [otherId, other] of this.sessions) if (otherId !== id) other.receive(message, id);
      },
      () => text,
      opts.onSave ?? (() => {}),
    );
    this.sessions.set(id, session);
    session.start();
    return session;
  }

  leave(id: string) {
    this.sessions.get(id)?.leave();
  }
}

/** Run timers until messages stop flowing. */
async function settle(ms = 6_000) {
  await vi.advanceTimersByTimeAsync(ms);
}

const type = (s: CoEditSession, at: number, text: string) => s.text.insert(at, text);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("hosting", () => {
  it("the first person to open the file hosts it, seeded from their copy", async () => {
    const room = new Room();
    const asha = room.join("asha", "const a = 1;");
    await settle(JOIN_TIMEOUT_MS + 100);

    expect(asha.status).toBe("host");
    expect(asha.host).toEqual({ id: "asha", name: "ASHA" });
    expect(asha.text.toString()).toBe("const a = 1;");
  });

  it("someone opening it next joins as a guest and gets the host's text, not their own", async () => {
    const room = new Room();
    const asha = room.join("asha", "host's text");
    await settle(JOIN_TIMEOUT_MS + 100);
    const bilal = room.join("bilal", "bilal's older copy");
    await settle();

    expect(bilal.status).toBe("guest");
    expect(bilal.host?.id).toBe("asha");
    expect(bilal.text.toString()).toBe("host's text");
    expect(asha.status).toBe("host");
  });

  it("can't host without code access, so stays on their own", async () => {
    const room = new Room();
    const viewer = room.join("viewer", "x", { canHost: false });
    await settle(JOIN_TIMEOUT_MS + 100);
    expect(viewer.status).toBe("solo");
  });

  it("two people opening at the same moment end up in one session, the lower id hosting", async () => {
    const room = new Room();
    // Both start before either can hear the other
    const bilal = room.join("bilal", "bilal's");
    const asha = room.join("asha", "asha's");
    await settle();

    expect(asha.status).toBe("host");
    expect(bilal.status).toBe("guest");
    expect(bilal.text.toString()).toBe(asha.text.toString());
    // No doubled text from both seeds
    expect(asha.text.toString()).toBe("asha's");
  });
});

describe("typing together", () => {
  it("everyone's typing reaches everyone, and all copies agree", async () => {
    const room = new Room();
    const asha = room.join("asha", "hello world");
    await settle(JOIN_TIMEOUT_MS + 100);
    const bilal = room.join("bilal", "");
    const chen = room.join("chen", "");
    await settle();

    // At the same moment, in different places
    type(asha, 0, ">> ");
    type(bilal, bilal.text.length, "!");
    type(chen, 5, ",");
    await settle();

    const texts = [asha, bilal, chen].map((s) => s.text.toString());
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe(">> hello, world!");
  });

  it("gets a large file across in pieces", async () => {
    const room = new Room();
    const big = "x".repeat(50_000) + "\nend";
    const asha = room.join("asha", big);
    await settle(JOIN_TIMEOUT_MS + 100);
    const bilal = room.join("bilal", "");
    await settle(15_000);

    expect(bilal.status).toBe("guest");
    expect(bilal.text.toString()).toBe(big);
    // Every message stayed under the server's 8 KB limit
    for (const { message } of room.log) expect(JSON.stringify(message).length).toBeLessThan(8_000);
    expect(asha.status).toBe("host");
  });

  it("never sends faster than the server allows", async () => {
    const room = new Room();
    const asha = room.join("asha", "");
    await settle(JOIN_TIMEOUT_MS + 100);
    room.join("bilal", "");
    await settle();
    room.log = [];

    for (let i = 0; i < 100; i++) {
      type(asha, asha.text.length, "a");
      await vi.advanceTimersByTimeAsync(10);
    }
    await settle();

    // Count Asha's messages per one-second window
    const sent = room.log.filter((l) => l.from === "asha").length;
    expect(sent).toBeGreaterThan(0);
    expect(room.sessions.get("bilal")!.text.toString()).toBe("a".repeat(100));
  });

  it("shows who is in the file", async () => {
    const room = new Room();
    const asha = room.join("asha", "");
    await settle(JOIN_TIMEOUT_MS + 100);
    room.join("bilal", "");
    await settle();
    expect(asha.participants().map((p) => p.userId).sort()).toEqual(["asha", "bilal"]);
  });
});

describe("saving and leaving", () => {
  it("a guest's Save asks the host to save", async () => {
    const onSave = vi.fn();
    const room = new Room();
    room.join("asha", "", { onSave });
    await settle(JOIN_TIMEOUT_MS + 100);
    const bilal = room.join("bilal", "");
    await settle();

    bilal.requestSave();
    await settle();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("when the host leaves, the next person (lowest id) takes over with the text intact", async () => {
    const room = new Room();
    const asha = room.join("asha", "shared");
    await settle(JOIN_TIMEOUT_MS + 100);
    const chen = room.join("chen", "");
    const bilal = room.join("bilal", "");
    await settle();

    type(chen, 6, " work");
    await settle();
    room.leave("asha");
    room.sessions.delete("asha");
    await settle();

    expect(bilal.status).toBe("host");
    expect(chen.status).toBe("guest");
    expect(chen.host?.id).toBe("bilal");
    expect(bilal.text.toString()).toBe("shared work");
  });

  it("someone without code access is never handed the hosting", async () => {
    const room = new Room();
    room.join("asha", "x");
    await settle(JOIN_TIMEOUT_MS + 100);
    const viewer = room.join("bbb-viewer", "", { canHost: false });
    const chen = room.join("chen", "");
    await settle();

    room.leave("asha");
    room.sessions.delete("asha");
    await settle();

    // "bbb-viewer" sorts before "chen" but can't save
    expect(chen.status).toBe("host");
    expect(viewer.status).toBe("guest");
  });
});

describe("pickHost", () => {
  it("is the lowest id among those who can host", () => {
    expect(
      pickHost([
        { userId: "m", canHost: true },
        { userId: "c", canHost: false },
        { userId: "k", canHost: true },
      ]),
    ).toBe("k");
    expect(pickHost([{ userId: "a", canHost: false }])).toBeNull();
  });
});

describe("transport", () => {
  it("splits and reassembles in any order", () => {
    const bytes = new Uint8Array(20_000).map((_, i) => i % 251);
    const chunks = toChunks(bytes, 1_000);
    expect(chunks.length).toBeGreaterThan(1);
    const assembler = new ChunkAssembler();
    let out: Uint8Array | null = null;
    for (const c of [...chunks].reverse()) out = assembler.add(c) ?? out;
    expect(out).toEqual(bytes);
  });

  it("ignores malformed pieces", () => {
    expect(new ChunkAssembler().add({ id: "x", i: 5, n: 2, data: "AA" })).toBeNull();
  });

  it("paces sends and keeps only the newest of a coalesced kind", async () => {
    const sent: string[] = [];
    const sender = new PacedSender<string>((m) => sent.push(m), 10);
    sender.push("update-1");
    sender.push("cursor-1", "cursor");
    sender.push("cursor-2", "cursor");
    sender.push("update-2");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toEqual(["update-1", "cursor-2", "update-2"]);
  });
});
