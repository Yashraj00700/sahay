import { db, customers, conversations, messages } from '@sahay/db'
import { eq, and } from 'drizzle-orm'
import { aiRespondQueue, type IncomingWhatsAppJob } from '../lib/queues'
import { normalizeIndianPhone } from '@sahay/shared'

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
    // orderBy: desc(conversations.createdAt) -- get most recent
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
  const msgContent = type === 'text' ? text?.body ?? '' : null
  const isMedia = ['image', 'audio', 'video', 'document'].includes(type)

  const [storedMessage] = await db.insert(messages).values({
    conversationId: conversation.id,
    tenantId,
    senderType: 'customer',
    contentType: type as any,
    content: msgContent,
    mediaMimeType: image?.mime_type ?? audio?.mime_type,
    channelMessageId: messageId,
    channelStatus: 'delivered',
    channelRawPayload: job.rawPayload,
    sentAt: new Date(parseInt(timestamp) * 1000),
  }).returning()

  // 4. Update conversation turn count
  await db.update(conversations)
    .set({
      turnCount: (conversation.turnCount ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversation.id))

  // 5. Queue AI response (AI pipeline will decide routing)
  await aiRespondQueue.add('respond', {
    tenantId,
    conversationId: conversation.id,
    messageId: storedMessage.id,
  }, {
    // VIP customers get higher priority (0 = highest, 2 = lowest)
    priority: customer.tier === 'vip' ? 0 : 1,
  })

  console.info(
    `[WA Worker] Message stored: conv=${conversation.id} msg=${storedMessage.id} type=${type}`
  )
}
