import { describe, expect, it } from "vitest";
import {
  getRunLanguage,
  joinPath,
  resolveJsImport,
} from "../../app/lib/codeRunner/paths";
import { collectFiles } from "../../app/lib/codeRunner/deps";
import { buildPreviewDocument } from "../../app/lib/codeRunner/htmlPreview";

/** A fake repo: collectFiles reads from here instead of the API. */
function repo(files: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    exists: (p: string) => p in files,
    read: async (p: string) => {
      reads.push(p);
      return files[p] ?? null;
    },
  };
}

describe("getRunLanguage", () => {
  it("maps runnable extensions and rejects the rest", () => {
    expect(getRunLanguage("src/index.ts")).toBe("typescript");
    expect(getRunLanguage("app.jsx")).toBe("javascript");
    expect(getRunLanguage("main.py")).toBe("python");
    expect(getRunLanguage("site/index.HTML")).toBe("html");
    expect(getRunLanguage("Main.java")).toBeNull();
    expect(getRunLanguage("Makefile")).toBeNull();
  });
});

describe("joinPath", () => {
  it("resolves dot segments", () => {
    expect(joinPath("src/lib", "../utils/x.ts")).toBe("src/utils/x.ts");
    expect(joinPath("src", "./a.js")).toBe("src/a.js");
    expect(joinPath("src/lib", "/root.js")).toBe("root.js");
  });

  it("refuses to climb above the repo root", () => {
    expect(joinPath("src", "../../etc/passwd")).toBeNull();
  });
});

describe("resolveJsImport", () => {
  const files = new Set(["src/utils.ts", "src/lib/index.js", "src/data.json", "src/helper.ts"]);
  const exists = (p: string) => files.has(p);

  it("tries extensions, index files and .js-to-.ts like bundlers do", () => {
    expect(resolveJsImport("src/main.ts", "./utils", exists)).toBe("src/utils.ts");
    expect(resolveJsImport("src/main.ts", "./lib", exists)).toBe("src/lib/index.js");
    expect(resolveJsImport("src/main.ts", "./data.json", exists)).toBe("src/data.json");
    expect(resolveJsImport("src/main.ts", "./helper.js", exists)).toBe("src/helper.ts");
  });

  it("returns null for missing files", () => {
    expect(resolveJsImport("src/main.ts", "./nope", exists)).toBeNull();
  });
});

describe("collectFiles", () => {
  it("follows relative JS/TS imports transitively and skips packages", async () => {
    const r = repo({
      "src/b.ts": `import { c } from "./c";\nexport const b = c;`,
      "src/c.ts": `export const c = 1;`,
      "src/unused.ts": `export {}`,
    });
    const entrySource = `import express from "express";\nimport { b } from "./b";\nconst x = require('./c');`;
    const result = await collectFiles({ entry: "src/a.ts", entrySource, ...r });

    expect(Object.keys(result.files).sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    // Each dependency is read once even when imported twice
    expect(r.reads.sort()).toEqual(["src/b.ts", "src/c.ts"]);
    expect(result.missing).toEqual([]);
  });

  it("finds Python modules beside the entry, packages and submodules", async () => {
    const r = repo({
      "app/helpers.py": "X = 1",
      "app/pkg/__init__.py": "",
      "app/pkg/tools.py": "from .inner import y",
      "app/pkg/inner.py": "y = 2",
    });
    const entrySource = "import helpers\nfrom pkg import tools\nimport os, sys";
    const result = await collectFiles({ entry: "app/main.py", entrySource, ...r });

    expect(Object.keys(result.files).sort()).toEqual([
      "app/helpers.py",
      "app/main.py",
      "app/pkg/__init__.py",
      "app/pkg/inner.py",
      "app/pkg/tools.py",
    ]);
  });

  it("collects an HTML page's local CSS and scripts but not CDN links", async () => {
    const r = repo({ "site/style.css": "body{}", "site/js/app.js": "import './util.js'", "site/js/util.js": "" });
    const entrySource = `<link rel="stylesheet" href="style.css"><script src="js/app.js"></script><script src="https://cdn.example.com/x.js"></script>`;
    const result = await collectFiles({ entry: "site/index.html", entrySource, ...r });

    expect(Object.keys(result.files).sort()).toEqual([
      "site/index.html",
      "site/js/app.js",
      "site/js/util.js",
      "site/style.css",
    ]);
  });

  it("reports imports that exist but couldn't be read", async () => {
    const result = await collectFiles({
      entry: "a.js",
      entrySource: `require("./b")`,
      exists: (p) => p === "b.js",
      read: async () => null,
    });
    expect(result.missing).toEqual(["b.js"]);
  });
});

describe("buildPreviewDocument", () => {
  it("inlines local CSS and JS and leaves external assets alone", () => {
    const html = buildPreviewDocument("site/index.html", {
      "site/index.html": `<html><head><link rel="stylesheet" href="./style.css"><script src="https://cdn.example.com/lib.js"></script></head><body><script src="app.js"></script></body></html>`,
      "site/style.css": "h1 { color: red }",
      "site/app.js": `console.log("</script>")`,
    });

    expect(html).toContain("<style>h1 { color: red }</style>");
    expect(html).toContain('src="https://cdn.example.com/lib.js"');
    expect(html).not.toContain('src="app.js"');
    // A literal </script> inside inlined code must not end the element early
    expect(html).toContain('console.log("<\\/script>")');
    // The console bridge runs before anything else
    expect(html.indexOf("__kolabPreview")).toBeLessThan(html.indexOf("cdn.example.com"));
  });
});
