import { diff3Merge } from "node-diff3";

// Three-way merge of one file, the way Git does it: given the version both
// sides started from (base), a change request's version (mine) and the latest
// main (theirs), keep every change that only one side made, and mark where
// both changed the same lines. Pure, so the conflict screen and the server
// that commits the result agree line for line.

export type MergeRegion =
  | { type: "ok"; lines: string[] }
  | { type: "conflict"; mine: string[]; base: string[]; theirs: string[] };

export interface TextMerge {
  /** True when every change merged on its own. */
  clean: boolean;
  regions: MergeRegion[];
}

/** How the author settles one conflict. */
export type ConflictChoice = "mine" | "theirs" | "both";

const toLines = (text: string) => (text === "" ? [] : text.split("\n"));

export function mergeText(base: string, mine: string, theirs: string): TextMerge {
  if (mine === theirs) return { clean: true, regions: [{ type: "ok", lines: toLines(mine) }] };

  const regions: MergeRegion[] = [];
  for (const part of diff3Merge(toLines(mine), toLines(base), toLines(theirs), {
    excludeFalseConflicts: true,
  })) {
    if (part.ok) {
      // Consecutive agreed parts read as one block
      const last = regions[regions.length - 1];
      if (last?.type === "ok") last.lines.push(...part.ok);
      else regions.push({ type: "ok", lines: [...part.ok] });
    } else if (part.conflict) {
      regions.push({
        type: "conflict",
        mine: part.conflict.a,
        base: part.conflict.o,
        theirs: part.conflict.b,
      });
    }
  }
  return { clean: regions.every((r) => r.type === "ok"), regions };
}

/**
 * The file's text once each conflict has been settled, in order. Throws if a
 * conflict has no choice, so a half-resolved file can never be committed.
 */
export function applyChoices(regions: MergeRegion[], choices: ConflictChoice[]): string {
  const lines: string[] = [];
  let next = 0;
  for (const region of regions) {
    if (region.type === "ok") {
      lines.push(...region.lines);
      continue;
    }
    const choice = choices[next++];
    if (choice === "mine") lines.push(...region.mine);
    else if (choice === "theirs") lines.push(...region.theirs);
    else if (choice === "both") lines.push(...region.mine, ...region.theirs);
    else throw new Error(`Conflict ${next} has no choice`);
  }
  return lines.join("\n");
}

export const conflictCount = (regions: MergeRegion[]) =>
  regions.filter((r) => r.type === "conflict").length;

/** Text the browser can show and edit. Binary files are settled by picking a side. */
export const isText = (content: string | null) => content === null || !content.includes("\u0000");
