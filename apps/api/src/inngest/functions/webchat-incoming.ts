import { and, eq } from 'drizzle-orm'
import { customers, conversations, messages, withTenant } from '@sahay/db'
import { inngest } from '../client'
import { triggerToTenant } from '../../lib/pusher'

/**
 * webchat-incoming
 *
 * Handles inbound web-chat messages posted by the embeddable widget.
 * The widget identifies the visitor by `sessionId` (cookie-backed). When
 * the visitor is anonymous (no prior customer row) we mint a stub
 * customer record using the sessionId as a stable key in `whatsappId`-style
 * scratch column — note: there's no dedicated `webSessionId` field in the
 * customer schema today, so we re-use `notes` JSONB for now and store the
 * session under a deterministic synthetic email of the form
 * `web+<session>@anon.sahay.local`. This keeps the unique tenant+email
 * index doing dedupe work for free.
 */

export const webchatIncoming = inngest.createFunction(
  {
    id: 'webchat-incoming',
    retries: 5,
    concurrency: { limit: 50, key: 'event.data.tenantId' },
  },
  { event: 'webchat/message.received' },
  async ({ event, step, logger }) => {
    const { tenantId, sessionId, message } = event.data

    if (!sessionId || !message) {
      logger.warn({ tenantId }, 'webchat-incoming: missing sessionId or message body')
      return { skipped: true }
    }

    const syntheticEmail = `web+${sessionId}@anon.sahay.local`

    const customer = await step.run('upsert-customer', async () =>
      withTenant(tenantId, async (tx) => {
        const existing = await tx.query.customers.findFirst({
          where: and(
            eq(customers.tenantId, tenantId),
            eq(customers.email, syntheticEmail),
          ),
        })
        if (existing) return { id: existing.id, tier: existing.tier ?? 'new' }

        const [created] = await tx
          .insert(customers)
          .values({
            tenantId,
            email: syntheticEmail,
            name: `Web visitor ${sessionId.slice(0, 8)}`,
            languagePref: 'auto',
            tier: 'new',
          })
          .returning({ id: customers.id, tier: customers.tier })
        if (!created) throw new Error('webchat-incoming: failed to insert customer')
        return { id: created.id, tier: created.tier ?? 'new' }
      }),
    )

    const conversation = await step.run('upsert-conversation', async () =>
      withTenant(tenantId, async (tx) => {
        const existing = await tx.query.conversations.findFirst({
          where: and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.customerId, customer.id),
            eq(conversations.channel, 'webchat'),
            eq(conversations.status, 'open'),
          ),
        })
        const now = new Date()
        // Webchat sessions live as long as the cookie does; no Meta-policy
        // window. We still mark a 24h heartbeat for routing parity.
        const sessionExpired = existing?.sessionExpiresAt
          ? existing.sessionExpiresAt < now
          : false

        if (!existing || sessionExpired) {
          const [created] = await tx
            .insert(conversations)
            .values({
              tenantId,
              customerId: customer.id,
              channel: 'webchat',
              status: 'open',
              sessionExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            })
            .returning()
          if (!created) throw new Error('webchat-incoming: failed to insert conversation')
          return { id: created.id, turnCount: created.turnCount ?? 0 }
        }

        await tx
          .update(conversations)
          .set({
            sessionExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            updatedAt: now,
          })
          .where(eq(conversations.id, existing.id))
        return { id: existing.id, turnCount: existing.turnCount ?? 0 }
      }),
    )

    const storedMessage = await step.run('insert-message', async () =>
      withTenant(tenantId, async (tx) => {
        const [created] = await tx
          .insert(messages)
          .values({
            conversationId: conversation.id,
            tenantId,
            senderType: 'customer',
            contentType: 'text',
            content: message,
            channelStatus: 'delivered',
            sentAt: new Date(),
          })
          .returning({ id: messages.id })
        if (!created) throw new Error('webchat-incoming: failed to insert message')

        await tx
          .update(conversations)
          .set({
            turnCount: (conversation.turnCount ?? 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, conversation.id))

        return { id: created.id }
      }),
    )

    await step.sendEvent('queue-ai', {
      name: 'ai/respond.requested',
      data: {
        tenantId,
        conversationId: conversation.id,
        messageId: storedMessage.id,
      },
    })

    await step.run('realtime-broadcast', async () => {
      await triggerToTenant(tenantId, 'message:new', {
        conversationId: conversation.id,
        messageId: storedMessage.id,
        senderType: 'customer',
        channel: 'webchat',
      })
    })

    return {
      conversationId: conversation.id,
      messageId: storedMessage.id,
    }
  },
)
