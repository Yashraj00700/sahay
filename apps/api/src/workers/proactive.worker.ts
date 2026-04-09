// ─── Proactive Messages Worker ────────────────────────────────────────────────
// Consumes jobs from the proactive-messages queue.
// Sends scheduled WhatsApp template messages (HSMs) to customers — used for:
//   - Order status updates (shipped, out-for-delivery, delivered)
//   - Abandoned cart recovery
//   - Post-purchase follow-ups
//   - Re-engagement campaigns
//
// job.data: ProactiveJob
//   tenantId        — tenant sending the message
//   to              — recipient phone in E.164 format
//   templateName    — approved WA template name
//   languageCode    — template language (e.g. 'en', 'en_IN')
//   components      — template parameter components (header/body/button)
//   customerId      — customers.id (optional, for logging)
//   conversationId  — existing conversation to link message to (optional)

import type { ProactiveJob } from '../lib/queues'
import { db, tenants, messages, conversations, customers } from '@sahay/db'
import { eq, and, desc } from 'drizzle-orm'
import { safeDecrypt } from '../lib/encryption'
import { logger } from '../lib/logger'

const WA_API_VERSION = 'v19.0'
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`

export async function processProactive(job: ProactiveJob): Promise<void> {
  const { tenantId, to, templateName, languageCode, components, customerId, conversationId } = job

  logger.info(
    `[ProactiveWorker] Sending template "${templateName}" to ${to} (tenant=${tenantId})`
  )

  // 1. Fetch tenant credentials
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { whatsappToken: true, whatsappPhoneNumberId: true },
  })

  if (!tenant?.whatsappToken || !tenant?.whatsappPhoneNumberId) {
    throw new Error(`[ProactiveWorker] Tenant ${tenantId} missing WhatsApp credentials`)
  }

  const whatsappToken = safeDecrypt(tenant.whatsappToken)
  if (!whatsappToken) {
    throw new Error(`[ProactiveWorker] Tenant ${tenantId} failed to decrypt whatsappToken`)
  }

  // 2. Build template message payload
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode ?? 'en' },
      ...(components && components.length > 0 ? { components } : {}),
    },
  }

  // 3. Send via WhatsApp Cloud API
  const url = `${WA_BASE_URL}/${tenant.whatsappPhoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${whatsappToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `[ProactiveWorker] WhatsApp API error ${response.status}: ${errorBody}`
    )
  }

  const result = (await response.json()) as {
    messages?: Array<{ id: string }>
  }
  const waMessageId = result.messages?.[0]?.id

  logger.info(`[ProactiveWorker] Template sent. WA ID: ${waMessageId ?? 'unknown'}`)

  // 4. Resolve or create a conversation to store the outbound message
  let convId = conversationId

  if (!convId && customerId) {
    // Try to find an open conversation for this customer
    const existingConv = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.customerId, customerId),
        eq(conversations.channel, 'whatsapp'),
        eq(conversations.status, 'open')
      ),
      orderBy: desc(conversations.createdAt),
      columns: { id: true, sessionExpiresAt: true },
    })

    if (existingConv && (!existingConv.sessionExpiresAt || existingConv.sessionExpiresAt > new Date())) {
      convId = existingConv.id
    } else if (customerId) {
      // Create a new conversation for the proactive outreach
      const [newConv] = await db
        .insert(conversations)
        .values({
          tenantId,
          customerId,
          channel: 'whatsapp',
          status: 'open',
          // 24h window — customer replying within this window re-opens session
          sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning({ id: conversations.id })
      convId = newConv?.id
    }
  }

  // 5. Persist the outbound message record
  if (convId) {
    await db.insert(messages).values({
      conversationId: convId,
      tenantId,
      senderType: 'ai',
      contentType: 'template',
      content: templateName,
      templateName,
      templateParams: components ? { components } : null,
      channelMessageId: waMessageId ?? null,
      channelStatus: 'sent',
    })
  }
}
