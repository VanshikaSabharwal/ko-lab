import { describe, it, expect } from "vitest";
import { applyChoices, conflictCount, isText, mergeText } from "../../app/lib/mergeText";

/**
 * Three-way merge of one file: keep what only one side changed, and mark the
 * lines both changed for the author to decide.
 */
const lines = (...l: string[]) => l.join("\n");

describe("mergeText", () => {
  const base = lines("a", "b", "c", "d", "e");

  it("keeps changes each side made to different lines", () => {
    const mine = lines("a", "B (mine)", "c", "d", "e");
    const theirs = lines("a", "b", "c", "D (main)", "e");

    const merged = mergeText(base, mine, theirs);

    expect(merged.clean).toBe(true);
    expect(applyChoices(merged.regions, [])).toBe(lines("a", "B (mine)", "c", "D (main)", "e"));
  });

  it("marks lines both sides changed as a conflict, with all three versions", () => {
    const merged = mergeText(base, lines("a", "mine", "c", "d", "e"), lines("a", "theirs", "c", "d", "e"));

    expect(merged.clean).toBe(false);
    expect(conflictCount(merged.regions)).toBe(1);
    expect(merged.regions).toEqual([
      { type: "ok", lines: ["a"] },
      { type: "conflict", mine: ["mine"], base: ["b"], theirs: ["theirs"] },
      { type: "ok", lines: ["c", "d", "e"] },
    ]);
  });

  it("treats the same change on both sides as no conflict", () => {
    const same = lines("a", "x", "c", "d", "e");
    expect(mergeText(base, same, same).clean).toBe(true);
  });

  it("handles a file both sides created from nothing", () => {
    const merged = mergeText("", "export const a = 1;", "export const a = 2;");
    expect(merged.clean).toBe(false);
  });

  it("keeps one side's additions at the end alongside the other's edits", () => {
    const merged = mergeText(base, lines(base, "f"), lines("A", "b", "c", "d", "e"));
    expect(merged.clean).toBe(true);
    expect(applyChoices(merged.regions, [])).toBe(lines("A", "b", "c", "d", "e", "f"));
  });
});

describe("applyChoices", () => {
  const { regions } = mergeText(
    lines("1", "2", "3", "4", "5", "6", "7"),
    lines("1", "mine-2", "3", "4", "5", "mine-6", "7"),
    lines("1", "main-2", "3", "4", "5", "main-6", "7"),
  );

  it("builds the file from a choice per conflict, in order", () => {
    expect(conflictCount(regions)).toBe(2);
    expect(applyChoices(regions, ["mine", "theirs"])).toBe(lines("1", "mine-2", "3", "4", "5", "main-6", "7"));
  });

  it("keeps both, the author's lines first", () => {
    expect(applyChoices(regions, ["both", "mine"])).toBe(
      lines("1", "mine-2", "main-2", "3", "4", "5", "mine-6", "7"),
    );
  });

  it("refuses to build a file with an undecided conflict", () => {
    expect(() => applyChoices(regions, ["mine"])).toThrow(/no choice/);
  });
});

describe("isText", () => {
  it("tells text from binary content", () => {
    expect(isText("hello")).toBe(true);
    expect(isText(null)).toBe(true);
    expect(isText("PNG\u0000\u0001")).toBe(false);
  });
});
