"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { hasLinter } from "./lib/fileTypes";
import { useFileLanguage } from "./lib/languages";
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
import FileActivityBadge, { describeActivity } from "./components/FileActivityBadge";
import { useFileActivity } from "./lib/useFileActivity";
import { useCoEditing, type CoEditing } from "./lib/coEditing/useCoEditing";
import {
  DEFAULT_IDE_SETTINGS,
  readRepoPrefs,
  readStoredIdeSettings,
  useIdeSettings,
  writeRepoPrefs,
} from "./lib/ideSettings";
import { formatSource } from "./lib/format";
import { useTheme } from "next-themes";
import LiveSiteControl from "./components/LiveSiteControl";
import { useLivePreview } from "./lib/useLivePreview";
import TerminalPanel, { OPEN_TERMINAL_AFTER_RELOAD_KEY } from "./components/TerminalPanel";
import { syncFileToContainer } from "./lib/webContainer";
import { useCodeRunner } from "../../../lib/codeRunner/useCodeRunner";
import { getRunLanguage } from "../../../lib/codeRunner/paths";
import LargeFileViewer from "./LargeFileViewer";
import ImagePreview from "./ImagePreview";
import FileTree from "./components/FileTree";
import BranchMenu, { type Branch } from "./components/BranchMenu";
import {
  buildFileTree,
  findFileInTree,
  type CodeFile,
  type TreeNode,
} from "./lib/fileTypes";
import { Bot, FileCode, X, Play, Square } from "lucide-react";

interface CodeProps {
  github: string;
  group: string;
}

// Kept at module scope: a new value each render makes CodeMirror rebuild its
// whole configuration on every keystroke.
const LINT_GUTTER = lintGutter();

/** How long typing has to pause before an auto-save. */
const AUTO_SAVE_DELAY_MS = 1500;

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

