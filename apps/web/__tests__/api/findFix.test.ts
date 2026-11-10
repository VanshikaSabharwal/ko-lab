/**
 * Helpers behind the editor's "Find fix": what leaves the server must be
 * redacted, and the search query must keep package names but drop the user's
 * own identifiers, paths and positions.
 */
import { describe, it, expect } from "vitest";
import {
  errorLineFor,
  extractRunError,
  normalizeError,
  rankResults,
  redactSecrets,
  snippetAround,
  validateCitations,
} from "../../app/lib/findFix";
import { memoryStore } from "../../app/lib/redis";

describe("redactSecrets", () => {
  it.each([
    ["connect ECONNREFUSED postgres://admin:hunter2@db.example.com:5432/app", "hunter2"],
    ["mongodb+srv://user:p%40ss@cluster0.mongodb.net", "p%40ss"],
    ["Invalid API key sk-proj-abcdEFGH1234567890abcdEFGH", "sk-proj-abcdEFGH1234567890abcdEFGH"],
    ["GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz123456", "gsk_abcdefghijklmnopqrstuvwxyz123456"],
    ["remote: ghp_abcdefghijklmnopqrstuvwxyz0123456789 denied", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["aws key AKIAIOSFODNN7EXAMPLE rejected", "AKIAIOSFODNN7EXAMPLE"],
    [
      "jwt malformed: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "eyJhbGciOiJIUzI1NiJ9",
    ],
    ["db error password=s3cr3t host=localhost", "s3cr3t"],
    ['config {"apiKey": "abc123def456"} invalid', "abc123def456"],
    ["Authorization: Bearer abcdefghijklmnop12345", "abcdefghijklmnop12345"],
  ])("removes the secret from %s", (input, secret) => {
    const out = redactSecrets(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  it("keeps scheme and host of a connection string", () => {
    expect(redactSecrets("postgres://u:p@db.local:5432/x")).toBe("postgres://[REDACTED]@db.local:5432/x");
  });

  it("redacts .env lines in snippets", () => {
    const snippet = "DATABASE_HOST=prod.internal\nconst x = 1;\nexport STRIPE_KEY=whatever";
    const out = redactSecrets(snippet, { envLines: true });
    expect(out).not.toContain("prod.internal");
    expect(out).not.toContain("whatever");
    expect(out).toContain("const x = 1;");
  });

  it("leaves git SHAs and integrity hashes alone", () => {
    const sha = "fatal: bad object 9fceb02d0ae598e95dc970b74767f19372d61af8";
    expect(redactSecrets(sha)).toBe(sha);
    const integrity =
      "EINTEGRITY sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUR3RTe5BmCnOKP7og==";
    expect(redactSecrets(integrity)).toBe(integrity);
  });
});

describe("normalizeError", () => {
  it("keeps the module name in module-not-found errors", () => {
    expect(normalizeError("Error: Cannot find module 'express'")).toContain("'express'");
    expect(normalizeError("ModuleNotFoundError: No module named 'numpy'")).toContain("'numpy'");
    expect(normalizeError("Module not found: Can't resolve '@tanstack/react-query'")).toContain(
      "'@tanstack/react-query'",
    );
  });

  it("strips the user's own identifiers", () => {
    expect(normalizeError("TypeError: myHandler is not a function")).toBe("TypeError: is not a function");
    expect(normalizeError("TypeError: Cannot read properties of undefined (reading 'userName')")).toBe(
      "TypeError: Cannot read properties of undefined (reading property)",
    );
    expect(normalizeError("NameError: name 'totl' is not defined")).toBe("NameError: name is not defined");
  });

  it("removes ANSI codes, paths, line numbers and stack frames", () => {
    const raw =
      "\x1b[31m/home/me/proj/src/app.js:12\x1b[0m\nReferenceError: foo is not defined\n    at Object.<anonymous> (/home/me/proj/src/app.js:12:5)\n    at Module._compile (node:internal/modules/cjs/loader:1256:14)";
    const out = normalizeError(raw);
    expect(out).toBe("ReferenceError: is not defined");
  });

  it("removes relative and Windows paths", () => {
    expect(normalizeError("SyntaxError: Unexpected token in ./src/index.ts:4:2")).not.toContain("src");
    expect(normalizeError("Error: EACCES C:\\Users\\me\\app\\data.json")).not.toContain("Users");
  });

  it("caps the query length", () => {
    expect(normalizeError("Error: " + "x ".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe("extractRunError", () => {
  it("returns the stderr tail", () => {
    const out = extractRunError(
      [
        { stream: "stdout", text: "hello\n" },
        { stream: "stderr", text: "Traceback...\nZeroDivisionError: division by zero\n" },
      ],
      { code: 1, reason: "exit" },
    );
    expect(out).toContain("ZeroDivisionError");
    expect(out).not.toContain("hello");
  });

  it("describes failures without stderr", () => {
    expect(extractRunError([], { code: 0, reason: "timeout" })).toMatch(/timed out/);
    expect(extractRunError([], { code: 2, reason: "exit" })).toMatch(/code 2/);
  });

  it("returns null for a clean or stopped run", () => {
    expect(extractRunError([{ stream: "stdout", text: "ok" }], { code: 0, reason: "exit" })).toBeNull();
    expect(extractRunError([], { code: 0, reason: "stopped" })).toBeNull();
    expect(extractRunError([], null)).toBeNull();
  });
});

describe("snippetAround / errorLineFor", () => {
  const doc = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");

  it("returns numbered lines around the error with a marker", () => {
    const s = snippetAround(doc, 25, 2);
    expect(s.split("\n")).toHaveLength(5);
    expect(s).toContain("25> line 25");
  });

  it("clamps at the start of the file", () => {
    expect(snippetAround(doc, 1, 3).split("\n")[0]).toContain("line 1");
  });

  it("finds the line for the file in Node and Python errors", () => {
    expect(errorLineFor("at main (/x/app.js:12:5)", "app.js")).toBe(12);
    expect(errorLineFor('File "main.py", line 4, in <module>', "main.py")).toBe(4);
    expect(errorLineFor("no position", "app.js")).toBeNull();
  });
});

describe("validateCitations", () => {
  it("drops citations that point past the results", () => {
    expect(validateCitations("Use await [1][7]. See [2].", 5)).toBe("Use await [1]. See [2].");
    expect(validateCitations("Fix it [0] [3].", 2)).toBe("Fix it.");
  });
});

describe("rankResults", () => {
  it("puts Stack Overflow and GitHub first, keeping order otherwise", () => {
    const ranked = rankResults([
      { title: "a", link: "https://blog.example.com/a", snippet: "" },
      { title: "b", link: "https://stackoverflow.com/q/1", snippet: "" },
      { title: "c", link: "https://github.com/x/y/issues/1", snippet: "" },
    ]);
    expect(ranked.map((r) => r.title)).toEqual(["b", "c", "a"]);
  });
});

describe("memoryStore", () => {
  it("limits per user per hour and frees up after the window", async () => {
    let t = 0;
    const store = memoryStore(() => t);
    for (let i = 0; i < 5; i++) expect((await store.limit("u")).success).toBe(true);
    expect((await store.limit("u")).success).toBe(false);
    expect((await store.limit("other")).success).toBe(true);
    t += 60 * 60 * 1000 + 1;
    expect((await store.limit("u")).success).toBe(true);
  });

  it("expires cached results after a day", async () => {
    let t = 0;
    const store = memoryStore(() => t);
    await store.setCache("k", [{ title: "t", link: "https://x.dev", snippet: "" }]);
    expect(await store.getCache("k")).toHaveLength(1);
    t += 24 * 60 * 60 * 1000 + 1;
    expect(await store.getCache("k")).toBeNull();
  });

  it("enforces the monthly cap and gives back released calls", async () => {
    const store = memoryStore();
    expect(await store.reserveMonthly(1)).toBe(true);
    expect(await store.reserveMonthly(1)).toBe(false);
    await store.releaseMonthly();
    expect(await store.reserveMonthly(1)).toBe(true);
  });
});
