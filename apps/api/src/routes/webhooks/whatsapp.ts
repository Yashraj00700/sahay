import type { FastifyPluginAsync } from 'fastify'
import crypto from 'crypto'
import { incomingWhatsAppQueue, type IncomingWhatsAppJob } from '../../lib/queues'
import { db, tenants, messages } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { safeDecrypt } from '../../lib/encryption'

export const whatsappWebhook: FastifyPluginAsync = async (app) => {

  // GET /webhooks/whatsapp — Meta webhook verification
  app.get('/whatsapp', async (request, reply) => {
    const query = request.query as Record<string, string>
    const mode = query['hub.mode']
    const token = query['hub.verify_token']
    const challenge = query['hub.challenge']

    if (mode !== 'subscribe') {
      return reply.status(400).send('Invalid mode')
    }

    // Find tenant by verify token
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.whatsappVerifyToken, token),
    })

    if (!tenant) {
      return reply.status(403).send('Verification token mismatch')
    }

    // Respond with challenge to complete verification
    return reply.status(200).send(challenge)
  })

  // POST /webhooks/whatsapp — Incoming messages
  // IMPORTANT: Must respond 200 within 20 seconds or Meta will retry
  app.post('/whatsapp', {
    config: { rawBody: true, rateLimit: { max: 300, timeWindow: '1 minute' } }, // Need raw body for HMAC verification
  }, async (request, reply) => {
    try {
      // Verify HMAC signature
      const signature = request.headers['x-hub-signature-256'] as string
      if (!signature) {
        request.log.warn('WhatsApp webhook missing signature')
        return reply.status(400).send('Missing signature')
      }

      // BYOA: Extract phone_number_id from payload to find the owning tenant
      // The phone_number_id is available in the raw payload before full parsing
      let phoneNumberId: string | undefined
      try {
        const rawParsed = JSON.parse((request as any).rawBody.toString()) as WhatsAppWebhookPayload
        phoneNumberId = rawParsed.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id
      } catch {
        // fallback to global secret
      }

      let appSecret = process.env.WA_APP_SECRET
      if (phoneNumberId) {
        // Look up the tenant by phone number ID
        const tenantRow = await db.query.tenants.findFirst({
          where: eq(tenants.whatsappPhoneNumberId, phoneNumberId),
          columns: { waAppSecret: true },
        })
        if (tenantRow?.waAppSecret) {
          appSecret = safeDecrypt(tenantRow.waAppSecret) ?? appSecret
        }
      }

      if (!appSecret) {
        request.log.error('No app secret found for webhook')
        return reply.status(500).send('Server misconfiguration')
      }

      const rawBody = (request as any).rawBody as Buffer
      const expectedSig = `sha256=${crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex')}`

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        request.log.warn('WhatsApp webhook HMAC verification failed')
        return reply.status(403).send('Invalid signature')
      }

      const body = request.body as WhatsAppWebhookPayload

      // Process each entry and message
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== 'messages') continue

          const value = change.value
          const phoneNumberId = value.metadata?.phone_number_id

          if (!phoneNumberId) continue

          // Find tenant by phone number ID
          const tenant = await db.query.tenants.findFirst({
            where: eq(tenants.whatsappPhoneNumberId, phoneNumberId),
          })

          if (!tenant) {
            request.log.warn({ phoneNumberId }, 'No tenant found for WhatsApp phone number ID')
            continue
          }

          // Handle incoming messages
          for (const msg of value.messages ?? []) {
            const job: IncomingWhatsAppJob = {
              tenantId: tenant.id,
              phoneNumberId,
              from: msg.from,
              messageId: msg.id,
              timestamp: msg.timestamp,
              type: msg.type,
              text: msg.text,
              image: msg.image,
              audio: msg.audio,
              video: msg.video,
              document: msg.document,
              interactive: msg.interactive,
              rawPayload: msg,
            }

            // Add to queue for async processing
            // VIP customers get higher priority (we don't know yet, worker will check)
            await incomingWhatsAppQueue.add('process', job, {
              priority: 1, // default priority, worker can re-queue with higher priority for VIPs
            })

            request.log.info(
              { tenantId: tenant.id, messageId: msg.id, from: msg.from, type: msg.type },
              'WhatsApp message queued for processing'
            )
          }

          // Handle status updates (sent/delivered/read)
          for (const status of value.statuses ?? []) {
            request.log.debug({ status }, 'WhatsApp message status update')

            const statusTimestamp = new Date(parseInt(status.timestamp, 10) * 1000)
            const timestampFields: Partial<{ deliveredAt: Date; readAt: Date }> = {}
            if (status.status === 'delivered') timestampFields.deliveredAt = statusTimestamp
            if (status.status === 'read') timestampFields.readAt = statusTimestamp

            await db.update(messages)
              .set({ channelStatus: status.status, ...timestampFields })
              .where(eq(messages.channelMessageId, status.id))

            request.log.info(
              { messageId: status.id, status: status.status },
              'WhatsApp message status persisted'
            )
          }
        }
      }
    } catch (err) {
      request.log.error({ err }, 'Error processing WhatsApp webhook')
      return reply.status(500).send('Internal error')
    }

    // All async work is done — now acknowledge to Meta
    return reply.status(200).send('EVENT_RECEIVED')
  })
}

// WhatsApp Cloud API webhook payload types
interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      field: string
      value: {
        messaging_product: string
        metadata: {
          display_phone_number: string
          phone_number_id: string
        }
        contacts?: Array<{
          profile: { name: string }
          wa_id: string
        }>
        messages?: Array<WhatsAppMessage>
        statuses?: Array<{
          id: string
          status: 'sent' | 'delivered' | 'read' | 'failed'
          timestamp: string
          recipient_id: string
          errors?: Array<{ code: number; title: string; message: string }>
        }>
      }
    }>
  }>
}

interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; sha256?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  video?: { id: string; mime_type: string }
  document?: { id: string; mime_type: string; filename?: string }
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  context?: { from: string; id: string }
}
