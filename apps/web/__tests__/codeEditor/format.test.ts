/**
 * Format on save must never stand between the user and a save: unsupported
 * files and code that doesn't parse come back as null ("save it as typed").
 */
import { describe, it, expect } from "vitest";
import { canFormat, formatSource } from "../../app/code-editor/[groupId]/[githubRepo]/lib/format";

const spaces = { tabWidth: 2, useTabs: false };

describe("formatSource", () => {
  it("formats JavaScript", async () => {
    expect(await formatSource("src/a.js", "const a={b:1}\n", spaces)).toBe("const a = { b: 1 };\n");
  });

  it("formats TypeScript", async () => {
    expect(await formatSource("a.ts", "function f(x:number){return x}", spaces)).toBe(
      "function f(x: number) {\n  return x;\n}\n",
    );
  });

  it("formats JSON, CSS, HTML, Markdown and YAML", async () => {
    expect(await formatSource("a.json", '{"a":1,\n"b":[1,2]}', spaces)).toBe('{ "a": 1, "b": [1, 2] }\n');
    expect(await formatSource("a.css", "a{color:red}", spaces)).toBe("a {\n  color: red;\n}\n");
    expect(await formatSource("a.html", "<p>hi</p>", spaces)).toBe("<p>hi</p>\n");
    expect(await formatSource("a.md", "*  item", spaces)).toBe("- item\n");
    expect(await formatSource("a.yml", "a:   1", spaces)).toBe("a: 1\n");
  });

  it("follows the indent settings", async () => {
    const source = "function f(){return 1}";
    expect(await formatSource("a.js", source, { tabWidth: 4, useTabs: false })).toBe(
      "function f() {\n    return 1;\n}\n",
    );
    expect(await formatSource("a.js", source, { tabWidth: 2, useTabs: true })).toBe(
      "function f() {\n\treturn 1;\n}\n",
    );
  });

  it("returns null for code that doesn't parse", async () => {
    expect(await formatSource("a.js", "const = ;", spaces)).toBeNull();
  });

  it("returns null for a file type it doesn't handle", async () => {
    expect(canFormat("main.py")).toBe(false);
    expect(await formatSource("main.py", "x=1", spaces)).toBeNull();
  });
});
