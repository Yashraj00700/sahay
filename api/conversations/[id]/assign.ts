import { z } from 'zod'
import { db, conversations } from '@sahay/db'
import { and, eq } from 'drizzle-orm'
import { defineAuthedHandler, parseBody } from '../../../apps/api/src/lib/handler'
import { enforce, limits } from '../../../apps/api/src/lib/rate-limit'
import { NotFoundError } from '../../../apps/api/src/lib/errors'
import { triggerToTenant } from '../../../apps/api/src/lib/pusher'

const assignSchema = z.object({
  agentId: z.string().uuid().nullable(),
})

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)
    const id = req.query.id as string
    const tenantId = ctx.tenant.id

    const { agentId } = parseBody(assignSchema, req.body)

    const [updated] = await db
      .update(conversations)
      .set({
        assignedTo: agentId ?? null,
        humanTouched: agentId !== null,
        updatedAt: new Date(),
      })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)))
      .returning()

    if (!updated) throw new NotFoundError('Not found')

    await triggerToTenant(
      tenantId,
      'conversation:updated',
      updated as unknown as Record<string, unknown>,
    )

    res.status(200).json(updated)
  },
  { methods: ['POST'] },
)
