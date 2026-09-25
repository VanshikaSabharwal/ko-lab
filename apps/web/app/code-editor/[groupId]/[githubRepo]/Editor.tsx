"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { rust } from "@codemirror/lang-rust";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { cpp } from "@codemirror/lang-cpp";
import { type Extension, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { hasLinter } from "./lib/fileTypes";
import CodeMirror from "@uiw/react-codemirror";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import toast from "react-hot-toast";
import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import IdeShell, { type IdeSection } from "./components/IdeShell";
import EditorTabs from "./components/EditorTabs";
import EditorBreadcrumb from "./components/EditorBreadcrumb";
import EditorStatusBar from "./components/EditorStatusBar";
import AiAssistantPanel from "./components/AiAssistantPanel";
import CollaborationPanel from "./components/CollaborationPanel";
import TrashPanel, { type TrashItem } from "./components/TrashPanel";
import OutputPanel from "./components/OutputPanel";
import SettingsPanel from "./components/SettingsPanel";
import { useIdeSettings } from "./lib/ideSettings";
import { useTheme } from "next-themes";
import LiveSiteControl from "./components/LiveSiteControl";
import { useLivePreview } from "./lib/useLivePreview";
import TerminalPanel, { OPEN_TERMINAL_AFTER_RELOAD_KEY } from "./components/TerminalPanel";
import { syncFileToContainer } from "./lib/webContainer";
import { useCodeRunner } from "../../../lib/codeRunner/useCodeRunner";
import { getRunLanguage } from "../../../lib/codeRunner/paths";
import LargeFileViewer from "./LargeFileViewer";
import ImagePreview from "./ImagePreview";
import { Bot } from "lucide-react";
import {
  FileText,
  Sparkles,
  X,
  Folder,
  FolderOpen,
  FileCode,
  FileJson,
  ChevronRight,
  ChevronDown,
  File,
  GitBranch,
  Trash2,
  Undo2,
  Play,
  Square,
} from "lucide-react";

interface CodeProps {
  github: string;
  group: string;
}

interface CodeFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  content?: string;
  _generated?: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: TreeNode[];
  file?: CodeFile;
}

const EXTENSION_MAP: Record<string, () => Extension> = {
  ".js": javascript,
  ".jsx": () => javascript({ jsx: true }),
  ".ts": () => javascript({ typescript: true }),
  ".tsx": () => javascript({ jsx: true, typescript: true }),
  ".mjs": javascript,
  ".cjs": javascript,
  ".py": python,
  ".pyw": python,
  ".java": java,
  ".html": html,
  ".htm": html,
  ".css": css,
  ".scss": css,
  ".sass": css,
  ".less": css,
  ".json": json,
  ".jsonc": json,
  ".md": markdown,
  ".mdx": markdown,
  ".xml": xml,
  ".svg": xml,
  ".yaml": yaml,
  ".yml": yaml,
  ".rs": rust,
  ".php": php,
  ".phtml": php,
  ".sql": sql,
  ".c": cpp,
  ".cpp": cpp,
  ".h": cpp,
  ".hpp": cpp,
  ".cs": cpp,
  ".go": () => javascript({ typescript: true }),
  ".rb": python,
  ".vue": html,
  ".svelte": html,
  ".astro": html,
};

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

function getFileLanguage(fileName: string) {
  const ext = "." + fileName.split(".").pop()?.toLowerCase();
  const lang = EXTENSION_MAP[ext];
  return lang ? lang() : javascript();
}

/**
 * How the open file is being presented when it isn't editable text.
 *
 * "chunked" is a viewer, not a failure: the file is readable, just streamed in
 * ranges rather than loaded into CodeMirror.
 */
interface FileNotice {
  kind: "image" | "binary" | "tooLarge" | "chunked";
  name: string;
  size: number;
  downloadUrl: string | null;
}

/**
 * Turn a /api/file-content response into a notice, or null for plain text the
 * editor should load normally.
 */
