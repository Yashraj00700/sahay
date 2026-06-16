/**
 * Cloudflare R2 (S3-compatible) object storage adapter.
 *
 * Used for media re-hosting (WhatsApp / Instagram inbound attachments) and
 * agent-side direct uploads via signed PUT URLs. R2 buckets in this app are
 * served from a public hostname (R2_PUBLIC_URL) so we can stitch a stable
 * absolute URL onto every stored object without proxying through us.
 *
 * Framework-agnostic — safe to import from Vercel Functions, Inngest jobs,
 * or unit tests. The S3Client is lazily constructed inside `getClient()` so
 * cold starts only pay the SDK init cost the first time something is read or
 * written. No dependency on Fastify / Express.
 *
 * Dev fallback: when R2_* env vars are unset, every operation throws an
 * `IntegrationError('r2', 'R2 not configured')` with a stable code so callers
 * can detect the condition and degrade gracefully (the WhatsApp/Instagram
 * media adapters use this to write a `[dev: media skipped]` placeholder
 * instead of failing the whole pipeline).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../../lib/env";
import { IntegrationError } from "../../lib/errors";
import { logger } from "../../lib/logger";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * WhatsApp Cloud API caps inbound media at 16 MiB. We keep the same ceiling
 * everywhere (including agent uploads) so we don't accidentally accept files
 * we can't later forward to WA.
 */
export const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

/** Default expiry for both signed PUT (uploads) and signed GET (reads). */
const DEFAULT_SIGNED_URL_EXPIRES_SEC = 5 * 60; // 5 minutes

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PutObjectArgs {
  /** Object key (path inside the bucket); should not start with a slash. */
  key: string;
  /** Bytes to upload. Buffer or Uint8Array; we measure size from `byteLength`. */
  body: Buffer | Uint8Array;
  /** MIME type, written to the object so signed reads serve correct headers. */
  contentType: string;
}

export interface PutObjectResult {
  url: string;
  key: string;
  size: number;
}

export interface GetSignedUploadUrlArgs {
  key: string;
  contentType: string;
  expiresInSec?: number;
}

export interface GetSignedUploadUrlResult {
  url: string;
  key: string;
}

export interface KeyForArgs {
  tenantId: string;
  channel: "whatsapp" | "instagram" | "webchat" | "email" | "agent-upload";
  messageId: string;
  ext: string;
}

// ─── R2 client (lazy singleton) ───────────────────────────────────────────────

let cachedClient: S3Client | null = null;

/**
 * True when all R2 env vars are present. Callers (e.g. WhatsApp media
 * download) check this before attempting to upload so we can no-op cleanly
 * in local dev without R2 credentials.
 */
export function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME,
  );
}

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  if (!isR2Configured()) {
    throw new IntegrationError("r2", "R2 not configured (missing env vars)");
  }
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
    },
    // R2 requires path-style addressing for some SDK paths; the default
    // virtual-host style works for our use case but path-style is safer
    // when the bucket name contains uppercase chars or dots.
    forcePathStyle: false,
  });
  return cachedClient;
}

function getBucket(): string {
  if (!env.R2_BUCKET_NAME) {
    throw new IntegrationError("r2", "R2 bucket name not configured");
  }
  return env.R2_BUCKET_NAME;
}

// ─── Key helper ───────────────────────────────────────────────────────────────

/**
 * Builds a deterministic, multi-tenant-safe object key.
 * Format: `tenant/<tenantId>/<channel>/<YYYY>/<MM>/<messageId>.<ext>`
 *
 * The year/month buckets keep listings cheap and let us add lifecycle rules
 * (e.g. "delete tenant uploads older than 1 year") without a database scan.
 * `messageId` is the DB row id, which is unique per tenant — collisions are
 * structurally impossible.
 */
export function keyFor(args: KeyForArgs): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = args.ext.replace(/^\./, "").toLowerCase() || "bin";
  return `tenant/${args.tenantId}/${args.channel}/${year}/${month}/${args.messageId}.${ext}`;
}

// ─── Public URL helper ────────────────────────────────────────────────────────

