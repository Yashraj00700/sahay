// ─── Incoming Instagram Worker ────────────────────────────────────────────────
// Consumes jobs from the incoming-instagram queue.
// Mirrors the WhatsApp incoming pipeline: find/create customer → find/create
// conversation → store message → enqueue AI respond job.
//
// job.data: IncomingInstagramJob
//   tenantId    — owning tenant
//   igUserId    — Instagram-scoped user ID of the sender
//   messageId   — Instagram message ID (from webhook)
//   timestamp   — unix timestamp string from webhook
//   type        — 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'story_mention'
//   text        — { body: string } for text messages
//   attachments — array of { type, url } for media
//   rawPayload  — full raw webhook payload for audit

import type { IncomingInstagramJob } from '../lib/queues'
import { db, customers, conversations, messages } from '@sahay/db'
import { eq, and, desc } from 'drizzle-orm'
import { aiRespondQueue } from '../lib/queues'
import { logger } from '../lib/logger'

export async function processIncomingInstagram(job: IncomingInstagramJob): Promise<void> {
  const { tenantId, igUserId, messageId, timestamp, type, text, attachments } = job

  logger.info(
    `[IGWorker] Incoming ${type} from ${igUserId} (tenant=${tenantId})`
  )

  // 1. Find or create customer by Instagram user ID
  let customer = await db.query.customers.findFirst({
    where: and(
      eq(customers.tenantId, tenantId),
      eq(customers.instagramId, igUserId)
    ),
  })

  if (!customer) {
    const [newCustomer] = await db
      .insert(customers)
      .values({
        tenantId,
        instagramId: igUserId,
        languagePref: 'auto',
      })
      .returning()
    customer = newCustomer
  }

  if (!customer) throw new Error(`[IGWorker] Failed to create customer for IG user ${igUserId}`)

  // 2. Find active conversation or create one
  let conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.customerId, customer.id),
      eq(conversations.channel, 'instagram'),
      eq(conversations.status, 'open')
    ),
    orderBy: desc(conversations.createdAt),
  })

  const sessionExpired =
    conversation?.sessionExpiresAt
      ? conversation.sessionExpiresAt < new Date()
      : false

  if (!conversation || sessionExpired) {
    const [newConv] = await db
      .insert(conversations)
      .values({
        tenantId,
        customerId: customer.id,
        channel: 'instagram',
        status: 'open',
        sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // IG 24h window
      })
      .returning()
    conversation = newConv
  } else {
    // Refresh session window
    await db
      .update(conversations)
      .set({
        sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id))
  }

  if (!conversation) throw new Error('[IGWorker] Failed to create conversation')

  // 3. Store the message
  const msgContent = type === 'text' ? text?.body ?? '' : null
  const firstAttachment = attachments?.[0]

  const [storedMessage] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      tenantId,
      senderType: 'customer',
      contentType: type as any,
      content: msgContent,
      mediaUrl: firstAttachment?.url ?? null,
      mediaMimeType: firstAttachment?.type ?? null,
      channelMessageId: messageId,
      channelStatus: 'delivered',
      channelRawPayload: job.rawPayload,
      sentAt: new Date(parseInt(timestamp) * 1000),
    })
    .returning()

  // 4. Enqueue AI respond
  await aiRespondQueue.add(
    'respond',
    {
      tenantId,
      conversationId: conversation.id,
      messageId: storedMessage.id,
    },
    { priority: 1 }
  )

  logger.info(
    `[IGWorker] Message stored: conv=${conversation.id} msg=${storedMessage.id} type=${type}`
  )
}
