import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { auditLogs } from '@sahay/db'
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth.middleware'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  action:   z.string().optional(),
  actorId:  z.string().uuid().optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo:   z.string().datetime({ offset: true }).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /audit/events ────────────────────────────────────────────────────
  app.get('/events', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query parameters', errors: parsed.error.flatten() })
    }

    const q = parsed.data
    const tenantId = req.agent.tenantId
    const offset = (q.page - 1) * q.pageSize

    const conditions = [eq(auditLogs.tenantId, tenantId)]

    if (q.action)   conditions.push(eq(auditLogs.action, q.action))
    if (q.actorId)  conditions.push(eq(auditLogs.actorId, q.actorId))
    if (q.dateFrom) conditions.push(gte(auditLogs.createdAt, new Date(q.dateFrom)))
    if (q.dateTo)   conditions.push(lte(auditLogs.createdAt, new Date(q.dateTo)))

    const [rows, countResult] = await Promise.all([
      db.select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt))
        .limit(q.pageSize)
        .offset(offset),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(auditLogs)
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

  // ─── GET /audit/events/:id ────────────────────────────────────────────────
  app.get('/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.agent.tenantId

    const [event] = await db.select()
      .from(auditLogs)
      .where(and(eq(auditLogs.id, id), eq(auditLogs.tenantId, tenantId)))

    if (!event) return reply.status(404).send({ message: 'Audit event not found' })

    return reply.send(event)
  })
}
