import { eq } from 'drizzle-orm'
import { customers, withTenant } from '@sahay/db'
import { inngest } from '../client'

/**
 * proactive-message
 *
 * Schedules an outbound WhatsApp send at a future time (re-engagement,
 * COD-to-prepaid nudge, restock alert, etc.). Uses Inngest's
 * `step.sleepUntil` so the function is paused server-side until the
 * trigger time arrives — no in-memory timer needed. On wake, we double
 * check the customer hasn't opted out before dispatching.
 *
 * Retries: 1. Proactive sends are best-effort; we don't want a flapping
 * Meta error to spam a customer.
 */
export const proactiveMessage = inngest.createFunction(
  {
    id: 'proactive-message',
    retries: 1,
    concurrency: { limit: 10, key: 'event.data.tenantId' },
  },
  { event: 'proactive/message.scheduled' },
  async ({ event, step, logger }) => {
    const { tenantId, customerId, templateKey, scheduleAt } = event.data

    const wakeAt = new Date(scheduleAt)
    if (Number.isNaN(wakeAt.getTime())) {
      throw new Error(`proactive-message: invalid scheduleAt ${scheduleAt}`)
    }
    if (wakeAt.getTime() > Date.now()) {
      await step.sleepUntil('wait-until-schedule', wakeAt)
    }

    const customer = await step.run('reload-customer', async () =>
      withTenant(tenantId, async (tx) => {
        const row = await tx.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!row) throw new Error(`proactive-message: customer ${customerId} not found`)
        return {
          id: row.id,
          tenantId: row.tenantId,
          whatsappId: row.whatsappId,
          isOptout: row.isOptout ?? false,
        }
      }),
    )

    if (customer.tenantId !== tenantId) {
      logger.warn({ customerId, tenantId }, 'proactive-message: tenant mismatch — skip')
      return { skipped: true, reason: 'tenant_mismatch' }
    }
    if (customer.isOptout) {
      logger.info({ customerId }, 'proactive-message: customer opted out — skip')
      return { skipped: true, reason: 'opted_out' }
    }
    if (!customer.whatsappId) {
      logger.info({ customerId }, 'proactive-message: no whatsappId on customer — skip')
      return { skipped: true, reason: 'no_whatsapp_id' }
    }

    await step.sendEvent('dispatch-wa', {
      name: 'whatsapp/message.send',
      data: {
        tenantId,
        to: customer.whatsappId,
        // The send function falls back to template if 24h window expired.
        // For a proactive message we *always* want a template because
        // there's no recent inbound message in flight.
        content: '',
        templateName: templateKey,
      },
    })

    return { dispatched: true, templateKey }
  },
)
