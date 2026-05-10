import { z } from 'zod'
import { conversations, customers, agents } from '@sahay/db'
import { and, eq, isNull, asc, desc, sql } from 'drizzle-orm'
import { defineAuthedHandler, parseQuery } from '../../apps/api/src/lib/handler'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'
import { auditConversationListRead } from '../../apps/api/src/lib/audit-helpers'

const listQuerySchema = z.object({
  status:     z.enum(['open', 'pending', 'snoozed', 'resolved', 'closed', 'all']).default('open'),
  channel:    z.enum(['whatsapp', 'instagram', 'webchat', 'email', 'all']).default('all'),
  assignedTo: z.string().uuid().optional(),
  unassigned: z.coerce.boolean().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).default(25),
  sortBy:     z.enum(['createdAt', 'updatedAt', 'urgencyScore']).default('updatedAt'),
  sortDir:    z.enum(['asc', 'desc']).default('desc'),
})

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)

    const q = parseQuery(listQuerySchema, req.query)
    const tenantId = ctx.tenant.id
    const offset = (q.page - 1) * q.pageSize

    const conditions = [eq(conversations.tenantId, tenantId)]
    if (q.status !== 'all') conditions.push(eq(conversations.status, q.status))
    if (q.channel !== 'all') conditions.push(eq(conversations.channel, q.channel))
    if (q.assignedTo) conditions.push(eq(conversations.assignedTo, q.assignedTo))
    if (q.unassigned) conditions.push(isNull(conversations.assignedTo) as any)

    const sortColMap = {
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      urgencyScore: conversations.urgencyScore,
    }
    const sortCol = sortColMap[q.sortBy]
    const sortFn = q.sortDir === 'asc' ? asc : desc

    const [rows, countResult] = await ctx.withTenant((tx) =>
      Promise.all([
        tx
          .select({
            id: conversations.id,
            channel: conversations.channel,
            status: conversations.status,
            primaryIntent: conversations.primaryIntent,
            sentiment: conversations.sentiment,
            urgencyScore: conversations.urgencyScore,
            aiHandled: conversations.aiHandled,
            humanTouched: conversations.humanTouched,
            assignedTo: conversations.assignedTo,
            tags: conversations.tags,
            turnCount: conversations.turnCount,
            createdAt: conversations.createdAt,
            updatedAt: conversations.updatedAt,
            resolvedAt: conversations.resolvedAt,
            customerId: customers.id,
            customerName: customers.name,
            customerPhone: customers.phone,
            customerTier: customers.tier,
            agentName: agents.name,
          })
          .from(conversations)
          .leftJoin(customers, eq(conversations.customerId, customers.id))
          .leftJoin(agents, eq(conversations.assignedTo, agents.id))
          .where(and(...conditions))
          .orderBy(sortFn(sortCol))
          .limit(q.pageSize)
          .offset(offset),

        tx
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(conversations)
          .where(and(...conditions)),
      ]),
    )

    const total = countResult[0]?.count ?? 0
    const totalPages = Math.ceil(total / q.pageSize)

    // DPDP/GDPR read audit — fire-and-forget after a successful DB read,
    // before responding so a logged-but-failed-to-respond is a clean trace.
    void auditConversationListRead(ctx, q)

    res.status(200).json({
      data: rows,
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages,
        hasNextPage: q.page < totalPages,
        hasPreviousPage: q.page > 1,
      },
    })
  },
  { methods: ['GET'] },
)
