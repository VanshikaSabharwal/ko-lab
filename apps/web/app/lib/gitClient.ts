import prisma from "./prisma";
import { decrypt, extractRepoName } from "./encryption";

// Vercel-side client for the git workspace service running on Render.
// Vercel has the DB + ENCRYPTION_KEY, so it decrypts the GitHub token and
// forwards it service-to-service. The token never reaches the browser.

const SERVICE = process.env.GIT_SERVICE_URL || "";
const SECRET = process.env.GIT_SERVICE_SECRET || "";

async function call<T = unknown>(
  path: string,
  body: unknown,
): Promise<T> {
  if (!SERVICE || !SECRET) {
    throw new Error(
      "GIT_SERVICE_URL and GIT_SERVICE_SECRET must be set to use the git workspace service",
    );
  }
  const res = await fetch(`${SERVICE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  });
  if (res.ok) return (await res.json()) as T;
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || "Git service error");
}

async function repoUrlFor(groupId: string): Promise<string> {
  const g = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      githubRepo: true,
      ownerName: true,
      githubAccessToken: true,
    },
  });
  if (!g || !g.githubRepo || !g.ownerName || !g.githubAccessToken) {
    throw new Error(
      "GitHub repository URL, owner name, or access token is missing",
    );
  }
  let token: string;
  try {
    token = decrypt(g.githubAccessToken);
  } catch {
    token = g.githubAccessToken;
  }
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${g.ownerName}/${extractRepoName(g.githubRepo)}.git`;
}

export interface GitFile {
  name: string;
  path: string;
  size: number;
  type: string;
}

/** Clone/pull (lazily) and return the file tree for a branch. */
export async function listFiles(
  groupId: string,
  branch: string,
): Promise<GitFile[]> {
  const repoUrl = await repoUrlFor(groupId);
  const data = await call<{ files: GitFile[] }>("/ensure", {
    groupId,
    branch,
    repoUrl,
  });
  return data.files;
}

/**
 * Resolve the default branch. Prefers a branch passed by the client, then the
 * cached Group.defaultBranch, then asks the git service (git ls-remote, no
 * GitHub API rate cost) and caches the answer.
 */
export async function resolveBranch(
  groupId: string,
  explicit?: string | null,
): Promise<string> {
  if (explicit) return explicit;

  const cached = await prisma.group.findUnique({
    where: { id: groupId },
    select: { defaultBranch: true },
  });
  if (cached?.defaultBranch) return cached.defaultBranch;

  const repoUrl = await repoUrlFor(groupId);
  const data = await call<{ branch: string }>("/default-branch", { repoUrl });
  await prisma.group.update({
    where: { id: groupId },
    data: { defaultBranch: data.branch },
  });
  return data.branch;
}

/** Read a single file's content (+ metadata flags) from the clone. */
export async function readFile(
  groupId: string,
  branch: string,
  filePath: string,
): Promise<{
  content?: string;
  binary?: boolean;
  isImage?: boolean;
  size: number;
  name: string;
  downloadUrl?: string;
  heavy?: boolean;
  readOnly?: boolean;
}> {
  return call("/content", { groupId, branch, filePath });
}

/** Fetch raw bytes for a file (used by /api/file-download for images/binaries). */
export async function readFileRawBuffer(
  groupId: string,
  branch: string,
  filePath: string,
): Promise<Buffer> {
  if (!SERVICE || !SECRET) {
    throw new Error(
      "GIT_SERVICE_URL and GIT_SERVICE_SECRET must be set to use the git workspace service",
    );
  }
  const params = new URLSearchParams({ groupId, branch, path: filePath });
  const res = await fetch(`${SERVICE}/file?${params.toString()}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Git service error");
  }
  return Buffer.from(await res.arrayBuffer());
}