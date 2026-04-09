// ─── CSAT Survey Worker ───────────────────────────────────────────────────────
// Consumes jobs from the csat-survey queue.
// Triggered when a conversation transitions to 'resolved'.
// Sends a WhatsApp template message ('csat_survey') to the customer containing
// a tamper-proof link to the public CSAT rating page.
//
// job.data: CsatJob
//   tenantId       — tenant that owns the conversation
//   conversationId — the resolved conversation
//   customerId     — customers.id of the recipient
//   customerPhone  — E.164 WhatsApp number to message
//   customerName   — used as a template parameter

import { createHmac } from 'node:crypto'
import type { CsatJob } from '../lib/queues'
import { db, tenants } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { safeDecrypt } from '../lib/encryption'
import { logger } from '../lib/logger'

const WA_API_VERSION = 'v19.0'
const WA_BASE_URL    = `https://graph.facebook.com/${WA_API_VERSION}`

export async function processCsatSurvey(job: CsatJob): Promise<void> {
  const { tenantId, conversationId, customerPhone, customerName } = job

  logger.info(
    `[CsatWorker] Sending CSAT survey for conv=${conversationId} to ${customerPhone}`
  )

  // 1. Fetch tenant WhatsApp credentials
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { whatsappToken: true, whatsappPhoneNumberId: true },
  })

  if (!tenant?.whatsappToken || !tenant?.whatsappPhoneNumberId) {
    throw new Error(`[CsatWorker] Tenant ${tenantId} missing WhatsApp credentials`)
  }

  const whatsappToken = safeDecrypt(tenant.whatsappToken)
  if (!whatsappToken) {
    throw new Error(`[CsatWorker] Tenant ${tenantId} failed to decrypt whatsappToken`)
  }

  // 2. Build tamper-proof survey URL
  //    HMAC-SHA256( conversationId:tenantId ) keyed with CSAT_HMAC_SECRET
  const secret = process.env.CSAT_HMAC_SECRET ?? process.env.JWT_SECRET ?? 'csat-secret'
  const token  = createHmac('sha256', secret)
    .update(`${conversationId}:${tenantId}`)
    .digest('hex')

  const webUrl    = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const surveyUrl = `${webUrl}/csat/${conversationId}?tenantId=${tenantId}&token=${token}`

  // 3. Build WhatsApp template payload
  //    Template name: 'csat_survey'
  //    Expected variables (body component):
  //      {{1}} — customer first name
  //      {{2}} — survey link
  const payload = {
    messaging_product: 'whatsapp',
    to:   customerPhone,
    type: 'template',
    template: {
      name:     'csat_survey',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customerName ?? 'there' },
            { type: 'text', text: surveyUrl },
          ],
        },
      ],
    },
  }

  // 4. Send via WhatsApp Cloud API
  const url = `${WA_BASE_URL}/${tenant.whatsappPhoneNumberId}/messages`

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${whatsappToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `[CsatWorker] WhatsApp API error ${response.status}: ${errorBody}`
    )
  }

  const result = (await response.json()) as { messages?: Array<{ id: string }> }
  logger.info(
    `[CsatWorker] Survey sent. WA ID: ${result.messages?.[0]?.id ?? 'unknown'}`
  )
}
