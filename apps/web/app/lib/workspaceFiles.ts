import prisma from "./prisma";
import { listFiles, readFileRawBuffer } from "./gitClient";
import { draftContentFor } from "./draftStore";

// "The branch as I see it": the repo's files overlaid with the user's own
// drafts (staged deletions removed) and, optionally, the open file's unsaved
// text. Shared by Make it live and the in-browser terminal.

export interface WorkspaceFile {
  path: string;
  /** Size in the repo; 0 for files that only exist as drafts. */
  size: number;
  read: () => Promise<Buffer>;
}

export async function collectWorkspaceFiles(opts: {
  groupId: string;
  userId: string;
  branch: string;
  unsaved?: { path: string; content: string };
}): Promise<WorkspaceFile[]> {
  const { groupId, userId, branch, unsaved } = opts;

  const [repoFiles, drafts] = await Promise.all([
    listFiles(groupId, branch),
    prisma.modifiedFiles.findMany({
      where: { groupId, userId },
      select: { path: true, content: true, deleted: true },
    }),
  ]);

  const deleted = new Set(drafts.filter((d) => d.deleted).map((d) => d.path));
  const draftRows = new Map(drafts.filter((d) => !d.deleted).map((d) => [d.path, d.content]));
  const sizes = new Map(repoFiles.map((f) => [f.path, f.size]));

  const read = async (path: string): Promise<Buffer> => {
    if (unsaved?.path === path) return Buffer.from(unsaved.content, "utf-8");
    if (draftRows.has(path)) {
      const text = await draftContentFor(groupId, userId, path, draftRows.get(path) ?? null);
      if (text !== null) return Buffer.from(text, "utf-8");
    }
    return readFileRawBuffer(groupId, branch, path);
  };

  const paths = new Set([
    ...repoFiles.map((f) => f.path),
    ...draftRows.keys(),
    ...(unsaved ? [unsaved.path] : []),
  ]);
  return [...paths]
    .filter((p) => !deleted.has(p))
    .map((path) => ({ path, size: sizes.get(path) ?? 0, read: () => read(path) }));
}
