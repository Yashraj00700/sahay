import { and, desc, eq } from 'drizzle-orm'
import { db, tenants, conversations, customers, messages } from '@sahay/db'
import { inngest } from '../client'
import { WhatsAppAdapter, type WATemplateComponent } from '../../services/channels/whatsapp.adapter'
import { env } from '../../lib/env'

/**
 * whatsapp-outgoing
 *
 * Sends a WhatsApp message via the Cloud API.
 * - Looks up the tenant for phoneNumberId + access token.
 * - Sends text by default; if a template is provided OR the 24h session
 *   has lapsed (Meta error code 131047 / 470 / 480) we retry with the
 *   template fallback supplied in the event.
 * - Records the channel message id + status on the messages row that
 *   matches the destination conversation (best-effort).
 *
 * Retries: 3 with Inngest's exponential backoff. Permanent send failures
 * (no template fallback available, recipient blocked, etc.) are recorded
 * on the message row and the function returns rather than throwing so
 * Inngest doesn't replay forever.
 */

interface MetaErrorShape {
  code?: number
  message?: string
}

function extractMetaErrorCode(err: unknown): number | null {
  // Adapter throws Error('WhatsApp API error <code>: ...').
  if (err instanceof Error) {
    const m = err.message.match(/error (\d+)/i)
    if (m && m[1]) return parseInt(m[1], 10)
  }
  const candidate = (err as { response?: { data?: { error?: MetaErrorShape } } } | null)
    ?.response?.data?.error
  return typeof candidate?.code === 'number' ? candidate.code : null
}

const SESSION_WINDOW_ERRORS = new Set<number>([131047, 131051, 470, 480])

export const whatsappOutgoing = inngest.createFunction(
  {
    id: 'whatsapp-outgoing',
    retries: 3,
    concurrency: { limit: 50, key: 'event.data.tenantId' },
  },
  { event: 'whatsapp/message.send' },
  async ({ event, step, logger }) => {
    const { tenantId, to, content, templateName, templateParams } = event.data

    const tenant = await step.run('load-tenant', async () => {
      const row = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      })
      if (!row) throw new Error(`whatsapp-outgoing: tenant ${tenantId} not found`)
      if (!row.whatsappPhoneNumberId) {
        throw new Error(`whatsapp-outgoing: tenant ${tenantId} has no WhatsApp phone number id`)
      }
      const accessToken = row.whatsappToken ?? env.WA_ACCESS_TOKEN ?? ''
      if (!accessToken) {
        throw new Error(`whatsapp-outgoing: tenant ${tenantId} has no WhatsApp access token`)
      }
      return {
        phoneNumberId: row.whatsappPhoneNumberId,
        accessToken,
      }
    })

    const sendResult = await step.run('send-message', async () => {
      const adapter = new WhatsAppAdapter(tenant.phoneNumberId, tenant.accessToken)
      try {
        const r = await adapter.sendText(to, content)
        return { ok: true as const, waMessageId: r.waMessageId, fallback: false as const }
      } catch (err) {
        const code = extractMetaErrorCode(err)

        // 24h-window violation: try template fallback if provided.
        if (code !== null && SESSION_WINDOW_ERRORS.has(code) && templateName) {
          const components: WATemplateComponent[] = templateParams && templateParams.length > 0
            ? [
                {
                  type: 'body',
                  parameters: templateParams.map((p) => ({ type: 'text' as const, text: p })),
                },
              ]
            : []
          try {
            const r = await adapter.sendTemplate(to, templateName, 'en_US', components)
            return { ok: true as const, waMessageId: r.waMessageId, fallback: true as const }
          } catch (innerErr) {
            return {
              ok: false as const,
              waMessageId: null,
              error: innerErr instanceof Error ? innerErr.message : String(innerErr),
              code,
            }
          }
        }

        return {
          ok: false as const,
          waMessageId: null,
          error: err instanceof Error ? err.message : String(err),
          code,
        }
      }
    })

    // Try to find the most recent outbound (ai/agent) message for this
    // conversation so we can stamp it with the channel id + status.
    await step.run('record-status', async () => {
      const customer = await db.query.customers.findFirst({
        where: and(eq(customers.tenantId, tenantId), eq(customers.whatsappId, to)),
      })
      if (!customer) {
        logger.warn({ tenantId, to }, 'whatsapp-outgoing: no customer match — cannot stamp status')
        return
      }
      const conv = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.customerId, customer.id),
          eq(conversations.channel, 'whatsapp'),
        ),
        orderBy: [desc(conversations.createdAt)],
      })
      if (!conv) return
      const lastOutbound = await db.query.messages.findFirst({
        where: and(
          eq(messages.conversationId, conv.id),
          eq(messages.tenantId, tenantId),
        ),
        orderBy: [desc(messages.createdAt)],
      })
      if (!lastOutbound) return

      if (sendResult.ok) {
        await db
          .update(messages)
          .set({
            channelMessageId: sendResult.waMessageId ?? lastOutbound.channelMessageId,
            channelStatus: 'sent',
            channelError: null,
          })
          .where(eq(messages.id, lastOutbound.id))
      } else {
        await db
          .update(messages)
          .set({
            channelStatus: 'failed',
            channelError: sendResult.error,
          })
          .where(eq(messages.id, lastOutbound.id))
      }
    })

    if (!sendResult.ok) {
      // Surface the failure so Inngest retries (subject to retries: 3) —
      // unless the failure is a session-window violation with no template
      // fallback, in which case retrying won't help.
      if (sendResult.code !== null && SESSION_WINDOW_ERRORS.has(sendResult.code) && !templateName) {
        logger.error(
          { tenantId, to, code: sendResult.code },
          'whatsapp-outgoing: 24h window expired with no template fallback — message dropped',
        )
        return { dropped: true, reason: '24h_window_no_template' }
      }
      throw new Error(`whatsapp-outgoing: send failed — ${sendResult.error}`)
    }

    return { waMessageId: sendResult.waMessageId, usedTemplate: sendResult.fallback }
  },
)
