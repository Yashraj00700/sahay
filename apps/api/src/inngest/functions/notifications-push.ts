import { eq } from 'drizzle-orm'
import { db, agents } from '@sahay/db'
import { inngest } from '../client'

/**
 * notifications-push
 *
 * Fan out a Web Push notification to all subscriptions registered on the
 * target agent's row. We don't have a `web-push` library installed yet
 * (TODO P0.12) so for now we log the intended payload and mark that the
 * subscription scrub-on-410-Gone branch is unimplemented. Once `web-push`
 * is added, replace the logger.warn block with the real send loop.
 */

interface PushSubscriptionShape {
  endpoint: string
  keys?: { p256dh?: string; auth?: string }
}

export const notificationsPush = inngest.createFunction(
  {
    id: 'notifications-push',
    retries: 2,
    concurrency: { limit: 100, key: 'event.data.tenantId' },
  },
  { event: 'notifications/push.requested' },
  async ({ event, step, logger }) => {
    const { tenantId, agentId, title, body, url } = event.data

    const agent = await step.run('load-agent', async () => {
      const row = await db.query.agents.findFirst({
        where: eq(agents.id, agentId),
      })
      if (!row) throw new Error(`notifications-push: agent ${agentId} not found`)
      if (row.tenantId !== tenantId) {
        throw new Error(
          `notifications-push: agent ${agentId} belongs to a different tenant`,
        )
      }
      return {
        id: row.id,
        pushSubscriptions: (row.pushSubscriptions ?? []) as PushSubscriptionShape[],
      }
    })

    if (agent.pushSubscriptions.length === 0) {
      logger.info({ tenantId, agentId }, 'notifications-push: no subscriptions')
      return { delivered: 0 }
    }

    // TODO(P0.12): swap this for the real `web-push` send loop. Requires
    // VAPID public/private keys configured in env. For each subscription:
    //   try { await webpush.sendNotification(sub, JSON.stringify(payload)) }
    //   catch (err) { if (err.statusCode === 410) removeSubscription(sub) }
    await step.run('send-and-prune', async () => {
      const payload = { title, body, url }
      logger.warn(
        { tenantId, agentId, payload, subs: agent.pushSubscriptions.length },
        'notifications-push: web-push not yet wired; payload logged only',
      )

      // Even though we can't send, prune obviously malformed entries.
      const valid = agent.pushSubscriptions.filter(
        (s) => typeof s.endpoint === 'string' && s.endpoint.length > 0,
      )
      if (valid.length !== agent.pushSubscriptions.length) {
        await db
          .update(agents)
          .set({ pushSubscriptions: valid })
          .where(eq(agents.id, agentId))
      }
    })

    return { delivered: 0, attempted: agent.pushSubscriptions.length }
  },
)
