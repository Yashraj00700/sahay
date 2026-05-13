import { and, eq } from "drizzle-orm";
import { customers, conversations, messages, withTenant } from "@sahay/db";
import { normalizeIndianPhone } from "@sahay/shared";
import { inngest } from "../client";
import { env } from "../../lib/env";
import { triggerToTenant } from "../../lib/pusher";
import { fetchAndStoreWhatsAppMedia } from "../../services/channels/whatsapp.media";
import { isR2Configured } from "../../services/storage/r2";

/**
 * whatsapp-incoming
 *
 * Handles inbound WhatsApp messages forwarded from Meta's webhook.
 * Replaces the BullMQ `incoming-whatsapp` queue + worker pair.
 *
 * Pipeline (each `step.run` is independently retried on failure
 * and memoized on success — partial progress survives crashes):
 *   1. parse           — extract message fields from raw webhook payload
 *   2. upsert-customer — find by whatsappId or insert new row
 *   3. upsert-conversation — find open conv (24h window) or open new one
 *   4. insert-message  — persist the inbound message + advance turnCount
 *   5. queue-ai        — fan-out by sending `ai/respond.requested`
 *   6. realtime fan-out — message:new event to tenant channel
 *
 * Concurrency: capped at 50 in-flight per tenant. Heavy senders can't
 * starve other tenants because the throttle key is `event.data.tenantId`.
 *
 * Retries: 5 with exponential backoff (Inngest default). Steps that
 * already completed are skipped on retry.
 */

