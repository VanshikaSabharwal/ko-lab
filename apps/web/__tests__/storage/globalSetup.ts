import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { ENDPOINT, IMAGE_BUCKET, DRAFT_BUCKET, CLIENT_CONFIG, assertLocalEndpoint } from "./config";

const BUCKETS = [IMAGE_BUCKET, DRAFT_BUCKET];

async function emptyAndDelete(client: S3Client, bucket: string) {
  try {
    for (;;) {
      const { Contents } = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
      if (!Contents?.length) break;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: Contents.map((c) => ({ Key: c.Key! })) },
        }),
      );
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  } catch (e: any) {
    if (e?.name !== "NoSuchBucket") throw e;
  }
}

/** Creates the test buckets before the run; the returned function removes them after. */
export default async function setup() {
  assertLocalEndpoint();
  const client = new S3Client(CLIENT_CONFIG);

  try {
    const res = await fetch(`${ENDPOINT}/_localstack/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`health check returned ${res.status}`);
  } catch (e) {
    throw new Error(
      `LocalStack isn't reachable at ${ENDPOINT} (${e instanceof Error ? e.message : e}). ` +
        "Start it with `npm run localstack:up`, then run the storage tests again.",
    );
  }

  for (const bucket of BUCKETS) {
    // Left over from a run that crashed before cleaning up
    await emptyAndDelete(client, bucket);
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  return async () => {
    for (const bucket of BUCKETS) await emptyAndDelete(client, bucket);
    client.destroy();
  };
}
