import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";

/** Lezer keeps parsing after a mistake, so one typo can cascade; show at most this many. */
export const MAX_SYNTAX_ERRORS = 20;
/** Errors this close together are reported as one. */
const MERGE_LINES = 2;
/** Don't block typing waiting for a slow parse; skip this pass instead. */
const PARSE_BUDGET_MS = 200;

/**
 * Syntax errors from the language's own parse tree (JS/TS only). Type errors
 * are not detected — the UI says "Syntax errors only".
 */
export function syntaxDiagnostics(state: EditorState): Diagnostic[] {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS);
  if (!tree) return [];

  const found: Diagnostic[] = [];
  let lastLine = -Infinity;
  tree.iterate({
    enter(node) {
      if (found.length >= MAX_SYNTAX_ERRORS) return false;
      if (!node.type.isError) return;

      const line = state.doc.lineAt(node.from).number;
      if (line - lastLine <= MERGE_LINES) {
        // Same mistake, still recovering: widen the previous mark instead
        const prev = found[found.length - 1]!;
        prev.to = Math.max(prev.to, node.to);
        lastLine = line;
        return;
      }
      lastLine = line;

      // An empty error node marks a missing token; point at what follows it
      const end = node.to > node.from ? node.to : Math.min(state.doc.length, node.from + 1);
      const token = state.doc.sliceString(node.from, end).trim().slice(0, 20);
      found.push({
        from: node.from,
        to: end,
        severity: "error",
        message: token ? `Syntax error: unexpected "${token}"` : "Syntax error: unexpected end of input",
        source: "syntax",
      });
    },
  });
  return found;
}
