/**
 * POST /api/messages/upload
 *
 * Issues a presigned R2 PUT URL so an authenticated agent can upload an
 * attachment directly to Cloudflare R2 without round-tripping the bytes
 * through the API. The flow is:
 *
 *   1. Client → POST /api/messages/upload with { conversationId, fileName,
 *                                                contentType, sizeBytes }
 *   2. API verifies tenant ownership of the conversation, validates the
 *      content-type / size, generates a deterministic key, and returns a
 *      short-lived presigned PUT URL + the eventual public URL.
 *   3. Client PUTs the file straight to R2.
 *   4. Client POSTs to /api/conversations/:id/messages with the public URL
 *      embedded as the message media — that endpoint then dispatches the
 *      actual outbound WhatsApp / Instagram send.
 *
 * Security:
 *   - Auth is enforced by `defineAuthedHandler`.
 *   - Tenant ownership of the target conversation is checked in DB.
 *   - Allowed MIME types are whitelisted (defense in depth — even a leaked
 *     PUT URL can only write the content-type the URL was signed for).
 *   - Max size is 16 MiB (WhatsApp policy ceiling).
 *   - Filename is sanitized for use in the R2 key extension only — we never
 *     trust client-provided paths.
 */

import { z } from "zod";
import { conversations } from "@sahay/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { defineAuthedHandler, parseBody } from "../../apps/api/src/lib/handler";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";
import { NotFoundError, ValidationError } from "../../apps/api/src/lib/errors";
import {
  getSignedUploadUrl,
  isR2Configured,
  keyFor,
  publicUrl,
  MAX_FILE_SIZE_BYTES,
} from "../../apps/api/src/services/storage/r2";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "audio/ogg",
  "audio/mpeg",
  "video/mp4",
] as const;

const uploadBodySchema = z.object({
  conversationId: z.string().uuid("conversationId must be a UUID"),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE_BYTES, `sizeBytes must be ≤ ${MAX_FILE_SIZE_BYTES}`),
});

/**
 * Maps a content-type to a canonical extension for the R2 key. We don't read
 * the extension from the user-supplied filename to keep the key namespace
 * predictable and immune to tricks like `image.jpg.exe`.
 */
function extForContentType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    case "video/mp4":
      return "mp4";
    default:
      return "bin";
  }
}

export default defineAuthedHandler(
  async (req, _res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id);

    if (!isR2Configured()) {
      throw new ValidationError(
        "Attachment uploads are disabled (storage not configured)",
      );
    }

    const body = parseBody(uploadBodySchema, req.body);

    // Verify conversation belongs to caller's tenant.
    const [conv] = await ctx.withTenant((tx) =>
      tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, body.conversationId),
            eq(conversations.tenantId, ctx.tenant.id),
          ),
        )
        .limit(1),
    );

    if (!conv) {
      throw new NotFoundError("Conversation not found");
    }

    // Generate a unique per-upload id so two parallel uploads to the same
    // conversation never collide. We reuse the existing `keyFor` helper so
    // R2 keys for inbound (channel media) and outbound (agent uploads) share
    // the same prefix structure.
    const uploadId = randomUUID();
    const ext = extForContentType(body.contentType);
    const key = keyFor({
      tenantId: ctx.tenant.id,
      channel: "agent-upload",
      messageId: uploadId,
      ext,
    });

    const signed = await getSignedUploadUrl({
      key,
      contentType: body.contentType,
      // 5 minutes is enough for even a 16 MiB upload over a slow link.
      expiresInSec: 5 * 60,
    });

    return {
      uploadUrl: signed.url,
      key: signed.key,
      // Publicly-resolvable URL the client should send back to
      // /api/conversations/:id/messages once the PUT completes.
      publicUrl: publicUrl(signed.key),
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      conversationId: body.conversationId,
      expiresInSec: 5 * 60,
    };
  },
  { methods: ["POST"] },
);
