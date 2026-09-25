import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const S3_ENDPOINT = process.env.S3_ENDPOINT;
const AVATAR_BUCKET = process.env.S3_BUCKET || "avatars";
// Public base URL for avatar objects, when the bucket is served through a
// public domain (e.g. an R2 custom domain). Falls back to the S3 endpoint
// itself for LocalStack, which serves buckets directly.
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL;

export const s3Client = new S3Client({
  // R2 is not a regional service and requires region "auto"; LocalStack sets
  // AWS_REGION explicitly (e.g. us-east-1).
  region: process.env.AWS_REGION || "auto",
  endpoint: S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Image types and size accepted for profile and group photos. */
export const ALLOWED_IMAGE_TYPES = Object.keys(EXTENSIONS);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function uploadAvatar(
  userId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  return uploadImage(`avatars/${userId}`, buffer, contentType);
}

export function uploadGroupImage(
  groupId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  return uploadImage(`group-images/${groupId}`, buffer, contentType);
}

async function uploadImage(
  prefix: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const ext = EXTENSIONS[contentType] || "bin";
  const key = `${prefix}/${randomUUID()}.${ext}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: AVATAR_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  const url = S3_PUBLIC_BASE_URL
    ? `${S3_PUBLIC_BASE_URL}/${key}`
    : `${S3_ENDPOINT}/${AVATAR_BUCKET}/${key}`;

  return url;
}
