import { z } from 'zod'
import { conversations, messages } from '@sahay/db'
import { and, eq, lt, desc } from 'drizzle-orm'
import { defineAuthedHandler, parseQuery } from '../../../apps/api/src/lib/handler'
import { enforce, limits } from '../../../apps/api/src/lib/rate-limit'
import { NotFoundError } from '../../../apps/api/src/lib/errors'
import { auditMessagesRead } from '../../../apps/api/src/lib/audit-helpers'

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)
    const id = req.query.id as string
    const tenantId = ctx.tenant.id

    const q = parseQuery(listQuerySchema, req.query)

    const rows = await ctx.withTenant(async (tx) => {
      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)),
        )
      if (!conv) throw new NotFoundError('Conversation not found')

      const conditions = [eq(messages.conversationId, id)]
      if (q.cursor) conditions.push(lt(messages.sentAt, new Date(q.cursor)) as any)

      return tx
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.sentAt))
        .limit(q.limit)
    })

    // DPDP/GDPR read audit — fire-and-forget; records count, NOT bodies.
    void auditMessagesRead(ctx, id, rows.length)

    res.status(200).json({
      messages: rows.reverse(),
      nextCursor: rows.length === q.limit ? rows[0]?.sentAt?.toISOString() ?? null : null,
    })
  },
  { methods: ['GET'] },
)
