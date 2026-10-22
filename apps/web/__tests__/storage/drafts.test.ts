/**
 * Editor drafts against real (LocalStack) storage: what's saved must come back
 * exactly, and one person's drafts must never reach another.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// restoreDraft copies the original from the git service; only that call is
// replaced, storage itself is real.
vi.mock("../../app/lib/gitClient", () => ({ readFileRawBuffer: vi.fn() }));

import {
  writeDraft,
  readDraft,
  deleteDraft,
  restoreDraft,
  clearDrafts,
} from "../../app/lib/draftStore";
import { readFileRawBuffer } from "../../app/lib/gitClient";

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

// A fresh group per test, so tests can't see each other's files
let group = "";
let n = 0;
beforeEach(() => {
  group = `group-${Date.now()}-${n++}`;
  vi.clearAllMocks();
});

describe("draft storage", () => {
  it("returns exactly what was saved", async () => {
    const code = 'const greeting = "नमस्ते 👋";\n\tconsole.log(greeting);\n';
    await writeDraft(group, "alice", "src/index.js", code);
    expect(await readDraft(group, "alice", "src/index.js")).toBe(code);
  });

  it("returns null for a file that was never saved", async () => {
    expect(await readDraft(group, "alice", "missing.js")).toBeNull();
  });

  it("keeps an empty file as empty, not as missing", async () => {
    await writeDraft(group, "alice", "empty.txt", "");
    expect(await readDraft(group, "alice", "empty.txt")).toBe("");
  });

  it("a second save replaces the first", async () => {
    await writeDraft(group, "alice", "a.txt", "one");
    await writeDraft(group, "alice", "a.txt", "two");
    expect(await readDraft(group, "alice", "a.txt")).toBe("two");
  });

  it("handles folders and awkward file names", async () => {
    const path = "docs/my notes/día 1 (final).md";
    await writeDraft(group, "alice", path, "# notes");
    expect(await readDraft(group, "alice", path)).toBe("# notes");
  });

  it("keeps each person's drafts separate", async () => {
    await writeDraft(group, "alice", "a.txt", "alice's version");
    await writeDraft(group, "bob", "a.txt", "bob's version");

    expect(await readDraft(group, "alice", "a.txt")).toBe("alice's version");
    expect(await readDraft(group, "bob", "a.txt")).toBe("bob's version");
    expect(await readDraft("another-group", "alice", "a.txt")).toBeNull();
  });

  it("deleting removes the draft, and deleting again is harmless", async () => {
    await writeDraft(group, "alice", "a.txt", "content");
    await deleteDraft(group, "alice", "a.txt");
    expect(await readDraft(group, "alice", "a.txt")).toBeNull();

    await expect(deleteDraft(group, "alice", "a.txt")).resolves.toBeUndefined();
  });

  it("restoring brings back the original from the repo", async () => {
    mocked(readFileRawBuffer).mockResolvedValue(Buffer.from("original from repo"));
    await writeDraft(group, "alice", "a.txt", "edited");
    await deleteDraft(group, "alice", "a.txt");

    await restoreDraft(group, "alice", "main", "a.txt");

    expect(readFileRawBuffer).toHaveBeenCalledWith(group, "main", "a.txt");
    expect(await readDraft(group, "alice", "a.txt")).toBe("original from repo");
  });

  it("restoring a file the repo never had does nothing", async () => {
    mocked(readFileRawBuffer).mockRejectedValue(new Error("not in repo"));
    await restoreDraft(group, "alice", "main", "brand-new.txt");
    expect(await readDraft(group, "alice", "brand-new.txt")).toBeNull();
  });

  it("clearing removes all of one person's drafts and nobody else's", async () => {
    await writeDraft(group, "alice", "a.txt", "1");
    await writeDraft(group, "alice", "src/b.txt", "2");
    await writeDraft(group, "alice", "src/deep/c.txt", "3");
    await writeDraft(group, "bob", "a.txt", "bob keeps this");
    // "alice2" starts with "alice": a sloppy prefix match would wipe theirs too
    await writeDraft(group, "alice2", "a.txt", "alice2 keeps this");

    await clearDrafts(group, "alice");

    expect(await readDraft(group, "alice", "a.txt")).toBeNull();
    expect(await readDraft(group, "alice", "src/b.txt")).toBeNull();
    expect(await readDraft(group, "alice", "src/deep/c.txt")).toBeNull();
    expect(await readDraft(group, "bob", "a.txt")).toBe("bob keeps this");
    expect(await readDraft(group, "alice2", "a.txt")).toBe("alice2 keeps this");
  });

  it("clearing when there are no drafts is harmless", async () => {
    await expect(clearDrafts(group, "nobody")).resolves.toBeUndefined();
  });
});
