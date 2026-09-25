"use client";

import type { DirectoryNode, FileSystemTree, WebContainer } from "@webcontainer/api";

// One WebContainer per page (the API allows only one boot at a time). It runs
// real Node + npm inside this browser tab, so it lives as long as the tab does:
// nothing runs on our servers and nothing is reachable by anyone else.

let container: Promise<WebContainer> | null = null;
/** Set once project files are mounted; saves are mirrored into it from then. */
let mounted = false;

/** Why the terminal can't start in this browser/page, or null if it can. */
export function unsupportedReason(): string | null {
  if (typeof window === "undefined") return "Not available during server rendering.";
  if (!window.crossOriginIsolated) return "isolation";
  if (typeof SharedArrayBuffer === "undefined") {
    return "This browser doesn't support the in-browser terminal. Use a recent Chrome, Edge or Firefox.";
  }
  return null;
}

export function getWebContainer(): Promise<WebContainer> {
  container ??= import("@webcontainer/api")
    .then(({ WebContainer }) => WebContainer.boot({ coep: "credentialless", workdirName: "project" }))
    .catch((err) => {
      container = null; // let the next attempt boot again
      throw err;
    });
  return container;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function addToTree(tree: FileSystemTree, path: string, contents: Uint8Array) {
  const parts = path.split("/");
  let dir = tree;
  for (const part of parts.slice(0, -1)) {
    const node = (dir[part] ??= { directory: {} }) as DirectoryNode;
    dir = node.directory;
  }
  dir[parts[parts.length - 1]!] = { file: { contents } };
}

/**
 * Replace the container's project files with the branch + the user's drafts.
 * node_modules is kept, so reloading files doesn't mean reinstalling.
 */
export async function loadProjectFiles(
  groupId: string,
  branch: string,
  onProgress: (text: string) => void,
): Promise<{ branch: string; paths: string[] }> {
  const wc = await getWebContainer();

  onProgress("Downloading project files…");
  const params = new URLSearchParams({ groupId, branch });
  const res = await fetch(`/api/workspace-snapshot?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't load the project files");

  const files = data.files as { path: string; base64?: string }[];
  const tree: FileSystemTree = {};
  const large = files.filter((f) => f.base64 === undefined);
  for (const f of files) if (f.base64 !== undefined) addToTree(tree, f.path, decodeBase64(f.base64));

  for (const [i, f] of large.entries()) {
    onProgress(`Downloading large files ${i + 1}/${large.length}…`);
    const r = await fetch(`/api/workspace-snapshot?${new URLSearchParams({ groupId, branch, path: f.path })}`);
    if (!r.ok) throw new Error(`Couldn't download ${f.path}`);
    addToTree(tree, f.path, new Uint8Array(await r.arrayBuffer()));
  }

  onProgress("Copying files into the terminal…");
  for (const entry of await wc.fs.readdir("/")) {
    if (entry !== "node_modules") await wc.fs.rm(entry, { recursive: true, force: true });
  }
  await wc.mount(tree);
  mounted = true;
  return { branch: data.branch as string, paths: files.map((f) => f.path) };
}

/** Mirror a saved file into the running container, if there is one. */
export async function syncFileToContainer(path: string, content: string): Promise<void> {
  if (!container || !mounted) return;
  const wc = await container;
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir) await wc.fs.mkdir(dir, { recursive: true });
  await wc.fs.writeFile(path, content);
}

/** A starting command for the project, based on its package.json. */
export async function suggestedCommand(paths: string[]): Promise<string | null> {
  if (!paths.includes("package.json")) {
    const entry = ["index.js", "main.js", "app.js", "server.js"].find((p) => paths.includes(p));
    return entry ? `node ${entry}` : null;
  }
  try {
    const wc = await getWebContainer();
    const pkg = JSON.parse(await wc.fs.readFile("package.json", "utf-8"));
    if (pkg.scripts?.dev) return "npm install && npm run dev";
    if (pkg.scripts?.start) return "npm install && npm start";
    const main = pkg.main || ["index.js", "server.js", "app.js"].find((p) => paths.includes(p));
    return main ? `npm install && node ${main}` : "npm install";
  } catch {
    return "npm install";
  }
}
