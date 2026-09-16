import { describe, expect, it } from "vitest";
import { wouldCreateCycle } from "../../app/api/workspace/[groupId]/planning/_shared";

/**
 * The Workflow graph must stay acyclic: both the node layout and any later
 * schedule ordering walk the edges, and a loop makes that non-terminating.
 * These cover the shapes that actually reach the route.
 */
describe("wouldCreateCycle", () => {
  it("allows an edge into an empty graph", () => {
    expect(wouldCreateCycle([], "a", "b")).toBe(false);
  });

  it("allows a chain to extend", () => {
    const edges = [{ blockerId: "a", dependentId: "b" }];
    expect(wouldCreateCycle(edges, "b", "c")).toBe(false);
  });

  it("rejects the direct reverse of an existing edge", () => {
    const edges = [{ blockerId: "a", dependentId: "b" }];
    expect(wouldCreateCycle(edges, "b", "a")).toBe(true);
  });

  it("rejects a longer loop closing back to the start", () => {
    const edges = [
      { blockerId: "a", dependentId: "b" },
      { blockerId: "b", dependentId: "c" },
    ];
    // c -> a would close a -> b -> c -> a.
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });

  it("allows a diamond — two paths to one task is not a cycle", () => {
    const edges = [
      { blockerId: "a", dependentId: "b" },
      { blockerId: "a", dependentId: "c" },
    ];
    expect(wouldCreateCycle(edges, "b", "d")).toBe(false);
    expect(wouldCreateCycle(edges, "c", "d")).toBe(false);
  });

  it("ignores unrelated components", () => {
    const edges = [
      { blockerId: "x", dependentId: "y" },
      { blockerId: "y", dependentId: "z" },
    ];
    expect(wouldCreateCycle(edges, "a", "b")).toBe(false);
  });

  /**
   * A cycle already in the data (only reachable if rows were written outside
   * this route) must not hang the walk — the `seen` set is what prevents it.
   */
  it("terminates when the stored graph already contains a loop", () => {
    const edges = [
      { blockerId: "a", dependentId: "b" },
      { blockerId: "b", dependentId: "a" },
    ];
    expect(wouldCreateCycle(edges, "b", "c")).toBe(false);
  });
});
