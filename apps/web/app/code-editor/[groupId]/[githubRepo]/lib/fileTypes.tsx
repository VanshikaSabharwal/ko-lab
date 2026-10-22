import React from "react";
import { FileText, FileCode, FileJson, File } from "lucide-react";

/**
 * File-type icons, labels and file-tree shaping. Language modes are loaded
 * on demand in ./languages.
 *
 * Extracted from Editor.tsx unchanged — these are pure and shared by the tree,
 * the tab bar and the status bar, so they don't belong in a component.
 */

export interface CodeFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  content?: string;
  /** Has never been saved: its text is `content`, not something to fetch. */
  _generated?: boolean;
  /** Not in the repo: created by this user and waiting on a change request. */
  draft?: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: TreeNode[];
  file?: CodeFile;
}

const FILE_ICON_MAP: Record<
  string,
  { icon: React.ReactNode; color: string }
> = {
  ".js": { icon: <FileCode size={15} />, color: "text-yellow-400" },
  ".jsx": { icon: <FileCode size={15} />, color: "text-cyan-400" },
  ".ts": { icon: <FileCode size={15} />, color: "text-blue-400" },
  ".tsx": { icon: <FileCode size={15} />, color: "text-blue-500" },
  ".mjs": { icon: <FileCode size={15} />, color: "text-yellow-400" },
  ".cjs": { icon: <FileCode size={15} />, color: "text-yellow-400" },
  ".py": { icon: <FileCode size={15} />, color: "text-blue-300" },
  ".pyw": { icon: <FileCode size={15} />, color: "text-blue-300" },
  ".java": { icon: <FileCode size={15} />, color: "text-orange-400" },
  ".html": { icon: <FileCode size={15} />, color: "text-orange-500" },
  ".htm": { icon: <FileCode size={15} />, color: "text-orange-500" },
  ".css": { icon: <FileCode size={15} />, color: "text-pink-400" },
  ".scss": { icon: <FileCode size={15} />, color: "text-pink-400" },
  ".sass": { icon: <FileCode size={15} />, color: "text-pink-400" },
  ".less": { icon: <FileCode size={15} />, color: "text-pink-400" },
  ".json": { icon: <FileJson size={15} />, color: "text-yellow-300" },
  ".jsonc": { icon: <FileJson size={15} />, color: "text-yellow-300" },
  ".md": { icon: <FileText size={15} />, color: "text-gray-400" },
  ".mdx": { icon: <FileText size={15} />, color: "text-gray-400" },
  ".xml": { icon: <FileCode size={15} />, color: "text-purple-400" },
  ".yaml": { icon: <FileCode size={15} />, color: "text-red-400" },
  ".yml": { icon: <FileCode size={15} />, color: "text-red-400" },
  ".rs": { icon: <FileCode size={15} />, color: "text-orange-500" },
  ".php": { icon: <FileCode size={15} />, color: "text-indigo-400" },
  ".phtml": { icon: <FileCode size={15} />, color: "text-indigo-400" },
  ".sql": { icon: <FileCode size={15} />, color: "text-orange-300" },
  ".c": { icon: <FileCode size={15} />, color: "text-blue-400" },
  ".cpp": { icon: <FileCode size={15} />, color: "text-blue-400" },
  ".h": { icon: <FileCode size={15} />, color: "text-blue-300" },
  ".hpp": { icon: <FileCode size={15} />, color: "text-blue-300" },
  ".cs": { icon: <FileCode size={15} />, color: "text-green-400" },
  ".go": { icon: <FileCode size={15} />, color: "text-cyan-400" },
  ".rb": { icon: <FileCode size={15} />, color: "text-red-400" },
  ".vue": { icon: <FileCode size={15} />, color: "text-green-500" },
  ".svelte": { icon: <FileCode size={15} />, color: "text-orange-400" },
  ".astro": { icon: <FileCode size={15} />, color: "text-purple-500" },
  ".svg": { icon: <FileCode size={15} />, color: "text-yellow-300" },
  ".png": { icon: <FileCode size={15} />, color: "text-purple-400" },
  ".jpg": { icon: <FileCode size={15} />, color: "text-purple-400" },
  ".jpeg": { icon: <FileCode size={15} />, color: "text-purple-400" },
  ".gif": { icon: <FileCode size={15} />, color: "text-purple-400" },
  ".ico": { icon: <FileCode size={15} />, color: "text-purple-400" },
  ".webp": { icon: <FileCode size={15} />, color: "text-purple-400" },
};

export function getFileIcon(fileName: string) {
  const ext = "." + fileName.split(".").pop()?.toLowerCase();
  const match = FILE_ICON_MAP[ext];
  if (match) return match;
  const name = fileName.toLowerCase();
  if (name === "dockerfile")
    return { icon: <FileCode size={15} />, color: "text-blue-400" };
  if (name === "makefile")
    return { icon: <FileCode size={15} />, color: "text-orange-400" };
  if (name.startsWith(".env"))
    return { icon: <FileCode size={15} />, color: "text-yellow-300" };
  if (name === ".gitignore" || name === ".dockerignore")
    return { icon: <FileCode size={15} />, color: "text-gray-500" };
  return { icon: <File size={15} />, color: "text-gray-400" };
}

export function buildFileTree(files: CodeFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const map = new Map<string, TreeNode>();

  for (const file of files) {
    const parts = file.path.split("/");
    let currentPath = "";
    let currentLevel: (TreeNode[] | TreeNode)[] = root;

    parts.forEach((part, i) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      let existing = map.get(currentPath);
      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          type: i === parts.length - 1 ? "file" : "folder",
          children: [],
          file: i === parts.length - 1 ? file : undefined,
        };
        map.set(currentPath, existing);
        (currentLevel as TreeNode[]).push(existing);
      }
      currentLevel = existing.children;
    });
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root);

  return root;
}

export function findFileInTree(nodes: TreeNode[], path: string): CodeFile | undefined {
  for (const node of nodes) {
    if (node.type === "file" && node.path === path) return node.file;
    if (node.type === "folder") {
      const found = findFileInTree(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}


/** Human-readable language label for the status bar. */
const LANGUAGE_LABELS: Record<string, string> = {
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript",
  ".py": "Python", ".pyw": "Python",
  ".java": "Java",
  ".html": "HTML", ".htm": "HTML",
  ".css": "CSS", ".scss": "SCSS", ".sass": "Sass", ".less": "Less",
  ".json": "JSON", ".jsonc": "JSON",
  ".md": "Markdown", ".mdx": "Markdown",
  ".xml": "XML", ".svg": "SVG",
  ".yaml": "YAML", ".yml": "YAML",
  ".rs": "Rust", ".php": "PHP", ".sql": "SQL",
  ".c": "C", ".cpp": "C++", ".h": "C", ".hpp": "C++", ".cs": "C#",
  ".go": "Go", ".rb": "Ruby",
  ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
};

export function getLanguageLabel(fileName: string): string {
  if (!fileName) return "Plain Text";
  const ext = "." + fileName.split(".").pop()?.toLowerCase();
  return LANGUAGE_LABELS[ext] ?? "Plain Text";
}

/**
 * Whether we can report real diagnostics for this file.
 *
 * Only a few languages have a linter available in-browser. Everything else
 * shows "—" in the status bar rather than a "0" that would falsely imply the
 * file was checked and found clean.
 */
export function hasLinter(fileName: string): boolean {
  const ext = "." + fileName.split(".").pop()?.toLowerCase();
  return [".json", ".jsonc"].includes(ext);
}
