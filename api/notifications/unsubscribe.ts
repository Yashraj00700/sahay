import { z } from 'zod'
import { agents } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { defineAuthedHandler, parseBody } from '../../apps/api/src/lib/handler'
import { NotFoundError } from '../../apps/api/src/lib/errors'
import { logger } from '../../apps/api/src/lib/logger'

/**
 * POST /api/notifications/unsubscribe
 *
 * Removes a browser PushSubscription from the authenticated agent's row.
 * Idempotent: if the endpoint isn't on file we still return 200 so the
 * client doesn't have to special-case "already gone" (e.g. after VAPID
 * rotation pruned it server-side).
 */

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

interface StoredSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent?: string
  createdAt?: string
}

export default defineAuthedHandler(
  async (req, res, ctx) => {
    const { endpoint } = parseBody(UnsubscribeSchema, req.body)

    const result = await ctx.withTenant(async (tx) => {
      const row = await tx.query.agents.findFirst({
        where: eq(agents.id, ctx.agent.id),
      })
      if (!row) throw new NotFoundError('Agent not found')

      const existing = (row.pushSubscriptions ?? []) as StoredSubscription[]
      const next = existing.filter((s) => s.endpoint !== endpoint)

      if (next.length !== existing.length) {
        await tx
          .update(agents)
          .set({ pushSubscriptions: next, updatedAt: new Date() })
          .where(eq(agents.id, ctx.agent.id))
        return { removed: true, remaining: next.length }
      }
      return { removed: false, remaining: next.length }
    })

    if (result.removed) {
      logger.info(
        { agentId: ctx.agent.id, remaining: result.remaining },
        'push: subscription removed',
      )
    }

    res.status(200).json({ success: true })
  },
  { methods: ['POST'] },
)