function noticeFor(
  data: {
    binary?: boolean;
    isImage?: boolean;
    chunked?: boolean;
    tooLarge?: boolean;
    size?: number;
    name?: string;
    downloadUrl?: string | null;
  },
  fallbackName: string,
): FileNotice | null {
  const shared = {
    name: data.name || fallbackName,
    size: data.size ?? 0,
    downloadUrl: data.downloadUrl ?? null,
  };
  if (data.tooLarge) return { kind: "tooLarge", ...shared };
  if (data.chunked) return { kind: "chunked", ...shared };
  if (data.binary) {
    return { kind: data.isImage ? "image" : "binary", ...shared };
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Stands in for the editor for non-image binaries and files past the viewer's
 * ceiling. Images have their own component; large text has the chunked viewer.
 */
function FilePlaceholder({
  notice,
  saveUrl,
}: {
  notice: FileNotice;
  saveUrl: string;
}) {
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8">
      <div className="flex max-w-lg flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gray-800 text-gray-400">
          <FileCode size={28} />
        </div>

        <p className="text-sm font-medium text-gray-200">{notice.name}</p>
        <p className="text-xs text-gray-500">
          {notice.kind === "tooLarge"
            ? `This file is too large to open (${formatBytes(notice.size)})`
            : `${formatBytes(notice.size)} · binary file, can't be shown as text`}
        </p>

        {/* Same-origin so the browser saves rather than navigates. */}
        <a
          href={saveUrl}
          className="rounded-md bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:bg-gray-600"
        >
          Download
        </a>
      </div>
    </div>
  );
}

function getFileIcon(fileName: string) {
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

function buildFileTree(files: CodeFile[]): TreeNode[] {
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

function findFileInTree(nodes: TreeNode[], path: string): CodeFile | undefined {
  for (const node of nodes) {
    if (node.type === "file" && node.path === path) return node.file;
    if (node.type === "folder") {
      const found = findFileInTree(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

export default function Editor({ github, group }: CodeProps) {
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [isEdited, setIsEdited] = useState(false);
  const { data: session } = useSession();
  const userId = session?.user.id;
  const [filePath, setFilePath] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const livePreview = useLivePreview(group);
  const [generatingReadme, setGeneratingReadme] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // Code access: editing is gated on accepted GitHub collaborator status.
  const [codeAccess, setCodeAccess] = useState<
    "NONE" | "PENDING_GITHUB" | "INVITED" | "ACTIVE" | "loading"
  >("loading");
  // Commit sha the selected branch is at — stamped onto drafts so a CR branch
  // is cut from what the author saw.
  const [baseSha, setBaseSha] = useState<string | null>(null);
  // Set when the open file isn't editable text — an image, another binary, or a
  // file too large to render. Null means a normal text file is in the editor.
  const [fileNotice, setFileNotice] = useState<FileNotice | null>(null);
  // True for text files past the editable size tier: shown, but not edited.
  const [sizeReadOnly, setSizeReadOnly] = useState(false);
  // 1–5 MB: still editable, but linting and full-file language parsing come off
  // because both traverse the entire document on every change.
  const [heavyFile, setHeavyFile] = useState(false);
  // Permission to edit this repo at all, independent of which file is open.
  const hasCodeAccess = codeAccess === "ACTIVE";
  // …and whether the file currently open is something the editor can edit.
  const canEdit = hasCodeAccess && !sizeReadOnly && !fileNotice;

  // Branch selection (auto-fetched from GitHub)
  const [branches, setBranches] = useState<
    { name: string; sha: string; isDefault: boolean; isChangeRequest: boolean }[]
  >([]);
  const [currentBranch, setCurrentBranch] = useState<string>("");
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  // The group's stored GitHub token expired/was revoked (GitHub App tokens
  // expire ~8h) — show a reconnect banner.
  const [authExpired, setAuthExpired] = useState(false);
  const [ideSection, setIdeSection] = useState<IdeSection>("files");
  // The terminal mounts on first visit and then stays mounted (hidden when
  // another section is open), so its shell and running server keep going.
  const [terminalOpened, setTerminalOpened] = useState(false);
  useEffect(() => {
    if (ideSection === "terminal") setTerminalOpened(true);
  }, [ideSection]);
  // Back from the reload that enabled the terminal: reopen it
  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPEN_TERMINAL_AFTER_RELOAD_KEY)) {
        sessionStorage.removeItem(OPEN_TERMINAL_AFTER_RELOAD_KEY);
        setIdeSection("terminal");
      }
    } catch {
      /* storage blocked: stay on Files */
    }
  }, []);
  const [fileSearch, setFileSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // Docked-panel collapse (desktop only); the mobile sheet uses aiOpen.
  const [aiCollapsed, setAiCollapsed] = useState(false);
  // Paths staged for deletion — struck through in the tree until the change
  // request is merged, at which point the file is actually removed.
  const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(true);
  const [trashTtlDays, setTrashTtlDays] = useState(10);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  // Dismissed for this session only — the reminder should come back tomorrow
  // if the deletion is still sitting there.
  const [expiryNoticeDismissed, setExpiryNoticeDismissed] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ errors: number; warnings: number }>({
    errors: 0,
    warnings: 0,
  });
  const [reconnecting, setReconnecting] = useState(false);

  const handleReconnectGithub = async () => {
    setReconnecting(true);
    try {
      const res = await fetch("/api/vcs/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("GitHub reconnected");
        window.location.reload();
      } else if (data.needsRelink) {
        // The owner's own GitHub sign-in is also stale — re-authorize, then retry
        toast("Re-authorizing GitHub…");
        window.location.href = "/api/github/link";
      } else if (res.status === 403) {
        toast.error("Only the group owner can reconnect GitHub.");
      } else {
        toast.error(data.error ?? "Reconnect failed");
      }
    } catch {
      toast.error("Reconnect failed");
    } finally {
      setReconnecting(false);
    }
  };

  // Cache loaded file bodies so switching files/tabs is instant. Keyed by
  // `${branch}:${path}` since content differs per branch.
  const contentCache = useRef<Map<string, string>>(new Map());

  const router = useRouter();

  // Only JSON has an in-browser linter today. The status bar shows "—" for
  // everything else rather than a 0 that would imply a clean check.
  const lintExtension = useMemo(
    () =>
      linter((view): Diagnostic[] => {
        const found: Diagnostic[] = [];
        if (hasLinter(fileName)) {
          const text = view.state.doc.toString();
          if (text.trim()) {
            try {
              JSON.parse(text);
            } catch (err) {
              const message = err instanceof Error ? err.message : "Invalid JSON";
              const at = /position (\d+)/.exec(message);
              const pos = at ? Math.min(Number(at[1]), view.state.doc.length) : 0;
              found.push({ from: pos, to: pos, severity: "error", message });
            }
          }
        }
        setDiagnostics({
          errors: found.filter((d) => d.severity === "error").length,
          warnings: found.filter((d) => d.severity === "warning").length,
        });
        return found;
      }),
    [fileName],
  );

  const fileTree = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    // Filter before shaping so a matching file keeps its folder ancestry.
    const source = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
    return buildFileTree(source);
  }, [files, fileSearch]);

  /**
   * Open a file, committing UI state only once the content is in hand.
   *
   * The breadcrumb, tab and editor body used to be set before the fetch, so a
   * failed load left the header naming a file whose contents were never shown —
   * with the previous file's text still on screen underneath it.
   */
  const loadFileContent = useCallback(
    async (file: CodeFile) => {
      if (!file) return;

      // Commit every piece of "this file is open" state together.
      const show = (opts: {
        content: string;
        notice?: FileNotice | null;
        readOnly?: boolean;
        heavy?: boolean;
        edited?: boolean;
      }) => {
        setFilePath(file.path);
        setFileName(file.name);
        setFileContent(opts.content);
        setOriginalContent(opts.content);
        setFileNotice(opts.notice ?? null);
        setSizeReadOnly(opts.readOnly ?? false);
        setHeavyFile(opts.heavy ?? false);
        setIsEdited(opts.edited ?? false);
        setOpenFiles((prev) =>
          prev.includes(file.path) ? prev : [...prev, file.path],
        );
      };

      if (file._generated) {
        show({ content: file.content || "", edited: true });
        return;
      }

      // Serve from cache for instant tab/file switching
      const cacheKey = `${currentBranch}:${file.path}`;
      const cached = contentCache.current.get(cacheKey);
      if (cached !== undefined) {
        show({ content: cached });
        return;
      }

      try {
        const res = await fetch("/api/file-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groupId: group,
            filePath: file.path,
            ref: currentBranch || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to fetch file content");
        }
        const data = await res.json();

        // Anything that isn't plain editable text opens a viewer instead. None
        // of it is cached — the cache holds editable text only, and the chunk
        // viewer maintains its own bounded cache.
        const notice = noticeFor(data, file.name);
        if (notice) {
          show({ content: "", notice });
          return;
        }

        contentCache.current.set(cacheKey, data.content);
        show({
          content: data.content,
          readOnly: !!data.readOnly,
          heavy: !!data.heavy,
        });
      } catch (err) {
        // Nothing above ran, so the previously open file stays put — the
        // breadcrumb keeps naming what's actually on screen.
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : "Failed to load the file content.",
        );
      }
    },
    [group, currentBranch],
  );

  useEffect(() => {
    if (group && github) {
      const init = async () => {
        try {
          const filesRes = await fetch(`/api/files?group=${group}`);

          if (filesRes.ok) {
            const data: CodeFile[] = await filesRes.json();
            setFiles(data);
            if (data.length > 0) {
              await loadFileContent(data[0]!);
            }
          } else {
            const errBody = await filesRes.json().catch(() => ({}));
            if (errBody.code === "GITHUB_AUTH_EXPIRED") {
              setAuthExpired(true);
            } else {
              // The fixed id keeps a repeated load (e.g. dev re-running effects) to one toast
              toast.error(errBody.error || "Failed to load the files.", { id: "files-load" });
            }
          }

          // Code-access (best-effort; don't block file loading)
          fetch(`/api/github/collaborator?groupId=${group}&self=1`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setCodeAccess(d?.codeAccess ?? "NONE"))
            .catch(() => setCodeAccess("NONE"));

          // Branches (auto-fetched); sets the current branch + baseSha
          fetch(`/api/vcs/branches?groupId=${group}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (!d?.branches) return;
              setBranches(d.branches);
              const def =
                d.branches.find((b: any) => b.isDefault) ?? d.branches[0];
              if (def) {
                setCurrentBranch(def.name);
                setBaseSha(def.sha);
              }
            })
            .catch(() => {});
        } catch {
          toast.error("Failed to load the files.", { id: "files-load" });
        } finally {
          setLoading(false);
        }
      };
      init();
    }
    // Run once per repo — must NOT depend on loadFileContent, which changes
    // with currentBranch and would re-run init and reset the selected branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, github]);

  const handleFileChange = (newContent: string) => {
    if (!canEdit) return; // editing gated on accepted code access
    const originalLines = originalContent.split("\n");
    const newLines = newContent.split("\n");

    const changes: {
      type: string;
      lineNumber: number;
      content: string;
    }[] = [];

    newLines.forEach((line, index) => {
      if (index >= originalLines.length) {
        changes.push({ type: "added", lineNumber: index + 1, content: line });
      } else if (line !== originalLines[index]) {
        changes.push({
          type: "modified",
          lineNumber: index + 1,
          content: line,
        });
      }
    });

    originalLines.forEach((line, index) => {
      if (index >= newLines.length) {
        changes.push({
          type: "removed",
          lineNumber: index + 1,
          content: line,
        });
      }
    });

    setIsEdited(changes.length > 0);
    setFileContent(newContent);
  };

  const expandToFile = (path: string) => {
    const parts = path.split("/");
    const toExpand = new Set(expandedFolders);
    let currentPath = "";
    parts.slice(0, -1).forEach((part) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      toExpand.add(currentPath);
    });
    setExpandedFolders(toExpand);
  };

  const handleFileClick = async (file: CodeFile) => {
    // Expanding the tree is safe to do up front — it only reveals the node in
    // the sidebar. Naming the file is loadFileContent's job, and only once the
    // content actually arrives.
    expandToFile(file.path);
    await loadFileContent(file);
  };

  // Switch the branch being viewed/edited: refetch its tree, reset caches,
  // and re-anchor baseSha to that branch's head.
  const switchBranch = async (name: string) => {
    if (name === currentBranch) {
      setBranchMenuOpen(false);
      return;
    }
    setBranchMenuOpen(false);
    setLoading(true);
    setCurrentBranch(name);
    setBaseSha(branches.find((b) => b.name === name)?.sha ?? baseSha);
    contentCache.current.clear();
    setOpenFiles([]);
    setIsEdited(false);
    try {
      const res = await fetch(`/api/files?group=${group}&ref=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data: CodeFile[] = await res.json();
        setFiles(data);
        if (data.length > 0) {
          await loadFileContentFor(data[0]!, name);
        } else {
          setFileContent("");
          setOriginalContent("");
          setFilePath("");
          setFileName("");
          setFileNotice(null);
          setSizeReadOnly(false);
          setHeavyFile(false);
        }
      } else {
        toast.error("Failed to load that branch.");
      }
    } catch {
      toast.error("Failed to load that branch.");
    } finally {
      setLoading(false);
    }
  };

  // Load content for a file on a specific branch (used right after switching,
  // before the currentBranch state has propagated to loadFileContent).
  const loadFileContentFor = async (file: CodeFile, branch: string) => {
    // Same success-first ordering as loadFileContent: nothing about the open
    // file changes until there's content to show.
    const show = (opts: {
      content: string;
      notice?: FileNotice | null;
      readOnly?: boolean;
      heavy?: boolean;
    }) => {
      setFilePath(file.path);
      setFileName(file.name);
      setFileContent(opts.content);
      setOriginalContent(opts.content);
      setFileNotice(opts.notice ?? null);
      setSizeReadOnly(opts.readOnly ?? false);
      setHeavyFile(opts.heavy ?? false);
      setIsEdited(false);
      setOpenFiles([file.path]);
    };

    const cacheKey = `${branch}:${file.path}`;
    const cached = contentCache.current.get(cacheKey);
    if (cached !== undefined) {
      show({ content: cached });
      return;
    }
    try {
      const res = await fetch("/api/file-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group, filePath: file.path, ref: branch }),
      });
      // A non-ok response used to fall through in silence, leaving the editor
      // showing the previous branch's content under the new file's name.
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to fetch file content");
      }
      const data = await res.json();

      const notice = noticeFor(data, file.name);
      if (notice) {
        show({ content: "", notice });
        return;
      }

      contentCache.current.set(cacheKey, data.content);
      show({ content: data.content, readOnly: !!data.readOnly, heavy: !!data.heavy });
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Failed to load the file content.",
      );
    }
  };

  // Save just the current file's changes to your draft — stays in the editor.
  const handleSave = async () => {
    if (!isEdited) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/modified-files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fileName,
          path: filePath,
          userId,
          content: fileContent,
          group,
          baseSha,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save the file");
      }

      // Keep the cache in sync so switching away and back shows saved content
      contentCache.current.set(`${currentBranch}:${filePath}`, fileContent);
      setOriginalContent(fileContent);
      toast.success(`Saved ${fileName}`);
      setIsEdited(false);
      void livePreview.syncSavedFile(filePath, fileContent);
      // A server started with --watch/nodemon in the terminal picks this up
      syncFileToContainer(filePath, fileContent).catch(() => {});
    } catch {
      toast.error("Failed to save the file.");
    } finally {
      setSaving(false);
    }
  };

  // Go to the change-request page. Save the current file first if it's dirty.
  const handleRaiseChangeRequest = async () => {
    if (isEdited) await handleSave();
    router.push(`/confirm-changes/${group}`);
  };

  const handleGenerateReadme = async () => {
    setGeneratingReadme(true);
    try {
      const res = await fetch("/api/generate-readme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate README");
      }

      const data = await res.json();

      const virtualFile: CodeFile = {
        name: data.fileName || "README.md",
        path: data.path || "README.md",
        sha: "",
        size: (data.content || "").length,
        url: "",
        content: data.content,
        _generated: true,
      };

      const exists = files.find((f) => f.path === virtualFile.path);
      if (exists) {
        setFiles((prev) =>
          prev.map((f) =>
            f.path === virtualFile.path ? virtualFile : f,
          ),
        );
      } else {
        setFiles((prev) => [...prev, virtualFile]);
      }

      expandToFile(virtualFile.path);
      setFileName(virtualFile.name);
      setFilePath(virtualFile.path);
      setFileContent(virtualFile.content || "");
      setOriginalContent(virtualFile.content || "");
      // A generated file is always editable text, so clear any placeholder the
      // previously open file left behind.
      setFileNotice(null);
      setSizeReadOnly(false);
      setHeavyFile(false);
      setIsEdited(true);
      setOpenFiles((prev) =>
        prev.includes(virtualFile.path) ? prev : [...prev, virtualFile.path],
      );

      toast.success("README generated successfully!");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to generate README",
      );
    } finally {
      setGeneratingReadme(false);
    }
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const closeTab = (path: string) => {
    setOpenFiles((prev) => prev.filter((p) => p !== path));
    if (filePath === path && openFiles.length > 0) {
      const remaining = openFiles.filter((p) => p !== path);
      if (remaining.length > 0) {
        const last = remaining[remaining.length - 1]!;
        const f =
          files.find((fl) => fl.path === last) ||
          findFileInTree(fileTree, last);
        if (f) handleFileClick(f);
      }
    }
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = node.path === filePath;

    if (node.type === "folder") {
      return (
        <div key={node.path}>
          <button
            onClick={() => toggleFolder(node.path)}
            className={`w-full flex items-center gap-1 px-2 py-1 text-left text-sm transition-colors duration-150 hover:bg-gray-800 rounded-sm ${
              isSelected ? "bg-gray-700" : ""
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
          >
            <span className="w-4 h-4 flex items-center justify-center text-gray-500">
              {isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
            <span className="w-4 h-4 flex items-center justify-center text-gray-400">
              {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
            </span>
            <span className="truncate text-gray-300">{node.name}</span>
          </button>
          {isExpanded && (
            <div>
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const { icon, color } = getFileIcon(node.name);
    const stagedForDelete = deletedPaths.has(node.path);
    return (
      // A div, not a button: the delete control is itself a button and nesting
      // one inside another is invalid HTML (and breaks click handling).
      <div
        key={node.path}
        className={`group flex w-full items-center gap-1 rounded-sm px-2 py-1 text-sm transition-colors duration-150 ${
          isSelected
            ? "bg-gray-700 text-white"
            : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
        }`}
        style={{ paddingLeft: `${28 + depth * 16}px` }}
      >
        <button
          onClick={() => node.file && handleFileClick(node.file)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <span className={`w-4 h-4 flex items-center justify-center shrink-0 ${color}`}>
            {icon}
          </span>
          <span className={`truncate ${stagedForDelete ? "line-through opacity-60" : ""}`}>
            {node.name}
          </span>
          {node.file?._generated && (
            <Sparkles className="w-3 h-3 ml-1 text-yellow-400 shrink-0" />
          )}
        </button>

        {/* Deletion is an edit, so it needs the same access as typing. */}
        {canEdit && node.file && !node.file._generated && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              stagedForDelete ? restoreFile(node.path) : setDeleteTarget(node);
            }}
            aria-label={
              stagedForDelete ? `Undo delete of ${node.name}` : `Delete ${node.name}`
            }
            title={
              stagedForDelete
                ? "Undo staged deletion"
                : "Delete file (applied when the change request is merged)"
            }
            className={`shrink-0 rounded p-0.5 transition-opacity hover:bg-gray-700 ${
              stagedForDelete
                ? "text-amber-400 opacity-100"
                : "text-gray-500 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
            }`}
          >
            {stagedForDelete ? <Undo2 size={13} /> : <Trash2 size={13} />}
          </button>
        )}
      </div>
    );
  };

  /**
   * Load the trash, which is also how staged deletions are rehydrated — the
   * route returns only this user's staged deletions, already swept of expired
   * ones, so the tree and the panel can't disagree about what's staged.
   */
  const loadTrash = useCallback(async () => {
    if (!group) return;
    try {
      const res = await fetch(`/api/trash?group=${group}`);
      if (!res.ok) return;
      const data = await res.json();
      const items: TrashItem[] = data.items ?? [];
      setTrashItems(items);
      setTrashTtlDays(data.ttlDays ?? 10);
      setDeletedPaths(new Set(items.map((i) => i.path)));
      // Expiry restores the file, so tell the user rather than letting a
      // staged deletion quietly reappear in the tree.
      if (data.restoredOnExpiry > 0) {
        toast(
          `${data.restoredOnExpiry} staged deletion${
            data.restoredOnExpiry === 1 ? "" : "s"
          } expired and ${data.restoredOnExpiry === 1 ? "was" : "were"} undone`,
        );
      }
    } catch {
      // A failed trash load leaves the previous list; nothing destructive.
    } finally {
      setTrashLoading(false);
    }
  }, [group]);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const stageDelete = async (node: TreeNode) => {
    setDeleteTarget(null);
    try {
      const res = await fetch("/api/delete-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: node.name, path: node.path, group }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setDeletedPaths((prev) => new Set(prev).add(node.path));
      setIsEdited(true);
      void loadTrash();
      toast.success("Staged for deletion — raise a change request to apply it");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't stage the deletion");
    }
  };

  const restoreFile = async (path: string) => {
    setRestoringPath(path);
    try {
      const res = await fetch("/api/delete-file", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, group }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setDeletedPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      setTrashItems((prev) => prev.filter((i) => i.path !== path));
      toast.success("Deletion undone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't undo the deletion");
    } finally {
      setRestoringPath(null);
    }
  };

  const activeFileName =
    files.find((f) => f.path === filePath)?.name || filePath.split("/").pop() || fileName;

  // Staged deletions inside their final day. Drives both the nav badge and the
  // banner; derived here so the two can never disagree.
  const expiringSoon = useMemo(
    () => trashItems.filter((i) => i.daysLeft <= 1),
    [trashItems],
  );

  /**
   * Same-origin URL that saves the open file to disk.
   *
   * Linking straight to GitHub's download_url does not download: the
   * `download` attribute is ignored cross-origin, so the browser navigates
   * instead. /api/file-download re-serves the bytes with Content-Disposition.
   */
  const downloadHref = useMemo(() => {
    const params = new URLSearchParams({ group, path: filePath });
    if (currentBranch) params.set("ref", currentBranch);
    return `/api/file-download?${params.toString()}`;
  }, [group, filePath, currentBranch]);

  // ── Editor settings (font size, theme) ────────────────────────────────────
  const { resolvedTheme } = useTheme();
  const ide = useIdeSettings(resolvedTheme !== "light");

  // ── Run code ──────────────────────────────────────────────────────────────
  const {
    state: runState,
    run: startRunner,
    stop: stopRunner,
    clear: clearOutput,
    appendOutput,
  } = useCodeRunner();
  const [outputOpen, setOutputOpen] = useState(false);
  const runLanguage = fileNotice ? null : getRunLanguage(filePath);
  const runnerBusy = runState.phase === "preparing" || runState.phase === "running";

  /** Text of another repo file for the runner: the tab cache first, then the server. */
  const readRepoText = useCallback(
    async (path: string): Promise<string | null> => {
      const cacheKey = `${currentBranch}:${path}`;
      const cached = contentCache.current.get(cacheKey);
      if (cached !== undefined) return cached;
      try {
        const res = await fetch("/api/file-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: group, filePath: path, ref: currentBranch || undefined }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (typeof data.content !== "string" || noticeFor(data, path.split("/").pop() ?? path)) {
          return null;
        }
        contentCache.current.set(cacheKey, data.content);
        return data.content;
      } catch {
        return null;
      }
    },
    [group, currentBranch],
  );

  const runPath = useCallback(
    (entry: string, entrySource: string) => {
      const available = new Set(files.map((f) => f.path).filter((p) => !deletedPaths.has(p)));
      setOutputOpen(true);
      void startRunner({
        entry,
        entrySource,
        exists: (p) => available.has(p),
        // The open tab's text includes unsaved edits
        read: (p) => (p === filePath ? Promise.resolve(fileContent) : readRepoText(p)),
      });
    },
    [files, deletedPaths, filePath, fileContent, readRepoText, startRunner],
  );

  /** Returns false when the open file can't be run. */
  const runCurrentFile = useCallback(() => {
    if (!runLanguage || !filePath) return false;
    runPath(filePath, fileContent);
    return true;
  }, [runLanguage, filePath, fileContent, runPath]);

  // "Run again" re-runs the file that produced the output, even after switching tabs
  const runAgain = useCallback(() => {
    const entry = runState.entry;
    if (!entry) return;
    if (entry === filePath) return runPath(entry, fileContent);
    void readRepoText(entry).then((text) => {
      if (text !== null) runPath(entry, text);
      else toast.error(`Couldn't read ${entry}`);
    });
  }, [runState.entry, filePath, fileContent, runPath, readRepoText]);

  // CodeMirror extensions are built once per render; the ref keeps Ctrl/Cmd+Enter
  // pointed at the latest file and buffer without rebuilding the keymap.
  const runShortcutRef = useRef(runCurrentFile);
  runShortcutRef.current = runCurrentFile;
  const runKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            // Not runnable → fall through to CodeMirror's own Mod-Enter
            run: () => runShortcutRef.current(),
          },
        ]),
      ),
    [],
  );

  return (
    <IdeShell
      repo={github}
      section={ideSection}
      onSectionChange={setIdeSection}
      search={fileSearch}
      onSearchChange={setFileSearch}
      menuOpen={menuOpen}
      onMenuOpenChange={setMenuOpen}
      trashWarningCount={expiringSoon.length}
      onOpenAi={() => setAiOpen(true)}
      explorer={
        loading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-gray-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
            Loading files…
          </div>
        ) : fileTree.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-gray-500">
            {fileSearch ? "No matching files" : "No files found"}
          </p>
        ) : (
          <>{fileTree.map((node) => renderTreeNode(node, 0))}</>
        )
      }
    >
      {/* Main Content Area */}
      {terminalOpened && (
        <TerminalPanel
          groupId={group}
          branch={currentBranch}
          active={ideSection === "terminal"}
          hasUnsavedChanges={isEdited}
        />
      )}
      {ideSection === "terminal" ? null : ideSection === "collaboration" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CollaborationPanel groupId={group} repo={github} />
        </div>
      ) : ideSection === "trash" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TrashPanel
            items={trashItems}
            loading={trashLoading}
            ttlDays={trashTtlDays}
            restoringPath={restoringPath}
            onRestore={restoreFile}
          />
        </div>
      ) : ideSection === "settings" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SettingsPanel
            ide={ide}
            autoUpdateLiveSite={livePreview.autoUpdate}
            onAutoUpdateLiveSiteChange={livePreview.setAutoUpdate}
          />
        </div>
      ) : (
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        {/* Top Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800/80 border-b border-gray-700/50">
          <div className="flex items-center gap-2 min-w-0">
            <LiveSiteControl
              live={livePreview}
              branch={currentBranch}
              unsaved={isEdited && filePath ? { path: filePath, content: fileContent } : undefined}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-500">
              {isEdited && (
                <span className="text-yellow-400 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                  Edited
                </span>
              )}
            </span>
            <button
              onClick={handleSave}
              disabled={!isEdited || saving}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded transition-colors ${
                isEdited
                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
            >
              {saving ? "Saving..." : isEdited ? "Save Changes" : "No Changes"}
            </button>
            <button
              onClick={handleRaiseChangeRequest}
              disabled={saving}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded transition-colors bg-green-700 hover:bg-green-600 text-white disabled:opacity-50"
            >
              {saving ? "Processing..." : "Change Request"}
            </button>
          </div>
        </div>

        <EditorTabs
          openFiles={openFiles}
          activePath={filePath}
          dirtyPaths={isEdited && filePath ? new Set([filePath]) : undefined}
          onSelect={(p) => {
            const f = files.find((fl) => fl.path === p) || findFileInTree(fileTree, p);
            if (f) handleFileClick(f);
          }}
          onClose={closeTab}
          actions={
            runnerBusy && runState.entry === filePath ? (
              <button
                onClick={stopRunner}
                title="Stop"
                className="flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500"
              >
                <Square size={11} className="fill-current" />
                Stop
              </button>
            ) : (
              <button
                onClick={runCurrentFile}
                disabled={!runLanguage}
                title={
                  runLanguage
                    ? `Run ${activeFileName} (Ctrl/Cmd+Enter)`
                    : "Only JavaScript, TypeScript, Python and HTML files can run in the browser. Use Make it live to host a whole static site."
                }
                className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
              >
                <Play size={11} className="fill-current" />
                {runLanguage === "html" ? "Preview" : "Run"}
              </button>
            )
          }
        />

        <EditorBreadcrumb repo={github} path={filePath} />

        {/* Code Editor */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* GitHub token expired — offer a one-click reconnect */}
          {authExpired && (
            <div className="flex items-center justify-between gap-3 border-b border-red-800/60 bg-red-950/50 px-4 py-2.5 text-xs text-red-200">
              <span className="flex items-center gap-2">
                <span>⚠️</span>
                GitHub access for this repo has expired. Reconnect to load files again.
              </span>
              <button
                onClick={handleReconnectGithub}
                disabled={reconnecting}
                className="shrink-0 rounded-md bg-white px-3 py-1 font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-60"
              >
                {reconnecting ? "Reconnecting…" : "Reconnect GitHub"}
              </button>
            </div>
          )}

          {/* Staged deletions about to age out. Amber rather than red: expiry
              undoes the staging, so nothing is lost — the risk is a deletion
              the user meant to keep silently reverting. */}
          {expiringSoon.length > 0 && !expiryNoticeDismissed && (
            <div className="flex items-center justify-between gap-3 border-b border-amber-800/60 bg-amber-950/40 px-4 py-2.5 text-xs text-amber-200">
              <span className="flex items-center gap-2">
                <span>🗑️</span>
                {expiringSoon.length === 1
                  ? `“${expiringSoon[0]!.name}” has been staged for deletion for ${trashTtlDays - 1} days and will be restored tomorrow.`
                  : `${expiringSoon.length} staged deletions will be restored tomorrow.`}{" "}
                Raise a change request to apply them.
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setIdeSection("trash")}
                  className="rounded-md bg-white px-3 py-1 font-medium text-gray-900 hover:bg-gray-100"
                >
                  Open trash
                </button>
                <button
                  onClick={() => setExpiryNoticeDismissed(true)}
                  aria-label="Dismiss"
                  className="rounded p-1 text-amber-300 hover:bg-amber-900/40"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Large text files open without highlighting and can't be edited —
              say so, or the disabled editor looks like a permissions problem. */}
          {(sizeReadOnly || heavyFile) && !fileNotice && (
            <div className="flex items-center gap-2 border-b border-sky-800/60 bg-sky-950/40 px-4 py-2 text-xs text-sky-300">
              <span>📄</span>
              <span>
                {sizeReadOnly
                  ? "This file is large, so it's open read-only without syntax highlighting."
                  : "Large file — syntax highlighting and linting are off to keep editing responsive."}
              </span>
            </div>
          )}

          {/* Locked banner when the member hasn't accepted code access */}
          {!loading && codeAccess !== "loading" && !hasCodeAccess && (
            <div className="flex items-center gap-2 border-b border-amber-800/60 bg-amber-950/40 px-4 py-2 text-xs text-amber-300">
              <span>🔒</span>
              {codeAccess === "INVITED" ? (
                <span>
                  You have a pending GitHub invite for this repo.{" "}
                  <a href="/profile" className="underline hover:text-amber-200">
                    Accept it on your profile
                  </a>{" "}
                  to edit code.
                </span>
              ) : codeAccess === "PENDING_GITHUB" ? (
                <span>
                  Connect GitHub on your{" "}
                  <a href="/profile" className="underline hover:text-amber-200">
                    profile
                  </a>{" "}
                  — the owner has queued a collaborator invite for you.
                </span>
              ) : (
                <span>Read-only. Ask the group owner to invite you as a code collaborator.</span>
              )}
            </div>
          )}

          {/* min-h-0 lets this shrink inside the flex column; overflow-auto is
              what actually scrolls. With overflow-hidden here and CodeMirror at
              height="100%", a long file was clipped to the viewport instead —
              no element in the chain owned the scroll. */}
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                  Loading editor...
                </div>
              </div>
            ) : fileNotice?.kind === "image" ? (
              <ImagePreview
                name={fileNotice.name}
                size={fileNotice.size}
                downloadUrl={fileNotice.downloadUrl}
                saveUrl={downloadHref}
              />
            ) : fileNotice?.kind === "chunked" ? (
              <LargeFileViewer
                groupId={group}
                filePath={filePath}
                fileRef={currentBranch || undefined}
                size={fileNotice.size}
                name={fileNotice.name}
                saveUrl={downloadHref}
              />
            ) : fileNotice ? (
              <FilePlaceholder notice={fileNotice} saveUrl={downloadHref} />
            ) : (
              <CodeMirror
                value={fileContent}
                // Not height="100%": that pins the editor to the parent box, so
                // long files get clipped. Growing to content lets the wrapper
                // above scroll, with a minimum so short files still fill it.
                minHeight="100%"
                theme={ide.theme.extension}
                editable={canEdit}
                readOnly={!canEdit}
                // Language parsing and JSON linting both walk the whole
                // document on every change, so they come off past 1 MB — that
                // traversal, not the rendering, is what stalls the tab.
                extensions={
                  heavyFile || sizeReadOnly
                    ? [runKeymap, ide.fontSizeExtension]
                    : [
                        runKeymap,
                        ide.fontSizeExtension,
                        getFileLanguage(fileName),
                        lintExtension,
                        lintGutter(),
                      ]
                }
                onChange={handleFileChange}
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: true,
                  highlightActiveLine: true,
                  foldGutter: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  indentOnInput: true,
                  tabSize: 2,
                }}
              />
            )}
          </div>
        </div>

        {outputOpen && (
          <OutputPanel
            state={runState}
            onRunAgain={runAgain}
            onStop={stopRunner}
            onClear={clearOutput}
            onClose={() => {
              stopRunner();
              setOutputOpen(false);
            }}
            onPreviewConsole={appendOutput}
          />
        )}

        <EditorStatusBar
          branch={currentBranch}
          isDirty={isEdited}
          fileName={activeFileName}
          errors={diagnostics.errors}
          warnings={diagnostics.warnings}
        />
      </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Delete {deleteTarget.name}?
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This stages the file for deletion. Nothing is removed from GitHub until an admin
              merges your change request — you can undo it before then.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => stageDelete(deleteTarget)}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Stage deletion
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Docked on wide screens; a dismissible sheet on phones. */}
      {aiCollapsed ? (
        <div className="hidden h-full w-11 shrink-0 flex-col items-center border-l border-gray-200 bg-gray-50 pt-3 dark:border-gray-800 dark:bg-gray-950 lg:flex">
          <button
            onClick={() => setAiCollapsed(false)}
            aria-label="Open AI assistant"
            title="AI Assistant"
            className="rounded-lg p-2 text-purple-500 hover:bg-gray-200 dark:hover:bg-gray-800"
          >
            <Bot size={18} />
          </button>
        </div>
      ) : (
        <div className="hidden h-full w-80 shrink-0 lg:block">
          <AiAssistantPanel
            onGenerateReadme={handleGenerateReadme}
            generatingReadme={generatingReadme}
            onCollapse={() => setAiCollapsed(true)}
          />
        </div>
      )}
      {aiOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="flex-1 bg-black/50" onClick={() => setAiOpen(false)} aria-hidden />
          <div className="w-[85vw] max-w-sm">
            <AiAssistantPanel
              onClose={() => setAiOpen(false)}
              onGenerateReadme={handleGenerateReadme}
              generatingReadme={generatingReadme}
            />
          </div>
        </div>
      )}
    </IdeShell>
  );
}