/**
 * Returns the canonical public URL for a key, assuming the bucket is fronted
 * by `R2_PUBLIC_URL` (e.g. https://media.example.com or the `r2.dev` domain).
 * If `R2_PUBLIC_URL` is unset (dev), we fall back to a stable `r2://bucket/key`
 * placeholder so logs don't break and callers can still tell what was stored.
 */
export function publicUrl(key: string): string {
  const base = env.R2_PUBLIC_URL;
  if (!base) {
    return `r2://${env.R2_BUCKET_NAME ?? "unconfigured"}/${key}`;
  }
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleanKey = key.startsWith("/") ? key.slice(1) : key;
  return `${trimmed}/${cleanKey}`;
}

// ─── Operations ───────────────────────────────────────────────────────────────

/**
 * Uploads `body` to R2 under `key` with the given content-type. Returns the
 * canonical public URL plus the key + byte size.
 *
 * Throws `IntegrationError('r2', ...)` on:
 *   - missing R2 config
 *   - file > MAX_FILE_SIZE_BYTES
 *   - any S3 SDK error (network, auth, etc.)
 */
export async function putObject(args: PutObjectArgs): Promise<PutObjectResult> {
  const size = args.body.byteLength;
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new IntegrationError(
      "r2",
      `Object exceeds ${MAX_FILE_SIZE_BYTES} bytes (got ${size})`,
    );
  }

  const client = getClient();
  const bucket = getBucket();

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: args.key,
        Body: args.body,
        ContentType: args.contentType,
        ContentLength: size,
      }),
    );
  } catch (err) {
    logger.error({ err, key: args.key, size }, "r2.putObject failed");
    throw new IntegrationError(
      "r2",
      err instanceof Error ? err.message : "putObject failed",
      err,
    );
  }

  const url = publicUrl(args.key);
  logger.debug({ key: args.key, size, url }, "r2.putObject ok");
  return { url, key: args.key, size };
}

/**
 * Returns a presigned PUT URL the client can upload directly to. Used by the
 * agent-attachment upload flow — the API never sees the file bytes.
 */
export async function getSignedUploadUrl(
  args: GetSignedUploadUrlArgs,
): Promise<GetSignedUploadUrlResult> {
  const client = getClient();
  const bucket = getBucket();
  const expiresIn = args.expiresInSec ?? DEFAULT_SIGNED_URL_EXPIRES_SEC;

  try {
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: args.key,
        ContentType: args.contentType,
      }),
      { expiresIn },
    );
    logger.debug(
      { key: args.key, expiresIn, contentType: args.contentType },
      "r2.getSignedUploadUrl ok",
    );
    return { url, key: args.key };
  } catch (err) {
    logger.error({ err, key: args.key }, "r2.getSignedUploadUrl failed");
    throw new IntegrationError(
      "r2",
      err instanceof Error ? err.message : "getSignedUploadUrl failed",
      err,
    );
  }
}

/**
 * Returns a presigned GET URL for a private object. The default expiry is 5
 * minutes — long enough for the user agent to start streaming, short enough
 * that a leaked URL is not a long-term credential.
 */
export async function getSignedReadUrl(args: {
  key: string;
  expiresInSec?: number;
}): Promise<string> {
  const client = getClient();
  const bucket = getBucket();
  const expiresIn = args.expiresInSec ?? DEFAULT_SIGNED_URL_EXPIRES_SEC;

  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: args.key }),
      { expiresIn },
    );
  } catch (err) {
    logger.error({ err, key: args.key }, "r2.getSignedReadUrl failed");
    throw new IntegrationError(
      "r2",
      err instanceof Error ? err.message : "getSignedReadUrl failed",
      err,
    );
  }
}

export async function deleteObject(key: string): Promise<void> {
  const client = getClient();
  const bucket = getBucket();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    logger.debug({ key }, "r2.deleteObject ok");
  } catch (err) {
    logger.error({ err, key }, "r2.deleteObject failed");
    throw new IntegrationError(
      "r2",
      err instanceof Error ? err.message : "deleteObject failed",
      err,
    );
  }
}
