import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { ChunkAssembler, PacedSender, toChunks, type Chunk } from "./transport";

// One file, edited live by several people (Google Docs style).
//
// Everyone holds a copy of the same Yjs document; Yjs merges concurrent typing
// so all copies converge. Messages travel through the group's "CODE" room on
// the socket server, which relays them to everyone else in the room.
//
// Hosting: the first person to open the file hosts it. Their editor seeds the
// shared text from their copy, sends the full document to each newcomer, and
// is the one that saves, so the work lands in the host's draft and change
// request (the group's choice). When the host leaves, the participant with
// the lowest user id who can edit takes over, so everyone picks the same one
// without a vote.

export type CoStatus =
  /** Looking for a host. */
  | "connecting"
  | "host"
  | "guest"
  /** Not sharing: nobody to share with, or the session ended. */
  | "solo";

export interface Participant {
  userId: string;
  name: string;
  color: string;
  /** Has code access, so could host (and save). */
  canHost: boolean;
}

export interface Me {
  id: string;
  name: string;
  canHost: boolean;
}

/** Every co-editing message, inside a board op: { action: "co", key, kind, … }. */
export type CoMessage =
  | { action: "co"; key: string; kind: "hello"; canHost: boolean }
  | { action: "co"; key: string; kind: "host"; hostId: string; hostName: string }
  | { action: "co"; key: string; kind: "state"; to: string; chunk: Chunk }
  | { action: "co"; key: string; kind: "update"; chunk: Chunk }
  | { action: "co"; key: string; kind: "aw"; chunk: Chunk }
  | { action: "co"; key: string; kind: "leave" }
  | { action: "co"; key: string; kind: "save" };

type Outgoing = CoMessage extends infer M ? (M extends { key: string } ? Omit<M, "action" | "key"> : never) : never;

/** How long to wait for a host to answer before hosting yourself. */
export const JOIN_TIMEOUT_MS = 1_500;
/** A newcomer who hasn't received the document by now asks again. */
const STATE_TIMEOUT_MS = 4_000;
/** Typing is sent in small batches rather than per keystroke. */
const UPDATE_BATCH_MS = 120;

const REMOTE = "remote";
/**
 * The host's starting text. Never broadcast: newcomers get it inside the full
 * document. If it were, two people who opened the file at the same moment
 * would both send theirs, and the text would appear twice.
 */
const SEED = "seed";
const COLORS = ["#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6", "#f43f5e"];

export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

/** Who takes over: the lowest user id among those who can host. Everyone computes the same answer. */
export function pickHost(candidates: { userId: string; canHost: boolean }[]): string | null {
  const ids = candidates.filter((c) => c.canHost).map((c) => c.userId).sort();
  return ids[0] ?? null;
}

export class CoEditSession {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText("file");
  readonly awareness = new Awareness(this.doc);

  status: CoStatus = "connecting";
  host: { id: string; name: string } | null = null;

  private sender: PacedSender<Outgoing>;
  private assembler = new ChunkAssembler();
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private listeners = new Set<() => void>();

