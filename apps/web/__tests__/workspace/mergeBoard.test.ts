import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { mergeBoards, sameBoard } from "../../app/workspace/lib/mergeBoard";

/**
 * When two people save a board at the same time, both sets of changes must
 * survive. The later save used to replace the board wholesale.
 */
const node = (id: string, x = 0, data: Record<string, unknown> = {}, extra: Partial<Node> = {}): Node => ({
  id,
  position: { x, y: 0 },
  data: { label: id, ...data },
  ...extra,
});
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target });

const base = { nodes: [node("a"), node("b"), node("c")], edges: [edge("e1", "a", "b")] };
const ids = (g: { nodes: Node[] }) => g.nodes.map((n) => n.id);

describe("mergeBoards", () => {
  it("keeps elements each person added", () => {
    const mine = { ...base, nodes: [...base.nodes, node("mine")] };
    const theirs = { ...base, nodes: [...base.nodes, node("theirs")] };
    expect(ids(mergeBoards(base, mine, theirs))).toEqual(["a", "b", "c", "theirs", "mine"]);
  });

  it("keeps each person's edits to different elements", () => {
    const mine = { ...base, nodes: [node("a", 100), node("b"), node("c")] };
    const theirs = { ...base, nodes: [node("a"), node("b", 0, { label: "renamed" }), node("c")] };
    const merged = mergeBoards(base, mine, theirs);
    expect(merged.nodes[0]!.position.x).toBe(100);
    expect(merged.nodes[1]!.data.label).toBe("renamed");
  });

  it("keeps both when two people change different properties of one element", () => {
    const mine = { ...base, nodes: [node("a", 0, { fill: "#f00" }), node("b"), node("c")] };
    const theirs = { ...base, nodes: [node("a", 50, { label: "Header" }), node("b"), node("c")] };
    const [a] = mergeBoards(base, mine, theirs).nodes;
    expect(a!.data).toEqual({ label: "Header", fill: "#f00" });
    expect(a!.position.x).toBe(50);
  });

  it("lets my change win when both changed the same property", () => {
    const mine = { ...base, nodes: [node("a", 0, { label: "mine" }), node("b"), node("c")] };
    const theirs = { ...base, nodes: [node("a", 0, { label: "theirs" }), node("b"), node("c")] };
    expect(mergeBoards(base, mine, theirs).nodes[0]!.data.label).toBe("mine");
  });

  it("applies deletions the other side didn't touch", () => {
    const mine = { nodes: [node("a"), node("c")], edges: [] }; // deleted b and its edge
    const merged = mergeBoards(base, mine, base);
    expect(ids(merged)).toEqual(["a", "c"]);
    expect(merged.edges).toEqual([]);
  });

  it("doesn't throw away an element someone was editing while another person deleted it", () => {
    const mine = { nodes: [node("a"), node("c")], edges: [] }; // I deleted b
    const theirs = { ...base, nodes: [node("a"), node("b", 0, { label: "edited" }), node("c")] };
    expect(ids(mergeBoards(base, mine, theirs))).toContain("b");
  });

  it("drops edges whose ends no longer exist", () => {
    const mine = { ...base, edges: [...base.edges, edge("e2", "b", "c")] };
    const theirs = { nodes: [node("a"), node("b")], edges: base.edges }; // c deleted
    const merged = mergeBoards(base, mine, theirs);
    expect(merged.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("puts a group container before the nodes inside it", () => {
    const mine = {
      ...base,
      nodes: [node("a", 0, {}, { parentId: "group" }), node("b"), node("c"), node("group")],
    };
    const merged = mergeBoards(base, mine, base);
    expect(ids(merged).indexOf("group")).toBeLessThan(ids(merged).indexOf("a"));
  });

  it("brings a node out of a group that no longer exists", () => {
    const withGroup = { ...base, nodes: [node("group"), node("a", 0, {}, { parentId: "group" }), node("b"), node("c")] };
    const theirs = { ...withGroup, nodes: withGroup.nodes.filter((n) => n.id !== "group") };
    const mine = { ...withGroup, nodes: withGroup.nodes.map((n) => (n.id === "a" ? node("a", 9, {}, { parentId: "group" }) : n)) };
    const a = mergeBoards(withGroup, mine, theirs).nodes.find((n) => n.id === "a")!;
    expect(a.parentId).toBeUndefined();
  });

  it("ignores selection and other on-screen state when comparing", () => {
    const selected = { ...base, nodes: base.nodes.map((n) => ({ ...n, selected: true, measured: { width: 9, height: 9 } })) };
    expect(sameBoard(base, selected)).toBe(true);
    expect(sameBoard(base, { ...base, nodes: [node("a", 1), node("b"), node("c")] })).toBe(false);
  });
});
