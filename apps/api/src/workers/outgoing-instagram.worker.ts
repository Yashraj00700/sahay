// ─── Outgoing Instagram Worker ────────────────────────────────────────────────
// Consumes jobs from the outgoing-instagram queue.
// Sends a reply DM via the Instagram Graph API (Messenger API for Instagram)
// and updates the message channelStatus in the database.
//
// job.data: OutgoingInstagramJob
//   tenantId       — used to look up instagramToken + instagramPageId
//   recipientIgId  — Instagram-scoped user ID of the recipient
//   message        — { text: string } or { attachment: {...} }
//   conversationId — for context
//   messageId      — messages.id to update on success

import type { OutgoingInstagramJob } from '../lib/queues'
import { db, tenants, messages } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { safeDecrypt } from '../lib/encryption'
import { logger } from '../lib/logger'

const IG_API_VERSION = 'v19.0'
const IG_BASE_URL = `https://graph.facebook.com/${IG_API_VERSION}`

export async function processOutgoingInstagram(job: OutgoingInstagramJob): Promise<void> {
  const { tenantId, recipientIgId, message, messageId } = job

  logger.info(`[OutgoingIGWorker] Sending DM to ${recipientIgId}`)

  // 1. Fetch tenant Instagram credentials
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { instagramToken: true, instagramPageId: true },
  })

  if (!tenant?.instagramToken || !tenant?.instagramPageId) {
    throw new Error(
      `[OutgoingIGWorker] Tenant ${tenantId} missing Instagram credentials`
    )
  }

  const instagramToken = safeDecrypt(tenant.instagramToken)
  if (!instagramToken) {
    throw new Error(`[OutgoingIGWorker] Tenant ${tenantId} failed to decrypt instagramToken`)
  }

  // 2. Build Messenger API payload
  // Using the Send API: POST /{page-id}/messages
  const payload = {
    recipient: { id: recipientIgId },
    message,
    messaging_type: 'RESPONSE',
  }

  // 3. Call Instagram / Messenger Graph API
  const url = `${IG_BASE_URL}/${tenant.instagramPageId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${instagramToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `[OutgoingIGWorker] Instagram API error ${response.status}: ${errorBody}`
    )
  }

  const result = (await response.json()) as { message_id?: string }

  const igMessageId = result.message_id
  logger.info(`[OutgoingIGWorker] Sent. IG message ID: ${igMessageId ?? 'unknown'}`)

  // 4. Update message status in DB
  await db
    .update(messages)
    .set({
      channelStatus: 'sent',
      channelMessageId: igMessageId ?? null,
    })
    .where(eq(messages.id, messageId))
}
