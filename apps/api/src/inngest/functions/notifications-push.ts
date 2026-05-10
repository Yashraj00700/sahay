import { eq } from 'drizzle-orm'
import { db, agents } from '@sahay/db'
import { inngest } from '../client'
import {
  sendPush,
  isPushConfigured,
  type WebPushSubscription,
} from '../../services/push'
import { auditAction } from '../../services/audit'

/**
 * notifications-push
 *
 * Fan out a Web Push notification to every subscription registered on the
 * target agent's row.
 *
 * Flow:
 *   1. load-agent: hydrate the agent + their `pushSubscriptions` array.
 *   2. send-and-prune (single step so the prune is co-located with the
 *      send and we don't risk duplicate sends on retry — the inngest
 *      retry policy is more aggressive than VAPID's idempotency tolerates):
 *        - Promise.allSettled across all subs (small N, parallel is fine)
 *        - Collect endpoints that returned 410 Gone or 404 → prune
 *        - Audit-log delivered count
 *
 * Graceful degradation: if VAPID env is missing we short-circuit with a
 * single info log so the rest of the inngest graph still runs.
 */

interface PushSubscriptionShape {
  endpoint: string
  keys?: { p256dh?: string; auth?: string }
}

/**
 * Returns the well-formed subscriptions and the endpoints of any malformed
 * entries (which we'll prune unconditionally — they can never be delivered).
 */
function partitionSubscriptions(raw: PushSubscriptionShape[]): {
  valid: WebPushSubscription[]
  malformed: string[]
} {
  const valid: WebPushSubscription[] = []
  const malformed: string[] = []
  for (const sub of raw) {
    if (
      typeof sub.endpoint === 'string' &&
      sub.endpoint.length > 0 &&
      sub.keys &&
      typeof sub.keys.p256dh === 'string' &&
      typeof sub.keys.auth === 'string'
    ) {
      valid.push({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      })
    } else if (typeof sub.endpoint === 'string') {
      malformed.push(sub.endpoint)
    }
  }
  return { valid, malformed }
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
      return { delivered: 0, attempted: 0 }
    }

    if (!isPushConfigured()) {
      logger.info(
        { tenantId, agentId, subs: agent.pushSubscriptions.length },
        'notifications-push: VAPID not configured, skipping send',
      )
      return { delivered: 0, attempted: agent.pushSubscriptions.length, skipped: true }
    }

    const result = await step.run('send-and-prune', async () => {
      const { valid, malformed } = partitionSubscriptions(agent.pushSubscriptions)
      const payload = { title, body, url }

      const outcomes = await Promise.allSettled(
        valid.map((sub) => sendPush(sub, payload)),
      )

      let delivered = 0
      const stale: string[] = [...malformed]
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i]
        const sub = valid[i]
        if (o.status === 'fulfilled') {
          if (o.value.ok) {
            delivered++
          } else if (o.value.statusCode === 410 || o.value.statusCode === 404) {
            stale.push(sub.endpoint)
          }
          // Other failures (5xx, network) leave the sub alone for next time.
        } else {
          // Unexpected throw inside sendPush wrapper — log and keep the sub.
          logger.warn(
            { endpoint: sub.endpoint, err: o.reason },
            'notifications-push: unexpected sendPush rejection',
          )
        }
      }

      if (stale.length > 0) {
        const staleSet = new Set(stale)
        const keep = agent.pushSubscriptions.filter(
          (s) => typeof s.endpoint === 'string' && !staleSet.has(s.endpoint),
        )
        await db
          .update(agents)
          .set({ pushSubscriptions: keep, updatedAt: new Date() })
          .where(eq(agents.id, agentId))
        logger.info(
          { tenantId, agentId, pruned: stale.length, remaining: keep.length },
          'notifications-push: pruned stale subscriptions',
        )
      }

      return { delivered, attempted: valid.length, pruned: stale.length }
    })

    await auditAction({
      tenantId,
      actorType: 'system',
      action: 'notifications.push.delivered',
      resourceType: 'agent',
      resourceId: agentId,
      metadata: {
        delivered: result.delivered,
        attempted: result.attempted,
        pruned: result.pruned,
      },
    })

    return result
  },
)
