// ─── Incoming Webchat Worker ──────────────────────────────────────────────────
// Consumes jobs from the incoming-webchat queue.
// Processes messages sent via the embedded chat widget on merchant storefronts.
// Unlike WhatsApp/Instagram there are no 24h session constraints, so sessions
// expire only on explicit close or after configurable inactivity.
//
// job.data: IncomingWebchatJob
//   tenantId       — owning tenant
//   sessionId      — browser session / visitor ID (used to correlate conversation)
//   visitorId      — anonymous or logged-in visitor identifier
//   customerId     — customers.id if visitor is identified (optional)
//   messageId      — client-generated idempotency ID
//   type           — 'text' | 'image' | 'file'
//   text           — { body: string } for text messages
//   mediaUrl       — CDN URL for uploaded image/file (optional)
//   mediaMimeType  — MIME type of uploaded file (optional)
//   timestamp      — unix timestamp string
//   rawPayload     — full raw client payload

import type { IncomingWebchatJob } from '../lib/queues'
import { db, customers, conversations, messages } from '@sahay/db'
import { eq, and, desc } from 'drizzle-orm'
import { aiRespondQueue } from '../lib/queues'
import { logger } from '../lib/logger'

// Webchat inactivity session timeout: 30 minutes
const SESSION_TIMEOUT_MS = 30 * 60 * 1000

export async function processIncomingWebchat(job: IncomingWebchatJob): Promise<void> {
  const { tenantId, sessionId, customerId, messageId, type, text, mediaUrl, mediaMimeType, timestamp } = job

  logger.info(
    `[WebchatWorker] Incoming ${type} session=${sessionId} tenant=${tenantId}`
  )

  // 1. Resolve customer — use provided customerId or find/create by sessionId
  let resolvedCustomerId: string | undefined = customerId ?? undefined

  if (!resolvedCustomerId) {
    // Anonymous visitor: find an existing open conversation for this session,
    // then use its customerId — otherwise create a new anonymous customer record.
    const existingConv = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.channel, 'webchat'),
        eq(conversations.status, 'open')
      ),
      // customFields stores the sessionId so we can correlate anonymous visitors
      columns: { customerId: true, customFields: true },
      orderBy: desc(conversations.createdAt),
    })

    // Match by sessionId stored in customFields
    const matchingConv =
      existingConv &&
      (existingConv.customFields as Record<string, unknown>)?.webchatSessionId === sessionId
        ? existingConv
        : null

    if (matchingConv) {
      resolvedCustomerId = matchingConv.customerId ?? undefined
    } else {
      // Create a new anonymous customer
      const [newCustomer] = await db
        .insert(customers)
        .values({
          tenantId,
          languagePref: 'auto',
        })
        .returning()
      if (!newCustomer) throw new Error(`[WebchatWorker] Failed to create customer for session ${sessionId}`)
      resolvedCustomerId = newCustomer.id
    }
  }

  // 2. Find active conversation or create one
  let conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.tenantId, tenantId),
      ...(resolvedCustomerId ? [eq(conversations.customerId, resolvedCustomerId)] : []),
      eq(conversations.channel, 'webchat'),
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
        customerId: resolvedCustomerId,
        channel: 'webchat',
        status: 'open',
        sessionExpiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS),
        // Store sessionId for anonymous visitor correlation on subsequent messages
        customFields: { webchatSessionId: sessionId },
      })
      .returning()
    conversation = newConv
  } else {
    // Slide the inactivity window on each new message
    await db
      .update(conversations)
      .set({
        sessionExpiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id))
  }

  if (!conversation) throw new Error('[WebchatWorker] Failed to create conversation')

  // 3. Store the message
  const msgContent = type === 'text' ? text?.body ?? '' : null

  const [storedMessage] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      tenantId,
      senderType: 'customer',
      contentType: type as any,
      content: msgContent,
      mediaUrl: mediaUrl ?? null,
      mediaMimeType: mediaMimeType ?? null,
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
    `[WebchatWorker] Message stored: conv=${conversation.id} msg=${storedMessage.id} type=${type}`
  )
}
