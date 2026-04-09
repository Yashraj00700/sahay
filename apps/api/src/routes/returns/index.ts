import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { conversations } from '@sahay/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth.middleware'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  page:         z.coerce.number().int().min(1).default(1),
  pageSize:     z.coerce.number().int().min(1).max(100).default(25),
  returnStatus: z.enum(['pending', 'approved', 'rejected', 'refunded', 'prevented']).optional(),
})

const patchReturnStatusSchema = z.object({
  returnStatus: z.enum(['pending', 'approved', 'rejected', 'refunded', 'prevented']),
  notes:        z.string().max(1000).optional(),
})

const uuidSchema = z.string().uuid()

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const returnsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /returns/overview ────────────────────────────────────────────────
  app.get('/overview', async (req, reply) => {
    const tenantId = req.agent.tenantId

    const [stats] = await db.select({
      totalRequests: sql<number>`cast(count(*) as integer)`,
      // Conversations where returnStatus in customFields is 'prevented'
      prevented:     sql<number>`cast(sum(case when ${conversations.customFields}->>'returnStatus' = 'prevented' then 1 else 0 end) as integer)`,
      refunded:      sql<number>`cast(sum(case when ${conversations.customFields}->>'returnStatus' = 'refunded'  then 1 else 0 end) as integer)`,
      approved:      sql<number>`cast(sum(case when ${conversations.customFields}->>'returnStatus' = 'approved'  then 1 else 0 end) as integer)`,
      pending:       sql<number>`cast(sum(case when ${conversations.customFields}->>'returnStatus' = 'pending' or ${conversations.customFields}->>'returnStatus' is null then 1 else 0 end) as integer)`,
    })
      .from(conversations)
      .where(and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.primaryIntent, 'return_request'),
      ))

    return reply.send({
      totalRequests: stats?.totalRequests ?? 0,
      prevented:     stats?.prevented     ?? 0,
      refunded:      stats?.refunded      ?? 0,
      approved:      stats?.approved      ?? 0,
      pending:       stats?.pending       ?? 0,
    })
  })

  // ─── GET /returns ─────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query parameters', errors: parsed.error.flatten() })
    }

    const q = parsed.data
    const tenantId = req.agent.tenantId
    const offset = (q.page - 1) * q.pageSize

    const conditions = [
      eq(conversations.tenantId, tenantId),
      eq(conversations.primaryIntent, 'return_request'),
      ...(q.returnStatus
        ? [sql`${conversations.customFields}->>'returnStatus' = ${q.returnStatus}`]
        : []),
    ]

    const [rows, countResult] = await Promise.all([
      db.select({
        id:             conversations.id,
        customerId:     conversations.customerId,
        channel:        conversations.channel,
        status:         conversations.status,
        primaryIntent:  conversations.primaryIntent,
        sentiment:      conversations.sentiment,
        urgencyScore:   conversations.urgencyScore,
        aiHandled:      conversations.aiHandled,
        humanTouched:   conversations.humanTouched,
        shopifyOrderId: conversations.shopifyOrderId,
        customFields:   conversations.customFields,
        tags:           conversations.tags,
        resolvedAt:     conversations.resolvedAt,
        createdAt:      conversations.createdAt,
        updatedAt:      conversations.updatedAt,
      })
        .from(conversations)
        .where(and(...conditions))
        .orderBy(desc(conversations.createdAt))
        .limit(q.pageSize)
        .offset(offset),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(conversations)
        .where(and(...conditions)),
    ])

    const total = countResult[0]?.count ?? 0
    const totalPages = Math.ceil(total / q.pageSize)

    return reply.send({
      data: rows,
      pagination: {
        page:            q.page,
        pageSize:        q.pageSize,
        total,
        totalPages,
        hasNextPage:     q.page < totalPages,
        hasPreviousPage: q.page > 1,
      },
    })
  })

  // ─── GET /returns/reasons ─────────────────────────────────────────────────
  // Group return requests by the 'returnReason' field stored in customFields
  app.get('/reasons', async (req, reply) => {
    const tenantId = req.agent.tenantId

    const rows = await db.select({
      reason: sql<string>`coalesce(${conversations.customFields}->>'returnReason', 'unspecified')`,
      count:  sql<number>`cast(count(*) as integer)`,
    })
      .from(conversations)
      .where(and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.primaryIntent, 'return_request'),
      ))
      .groupBy(sql`coalesce(${conversations.customFields}->>'returnReason', 'unspecified')`)
      .orderBy(sql`count(*) desc`)

    return reply.send({ data: rows })
  })

  // ─── PATCH /returns/:id/status ────────────────────────────────────────────
  app.patch('/:id/status', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const parsed = patchReturnStatusSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const tenantId = req.agent.tenantId

    const [existing] = await db.select({ id: conversations.id, customFields: conversations.customFields })
      .from(conversations)
      .where(and(
        eq(conversations.id, id),
        eq(conversations.tenantId, tenantId),
        eq(conversations.primaryIntent, 'return_request'),
      ))

    if (!existing) return reply.status(404).send({ message: 'Return request not found' })

    const currentFields = (existing.customFields as Record<string, unknown>) ?? {}
    const updatedFields: Record<string, unknown> = {
      ...currentFields,
      returnStatus:    parsed.data.returnStatus,
      returnUpdatedAt: new Date().toISOString(),
      returnUpdatedBy: req.agent.id,
    }
    if (parsed.data.notes !== undefined) updatedFields.returnNotes = parsed.data.notes

    const [updated] = await db.update(conversations)
      .set({ customFields: updatedFields, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)))
      .returning({
        id:           conversations.id,
        customFields: conversations.customFields,
        updatedAt:    conversations.updatedAt,
      })

    return reply.send(updated)
  })
}