export default function Editor({ github, group }: CodeProps) {
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  // The explorer's own spinner: the tree shows as soon as the list arrives,
  // without waiting for the first file's content.
  const [treeLoading, setTreeLoading] = useState(true);
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
  // Language parsing walks the whole document, so it stays off for big files
  const language = useFileLanguage(fileName, !heavyFile && !sizeReadOnly && !fileNotice);
  const hasCodeAccess = codeAccess === "ACTIVE";
  // …and whether the file currently open is something the editor can edit.
  const canEdit = hasCodeAccess && !sizeReadOnly && !fileNotice;

  // Branch selection (auto-fetched from GitHub)
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>("");
  // Branch this repo opens on, chosen in Settings; "" means the repo's default.
  const [startBranch, setStartBranch] = useState("");
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
  // Bumped by every open. A response that comes back after a newer open is
  // dropped, so clicking A then B can't end up showing A.
  const loadSeq = useRef(0);

  // Unsaved text of open files other than the one on screen, by path. The
  // on-screen file's edits live in fileContent; switching tabs parks them here
  // so several files can be mid-edit at once.
  const unsaved = useRef<Map<string, string>>(new Map());
  const [dirtyOthers, setDirtyOthers] = useState<Set<string>>(new Set());
  // A file that has never been saved is unsaved whatever its text is.
  const [neverSaved, setNeverSaved] = useState(false);
  // The on-screen file as of the latest render, for code that runs after an
  // await and must not act on the file that was open when it started.
  // Live co-editing state, for handlers defined before the hook that sets it
  const coRef = useRef<CoEditing | null>(null);
  const activeRef = useRef({ path: "", content: "", edited: false });
  activeRef.current = { path: filePath, content: fileContent, edited: isEdited };
  const anyDirty = isEdited || dirtyOthers.size > 0;

  // The settings and the background save are both defined further down;
  // callbacks created up here reach the latest of each through these.
  const settingsRef = useRef(DEFAULT_IDE_SETTINGS);
  const backgroundSaveRef = useRef<(path: string, content: string) => void>(() => {});

  /**
   * Park the on-screen file's unsaved text before another file replaces it.
   * Returns what was parked, if anything.
   */
  const stashActive = useCallback((nextPath: string) => {
    const active = activeRef.current;
    if (!active.edited || !active.path || active.path === nextPath) return null;
    unsaved.current.set(active.path, active.content);
    setDirtyOthers((prev) => new Set(prev).add(active.path));
    return { path: active.path, content: active.content };
  }, []);

  /** Take back a file's parked text, if it has any. */
  const unstash = useCallback((path: string): string | undefined => {
    const text = unsaved.current.get(path);
    if (text === undefined) return undefined;
    unsaved.current.delete(path);
    setDirtyOthers((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    return text;
  }, []);

  /** Give up the on-screen file's edits, so replacing it doesn't park them. */
  const dropActiveEdits = () => {
    activeRef.current = { ...activeRef.current, edited: false };
    setIsEdited(false);
  };

  // A step that would throw away unsaved edits, held while the user decides.
  const [pendingAction, setPendingAction] = useState<{
    title: string;
    body: string;
    save: () => Promise<boolean>;
    run: () => void;
  } | null>(null);
  const [resolvingPending, setResolvingPending] = useState(false);

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
    // `branchOverride` is for callers that know the branch before the
    // currentBranch state has caught up (the first load).
    async (file: CodeFile, branchOverride?: string) => {
      if (!file) return;
      const seq = ++loadSeq.current;
      const branch = branchOverride ?? currentBranch;

      // Commit every piece of "this file is open" state together.
      const show = (opts: {
        content: string;
        notice?: FileNotice | null;
        readOnly?: boolean;
        heavy?: boolean;
        edited?: boolean;
      }) => {
        const left = stashActive(file.path);
        // With auto-save on, leaving a file saves it rather than waiting
        if (left && settingsRef.current.autoSave !== "off") {
          backgroundSaveRef.current(left.path, left.content);
        }
        // Edits made to this file before it was last switched away from
        const parked = opts.notice ? undefined : unstash(file.path);
        setFilePath(file.path);
        setFileName(file.name);
        setFileContent(parked ?? opts.content);
        setOriginalContent(opts.content);
        setFileNotice(opts.notice ?? null);
        setSizeReadOnly(opts.readOnly ?? false);
        setHeavyFile(opts.heavy ?? false);
        setNeverSaved(opts.edited ?? false);
        setIsEdited(parked !== undefined || (opts.edited ?? false));
        setOpenFiles((prev) =>
          prev.includes(file.path) ? prev : [...prev, file.path],
        );
      };

      if (file._generated) {
        show({ content: file.content || "", edited: true });
        return;
      }

      // Serve from cache for instant tab/file switching
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
          body: JSON.stringify({
            groupId: group,
            filePath: file.path,
            ref: branch || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to fetch file content");
        }
        const data = await res.json();
        const superseded = seq !== loadSeq.current;

        // Anything that isn't plain editable text opens a viewer instead. None
        // of it is cached — the cache holds editable text only, and the chunk
        // viewer maintains its own bounded cache.
        const notice = noticeFor(data, file.name);
        if (notice) {
          if (!superseded) show({ content: "", notice });
          return;
        }

        contentCache.current.set(cacheKey, data.content);
        if (superseded) return;
        show({
          content: data.content,
          readOnly: !!data.readOnly,
          heavy: !!data.heavy,
        });
      } catch (err) {
        // Nothing above ran, so the previously open file stays put — the
        // breadcrumb keeps naming what's actually on screen.
        if (seq !== loadSeq.current) return;
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : "Failed to load the file content.",
        );
      }
    },
    [group, currentBranch, stashActive, unstash],
  );

  useEffect(() => {
    if (!group || !github) return;

    // Neither of these needs the file list, so they start alongside it rather
    // than after it.
    // Code access (best-effort)
    fetch(`/api/github/collaborator?groupId=${group}&self=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCodeAccess(d?.codeAccess ?? "NONE"))
      .catch(() => setCodeAccess("NONE"));

    // Read straight from storage: the settings hook hasn't loaded them yet
    const settings = readStoredIdeSettings();
    const prefs = readRepoPrefs(group);
    let startBranch = prefs.startBranch;
    setStartBranch(startBranch ?? "");

    // Branches (auto-fetched); sets the current branch + baseSha. The branch
    // chosen in Settings wins over the repo's default while it still exists.
    let known: Branch[] | null = null;
    const applyBranch = () => {
      if (!known) return;
      const pick =
        (startBranch && known.find((b) => b.name === startBranch)) ||
        known.find((b) => b.isDefault) ||
        known[0];
      if (pick) {
        setCurrentBranch(pick.name);
        setBaseSha(pick.sha);
      }
    };
    fetch(`/api/vcs/branches?groupId=${group}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.branches) return;
        known = d.branches;
        setBranches(d.branches);
        applyBranch();
      })
      .catch(() => {});

    const listFiles = (branch?: string) =>
      fetch(`/api/files?group=${group}${branch ? `&ref=${encodeURIComponent(branch)}` : ""}`);

    const init = async () => {
      try {
        let filesRes = await listFiles(startBranch);
        if (!filesRes.ok && startBranch) {
          const errBody = await filesRes.clone().json().catch(() => ({}));
          if (errBody.code !== "GITHUB_AUTH_EXPIRED") {
            // The chosen branch has gone (merged or deleted): open the default
            toast(`Branch ${startBranch} couldn't be opened, so the default branch is shown.`);
            startBranch = undefined;
            setStartBranch("");
            writeRepoPrefs(group, { startBranch: undefined });
            applyBranch();
            filesRes = await listFiles();
          }
        }

        if (filesRes.ok) {
          const data: CodeFile[] = await filesRes.json();
          setFiles(data);
          // The tree is usable now; only the editor pane waits for the file
          setTreeLoading(false);

          const byPath = new Map(data.map((f) => [f.path, f]));
          const tabs = settings.restoreTabs
            ? (prefs.tabs ?? []).filter((path) => byPath.has(path))
            : [];
          const last = prefs.active ? byPath.get(prefs.active) : undefined;
          let first: CodeFile | undefined;
          if (tabs.length > 0 || settings.openFirst === "last") first = last;
          // "last" with nothing to go back to opens the README like a first visit
          if (!first && (settings.openFirst !== "none" || tabs.length > 0)) {
            first =
              (tabs[0] !== undefined ? byPath.get(tabs[0]) : undefined) ??
              data.find((f) => /^readme(\.md)?$/i.test(f.path)) ??
              data[0];
          }
          if (tabs.length > 0) setOpenFiles(tabs);
          if (first) await loadFileContent(first, startBranch ?? "");
        } else {
          const errBody = await filesRes.json().catch(() => ({}));
          if (errBody.code === "GITHUB_AUTH_EXPIRED") {
            setAuthExpired(true);
          } else {
            // The fixed id keeps a repeated load (e.g. dev re-running effects) to one toast
            toast.error(errBody.error || "Failed to load the files.", { id: "files-load" });
          }
        }
      } catch {
        toast.error("Failed to load the files.", { id: "files-load" });
      } finally {
        setTreeLoading(false);
        setLoading(false);
      }
    };
    init();
    // Run once per repo — must NOT depend on loadFileContent, which changes
    // with currentBranch and would re-run init and reset the selected branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, github]);

  // Stable identity (CodeMirror reconfigures itself when onChange changes), so
  // what it needs from the latest render comes through a ref.
  const changeRef = useRef({ canEdit, originalContent, neverSaved });
  changeRef.current = { canEdit, originalContent, neverSaved };
  const handleFileChange = useCallback((newContent: string) => {
    const latest = changeRef.current;
    // Editing live as a guest: the text lives in the host's draft, so nothing
    // is unsaved here (and a remote edit arriving must still show)
    if (coRef.current?.status === "guest") {
      setFileContent(newContent);
      return;
    }
    if (!latest.canEdit) return; // editing gated on accepted code access
    setIsEdited(latest.neverSaved || newContent !== latest.originalContent);
    setFileContent(newContent);
  }, []);

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

  /** Back to "no file open". */
  const clearOpenFile = () => {
    loadSeq.current++; // a load still in flight must not reopen something
    setFilePath("");
    setFileName("");
    setFileContent("");
    setOriginalContent("");
    setFileNotice(null);
    setSizeReadOnly(false);
    setHeavyFile(false);
    setNeverSaved(false);
    setIsEdited(false);
  };

  const handleFileClick = (file: CodeFile) => {
    // Expanding the tree is safe to do up front — it only reveals the node in
    // the sidebar. Naming the file is loadFileContent's job, and only once the
    // content actually arrives.
    expandToFile(file.path);
    // From Terminal, Settings etc. the editor is hidden, so the file would load
    // out of sight. The terminal stays mounted, so its shell keeps running.
    setIdeSection("files");
    // Already open: reloading it would throw away what's been typed
    if (file.path === filePath) return;
    void loadFileContent(file);
  };

  // Switch the branch being viewed/edited: refetch its tree, reset caches,
  // and re-anchor baseSha to that branch's head.
  const switchBranch = (name: string) => {
    if (name === currentBranch) return;
    if (!anyDirty || !ide.settings.confirmDiscard) return void loadBranch(name);
    // Tabs don't carry over to another branch, so their edits would be lost
    setPendingAction({
      title: "Save your changes first?",
      body: `Switching to ${name} closes the open tabs. Unsaved edits in them would be lost.`,
      save: saveAll,
      run: () => void loadBranch(name),
    });
  };

  const loadBranch = async (name: string) => {
    setLoading(true);
    setTreeLoading(true);
    try {
      const res = await fetch(`/api/files?group=${group}&ref=${encodeURIComponent(name)}`);
      if (!res.ok) {
        // Nothing has changed yet, so the editor is still wholly on the
        // previous branch.
        const errBody = await res.json().catch(() => ({}));
        if (errBody.code === "GITHUB_AUTH_EXPIRED") setAuthExpired(true);
        else toast.error(errBody.error || "Failed to load that branch.");
        return;
      }
      const data: CodeFile[] = await res.json();

      // The new tree is in hand: move everything over together.
      setCurrentBranch(name);
      setBaseSha(branches.find((b) => b.name === name)?.sha ?? baseSha);
      contentCache.current.clear();
      unsaved.current.clear();
      setDirtyOthers(new Set());
      setFiles(data);
      setOpenFiles([]);
      clearOpenFile();
      const first = data.find((f) => /^readme(\.md)?$/i.test(f.path)) ?? data[0];
      if (first) await loadFileContentFor(first, name);
    } catch {
      toast.error("Failed to load that branch.");
    } finally {
      setTreeLoading(false);
      setLoading(false);
    }
  };

  // Load content for a file on a specific branch (used right after switching,
  // before the currentBranch state has propagated to loadFileContent).
  const loadFileContentFor = async (file: CodeFile, branch: string) => {
    const seq = ++loadSeq.current;
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
      setNeverSaved(false);
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
      if (seq !== loadSeq.current) return;

      const notice = noticeFor(data, file.name);
      if (notice) {
        show({ content: "", notice });
        return;
      }

      contentCache.current.set(cacheKey, data.content);
      show({ content: data.content, readOnly: !!data.readOnly, heavy: !!data.heavy });
    } catch (err) {
      if (seq !== loadSeq.current) return;
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Failed to load the file content.",
      );
    }
  };

  /**
   * Write one file to the user's draft. Resolves false when it didn't save, so
   * callers don't carry on as if the work were safe.
   */
  const saveFile = async (path: string, content: string): Promise<boolean> => {
    const name = path.split("/").pop() ?? path;
    try {
      const res = await fetch(`/api/modified-files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path, userId, content, group, baseSha }),
      });
      if (!res.ok) throw new Error("Failed to save the file");

      // Keep the cache in sync so switching away and back shows saved content
      contentCache.current.set(`${currentBranch}:${path}`, content);
      // Once saved, a new file is a draft like any other: it loads from the
      // cache or the server, not from the text it was created with.
      setFiles((prev) =>
        prev.map((f) =>
          f.path === path && f._generated ? { ...f, _generated: false, content: undefined } : f,
        ),
      );
      void livePreview.syncSavedFile(path, content);
      // A server started with --watch/nodemon in the terminal picks this up
      syncFileToContainer(path, content).catch(() => {});
      return true;
    } catch {
      toast.error(`Failed to save ${name}.`);
      return false;
    }
  };

  // Save the on-screen file's changes to your draft — stays in the editor.
  // `auto` is a save the user didn't ask for: no toast, and no reformatting,
  // which would move the text under the cursor mid-thought.
  const handleSave = async (opts: { auto?: boolean } = {}): Promise<boolean> => {
    const co = coRef.current;
    if (co?.status === "guest") {
      if (!opts.auto) {
        co.requestSave();
        toast.success(`Asked ${co.host?.name ?? "the host"} to save`);
      }
      return true;
    }
    if (!isEdited) return true;
    if (saving) return false;
    const path = filePath;
    const typed = fileContent;
    let content = typed;
    setSaving(true);

    if (!opts.auto && ide.settings.formatOnSave) {
      const formatted = await formatSource(path, typed, {
        tabWidth: ide.settings.tabSize,
        useTabs: ide.settings.useTabs,
      });
      // Only if nothing was typed while the formatter ran
      const now = activeRef.current;
      if (formatted !== null && now.path === path && now.content === typed) {
        content = formatted;
        if (formatted !== typed) setFileContent(formatted);
      }
    }

    const saved = await saveFile(path, content);
    setSaving(false);
    if (!saved) return false;

    if (!opts.auto) toast.success(`Saved ${fileName}`);
    // Still on that file? It may have been typed in while the save ran.
    const active = activeRef.current;
    if (active.path === path) {
      setOriginalContent(content);
      setNeverSaved(false);
      setIsEdited(active.content !== typed && active.content !== content);
    }
    return true;
  };

  // Save a file the user has just switched away from (auto-save). Its text is
  // parked in `unsaved`; on success it stops counting as unsaved.
  backgroundSaveRef.current = (path, content) => {
    void saveFile(path, content).then((saved) => {
      if (!saved) return;
      if (unsaved.current.get(path) === content) {
        unstash(path);
        return;
      }
      // Reopened in the meantime, with nothing typed since
      const active = activeRef.current;
      if (active.path === path && active.content === content) {
        setOriginalContent(content);
        setNeverSaved(false);
        setIsEdited(false);
      }
    });
  };

  /** Save every tab with unsaved edits, stopping at the first failure. */
  const saveAll = async (): Promise<boolean> => {
    if (!(await handleSave())) return false;
    for (const [path, content] of [...unsaved.current]) {
      if (!(await saveFile(path, content))) return false;
      unstash(path);
    }
    return true;
  };

  // Go to the change-request page, saving every unsaved tab first.
  const handleRaiseChangeRequest = async () => {
    // Leaving after a failed save would drop the edits
    if (!(await saveAll())) return;
    router.push(`/confirm-changes/${group}`);
  };

  // Ctrl/Cmd+S saves the open file. The ref keeps the listener pointed at the
  // latest buffer without re-subscribing on every keystroke.
  const saveShortcutRef = useRef({ section: ideSection, save: () => handleSave() });
  saveShortcutRef.current = { section: ideSection, save: () => handleSave() };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "s") return;
      const { section, save } = saveShortcutRef.current;
      if (section !== "files") return; // the terminal keeps its own Ctrl+S
      e.preventDefault(); // not the browser's "save page" dialog
      void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Closing or reloading the tab with unsaved edits asks first
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  // A Node app with nothing to serve as a static site (e.g. Express + EJS):
  // Make it live can't host it, the terminal can run it.
  const isServerApp =
    files.some((f) => f.path === "package.json") &&
    !files.some((f) => f.path === "index.html" || f.path.endsWith("/index.html"));

  // ── New file ──────────────────────────────────────────────────────────────
  // Null when closed; otherwise the path being typed in the explorer.
  const [newFilePath, setNewFilePath] = useState<string | null>(null);

  /** Why a path can't be created, or null when it's fine. */
  const newFileError = (raw: string): string | null => {
    const path = raw.trim().replace(/^\/+/, "");
    if (!path) return "Enter a file name";
    if (path.endsWith("/")) return "Add a file name after the folder";
    if (path.split("/").some((part) => !part || part === "." || part === ".."))
      return "That path isn't allowed";
    if (/[\\:*?"<>|\0]/.test(path)) return "Remove special characters from the name";
    if (files.some((f) => f.path === path)) return "A file with that name already exists";
    return null;
  };

  /**
   * Adds an empty file that exists only in this editor until it's saved. It
   * goes through the same draft → change request path as any edit, the way a
   * generated README does, so nothing reaches the repo unreviewed.
   */
  const createFile = (raw: string) => {
    const error = newFileError(raw);
    if (error) {
      toast.error(error, { id: "new-file" });
      return;
    }
    const path = raw.trim().replace(/^\/+/, "");
    const file: CodeFile = {
      name: path.split("/").pop()!,
      path,
      sha: "",
      size: 0,
      url: "",
      content: "",
      _generated: true,
      draft: true,
    };
    setFiles((prev) => [...prev, file]);
    setNewFilePath(null);
    setFileSearch("");
    setIdeSection("files");
    expandToFile(path);
    void loadFileContent(file);
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

      const path: string = data.path || "README.md";
      const exists = files.find((f) => f.path === path);
      const virtualFile: CodeFile = {
        name: data.fileName || "README.md",
        path,
        sha: "",
        size: (data.content || "").length,
        url: "",
        content: data.content,
        _generated: true,
        // Replacing a README the repo already has isn't a new file
        draft: exists ? exists.draft : true,
      };

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
      loadSeq.current++; // a file still loading must not replace the README
      stashActive(virtualFile.path);
      unstash(virtualFile.path); // the generated text replaces any earlier edits
      setNeverSaved(true);
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

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** Close the on-screen file's tab and show the last remaining one, if any. */
  const closeActiveTab = () => {
    dropActiveEdits();
    const remaining = openFiles.filter((p) => p !== filePath);
    setOpenFiles(remaining);
    const last = remaining[remaining.length - 1];
    const next =
      last === undefined
        ? undefined
        : files.find((fl) => fl.path === last) || findFileInTree(fileTree, last);
    // With no tab left there is no file open, so the editor empties too
    if (next) void loadFileContent(next);
    else clearOpenFile();
  };

  const closeTab = (path: string) => {
    const isActive = path === filePath;
    const close = isActive
      ? closeActiveTab
      : () => {
          unstash(path);
          setOpenFiles((prev) => prev.filter((p) => p !== path));
        };
    const clean = isActive ? !isEdited : !dirtyOthers.has(path);
    if (clean || !ide.settings.confirmDiscard) return close();

    setPendingAction({
      title: `Save changes to ${path.split("/").pop() ?? path}?`,
      body: "This file has unsaved edits. Discarding them can't be undone.",
      save: isActive ? () => handleSave() : () => saveFile(path, unsaved.current.get(path) ?? ""),
      run: close,
    });
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

  /**
   * Remove a file that exists only as this user's draft. There is nothing in
   * the repo to stage a deletion of, so this drops the draft itself.
   */
  const discardNewFile = async (file: CodeFile) => {
    setDeleteTarget(null);
    try {
      // Never saved means nothing was stored for it
      if (!file._generated) {
        const res = await fetch("/api/modified-files", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: file.path, group }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed");
      }
      for (const key of [...contentCache.current.keys()]) {
        if (key.endsWith(`:${file.path}`)) contentCache.current.delete(key);
      }
      setFiles((prev) => prev.filter((f) => f.path !== file.path));
      if (file.path === filePath) {
        closeActiveTab();
      } else {
        unstash(file.path);
        setOpenFiles((prev) => prev.filter((p) => p !== file.path));
      }
      toast.success(`Discarded ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message !== "Failed" ? err.message : "Couldn't discard the file");
    }
  };

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
  settingsRef.current = ide.settings;

  // Auto-save once typing pauses. The ref keeps the timer pointed at the
  // latest save without restarting it for unrelated renders.
  const autoSaveRef = useRef(handleSave);
  autoSaveRef.current = handleSave;
  const autoSaveAfterDelay = ide.settings.autoSave === "afterDelay";
  useEffect(() => {
    if (!autoSaveAfterDelay || !isEdited || !filePath || !canEdit) return;
    const timer = setTimeout(() => void autoSaveRef.current({ auto: true }), AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoSaveAfterDelay, isEdited, filePath, fileContent, canEdit]);

  // Remember the open tabs for "restore tabs" and "open the last file"
  useEffect(() => {
    if (loading) return;
    writeRepoPrefs(group, { tabs: openFiles, active: filePath || undefined });
  }, [group, loading, openFiles, filePath]);

  const changeStartBranch = (name: string) => {
    setStartBranch(name);
    writeRepoPrefs(group, { startBranch: name || undefined });
  };

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
        // Open tabs are read with their unsaved edits
        read: (p) => {
          if (p === filePath) return Promise.resolve(fileContent);
          const parked = unsaved.current.get(p);
          return parked !== undefined ? Promise.resolve(parked) : readRepoText(p);
        },
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

  // Memoised: a new array each render would have CodeMirror reconfigure on
  // every keystroke.
  const editorExtensions = useMemo(
    () =>
      heavyFile || sizeReadOnly
        ? [runKeymap, ide.fontSizeExtension, ide.behaviourExtension]
        : [
            runKeymap,
            ide.fontSizeExtension,
            ide.behaviourExtension,
            ...(language ? [language] : []),
            lintExtension,
            LINT_GUTTER,
          ],
    [
      heavyFile,
      sizeReadOnly,
      runKeymap,
      ide.fontSizeExtension,
      ide.behaviourExtension,
      language,
      lintExtension,
    ],
  );

  const dirtyPaths = useMemo(() => {
    const paths = new Set(dirtyOthers);
    if (isEdited && filePath) paths.add(filePath);
    return paths;
  }, [dirtyOthers, isEdited, filePath]);

  // Who else in the group has which file open (and whether they're editing it)
  const activity = useFileActivity({
    groupId: group,
    userId,
    userName: session?.user?.name || session?.user?.email?.split("@")[0] || "Someone",
    openPath: ideSection === "files" && filePath ? filePath : null,
    editing: isEdited,
  });
  const othersOnThisFile = filePath ? activity.get(filePath) : undefined;

  // ── Live co-editing (see lib/coEditing/session.ts) ──
  // A file opened with unsaved edits of your own isn't shared: joining would
  // replace them with the live copy. You edit alone until you save or discard.
  const [coBlocked, setCoBlocked] = useState<string | null>(null);
  useEffect(() => {
    setCoBlocked(isEdited ? filePath : null);
    // Decided once, when a file is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);
  // Saved or discarded since: nothing of yours would be lost, so join now
  useEffect(() => {
    if (!isEdited && coBlocked === filePath) setCoBlocked(null);
  }, [isEdited, coBlocked, filePath]);
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const co = useCoEditing({
    groupId: group,
    userId,
    userName: session?.user?.name || session?.user?.email?.split("@")[0] || "Someone",
    branch: currentBranch,
    path:
      filePath && !fileNotice && !sizeReadOnly && !heavyFile && coBlocked !== filePath ? filePath : null,
    canHost: hasCodeAccess,
    getText: () => activeRef.current.content,
    onSaveRequest: () => void handleSaveRef.current(),
  });
  coRef.current = co;

  // The editor is bound to the shared text only once both hold the same text,
  // or the binding would broadcast the difference as an edit
  const [coBound, setCoBound] = useState(false);
  useEffect(() => {
    if (co.status === "host") {
      co.syncFrom(activeRef.current.content);
      setCoBound(true);
    } else if (co.status === "guest") {
      // Show the host's copy; bound by the effect below once it's on screen
      setFileContent(co.sharedText());
      setIsEdited(false);
    } else {
      setCoBound(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [co.status, co.binding]);
  useEffect(() => {
    if (co.status === "guest" && !coBound && fileContent === co.sharedText()) setCoBound(true);
  }, [co, coBound, fileContent]);
  const liveWith = co.participants.filter((p) => p.userId !== userId);
  const isLive = (co.status === "host" || co.status === "guest") && liveWith.length > 0;
  // Its own memo, so the editor is only reconfigured when the binding changes
  const extensions = useMemo(
    () => (coBound && co.binding ? [...editorExtensions, co.binding] : editorExtensions),
    [editorExtensions, coBound, co.binding],
  );

  // The tree is memoised, so its callbacks keep one identity and reach the
  // latest handlers through a ref.
  const treeHandlers = useRef({ open: handleFileClick, restore: restoreFile });
  treeHandlers.current = { open: handleFileClick, restore: restoreFile };
  const onTreeOpen = useCallback((file: CodeFile) => treeHandlers.current.open(file), []);
  const onTreeRestore = useCallback((path: string) => void treeHandlers.current.restore(path), []);

  return (
    <IdeShell
      theme={ide.theme}
      repo={github}
      section={ideSection}
      onSectionChange={setIdeSection}
      search={fileSearch}
      onSearchChange={setFileSearch}
      menuOpen={menuOpen}
      onMenuOpenChange={setMenuOpen}
      trashWarningCount={expiringSoon.length}
      onOpenAi={() => setAiOpen(true)}
      onNewFile={hasCodeAccess ? () => setNewFilePath((p) => p ?? "") : undefined}
      explorer={
        <>
        {newFilePath !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createFile(newFilePath);
            }}
            className="px-2 pb-2"
          >
            <input
              autoFocus
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setNewFilePath(null);
              }}
              onBlur={() => {
                // Clicking away with nothing typed just closes it
                if (!newFilePath.trim()) setNewFilePath(null);
              }}
              placeholder="e.g. src/utils.js"
              aria-label="New file name"
              className="w-full rounded-md border border-blue-500 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none dark:bg-gray-900 dark:text-white"
            />
            <p className="mt-1 px-0.5 text-[11px] text-gray-500">
              {newFilePath.trim() && newFileError(newFilePath)
                ? newFileError(newFilePath)
                : "Enter to create · Esc to cancel · use / for folders"}
            </p>
          </form>
        )}
        {treeLoading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-gray-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
            Loading files…
          </div>
        ) : fileTree.length === 0 ? (
          newFilePath === null && (
            <div className="px-3 py-6 text-center text-sm text-gray-500">
              <p>{fileSearch ? "No matching files" : "No files found"}</p>
              {!fileSearch && hasCodeAccess && (
                <button
                  onClick={() => setNewFilePath("")}
                  className="mt-2 text-blue-600 hover:underline dark:text-blue-400"
                >
                  Create a file
                </button>
              )}
            </div>
          )
        ) : (
          <FileTree
            nodes={fileTree}
            expanded={expandedFolders}
            activePath={filePath}
            deletedPaths={deletedPaths}
            dirtyPaths={dirtyPaths}
            activity={activity}
            canEdit={hasCodeAccess}
            onToggleFolder={toggleFolder}
            onOpen={onTreeOpen}
            onDelete={setDeleteTarget}
            onRestore={onTreeRestore}
          />
        )}
        </>
      }
    >
      {/* Main Content Area */}
      {terminalOpened && (
        <TerminalPanel
          groupId={group}
          branch={currentBranch}
          active={ideSection === "terminal"}
          hasUnsavedChanges={anyDirty}
          fontSize={ide.settings.terminalFontSize}
          background={ide.theme.swatch[0]}
          foreground={ide.theme.text}
          startCommand={ide.settings.terminalCommand}
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
            branches={branches}
            startBranch={startBranch}
            onStartBranchChange={changeStartBranch}
            onReconnectGithub={handleReconnectGithub}
            reconnecting={reconnecting}
            onOpenCollaboration={() => setIdeSection("collaboration")}
          />
        </div>
      ) : (
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        {/* Top Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800/80 border-b border-gray-700/50">
          <div className="flex items-center gap-2 min-w-0">
            <BranchMenu
              branches={branches}
              current={currentBranch}
              onSelect={switchBranch}
              disabled={loading}
            />
            <LiveSiteControl
              live={livePreview}
              branch={currentBranch}
              unsaved={isEdited && filePath ? { path: filePath, content: fileContent } : undefined}
              onRunServerApp={isServerApp ? () => setIdeSection("terminal") : undefined}
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
              onClick={() => void handleSave()}
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
          dirtyPaths={dirtyPaths}
          activity={activity}
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

        {/* Two people changing one file meet as a conflict at change-request
            time; seeing each other now is the cheap way to avoid that */}
        {isLive ? (
          // Editing together: who's here, and whose change request it goes into
          <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-emerald-700/40 bg-emerald-950/30 px-4 py-1.5 text-xs text-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="font-medium">
              Editing live with {liveWith.map((p) => p.name.split(" ")[0]).join(", ")}
            </span>
            <span className="text-emerald-300/80">
              {co.status === "host"
                ? "· Everyone's typing goes into your changes. You save them."
                : `· Saved to ${co.host?.name.split(" ")[0] ?? "the host"}'s changes. Save asks them to save.`}
            </span>
          </div>
        ) : co.status === "connecting" && co.host ? (
          <div className="shrink-0 border-b border-emerald-700/40 bg-emerald-950/30 px-4 py-1.5 text-xs text-emerald-200">
            Joining {co.host.name.split(" ")[0]}&apos;s live session…
          </div>
        ) : (
          othersOnThisFile &&
          othersOnThisFile.length > 0 && (
            <div className="flex shrink-0 items-center gap-2 border-b border-amber-700/40 bg-amber-950/30 px-4 py-1.5 text-xs text-amber-200">
              <FileActivityBadge people={othersOnThisFile} />
              <span>
                {describeActivity(othersOnThisFile)}
                {coBlocked === filePath
                  ? ". You have unsaved edits here, so you're not editing live with them. Save or discard to join."
                  : othersOnThisFile.some((p) => p.editing) &&
                    ". If you both change the same lines, one of you will resolve a conflict when submitting."}
              </span>
            </div>
          )
        )}

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
            ) : !filePath ? (
              <div className="flex h-full items-center justify-center p-8 text-sm text-gray-500">
                {files.length > 0 ? "Select a file to open it" : "No file open"}
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
                extensions={extensions}
                onChange={handleFileChange}
                basicSetup={ide.basicSetup}
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

      {pendingAction && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900">
            <h3 id="unsaved-title" className="text-base font-semibold text-gray-900 dark:text-white">
              {pendingAction.title}
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{pendingAction.body}</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setPendingAction(null)}
                disabled={resolvingPending}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { run } = pendingAction;
                  setPendingAction(null);
                  run();
                }}
                disabled={resolvingPending}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Discard
              </button>
              <button
                autoFocus
                onClick={async () => {
                  const { save, run } = pendingAction;
                  setResolvingPending(true);
                  const saved = await save();
                  setResolvingPending(false);
                  // A failed save keeps the dialog open: the edits are still here
                  if (!saved) return;
                  setPendingAction(null);
                  run();
                }}
                disabled={resolvingPending}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {resolvingPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {deleteTarget.file?.draft ? "Discard" : "Delete"} {deleteTarget.name}?
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {deleteTarget.file?.draft
                ? "This file isn't in the repo yet, it only exists as your draft. Discarding it can't be undone."
                : "This stages the file for deletion. Nothing is removed from GitHub until an admin merges your change request — you can undo it before then."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deleteTarget.file?.draft
                    ? discardNewFile(deleteTarget.file)
                    : stageDelete(deleteTarget)
                }
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                {deleteTarget.file?.draft ? "Discard file" : "Stage deletion"}
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
