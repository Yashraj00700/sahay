import type { FastifyPluginAsync } from 'fastify'
import crypto from 'crypto'
import { incomingInstagramQueue } from '../../lib/queues'
import { db, tenants, customers, conversations, messages } from '@sahay/db'
import { eq, and } from 'drizzle-orm'

export const instagramWebhook: FastifyPluginAsync = async (app) => {

  // GET /webhooks/instagram — Meta webhook verification
  app.get('/instagram', async (request, reply) => {
    const query = request.query as Record<string, string>
    const mode = query['hub.mode']
    const token = query['hub.verify_token']
    const challenge = query['hub.challenge']

    if (mode !== 'subscribe') {
      return reply.status(400).send('Invalid mode')
    }

    if (token !== process.env.INSTAGRAM_VERIFY_TOKEN) {
      return reply.status(403).send('Verification token mismatch')
    }

    return reply.status(200).send(challenge)
  })

  // POST /webhooks/instagram — Incoming messages
  // IMPORTANT: Must respond 200 within 20 seconds or Meta will retry
  app.post('/instagram', {
    config: { rawBody: true, rateLimit: { max: 300, timeWindow: '1 minute' } }, // Need raw body for HMAC verification
  }, async (request, reply) => {
    try {
      // Verify HMAC signature
      const signature = request.headers['x-hub-signature-256'] as string
      if (!signature) {
        request.log.warn('Instagram webhook missing signature')
        return reply.status(400).send('Missing signature')
      }

      const appSecret = process.env.INSTAGRAM_APP_SECRET
      if (!appSecret) {
        request.log.error('INSTAGRAM_APP_SECRET not configured')
        return reply.status(500).send('Server misconfiguration')
      }

      const rawBody = (request as any).rawBody as Buffer
      const expectedSig = `sha256=${crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex')}`

      if (
        signature.length !== expectedSig.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
      ) {
        request.log.warn('Instagram webhook HMAC verification failed')
        return reply.status(403).send('Invalid signature')
      }

      const body = request.body as InstagramWebhookPayload

      if (body.object !== 'instagram') {
        return reply.status(200).send('EVENT_RECEIVED')
      }

      // Process each entry
      for (const entry of body.entry ?? []) {
        const pageId = entry.id

        // Find tenant by Instagram page ID
        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.instagramPageId, pageId),
        })

        if (!tenant) {
          request.log.warn({ pageId }, 'No tenant found for Instagram page ID')
          continue
        }

        for (const event of entry.messaging ?? []) {
          // Skip echo messages (messages sent by the page itself)
          if (event.message?.is_echo) continue

          const senderId = event.sender?.id
          if (!senderId) continue

          // Handle incoming text/attachment messages
          if (event.message) {
            const msg = event.message

            // Find or create customer by instagramId
            let customer = await db.query.customers.findFirst({
              where: and(
                eq(customers.tenantId, tenant.id),
                eq(customers.instagramId, senderId),
              ),
            })

            if (!customer) {
              const [created] = await db
                .insert(customers)
                .values({
                  tenantId: tenant.id,
                  instagramId: senderId,
                })
                .returning()
              customer = created
            }

            // Find open conversation on instagram channel or create one
            let conversation = await db.query.conversations.findFirst({
              where: and(
                eq(conversations.tenantId, tenant.id),
                eq(conversations.customerId, customer.id),
                eq(conversations.channel, 'instagram'),
                eq(conversations.status, 'open'),
              ),
            })

            if (!conversation) {
              const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h IG window
              const [created] = await db
                .insert(conversations)
                .values({
                  tenantId: tenant.id,
                  customerId: customer.id,
                  channel: 'instagram',
                  status: 'open',
                  sessionExpiresAt,
                })
                .returning()
              conversation = created
            }

            // Determine content type
            let contentType = 'text'
            let content: string | null = msg.text ?? null
            let mediaUrl: string | null = null
            let mediaMimeType: string | null = null

            if (msg.attachments && msg.attachments.length > 0) {
              const attachment = msg.attachments[0]
              contentType = attachment.type // image|video|audio|file|story_mention
              mediaUrl = attachment.payload?.url ?? null
            }

            // Store message in DB
            const [storedMessage] = await db
              .insert(messages)
              .values({
                conversationId: conversation.id,
                tenantId: tenant.id,
                senderType: 'customer',
                contentType,
                content,
                mediaUrl,
                mediaMimeType,
                channelMessageId: msg.mid,
                channelStatus: 'sent',
                channelRawPayload: event as object,
                // Instagram story context
                igStoryId: msg.reply_to?.story?.id ?? null,
                igStoryMediaUrl: msg.reply_to?.story?.url ?? null,
                sentAt: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
              })
              .returning()

            // Enqueue for async AI/agent processing
            await incomingInstagramQueue.add('process', {
              tenantId: tenant.id,
              pageId,
              senderId,
              messageId: msg.mid,
              conversationId: conversation.id,
              customerId: customer.id,
              storedMessageId: storedMessage.id,
              text: msg.text,
              attachments: msg.attachments,
              replyTo: msg.reply_to,
              rawPayload: event,
            }, {
              priority: 1,
            })

            request.log.info(
              { tenantId: tenant.id, messageId: msg.mid, senderId, contentType },
              'Instagram message queued for processing'
            )
          }

          // Handle read receipts
          if (event.read) {
            const watermark = event.read.watermark
            request.log.debug({ senderId, watermark }, 'Instagram read receipt received')
            // Watermark = timestamp; all messages before this were read.
            // Detailed status updates are handled by the worker if needed.
          }

          // Handle message reactions
          if (event.reaction) {
            request.log.debug({ senderId, reaction: event.reaction }, 'Instagram reaction received')
          }
        }
      }
    } catch (err) {
      request.log.error({ err }, 'Error processing Instagram webhook')
      return reply.status(500).send('Internal error')
    }

    // Acknowledge to Meta
    return reply.status(200).send('EVENT_RECEIVED')
  })
}

// ─── Instagram Webhook Payload Types ──────────────────────────

interface InstagramWebhookPayload {
  object: string
  entry: Array<InstagramEntry>
}

interface InstagramEntry {
  id: string          // Instagram page/account ID
  time?: number
  messaging: Array<InstagramMessagingEvent>
}

interface InstagramMessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: InstagramMessage
  read?: { watermark: number }
  reaction?: {
    mid: string
    action: 'react' | 'unreact'
    emoji?: string
  }
}

interface InstagramMessage {
  mid: string
  text?: string
  is_echo?: boolean
  attachments?: Array<{
    type: string  // image|video|audio|file|story_mention|fallback
    payload: {
      url?: string
      sticker_id?: number
    }
  }>
  reply_to?: {
    mid?: string
    story?: {
      id: string
      url: string
    }
  }
}
