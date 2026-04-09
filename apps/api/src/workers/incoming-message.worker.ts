import { db, customers, conversations, messages, tenants } from '@sahay/db'
import { eq, and, desc } from 'drizzle-orm'
import { aiRespondQueue, type IncomingWhatsAppJob } from '../lib/queues'
import { normalizeIndianPhone } from '@sahay/shared'
import { logger } from '../lib/logger'
import { safeDecrypt } from '../lib/encryption'
import { transcribeWhatsAppAudio } from '../services/ai/transcription'

export async function processIncomingWhatsApp(job: IncomingWhatsAppJob): Promise<void> {
  const { tenantId, from, messageId, timestamp, type, text, image, audio } = job

  // 1. Find or create customer by phone number
  const normalizedPhone = normalizeIndianPhone(from)

  let customer = await db.query.customers.findFirst({
    where: and(
      eq(customers.tenantId, tenantId),
      eq(customers.whatsappId, from)
    ),
  })

  if (!customer) {
    const [newCustomer] = await db.insert(customers).values({
      tenantId,
      phone: normalizedPhone,
      whatsappId: from,
      languagePref: 'auto',
    }).returning()
    customer = newCustomer
  }

  if (!customer) throw new Error(`Failed to create customer for phone ${from}`)

  // 2. Find active conversation or create new one
  // Active = last conversation that is not resolved/closed AND session has not expired
  let conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.customerId, customer.id),
      eq(conversations.channel, 'whatsapp'),
      eq(conversations.status, 'open')
    ),
    orderBy: desc(conversations.createdAt), // get most recent (fixes P1-7: arbitrary row without ordering)
  })

  const sessionExpired = conversation?.sessionExpiresAt
    ? conversation.sessionExpiresAt < new Date()
    : false

  if (!conversation || sessionExpired) {
    const [newConv] = await db.insert(conversations).values({
      tenantId,
      customerId: customer.id,
      channel: 'whatsapp',
      status: 'open',
      sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h window
    }).returning()
    conversation = newConv
  } else {
    // Refresh session window on new message
    await db.update(conversations)
      .set({
        sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id))
  }

  if (!conversation) throw new Error('Failed to create conversation')

  // 3. Store the message
  let msgContent: string | null = type === 'text' ? text?.body ?? '' : null
  let msgContentType: string = type
  const isMedia = ['image', 'audio', 'video', 'document'].includes(type)

  // Transcribe audio/voice notes via Whisper
  if ((type === 'audio' || type === 'voice') && audio?.id) {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { whatsappToken: true },
    })
    const waToken = tenant?.whatsappToken ? safeDecrypt(tenant.whatsappToken) : null
    const fallbackToken = waToken ?? process.env.WA_SYSTEM_ACCESS_TOKEN ?? ''

    const transcript = await transcribeWhatsAppAudio(audio.id, fallbackToken)
    if (transcript) {
      msgContent = '[Voice note] ' + transcript
      msgContentType = 'voice_transcript'
    } else {
      msgContent = '[Voice note]'
    }
  }

  const [storedMessage] = await db.insert(messages).values({
    conversationId: conversation.id,
    tenantId,
    senderType: 'customer',
    contentType: msgContentType as any,
    content: msgContent,
    mediaMimeType: image?.mime_type ?? audio?.mime_type,
    channelMessageId: messageId,
    channelStatus: 'delivered',
    channelRawPayload: job.rawPayload,
    sentAt: new Date(parseInt(timestamp) * 1000),
  }).returning()

  // NOTE (P1-5): turnCount / unresolvedTurns is intentionally NOT incremented here.
  // agent.ts owns the increment because it has full context (e.g. it knows whether
  // the AI actually responded). Incrementing here as well was causing escalation to
  // trigger at half the intended threshold.

  // 4. Queue AI response (AI pipeline will decide routing)
  await aiRespondQueue.add('respond', {
    tenantId,
    conversationId: conversation.id,
    messageId: storedMessage.id,
  }, {
    // VIP customers get higher priority (0 = highest, 2 = lowest)
    priority: customer.tier === 'vip' ? 0 : 1,
  })

  logger.info(
    `[WA Worker] Message stored: conv=${conversation.id} msg=${storedMessage.id} type=${type}`
  )
}
