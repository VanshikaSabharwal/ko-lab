import { ENDPOINT, IMAGE_BUCKET, DRAFT_BUCKET, CLIENT_CONFIG, assertLocalEndpoint } from "./config";

// Runs before each test file is imported. The storage modules read these when
// they load, so they must be set first; this is what points the app's real
// storage code at LocalStack and the test buckets.
assertLocalEndpoint();

process.env.S3_ENDPOINT = ENDPOINT;
process.env.S3_BUCKET = IMAGE_BUCKET;
process.env.DRAFT_BUCKET = DRAFT_BUCKET;
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.AWS_REGION = CLIENT_CONFIG.region;
process.env.AWS_ACCESS_KEY_ID = CLIENT_CONFIG.credentials.accessKeyId;
process.env.AWS_SECRET_ACCESS_KEY = CLIENT_CONFIG.credentials.secretAccessKey;
// A public base URL (production's CDN domain) would make image links point away
// from LocalStack, where the test couldn't fetch them back.
delete process.env.S3_PUBLIC_BASE_URL;
