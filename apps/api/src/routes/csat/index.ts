import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { conversations } from '@sahay/db'
import { eq, and, isNotNull, desc, gte, sql } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth.middleware'
import { createHmac } from 'node:crypto'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const submitBodySchema = z.object({
  conversationId: z.string().uuid(),
  rating:         z.number().int().min(1).max(5),
  comment:        z.string().max(2000).optional(),
  tenantId:       z.string().uuid(),
  token:          z.string(),
})

const listQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const csatRoutes: FastifyPluginAsync = async (app) => {

  // ─── POST /csat/submit (public — no auth required) ────────────────────────
  app.post('/submit', async (req, reply) => {
    const parsed = submitBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const { conversationId, rating, comment, tenantId, token } = parsed.data

    // Verify HMAC token to prevent tampering
    const secret = process.env.CSAT_HMAC_SECRET ?? process.env.JWT_SECRET ?? 'csat-secret'
    const expected = createHmac('sha256', secret)
      .update(`${conversationId}:${tenantId}`)
      .digest('hex')

    if (token !== expected) {
      return reply.status(403).send({ message: 'Invalid or tampered CSAT link' })
    }

    // Verify the conversation belongs to the stated tenant
    const [conv] = await db
      .select({ id: conversations.id, csatScore: conversations.csatScore })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))

    if (!conv) {
      return reply.status(404).send({ message: 'Conversation not found' })
    }

    if (conv.csatScore !== null) {
      // Already submitted — return success so the page shows the thank-you screen
      return reply.send({ message: 'Already submitted', alreadySubmitted: true })
    }

    // Build the update set — store optional comment in customFields.csatComment
    const updateSet: Record<string, unknown> = {
      csatScore:       rating,
      csatSubmittedAt: new Date(),
      updatedAt:       new Date(),
    }
    if (comment) {
      updateSet.customFields = sql`jsonb_set(coalesce(custom_fields, '{}'), '{csatComment}', ${JSON.stringify(comment)}::jsonb)`
    }

    await db
      .update(conversations)
      .set(updateSet as any)
      .where(eq(conversations.id, conversationId))

    return reply.status(201).send({ message: 'Thank you for your feedback!' })
  })

  // ─── Authenticated routes (agent dashboard) ────────────────────────────────
  // Registered inside a child plugin so the auth hook is scoped only here.
  app.register(async (authedApp) => {
    authedApp.addHook('preHandler', requireAuth)

    // ─── GET /csat/overview ─────────────────────────────────────────────────
    authedApp.get('/overview', async (req, reply) => {
      const tenantId = req.agent.tenantId

      const [stats] = await db.select({
        totalConversations:  sql<number>`cast(count(*) as integer)`,
        ratedConversations:  sql<number>`cast(count(${conversations.csatScore}) as integer)`,
        avgScore:            sql<string | null>`round(avg(${conversations.csatScore})::numeric, 2)`,
        promoters:           sql<number>`cast(sum(case when ${conversations.csatScore} = 5 then 1 else 0 end) as integer)`,
        detractors:          sql<number>`cast(sum(case when ${conversations.csatScore} <= 2 then 1 else 0 end) as integer)`,
      })
        .from(conversations)
        .where(eq(conversations.tenantId, tenantId))

      const total    = stats?.totalConversations ?? 0
      const rated    = stats?.ratedConversations ?? 0
      const promoters  = stats?.promoters ?? 0
      const detractors = stats?.detractors ?? 0

      // NPS: ((promoters - detractors) / rated) * 100
      const nps = rated > 0
        ? Math.round(((promoters - detractors) / rated) * 100)
        : null

      const responseRate = total > 0
        ? Math.round((rated / total) * 100)
        : 0

      return reply.send({
        avgScore:     stats?.avgScore ? parseFloat(stats.avgScore) : null,
        responseRate,               // percentage
        totalRated:   rated,
        totalConversations: total,
        nps,
      })
    })

    // ─── GET /csat/responses ────────────────────────────────────────────────
    authedApp.get('/responses', async (req, reply) => {
      const parsed = listQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.status(400).send({ message: 'Invalid query parameters', errors: parsed.error.flatten() })
      }

      const q = parsed.data
      const tenantId = req.agent.tenantId
      const offset = (q.page - 1) * q.pageSize

      const conditions = [
        eq(conversations.tenantId, tenantId),
        isNotNull(conversations.csatScore),
      ]

      const [rows, countResult] = await Promise.all([
        db.select({
          id:               conversations.id,
          customerId:       conversations.customerId,
          channel:          conversations.channel,
          status:           conversations.status,
          csatScore:        conversations.csatScore,
          csatSubmittedAt:  conversations.csatSubmittedAt,
          primaryIntent:    conversations.primaryIntent,
          sentiment:        conversations.sentiment,
          aiHandled:        conversations.aiHandled,
          humanTouched:     conversations.humanTouched,
          resolvedAt:       conversations.resolvedAt,
          resolutionTimeSeconds: conversations.resolutionTimeSeconds,
          createdAt:        conversations.createdAt,
        })
          .from(conversations)
          .where(and(...conditions))
          .orderBy(desc(conversations.csatSubmittedAt))
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

    // ─── GET /csat/trends ───────────────────────────────────────────────────
    // Daily average CSAT scores for the last 30 days
    authedApp.get('/trends', async (req, reply) => {
      const tenantId = req.agent.tenantId
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      const rows = await db.select({
        date:     sql<string>`date_trunc('day', ${conversations.csatSubmittedAt})::date`,
        avgScore: sql<string>`round(avg(${conversations.csatScore})::numeric, 2)`,
        count:    sql<number>`cast(count(*) as integer)`,
      })
        .from(conversations)
        .where(and(
          eq(conversations.tenantId, tenantId),
          isNotNull(conversations.csatScore),
          gte(conversations.csatSubmittedAt, thirtyDaysAgo),
        ))
        .groupBy(sql`date_trunc('day', ${conversations.csatSubmittedAt})::date`)
        .orderBy(sql`date_trunc('day', ${conversations.csatSubmittedAt})::date`)

      return reply.send({
        data: rows.map(r => ({
          date:     r.date,
          avgScore: r.avgScore ? parseFloat(r.avgScore) : null,
          count:    r.count,
        })),
      })
    })
  })
}
