/**
 * JS/TS syntax linting from the Lezer parse tree. Lezer keeps parsing after a
 * mistake, so nearby errors are merged and the total is capped; the dialect
 * must match the file or valid JSX/TS would be flagged.
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { MAX_SYNTAX_ERRORS, syntaxDiagnostics } from "../../app/code-editor/[groupId]/[githubRepo]/lib/syntaxLint";
import { hasLinter, hasSyntaxLinter } from "../../app/code-editor/[groupId]/[githubRepo]/lib/fileTypes";

function lint(doc: string, config: { jsx?: boolean; typescript?: boolean } = {}) {
  return syntaxDiagnostics(EditorState.create({ doc, extensions: [javascript(config)] }));
}

describe("syntaxDiagnostics", () => {
  it("reports one error for a missing expression", () => {
    const found = lint("const x = ;\nconsole.log(x);\n");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("error");
    expect(found[0]!.message).toMatch(/^Syntax error/);
  });

  it("finds nothing in valid JavaScript", () => {
    expect(lint("import fs from 'fs';\nconst add = (a, b) => a + b;\nexport default add;\n")).toEqual([]);
  });

  it("accepts JSX when the dialect has it on", () => {
    expect(lint("const App = () => <div className=\"x\">{1}</div>;\n", { jsx: true })).toEqual([]);
  });

  it("accepts TypeScript when the dialect has it on", () => {
    const ts = "interface User { id: string }\nconst get = <T,>(x: T): T => x;\nlet u: User | null = null;\n";
    expect(lint(ts, { typescript: true })).toEqual([]);
    expect(lint("const App = (p: { a: number }) => <b>{p.a}</b>;\n", { jsx: true, typescript: true })).toEqual([]);
  });

  it("merges errors on nearby lines into one", () => {
    expect(lint("function f( {\n  return 1 +;\n}\n")).toHaveLength(1);
  });

  it(`caps at ${MAX_SYNTAX_ERRORS} errors`, () => {
    const broken = Array.from({ length: 200 }, () => "const = ;\n\n\n\n").join("");
    const found = lint(broken);
    expect(found.length).toBeGreaterThan(1);
    expect(found.length).toBeLessThanOrEqual(MAX_SYNTAX_ERRORS);
  });
});

describe("linter availability", () => {
  it("covers JS/TS and JSON, not type declarations or other languages", () => {
    for (const f of ["a.js", "a.jsx", "a.ts", "a.tsx", "a.mjs", "a.cts"]) expect(hasSyntaxLinter(f)).toBe(true);
    expect(hasSyntaxLinter("types.d.ts")).toBe(false);
    expect(hasSyntaxLinter("main.py")).toBe(false);
    expect(hasLinter("package.json")).toBe(true);
    expect(hasLinter("main.py")).toBe(false);
  });
});
