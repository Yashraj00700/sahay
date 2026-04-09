// ─── Outgoing WhatsApp Worker ─────────────────────────────────────────────────
// Consumes jobs from the outgoing-whatsapp queue.
// Sends a WhatsApp message via the Cloud API and updates the message's
// channelStatus + channelMessageId in the database.
//
// job.data: OutgoingWhatsAppJob
//   tenantId       — used to look up whatsappToken + whatsappPhoneNumberId
//   phoneNumberId  — WA phone number ID to send from (validated against tenant)
//   to             — recipient phone number (E.164)
//   message        — WhatsApp message descriptor:
//                      { type: 'text', text: string }
//                    | { type: 'template', name: string, language: string,
//                         components?: object[] }
//                    | any other pre-built WA Cloud API message object
//   conversationId — for DB update context
//   messageId      — messages.id to update after send

import type { OutgoingWhatsAppJob } from '../lib/queues'
import { db, tenants, messages } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { safeDecrypt } from '../lib/encryption'
import { logger } from '../lib/logger'

const WA_API_VERSION = 'v19.0'
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`

// Shape of the typed message descriptor carried in job.data.message
interface TextMessageDescriptor {
  type: 'text'
  text: string
}

interface TemplateMessageDescriptor {
  type: 'template'
  name: string
  language: string
  components?: object[]
}

type MessageDescriptor = TextMessageDescriptor | TemplateMessageDescriptor | Record<string, unknown>

export async function processOutgoingWhatsApp(job: OutgoingWhatsAppJob): Promise<void> {
  const { tenantId, to, message, messageId } = job

  logger.info(`[OutgoingWAWorker] Sending message to ${to} (tenant=${tenantId})`)

  // 1. Fetch tenant credentials from DB
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { whatsappToken: true, whatsappPhoneNumberId: true },
  })

  if (!tenant?.whatsappToken || !tenant?.whatsappPhoneNumberId) {
    throw new Error(
      `[OutgoingWAWorker] Tenant ${tenantId} missing WhatsApp credentials`
    )
  }

  const accessToken = safeDecrypt(tenant.whatsappToken)
  if (!accessToken) {
    throw new Error(`[OutgoingWAWorker] Tenant ${tenantId} failed to decrypt whatsappToken`)
  }

  const phoneNumberId = tenant.whatsappPhoneNumberId

  // 2. Build the WhatsApp Cloud API message content based on type
  const msg = message as MessageDescriptor
  let messageContent: object

  if (msg.type === 'text') {
    // Plain text message
    const descriptor = msg as TextMessageDescriptor
    messageContent = {
      type: 'text',
      text: { body: descriptor.text },
    }
  } else if (msg.type === 'template') {
    // Pre-approved template (HSM) message
    const descriptor = msg as TemplateMessageDescriptor
    messageContent = {
      type: 'template',
      template: {
        name: descriptor.name,
        language: { code: descriptor.language },
        ...(descriptor.components && descriptor.components.length > 0
          ? { components: descriptor.components }
          : {}),
      },
    }
  } else {
    // Pass through any other pre-built message object (interactive, image, etc.)
    // Callers are responsible for providing a valid WA Cloud API message shape
    messageContent = msg
  }

  // 3. Assemble the full Cloud API request body
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    ...messageContent,
  }

  // 4. POST to Meta's WhatsApp Cloud API
  const url = `${WA_BASE_URL}/${phoneNumberId}/messages`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(
        `[OutgoingWAWorker] WhatsApp API error ${response.status}: ${errorBody}`
      )
    }

    const result = (await response.json()) as {
      messages?: Array<{ id: string }>
    }

    const waMessageId = result.messages?.[0]?.id

    logger.info(
      `[OutgoingWAWorker] Sent successfully. WA message ID: ${waMessageId ?? 'unknown'}`
    )

    // 5a. Success — update message status to 'sent' and store WA message ID
    await db
      .update(messages)
      .set({
        channelStatus: 'sent',
        channelMessageId: waMessageId ?? null,
      })
      .where(eq(messages.id, messageId))

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    logger.error({ err }, `[OutgoingWAWorker] Failed to send to ${to}: ${errorMessage}`)

    // 5b. Failure — persist the error state so the UI reflects it.
    //     Re-throw so BullMQ can retry; if this is the final attempt the
    //     message will remain in the 'failed' state in the DB.
    await db
      .update(messages)
      .set({
        channelStatus: 'failed',
        channelError: errorMessage,
      })
      .where(eq(messages.id, messageId))

    throw err
  }
}
