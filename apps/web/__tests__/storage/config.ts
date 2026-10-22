/**
 * Settings for the storage tests, which run against LocalStack rather than a
 * stand-in. They use their own buckets, created before the run and removed
 * after, so development photos and drafts are never touched.
 */
export const ENDPOINT = process.env.STORAGE_TEST_ENDPOINT || "http://localhost:4566";
export const IMAGE_BUCKET = "ko-lab-test-images";
export const DRAFT_BUCKET = "ko-lab-test-drafts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "localstack"]);

/**
 * These tests create and delete buckets. Refuse anything but a local endpoint,
 * so a stray setting can never point them at real storage (R2).
 */
export function assertLocalEndpoint(): void {
  const host = new URL(ENDPOINT).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Storage tests only run against LocalStack, but the endpoint is ${ENDPOINT}. ` +
        "Unset STORAGE_TEST_ENDPOINT or point it at localhost.",
    );
  }
}

export const CLIENT_CONFIG = {
  region: "us-east-1",
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};
