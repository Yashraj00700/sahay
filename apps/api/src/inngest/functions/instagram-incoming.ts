import { and, eq } from 'drizzle-orm'
import { db, customers, conversations, messages } from '@sahay/db'
import { inngest } from '../client'
import { triggerToTenant } from '../../lib/pusher'
import { fetchAndStoreInstagramMedia } from '../../services/channels/instagram.media'
import { isR2Configured } from '../../services/storage/r2'

/**
 * instagram-incoming
 *
 * Handles inbound Instagram DMs forwarded by Meta's Messenger webhook.
 * Same pipeline shape as whatsapp-incoming, but customers are matched on
 * `instagramId` (a PSID) instead of phone number, and the channel is
 * 'instagram'. IG conversations don't have the same hard 24h policy
 * window as WA, but we still set `sessionExpiresAt` for consistency in
 * routing logic.
 */

interface ParsedIGMessage {
  igUserId: string // sender PSID
  messageId: string
  timestamp: string
  type: 'text' | 'image' | 'audio' | 'video' | 'sticker' | 'story_reply' | 'unknown'
  text?: string
  attachmentUrl?: string
  attachmentMime?: string
  igStoryId?: string
  igStoryMediaUrl?: string
  rawPayload: Record<string, unknown>
}

function parseInstagramEntry(raw: Record<string, unknown>): ParsedIGMessage {
  // Two possible shapes:
  //   (a) the parsed `messaging[0]` object directly, or
  //   (b) the full webhook entry { entry: [{ messaging: [...] }] }
  let messaging: Record<string, unknown> | null = null
  if ((raw as { sender?: unknown }).sender !== undefined) {
    messaging = raw
  } else {
    const entry = (raw as { entry?: Array<Record<string, unknown>> }).entry?.[0]
    const messagingArr = (entry as { messaging?: Array<Record<string, unknown>> } | undefined)
      ?.messaging
    messaging = messagingArr?.[0] ?? null
  }

  if (!messaging) {
    throw new Error('instagram-incoming.parse: no messaging entry')
  }

  const sender = (messaging['sender'] as { id?: string } | undefined)?.id ?? ''
  const message = (messaging['message'] as Record<string, unknown> | undefined) ?? {}
  const messageId = String(message['mid'] ?? '')
  const timestamp = String(messaging['timestamp'] ?? Math.floor(Date.now() / 1000))

  const text = typeof message['text'] === 'string' ? (message['text'] as string) : undefined

  const attachments =
    (message['attachments'] as Array<Record<string, unknown>> | undefined) ?? []
  const firstAttachment = attachments[0]
  const attachmentType = firstAttachment?.['type'] as string | undefined
  const attachmentPayload = firstAttachment?.['payload'] as Record<string, unknown> | undefined
  const attachmentUrl = attachmentPayload?.['url'] as string | undefined

  let type: ParsedIGMessage['type'] = 'unknown'
  if (text !== undefined) type = 'text'
  else if (attachmentType === 'image') type = 'image'
  else if (attachmentType === 'audio') type = 'audio'
  else if (attachmentType === 'video') type = 'video'
  else if (attachmentType === 'story_mention' || attachmentType === 'story_reply')
    type = 'story_reply'

  return {
    igUserId: sender,
    messageId,
    timestamp,
    type,
    text,
    attachmentUrl,
    igStoryId: attachmentPayload?.['story_id'] as string | undefined,
    igStoryMediaUrl: attachmentPayload?.['url'] as string | undefined,
    rawPayload: raw,
  }
}

