import { z } from 'zod'
import { db, conversations, messages } from '@sahay/db'
import { and, eq, lt, desc } from 'drizzle-orm'
import { defineAuthedHandler, parseQuery } from '../../../apps/api/src/lib/handler'
import { enforce, limits } from '../../../apps/api/src/lib/rate-limit'
import { NotFoundError } from '../../../apps/api/src/lib/errors'

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)
    const id = req.query.id as string
    const tenantId = ctx.tenant.id

    const [conv] = await db.select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)))
    if (!conv) throw new NotFoundError('Conversation not found')

    const q = parseQuery(listQuerySchema, req.query)
    const conditions = [eq(messages.conversationId, id)]
    if (q.cursor) conditions.push(lt(messages.sentAt, new Date(q.cursor)) as any)

    const rows = await db.select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.sentAt))
      .limit(q.limit)

    res.status(200).json({
      messages: rows.reverse(),
      nextCursor: rows.length === q.limit ? rows[0]?.sentAt?.toISOString() ?? null : null,
    })
  },
  { methods: ['GET'] },
)