interface ParsedMessage {
  from: string;
  messageId: string;
  timestamp: string;
  type:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "interactive"
    | "sticker"
    | "location"
    | "unknown";
  text?: { body: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string };
  interactive?: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

function parseWhatsAppEntry(raw: Record<string, unknown>): ParsedMessage {
  // The webhook handler may forward us either:
  //   (a) the parsed `messages[0]` object directly, or
  //   (b) a Meta entry blob with entry[].changes[].value.messages[0]
  // Try (a) first — looks like a message if it has a `from` and `id`.
  const candidate = raw as { from?: unknown; id?: unknown };
  let msg: Record<string, unknown> | null = null;
  if (typeof candidate.from === "string" && typeof candidate.id === "string") {
    msg = raw;
  } else {
    const entry = (raw as { entry?: Array<Record<string, unknown>> })
      .entry?.[0];
    const changes = (
      entry as { changes?: Array<Record<string, unknown>> } | undefined
    )?.changes?.[0];
    const value = (changes as { value?: Record<string, unknown> } | undefined)
      ?.value;
    const messagesArr = (
      value as { messages?: Array<Record<string, unknown>> } | undefined
    )?.messages;
    msg = messagesArr?.[0] ?? null;
  }

  if (!msg) {
    throw new Error("whatsapp-incoming.parse: no message in payload");
  }

  const type = (msg["type"] as ParsedMessage["type"] | undefined) ?? "unknown";

  return {
    from: String(msg["from"] ?? ""),
    messageId: String(msg["id"] ?? ""),
    timestamp: String(msg["timestamp"] ?? Math.floor(Date.now() / 1000)),
    type,
    text: msg["text"] as ParsedMessage["text"],
    image: msg["image"] as ParsedMessage["image"],
    audio: msg["audio"] as ParsedMessage["audio"],
    video: msg["video"] as ParsedMessage["video"],
    document: msg["document"] as ParsedMessage["document"],
    interactive: msg["interactive"] as ParsedMessage["interactive"],
    rawPayload: raw,
  };
}

export const whatsappIncoming = inngest.createFunction(
  {
    id: "whatsapp-incoming",
    retries: 5,
    concurrency: {
      limit: 50,
      key: "event.data.tenantId",
    },
  },
  { event: "whatsapp/message.received" },
  async ({ event, step, logger }) => {
    const { tenantId, raw } = event.data;

    // 1. Parse the raw Meta webhook entry into the shape our DB layer wants.
    const parsed = await step.run("parse", async () => {
      return parseWhatsAppEntry(raw);
    });

    if (!parsed.from || !parsed.messageId) {
      logger.warn(
        { tenantId },
        "whatsapp-incoming: skipping payload with no from/id",
      );
      return { skipped: true };
    }

    // 1b. If the inbound is a media message, fetch from Meta + re-host on R2.
    //     We do this before inserting so the message row already carries the
    //     final URL — UI never has to handle a transient "[loading]" state.
    //     Failures are tolerated: we fall back to a placeholder content/url
    //     so the rest of the pipeline (AI, realtime fan-out) keeps running.
    type MediaInfo = {
      url: string | null;
      mimeType: string | null;
      size: number | null;
      placeholderContent: string | null;
    };
    const isMediaType =
      parsed.type === "image" ||
      parsed.type === "audio" ||
      parsed.type === "video" ||
      parsed.type === "document";

    let media: MediaInfo = {
      url: null,
      mimeType: null,
      size: null,
      placeholderContent: null,
    };

    if (isMediaType) {
      const mediaId =
        parsed.image?.id ??
        parsed.audio?.id ??
        parsed.video?.id ??
        parsed.document?.id ??
        null;

      if (!mediaId) {
        logger.warn(
          { tenantId, type: parsed.type, channelMessageId: parsed.messageId },
          "whatsapp-incoming: media message missing media id",
        );
        media = {
          url: null,
          mimeType: null,
          size: null,
          placeholderContent: "[media unavailable]",
        };
      } else if (!isR2Configured()) {
        // Dev fallback: don't block the pipeline on missing R2 creds.
        logger.warn(
          { tenantId, mediaId },
          "whatsapp-incoming: R2 not configured, skipping media download",
        );
        media = {
          url: null,
          mimeType: null,
          size: null,
          placeholderContent: "[dev: media skipped]",
        };
      } else {
        media = await step.run(
          "download-media",
          async (): Promise<MediaInfo> => {
            try {
              const result = await fetchAndStoreWhatsAppMedia({
                mediaId,
                accessToken: env.WA_ACCESS_TOKEN,
                tenantId,
                messageId: parsed.messageId,
              });
              return {
                url: result.url,
                mimeType: result.mimeType,
                size: result.size,
                placeholderContent: null,
              };
            } catch (err) {
              // Swallow the error — we don't want media problems to fail the
              // whole pipeline. The message will still be stored with a
              // placeholder so agents see *something*.
              logger.error(
                { err, tenantId, mediaId, channelMessageId: parsed.messageId },
                "whatsapp-incoming: media download failed",
              );
              return {
                url: null,
                mimeType: null,
                size: null,
                placeholderContent: "[media unavailable]",
              };
            }
          },
        );
      }
    }

    // 2. Find or create the customer record keyed by whatsappId.
    const customer = await step.run("upsert-customer", async () =>
      withTenant(tenantId, async (tx) => {
        const normalizedPhone = normalizeIndianPhone(parsed.from);
        const existing = await tx.query.customers.findFirst({
          where: and(
            eq(customers.tenantId, tenantId),
            eq(customers.whatsappId, parsed.from),
          ),
        });
        if (existing) {
          return { id: existing.id, tier: existing.tier ?? "new" };
        }
        const [created] = await tx
          .insert(customers)
          .values({
            tenantId,
            phone: normalizedPhone,
            whatsappId: parsed.from,
            languagePref: "auto",
          })
          .returning({ id: customers.id, tier: customers.tier });
        if (!created)
          throw new Error("whatsapp-incoming: failed to insert customer");
        return { id: created.id, tier: created.tier ?? "new" };
      }),
    );

    // 3. Find an open 24h-window conversation or open a new one.
    const conversation = await step.run("upsert-conversation", async () =>
      withTenant(tenantId, async (tx) => {
        const existing = await tx.query.conversations.findFirst({
          where: and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.customerId, customer.id),
            eq(conversations.channel, "whatsapp"),
            eq(conversations.status, "open"),
          ),
        });
        const now = new Date();
        const sessionExpired = existing?.sessionExpiresAt
          ? existing.sessionExpiresAt < now
          : false;

        if (!existing || sessionExpired) {
          const [created] = await tx
            .insert(conversations)
            .values({
              tenantId,
              customerId: customer.id,
              channel: "whatsapp",
              status: "open",
              sessionExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            })
            .returning();
          if (!created)
            throw new Error("whatsapp-incoming: failed to insert conversation");
          return { id: created.id, turnCount: created.turnCount ?? 0 };
        }

        // Refresh the 24h window on every new message.
        await tx
          .update(conversations)
          .set({
            sessionExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            updatedAt: now,
          })
          .where(eq(conversations.id, existing.id));

        return { id: existing.id, turnCount: existing.turnCount ?? 0 };
      }),
    );

