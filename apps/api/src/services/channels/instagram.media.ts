/**
 * Instagram → Cloudflare R2 media re-host adapter.
 *
 * Instagram messaging webhooks (unlike WhatsApp) carry the full attachment
 * URL inline — `event.message.attachments[i].payload.url` — so there's no
 * separate metadata fetch step. The download URL itself is short-lived
 * (Meta CDN), which is exactly why we have to mirror it to R2 ASAP.
 *
 * Failure modes:
 *   - missing R2 config (dev): throw IntegrationError; pipeline catches it
 *   - oversize, network, auth: throw IntegrationError with `instagram_media`
 *
 * All requests use AbortController for a 30s hard ceiling.
 */

import { IntegrationError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import {
  isR2Configured,
  keyFor,
  putObject,
  MAX_FILE_SIZE_BYTES,
} from "../storage/r2";

const MEDIA_FETCH_TIMEOUT_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FetchAndStoreInstagramMediaArgs {
  /**
   * Direct download URL from the IG webhook payload (already short-lived).
   * Must include scheme + host. We do NOT trust this for routing — it's
   * fetched as-is and the result is uploaded to R2.
   */
  payloadUrl: string;
  /**
   * Tenant whose page received the DM. Used for the R2 key prefix.
   */
  tenantId: string;
  /**
   * DB messages.id this media is attached to. Used for the R2 key suffix.
   */
  messageId: string;
  /**
   * Optional MIME hint from the webhook ("image"/"video"/"audio"). If
   * provided we fall back on the response Content-Type but prefer this when
   * Meta sends generic `application/octet-stream`.
   */
  attachmentType?: "image" | "video" | "audio" | "file";
}

export interface FetchAndStoreInstagramMediaResult {
  url: string;
  key: string;
  mimeType: string;
  size: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extFromMime(mime: string): string {
  const lower = mime.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf",
  };
  return map[lower] ?? "bin";
}

/** Best-effort MIME inference when the response Content-Type is missing. */
function defaultMimeForType(
  type: FetchAndStoreInstagramMediaArgs["attachmentType"],
): string {
  switch (type) {
    case "image":
      return "image/jpeg";
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/mp4";
    case "file":
    default:
      return "application/octet-stream";
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  context: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new IntegrationError(
        "instagram_media",
        `${context}: request timed out after ${timeoutMs}ms`,
      );
    }
    throw new IntegrationError(
      "instagram_media",
      `${context}: ${(err as Error).message}`,
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function fetchAndStoreInstagramMedia(
  args: FetchAndStoreInstagramMediaArgs,
): Promise<FetchAndStoreInstagramMediaResult> {
  const { payloadUrl, tenantId, messageId } = args;

  if (!payloadUrl) {
    throw new IntegrationError("instagram_media", "payloadUrl is required");
  }
  if (!isR2Configured()) {
    throw new IntegrationError("instagram_media", "R2 not configured");
  }

  // Sanity-check the URL — we don't want callers to accidentally pass an
  // arbitrary internal URL.
  let parsed: URL;
  try {
    parsed = new URL(payloadUrl);
  } catch {
    throw new IntegrationError(
      "instagram_media",
      "payloadUrl is not a valid URL",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new IntegrationError(
      "instagram_media",
      `payloadUrl must be https (got ${parsed.protocol})`,
    );
  }

  const res = await fetchWithTimeout(
    payloadUrl,
    { method: "GET" },
    MEDIA_FETCH_TIMEOUT_MS,
    "download",
  );

  if (!res.ok) {
    throw new IntegrationError(
      "instagram_media",
      `download HTTP ${res.status}`,
    );
  }

  const arrayBuf = await res.arrayBuffer();
  const body = new Uint8Array(arrayBuf);
  if (body.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new IntegrationError(
      "instagram_media",
      `downloaded media exceeds ${MAX_FILE_SIZE_BYTES} bytes`,
    );
  }

  const headerMime = res.headers.get("content-type") ?? "";
  const mimeType =
    headerMime && headerMime !== "application/octet-stream"
      ? headerMime.split(";")[0].trim()
      : defaultMimeForType(args.attachmentType);

  const ext = extFromMime(mimeType);
  const key = keyFor({ tenantId, channel: "instagram", messageId, ext });
  const stored = await putObject({ key, body, contentType: mimeType });

  logger.info(
    {
      tenantId,
      messageId,
      key: stored.key,
      size: stored.size,
      mimeType,
    },
    "instagram_media: stored",
  );

  return {
    url: stored.url,
    key: stored.key,
    mimeType,
    size: stored.size,
  };
}