  constructor(
    readonly key: string,
    private me: Me,
    send: (message: CoMessage) => void,
    /** The file's text on this screen, to seed the document when hosting. */
    private getText: () => string,
    /** A guest asked the host to save. */
    private onSaveRequest: () => void,
  ) {
    this.sender = new PacedSender((m) => send({ action: "co", key, ...m } as CoMessage));

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || origin === SEED || this.stopped) return;
      this.pending.push(update);
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), UPDATE_BATCH_MS);
    });

    // Listening first, so setting our own state below is sent too
    this.awareness.on("update", ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
      if (origin !== REMOTE && !this.stopped) {
        const changed = [...added!, ...updated!, ...removed!];
        // Only the newest cursor position matters, so waiting ones are replaced
        this.sendData("aw", encodeAwarenessUpdate(this.awareness, changed), "aw");
      }
      this.emit();
    });
    this.awareness.setLocalStateField("user", {
      userId: me.id,
      name: me.name,
      color: colorFor(me.id),
      colorLight: `${colorFor(me.id)}33`,
      canHost: me.canHost,
    });
  }

  /** Change notifications, for React. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private setStatus(status: CoStatus) {
    this.status = status;
    this.emit();
  }

  /** Everyone sharing the file right now, you included. */
  participants(): Participant[] {
    const people = new Map<string, Participant>();
    for (const state of this.awareness.getStates().values()) {
      const u = state?.user;
      if (u?.userId) people.set(u.userId, { userId: u.userId, name: u.name, color: u.color, canHost: !!u.canHost });
    }
    return [...people.values()];
  }

  start() {
    this.send({ kind: "hello", canHost: this.me.canHost });
    this.joinTimer = setTimeout(() => {
      // Nobody answered: this person hosts, if they're able to save
      if (this.status === "connecting") {
        if (this.me.canHost) this.becomeHost(true);
        else this.setStatus("solo");
      }
    }, JOIN_TIMEOUT_MS);
  }

  private send(m: Outgoing, coalesceKey?: string) {
    if (!this.stopped) this.sender.push(m, coalesceKey);
  }

  private sendData(kind: "update" | "aw", bytes: Uint8Array, coalesceKey?: string) {
    for (const chunk of toChunks(bytes)) {
      // A many-piece message must not have its pieces merged away
      this.send({ kind, chunk } as Outgoing, chunk.n === 1 ? coalesceKey : undefined);
    }
  }

  private flush() {
    this.flushTimer = null;
    if (!this.pending.length) return;
    const merged = Y.mergeUpdates(this.pending);
    this.pending = [];
    this.sendData("update", merged);
  }

  private becomeHost(seed: boolean) {
    if (seed) {
      const text = this.getText();
      this.doc.transact(() => {
        if (this.text.length) this.text.delete(0, this.text.length);
        this.text.insert(0, text);
      }, SEED);
    }
    this.host = { id: this.me.id, name: this.me.name };
    this.setStatus("host");
    this.send({ kind: "host", hostId: this.me.id, hostName: this.me.name });
  }

  /** Called with every co-editing message for this file from someone else. */
  receive(message: CoMessage, from: string) {
    if (this.stopped || message.key !== this.key || from === this.me.id) return;

    switch (message.kind) {
      case "hello":
        if (this.status === "host") {
          // A newcomer: tell them who hosts, and send them the whole document
          this.send({ kind: "host", hostId: this.me.id, hostName: this.me.name });
          for (const chunk of toChunks(Y.encodeStateAsUpdate(this.doc))) {
            this.send({ kind: "state", to: from, chunk });
          }
          // And everyone's cursors
          this.sendData("aw", encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]));
        }
        break;

      case "host":
        if (this.status === "host" && message.hostId !== this.me.id) {
          // Two people opened the file at the same moment and both started
          // hosting. The lower id keeps it; the other joins as a guest.
          if (message.hostId < this.me.id) this.yield(message.hostId, message.hostName);
          else this.send({ kind: "host", hostId: this.me.id, hostName: this.me.name });
          break;
        }
        this.host = { id: message.hostId, name: message.hostName };
        if (this.status === "connecting" && this.joinTimer) {
          clearTimeout(this.joinTimer);
          this.joinTimer = null;
          this.waitForState();
        } else if (this.status === "solo" && this.text.length === 0) {
          // We gave up waiting (and couldn't host), but a host has answered
          // since: join after all
          this.setStatus("connecting");
          this.send({ kind: "hello", canHost: this.me.canHost });
          this.waitForState();
        }
        this.emit();
        break;

      case "state": {
        if (message.to !== this.me.id) break;
        const update = this.assembler.add(message.chunk);
        if (!update) break;
        Y.applyUpdate(this.doc, update, REMOTE);
        if (this.stateTimer) clearTimeout(this.stateTimer);
        this.stateTimer = null;
        if (this.status === "connecting") this.setStatus("guest");
        break;
      }

      case "update": {
        const update = this.assembler.add(message.chunk);
        if (update) Y.applyUpdate(this.doc, update, REMOTE);
        break;
      }

      case "aw": {
        const update = this.assembler.add(message.chunk);
        if (update) applyAwarenessUpdate(this.awareness, update, REMOTE);
        break;
      }

      case "leave":
        if (this.host?.id === from) this.hostLeft(from);
        break;

      case "save":
        if (this.status === "host") this.onSaveRequest();
        break;
    }
  }

  private waitForState() {
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => {
      // The document didn't arrive (a dropped message): ask again
      if (this.status === "connecting") {
        this.send({ kind: "hello", canHost: this.me.canHost });
        this.waitForState();
      }
    }, STATE_TIMEOUT_MS);
  }

  private yield(hostId: string, hostName: string) {
    // Start over with an empty document and take the host's
    this.doc.transact(() => this.text.delete(0, this.text.length), REMOTE);
    this.host = { id: hostId, name: hostName };
    this.setStatus("connecting");
    this.send({ kind: "hello", canHost: this.me.canHost });
    this.waitForState();
  }

  private hostLeft(leaver: string) {
    const remaining = this.participants().filter((p) => p.userId !== leaver);
    const next = pickHost(remaining);
    if (next === null) {
      // Nobody left who can save: carry on alone; the text stays on screen
      this.host = null;
      this.setStatus("solo");
    } else if (next === this.me.id) {
      // Everyone already has the same document, so nothing is re-sent
      this.becomeHost(false);
    } else {
      const person = remaining.find((p) => p.userId === next)!;
      this.host = { id: next, name: person.name };
      this.emit();
    }
  }

  /** A guest's Save: the host's editor does the saving. */
  requestSave() {
    if (this.status === "guest") this.send({ kind: "save" });
  }

  /**
   * Make the shared text match this screen, as one edit, before the editor is
   * bound to it (typing between seeding and binding would otherwise be lost).
   */
  syncFrom(text: string) {
    if (this.text.toString() === text) return;
    this.doc.transact(() => {
      this.text.delete(0, this.text.length);
      this.text.insert(0, text);
    });
  }

  leave() {
    if (this.stopped) return;
    this.flush();
    // Others drop this cursor, and pick a new host if this was it
    removeAwarenessStates(this.awareness, [this.doc.clientID], "leave");
    this.send({ kind: "leave" });
    this.stopped = true;
    [this.flushTimer, this.joinTimer, this.stateTimer].forEach((t) => t && clearTimeout(t));
    // Let the last messages go out before tearing down
    setTimeout(() => {
      this.sender.clear();
      this.awareness.destroy();
      this.doc.destroy();
    }, 1_500);
    this.listeners.clear();
  }
}
