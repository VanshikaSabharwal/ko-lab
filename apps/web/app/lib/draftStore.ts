import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { s3Client } from "./s3";
import { readFileRawBuffer } from "./gitClient";

// Drafts (write-through saves) live in an S3-compatible bucket as plain
// objects — keyed drafts/{groupId}/{userId}/{path}. Using object storage instead
// of local disk means drafts are durable across Render restarts/redeploys and
// never consume instance disk space. The DB ModifiedFiles row holds only
// metadata; the bytes are here. Restoring a deleted file pulls the original
// from the shared per-group branch clone on the git service.

const DRAFT_BUCKET = process.env.DRAFT_BUCKET || process.env.S3_BUCKET || "ko-lab-drafts";

function requireBucket(): string {
  if (!DRAFT_BUCKET) {
    throw new Error("DRAFT_BUCKET or S3_BUCKET must be set to use draft storage");
  }
  return DRAFT_BUCKET;
}

function draftKey(groupId: string, userId: string, filePath: string): string {
  return `drafts/${groupId}/${userId}/${filePath}`;
}

async function readObjectAsText(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (Body === undefined) return "";
  if (typeof Body === "string") return Body;
  if (Body instanceof Uint8Array) return Buffer.from(Body).toString("utf-8");
  if (typeof (Body as { transformToString: unknown }).transformToString === "function") {
    return await (Body as { transformToString: () => Promise<string> }).transformToString();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Write a draft file's content. Creates/replaces the object. */
export async function writeDraft(
  groupId: string,
  userId: string,
  filePath: string,
  content: string,
): Promise<void> {
  const bucket = requireBucket();
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: draftKey(groupId, userId, filePath),
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
}

/** Read a draft file; returns null if this user hasn't saved that path. */
export async function readDraft(
  groupId: string,
  userId: string,
  filePath: string,
): Promise<string | null> {
  const bucket = requireBucket();
  try {
    return await readObjectAsText(s3Client, bucket, draftKey(groupId, userId, filePath));
  } catch (e: any) {
    if (e?.name === "NoSuchKey") return null;
    throw e;
  }
}

/** Stage a deletion by removing the draft object. Idempotent. */
export async function deleteDraft(
  groupId: string,
  userId: string,
  filePath: string,
): Promise<void> {
  const bucket = requireBucket();
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: draftKey(groupId, userId, filePath) }),
  );
}

/**
 * Undo a staged deletion: copy the original back from the shared branch clone
 * on the git service. A missing original (deleting a brand-new file) is a
 * no-op, matching the previous local-disk behavior.
 */
export async function restoreDraft(
  groupId: string,
  userId: string,
  branch: string,
  filePath: string,
): Promise<void> {
  const bucket = requireBucket();
  try {
    const original = await readFileRawBuffer(groupId, branch, filePath);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: draftKey(groupId, userId, filePath),
        Body: original,
      }),
    );
  } catch {
    // Original doesn't exist in the repo — nothing to restore.
  }
}

/** Delete every draft object for a user (after a change request is submitted). */
export async function clearDrafts(
  groupId: string,
  userId: string,
): Promise<void> {
  const bucket = requireBucket();
  const prefix = `drafts/${groupId}/${userId}/`;
  let token: string | undefined;
  do {
    const { Contents, NextContinuationToken } = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    if (Contents && Contents.length > 0) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: Contents.map((c) => ({ Key: c.Key! })) },
        }),
      );
    }
    token = NextContinuationToken;
  } while (token);
}

/**
 * Plain-text form of stored draft content. Phase 2 saves write plain UTF-8, but
 * rows saved earlier are base64 (the editor btoa'd on save). Decode those so
 * previews and commits stay consistent, and pass plain text through untouched.
 */
export function contentToPlain(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const decoded = Buffer.from(stored, "base64").toString("utf-8");
    const reencoded = Buffer.from(decoded, "utf-8").toString("base64");
    if (reencoded.replace(/=+$/, "") === stored.replace(/=+$/, "")) return decoded;
  } catch {
    /* not base64 — return as-is below */
  }
  return stored;
}

/**
 * Current text for a user's draft file: read draft storage, falling back to
 * the (legacy) content stored on the row. Deleted drafts have no content.
 */
export async function draftContentFor(
  groupId: string,
  userId: string,
  filePath: string,
  storedContent: string | null,
): Promise<string | null> {
  const fromStore = await readDraft(groupId, userId, filePath).catch(() => null);
  if (fromStore !== null) return fromStore;
  return contentToPlain(storedContent);
}