    // 4. Persist the message row + bump conversation turn count.
    const storedMessage = await step.run("insert-message", async () =>
      withTenant(tenantId, async (tx) => {
        // Text content stays as-is. Media messages either store the caption
        // (image/video) or the failure placeholder so the dashboard always
        // has *some* preview text to render.
        const captionFromPayload =
          parsed.image?.caption ?? parsed.video?.caption ?? null;

        const msgContent =
          parsed.type === "text"
            ? (parsed.text?.body ?? "")
            : (captionFromPayload ?? media.placeholderContent);

        // Prefer the MIME we got back from R2 (authoritative — based on what
        // Meta served), fall back to the webhook's hint if we never fetched.
        const mediaMimeType =
          media.mimeType ??
          parsed.image?.mime_type ??
          parsed.audio?.mime_type ??
          parsed.video?.mime_type ??
          parsed.document?.mime_type ??
          null;

        // Idempotency: ignore duplicate channelMessageId (Meta retries).
        const existing = await tx.query.messages.findFirst({
          where: and(
            eq(messages.tenantId, tenantId),
            eq(messages.channelMessageId, parsed.messageId),
          ),
        });
        if (existing) return { id: existing.id, deduped: true };

        const [created] = await tx
          .insert(messages)
          .values({
            conversationId: conversation.id,
            tenantId,
            senderType: "customer",
            // Drizzle text column accepts string; widen via cast to avoid generic literal mismatch.
            contentType: parsed.type,
            content: msgContent,
            mediaUrl: media.url ?? undefined,
            mediaSize: media.size ?? undefined,
            mediaMimeType: mediaMimeType ?? undefined,
            mediaFilename: parsed.document?.filename ?? undefined,
            channelMessageId: parsed.messageId,
            channelStatus: "delivered",
            channelRawPayload: parsed.rawPayload,
            sentAt: new Date(parseInt(parsed.timestamp, 10) * 1000),
          })
          .returning({ id: messages.id });

        if (!created)
          throw new Error("whatsapp-incoming: failed to insert message");

        await tx
          .update(conversations)
          .set({
            turnCount: (conversation.turnCount ?? 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, conversation.id));

        return { id: created.id, deduped: false };
      }),
    );

    // 5. Fan-out: hand the AI pipeline the new message.
    await step.sendEvent("queue-ai", {
      name: "ai/respond.requested",
      data: {
        tenantId,
        conversationId: conversation.id,
        messageId: storedMessage.id,
      },
    });

    // 6. Realtime fan-out so dashboards see the message immediately.
    await step.run("realtime-broadcast", async () => {
      await triggerToTenant(tenantId, "message:new", {
        conversationId: conversation.id,
        messageId: storedMessage.id,
        senderType: "customer",
        channel: "whatsapp",
      });
    });

    return {
      conversationId: conversation.id,
      messageId: storedMessage.id,
    };
  },
);
