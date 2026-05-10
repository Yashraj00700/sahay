import { conversations } from '@sahay/db'
import { and, eq } from 'drizzle-orm'
import { defineAuthedHandler } from '../../../apps/api/src/lib/handler'
import { enforce, limits } from '../../../apps/api/src/lib/rate-limit'
import { NotFoundError } from '../../../apps/api/src/lib/errors'
import { triggerToTenant } from '../../../apps/api/src/lib/pusher'

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)
    const id = req.query.id as string
    const tenantId = ctx.tenant.id

    const updated = await ctx.withTenant(async (tx) => {
      const [existing] = await tx
        .select({ createdAt: conversations.createdAt })
        .from(conversations)
        .where(
          and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)),
        )
      if (!existing) throw new NotFoundError('Not found')

      const [updated] = await tx
        .update(conversations)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionTimeSeconds: Math.floor(
            (Date.now() - (existing.createdAt?.getTime() ?? Date.now())) / 1000,
          ),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, id))
        .returning()

      return updated
    })

    await triggerToTenant(
      tenantId,
      'conversation:updated',
      updated as unknown as Record<string, unknown>,
    )

    res.status(200).json(updated)
  },
  { methods: ['POST'] },
)
