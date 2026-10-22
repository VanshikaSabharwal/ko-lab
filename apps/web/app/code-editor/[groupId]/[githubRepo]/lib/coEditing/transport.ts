// Getting live-editing data through the socket server, which relays at most
// 8 KB per message and 10 messages a second per connection. A file's full
// state (sent to someone joining) can be far bigger than one message, and fast
// typing produces more than ten changes a second, so data is split into
// pieces small enough to pass, and sends are spaced out.

/** Base64 characters per piece: well under the 8 KB limit with the envelope. */
export const CHUNK_CHARS = 6_000;
/** Below the server's 10 a second, leaving room for anything else on the connection. */
export const MAX_SENDS_PER_SECOND = 8;

export interface Chunk {
  /** Groups the pieces of one message. */
  id: string;
  /** This piece's position, and how many there are. */
  i: number;
  n: number;
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let counter = 0;
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Split binary data into pieces that each fit in one message. */
export function toChunks(bytes: Uint8Array, size = CHUNK_CHARS): Chunk[] {
  const text = toBase64(bytes);
  const id = newId();
  const n = Math.max(1, Math.ceil(text.length / size));
  return Array.from({ length: n }, (_, i) => ({ id, i, n, data: text.slice(i * size, (i + 1) * size) }));
}

/**
 * Puts pieces back together. Returns the whole message once its last piece
 * arrives, in any order; incomplete messages are dropped after a while.
 */
export class ChunkAssembler {
  private parts = new Map<string, { pieces: string[]; got: number; at: number }>();

  constructor(private ttlMs = 30_000) {}

  add(chunk: Chunk): Uint8Array | null {
    if (!chunk || typeof chunk.data !== "string" || !(chunk.n >= 1) || !(chunk.i >= 0) || chunk.i >= chunk.n) {
      return null;
    }
    this.expire();
    if (chunk.n === 1) return fromBase64(chunk.data);

    let entry = this.parts.get(chunk.id);
    if (!entry) {
      entry = { pieces: new Array(chunk.n), got: 0, at: Date.now() };
      this.parts.set(chunk.id, entry);
    }
    if (entry.pieces[chunk.i] === undefined) {
      entry.pieces[chunk.i] = chunk.data;
      entry.got++;
    }
    if (entry.got < chunk.n) return null;
    this.parts.delete(chunk.id);
    return fromBase64(entry.pieces.join(""));
  }

  private expire() {
    const now = Date.now();
    for (const [id, entry] of this.parts) {
      if (now - entry.at > this.ttlMs) this.parts.delete(id);
    }
  }
}

/**
 * Sends at a steady pace. Messages with the same `coalesceKey` that are still
 * waiting are replaced by the newest (e.g. cursor positions: only the latest
 * matters), so a backlog never builds up.
 */
export class PacedSender<T> {
  private queue: { message: T; key?: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;

  constructor(
    private send: (message: T) => void,
    private perSecond = MAX_SENDS_PER_SECOND,
  ) {}

  push(message: T, coalesceKey?: string) {
    if (coalesceKey) {
      const waiting = this.queue.find((q) => q.key === coalesceKey);
      if (waiting) {
        waiting.message = message;
        return;
      }
    }
    this.queue.push({ message, key: coalesceKey });
    this.pump();
  }

  /** Drop anything not yet sent. */
  clear() {
    this.queue = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get pending() {
    return this.queue.length;
  }

  private pump() {
    if (this.timer || this.queue.length === 0) return;
    const gap = 1000 / this.perSecond;
    const wait = Math.max(0, this.lastSent + gap - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      const next = this.queue.shift();
      if (next) {
        this.lastSent = Date.now();
        this.send(next.message);
      }
      this.pump();
    }, wait);
  }
}