export const instagramIncoming = inngest.createFunction(
  {
    id: 'instagram-incoming',
    retries: 5,
    concurrency: { limit: 50, key: 'event.data.tenantId' },
  },
  { event: 'instagram/message.received' },
  async ({ event, step, logger }) => {
    const { tenantId, raw } = event.data

    const parsed = await step.run('parse', async () => parseInstagramEntry(raw))

    if (!parsed.igUserId || !parsed.messageId) {
      logger.warn({ tenantId }, 'instagram-incoming: skipping payload with no sender/mid')
      return { skipped: true }
    }

    // 1b. If the inbound carries a media attachment, mirror the bytes to R2
    //     so we keep them after Meta's CDN URL expires. We tolerate failures:
    //     the message is still inserted (with the original IG URL as fallback)
    //     so the agent dashboard never silently drops a customer message.
    type IGMediaInfo = {
      url: string | null
      mimeType: string | null
      size: number | null
      placeholderContent: string | null
    }

    const isMediaType =
      parsed.type === 'image' ||
      parsed.type === 'audio' ||
      parsed.type === 'video'

    let media: IGMediaInfo = {
      url: null,
      mimeType: null,
      size: null,
      placeholderContent: null,
    }

    if (isMediaType && parsed.attachmentUrl) {
      if (!isR2Configured()) {
        logger.warn(
          { tenantId, channelMessageId: parsed.messageId },
          'instagram-incoming: R2 not configured, falling back to source URL',
        )
        media = {
          // In dev, persist the (short-lived) source URL — it'll work for a
          // few minutes which is enough to verify the pipeline locally.
          url: parsed.attachmentUrl,
          mimeType: parsed.attachmentMime ?? null,
          size: null,
          placeholderContent: '[dev: media skipped]',
        }
      } else {
        media = await step.run('download-media', async (): Promise<IGMediaInfo> => {
          try {
            const result = await fetchAndStoreInstagramMedia({
              payloadUrl: parsed.attachmentUrl as string,
              tenantId,
              messageId: parsed.messageId,
              attachmentType:
                parsed.type === 'image'
                  ? 'image'
                  : parsed.type === 'video'
                  ? 'video'
                  : parsed.type === 'audio'
                  ? 'audio'
                  : 'file',
            })
            return {
              url: result.url,
              mimeType: result.mimeType,
              size: result.size,
              placeholderContent: null,
            }
          } catch (err) {
            logger.error(
              { err, tenantId, channelMessageId: parsed.messageId },
              'instagram-incoming: media download failed',
            )
            return {
              url: null,
              mimeType: null,
              size: null,
              placeholderContent: '[media unavailable]',
            }
          }
        })
      }
    }

    const customer = await step.run('upsert-customer', async () => {
      const existing = await db.query.customers.findFirst({
        where: and(
          eq(customers.tenantId, tenantId),
          eq(customers.instagramId, parsed.igUserId),
        ),
      })
      if (existing) return { id: existing.id, tier: existing.tier ?? 'new' }

      const [created] = await db
        .insert(customers)
        .values({
          tenantId,
          instagramId: parsed.igUserId,
          languagePref: 'auto',
        })
        .returning({ id: customers.id, tier: customers.tier })
      if (!created) throw new Error('instagram-incoming: failed to insert customer')
      return { id: created.id, tier: created.tier ?? 'new' }
    })

    const conversation = await step.run('upsert-conversation', async () => {
      const existing = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.customerId, customer.id),
          eq(conversations.channel, 'instagram'),
          eq(conversations.status, 'open'),
        ),
      })
      const now = new Date()
      const sessionExpired = existing?.sessionExpiresAt
        ? existing.sessionExpiresAt < now
        : false

      if (!existing || sessionExpired) {
        const [created] = await db
          .insert(conversations)
          .values({
            tenantId,
            customerId: customer.id,
            channel: 'instagram',
            status: 'open',
            sessionExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          })
          .returning()
        if (!created) throw new Error('instagram-incoming: failed to insert conversation')
        return { id: created.id, turnCount: created.turnCount ?? 0 }
      }

      await db
        .update(conversations)
        .set({
          sessionExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          updatedAt: now,
        })
        .where(eq(conversations.id, existing.id))
      return { id: existing.id, turnCount: existing.turnCount ?? 0 }
    })

    const storedMessage = await step.run('insert-message', async () => {
      const existing = await db.query.messages.findFirst({
        where: and(
          eq(messages.tenantId, tenantId),
          eq(messages.channelMessageId, parsed.messageId),
        ),
      })
      if (existing) return { id: existing.id, deduped: true }

      const msgContent =
        parsed.type === 'text'
          ? parsed.text ?? ''
          : media.placeholderContent

      // R2-mirrored URL takes precedence; fall back to the (short-lived)
      // source URL only when we couldn't (or didn't try to) re-host.
      const finalMediaUrl = media.url ?? parsed.attachmentUrl ?? undefined
      const finalMediaMime =
        media.mimeType ?? parsed.attachmentMime ?? undefined

      const [created] = await db
        .insert(messages)
        .values({
          conversationId: conversation.id,
          tenantId,
          senderType: 'customer',
          contentType: parsed.type,
          content: msgContent,
          mediaUrl: finalMediaUrl,
          mediaSize: media.size ?? undefined,
          mediaMimeType: finalMediaMime,
          channelMessageId: parsed.messageId,
          channelStatus: 'delivered',
          channelRawPayload: parsed.rawPayload,
          igStoryId: parsed.igStoryId ?? undefined,
          igStoryMediaUrl: parsed.igStoryMediaUrl ?? undefined,
          sentAt: new Date(Number(parsed.timestamp)),
        })
        .returning({ id: messages.id })

      if (!created) throw new Error('instagram-incoming: failed to insert message')

      await db
        .update(conversations)
        .set({
          turnCount: (conversation.turnCount ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversation.id))

      return { id: created.id, deduped: false }
    })

    await step.sendEvent('queue-ai', {
      name: 'ai/respond.requested',
      data: {
        tenantId,
        conversationId: conversation.id,
        messageId: storedMessage.id,
      },
    })

    await step.run('realtime-broadcast', async () => {
      await triggerToTenant(tenantId, 'message:new', {
        conversationId: conversation.id,
        messageId: storedMessage.id,
        senderType: 'customer',
        channel: 'instagram',
      })
    })

    return {
      conversationId: conversation.id,
      messageId: storedMessage.id,
    }
  },
)
