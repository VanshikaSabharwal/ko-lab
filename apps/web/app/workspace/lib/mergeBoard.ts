import type { Edge, Node } from "@xyflow/react";

// Three-way merge of a node-graph board (mind map, database, UI design).
//
// Used when a save is refused because someone else saved first: `base` is the
// board as this browser last saved or loaded it, `mine` is what's on screen,
// `theirs` is what the server holds now. Elements are matched by id, so
// different people's changes to different elements all survive, and for an
// element both changed, each property keeps whichever side changed it.

export interface Graph {
  nodes: Node[];
  edges: Edge[];
}

// React Flow writes these while you interact; they aren't anyone's edit
const TRANSIENT = new Set(["selected", "dragging", "resizing", "measured", "positionAbsolute"]);

function stable(value: unknown): string {
  return JSON.stringify(value, (key, v) => {
    if (TRANSIENT.has(key)) return undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/** Field-by-field: whichever side changed a field wins it; mine wins if both did. */
function mergeObject<T extends Record<string, any>>(base: T, mine: T, theirs: T): T {
  const result: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const b = base[key];
    const m = mine[key];
    const t = theirs[key];
    if (same(m, b)) {
      if (t !== undefined) result[key] = t;
    } else if (same(t, b)) {
      if (m !== undefined) result[key] = m;
    } else if (key === "data" && m && t && typeof m === "object" && typeof t === "object") {
      // Two people edited different properties of the same element
      result[key] = mergeObject(b ?? {}, m, t);
    } else if (m !== undefined) {
      result[key] = m;
    }
  }
  return result as T;
}

function mergeById<T extends { id: string }>(base: T[], mine: T[], theirs: T[]): T[] {
  const b = new Map(base.map((x) => [x.id, x]));
  const m = new Map(mine.map((x) => [x.id, x]));
  const t = new Map(theirs.map((x) => [x.id, x]));

  const pick = (id: string): T | undefined => {
    const [bx, mx, tx] = [b.get(id), m.get(id), t.get(id)];
    if (!bx) return mx ?? tx; // added (by one side, or both with the same id)
    if (!mx && !tx) return undefined; // deleted on both sides
    if (!mx) return same(tx, bx) ? undefined : tx; // I deleted it; keep it only if they edited it
    if (!tx) return same(mx, bx) ? undefined : mx; // they deleted it; keep it only if I edited it
    return mergeObject(bx, mx, tx);
  };

  // Their order first (it's what everyone else sees), then my additions
  const order = [...theirs.map((x) => x.id), ...mine.map((x) => x.id).filter((id) => !t.has(id))];
  return order.map(pick).filter((x): x is T => x !== undefined);
}

/** A group container must come before the nodes inside it, or React Flow drops them. */
function parentsFirst(nodes: Node[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = new Set<string>();
  const out: Node[] = [];
  const place = (n: Node, seen = new Set<string>()) => {
    if (placed.has(n.id) || seen.has(n.id)) return;
    seen.add(n.id);
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) place(parent, seen);
    placed.add(n.id);
    out.push(n);
  };
  nodes.forEach((n) => place(n));
  // A child whose container is gone would vanish: show it at the top level
  return out.map((n) => (n.parentId && !byId.has(n.parentId) ? { ...n, parentId: undefined } : n));
}

export function mergeBoards(base: Graph, mine: Graph, theirs: Graph): Graph {
  const nodes = parentsFirst(mergeById(base.nodes, mine.nodes, theirs.nodes));
  const ids = new Set(nodes.map((n) => n.id));
  // An edge to a node that no longer exists would point at nothing
  const edges = mergeById(base.edges, mine.edges, theirs.edges).filter(
    (e) => ids.has(e.source) && ids.has(e.target),
  );
  return { nodes, edges };
}

/** Whether two boards hold the same content, ignoring selection and other UI state. */
export const sameBoard = (a: Graph, b: Graph) => same(a, b);
