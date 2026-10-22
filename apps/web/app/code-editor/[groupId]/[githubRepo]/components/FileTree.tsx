"use client";

import React from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Sparkles, Trash2, Undo2 } from "lucide-react";
import { getFileIcon, type CodeFile, type TreeNode } from "../lib/fileTypes";
import FileActivityBadge from "./FileActivityBadge";
import type { FileActivity } from "../lib/useFileActivity";

interface FileTreeProps {
  nodes: TreeNode[];
  expanded: Set<string>;
  activePath: string;
  /** Paths staged for deletion: struck through until the change request merges. */
  deletedPaths: Set<string>;
  /** Files with edits that haven't been saved: marked with a dot, as in VS Code. */
  dirtyPaths: Set<string>;
  /** Who else has each file open. */
  activity?: Map<string, FileActivity[]>;
  /** Shows the delete controls. Deletion is an edit, so it needs code access. */
  canEdit: boolean;
  onToggleFolder: (path: string) => void;
  onOpen: (file: CodeFile) => void;
  /** Asks to delete a repo file, or to discard one that exists only as a draft. */
  onDelete: (node: TreeNode) => void;
  onRestore: (path: string) => void;
}

/**
 * The explorer's tree. Memoised with stable callbacks from the editor, so
 * typing in the editor doesn't re-render every row of a large repo.
 */
function FileTree({ nodes, ...rest }: FileTreeProps) {
  return <>{nodes.map((node) => <TreeRow key={node.path} node={node} depth={0} {...rest} />)}</>;
}

export default React.memo(FileTree);

/** The "unsaved edits" marker, in the theme's text colour: white on a dark theme. */
function UnsavedDot({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="ml-auto block h-2 w-2 shrink-0 rounded-full bg-gray-100"
    />
  );
}

function TreeRow({
  node,
  depth,
  ...rest
}: Omit<FileTreeProps, "nodes"> & { node: TreeNode; depth: number }) {
  const { expanded, activePath, deletedPaths, dirtyPaths, canEdit, onToggleFolder, onOpen, onDelete, onRestore } =
    rest;
  const isSelected = node.path === activePath;

  if (node.type === "folder") {
    const isExpanded = expanded.has(node.path);
    // A closed folder hides its files, so it carries the dot for them
    const hidesUnsaved =
      !isExpanded && dirtyPaths.size > 0 && [...dirtyPaths].some((p) => p.startsWith(`${node.path}/`));
    return (
      <div>
        <button
          onClick={() => onToggleFolder(node.path)}
          className={`w-full flex items-center gap-1 px-2 py-1 text-left text-sm transition-colors duration-150 hover:bg-gray-800 rounded-sm ${
            isSelected ? "bg-gray-700" : ""
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <span className="w-4 h-4 flex items-center justify-center text-gray-500">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="w-4 h-4 flex items-center justify-center text-gray-400">
            {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          </span>
          <span className="truncate text-gray-300">{node.name}</span>
          {hidesUnsaved && <UnsavedDot label="Contains unsaved changes" />}
        </button>
        {isExpanded && (
          <div>
            {node.children.map((child) => (
              <TreeRow key={child.path} node={child} depth={depth + 1} {...rest} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const { icon, color } = getFileIcon(node.name);
  const stagedForDelete = deletedPaths.has(node.path);
  // Not in the repo yet, so there is nothing to stage: removing it discards it
  const isNew = !!node.file?.draft;
  return (
    // A div, not a button: the delete control is itself a button and nesting
    // one inside another is invalid HTML (and breaks click handling).
    <div
      className={`group flex w-full items-center gap-1 rounded-sm px-2 py-1 text-sm transition-colors duration-150 ${
        isSelected
          ? "bg-gray-700 text-white"
          : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
      }`}
      style={{ paddingLeft: `${28 + depth * 16}px` }}
    >
      <button
        onClick={() => node.file && onOpen(node.file)}
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
      >
        <span className={`w-4 h-4 flex items-center justify-center shrink-0 ${color}`}>{icon}</span>
        <span className={`truncate ${stagedForDelete ? "line-through opacity-60" : ""}`}>
          {node.name}
        </span>
        {node.file?._generated && <Sparkles className="w-3 h-3 ml-1 text-yellow-400 shrink-0" />}
        <FileActivityBadge people={rest.activity?.get(node.path)} />
        {dirtyPaths.has(node.path) && <UnsavedDot label="Unsaved changes" />}
      </button>

      {canEdit && node.file && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            stagedForDelete ? onRestore(node.path) : onDelete(node);
          }}
          aria-label={
            stagedForDelete
              ? `Undo delete of ${node.name}`
              : isNew
                ? `Discard ${node.name}`
                : `Delete ${node.name}`
          }
          title={
            stagedForDelete
              ? "Undo staged deletion"
              : isNew
                ? "Discard this new file"
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
}
