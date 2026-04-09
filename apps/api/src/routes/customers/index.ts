import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { customers, conversations } from '@sahay/db'
import { eq, and, desc, ilike, or, sql } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth.middleware'

// ─── Request schemas ──────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  search: z.string().optional(),
  tags: z.string().optional(),              // comma-separated list
  tier: z.enum(['new', 'regular', 'vip', 'champion']).optional(),
  churnRisk: z.enum(['low', 'medium', 'high']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['createdAt', 'updatedAt', 'totalSpent', 'totalOrders', 'lastOrderAt']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

const createCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  whatsappId: z.string().max(50).optional(),
  instagramId: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(10).default('IN'),
  languagePref: z.string().max(20).default('auto'),
  tags: z.array(z.string()).default([]),
  notes: z.array(z.any()).default([]),
  waSupportConsent: z.boolean().default(false),
  waMarketingConsent: z.boolean().default(false),
})

const uuidSchema = z.string().uuid()

const patchCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(10).optional(),
  languagePref: z.string().max(20).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.array(z.any()).optional(),
  tier: z.enum(['new', 'regular', 'vip', 'champion']).optional(),
  churnRisk: z.enum(['low', 'medium', 'high']).optional(),
  waSupportConsent: z.boolean().optional(),
  waMarketingConsent: z.boolean().optional(),
  isOptout: z.boolean().optional(),
})

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /customers/stats ─────────────────────────────────────────────────
  // Must be registered before /:id to avoid "stats" being matched as an id param
  app.get('/stats', async (req, reply) => {
    const tenantId = req.tenant.id
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [totalResult, newThisWeekResult, vipResult, highChurnResult, optoutResult] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(customers)
        .where(eq(customers.tenantId, tenantId)),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(customers)
        .where(and(
          eq(customers.tenantId, tenantId),
          sql`${customers.createdAt} >= ${weekAgo}`,
        )),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(customers)
        .where(and(
          eq(customers.tenantId, tenantId),
          or(eq(customers.tier, 'vip'), eq(customers.tier, 'champion')),
        )),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(customers)
        .where(and(
          eq(customers.tenantId, tenantId),
          eq(customers.churnRisk, 'high'),
        )),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(customers)
        .where(and(
          eq(customers.tenantId, tenantId),
          eq(customers.isOptout, true),
        )),
    ])

    return reply.send({
      total: totalResult[0]?.count ?? 0,
      newThisWeek: newThisWeekResult[0]?.count ?? 0,
      vipCount: vipResult[0]?.count ?? 0,
      highChurnCount: highChurnResult[0]?.count ?? 0,
      optoutCount: optoutResult[0]?.count ?? 0,
    })
  })

  // ─── GET /customers ───────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query parameters', errors: parsed.error.flatten() })
    }

    const q = parsed.data
    const tenantId = req.tenant.id
    const offset = (q.page - 1) * q.pageSize

    const conditions = [eq(customers.tenantId, tenantId)]

    if (q.search) {
      const term = `%${q.search}%`
      conditions.push(
        or(
          ilike(customers.name, term),
          ilike(customers.phone, term),
          ilike(customers.email, term),
        )!,
      )
    }

    if (q.tier) conditions.push(eq(customers.tier, q.tier))
    if (q.churnRisk) conditions.push(eq(customers.churnRisk, q.churnRisk))

    if (q.tags) {
      const tagList = q.tags.split(',').map(t => t.trim()).filter(Boolean)
      if (tagList.length > 0) {
        // customers whose tags array overlaps with the filter list
        conditions.push(sql`${customers.tags} && ARRAY[${sql.join(tagList.map(t => sql`${t}`), sql`, `)}]::text[]`)
      }
    }

    const sortColMap = {
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,
      totalSpent: customers.totalSpent,
      totalOrders: customers.totalOrders,
      lastOrderAt: customers.lastOrderAt,
    }
    const sortCol = sortColMap[q.sortBy]
    const sortFn = q.sortDir === 'asc' ? sql`asc nulls last` : sql`desc nulls last`

    // Sub-query: last conversation date and total conversation count per customer
    const convStats = db.select({
      customerId: conversations.customerId,
      lastConversationAt: sql<string | null>`max(${conversations.createdAt})`.as('last_conversation_at'),
      conversationCount: sql<number>`cast(count(*) as integer)`.as('conversation_count'),
    })
      .from(conversations)
      .where(eq(conversations.tenantId, tenantId))
      .groupBy(conversations.customerId)
      .as('conv_stats')

    const [rows, countResult] = await Promise.all([
      db.select({
        id: customers.id,
        tenantId: customers.tenantId,
        phone: customers.phone,
        email: customers.email,
        name: customers.name,
        whatsappId: customers.whatsappId,
        instagramId: customers.instagramId,
        city: customers.city,
        state: customers.state,
        country: customers.country,
        languagePref: customers.languagePref,
        totalOrders: customers.totalOrders,
        totalSpent: customers.totalSpent,
        lastOrderAt: customers.lastOrderAt,
        clvScore: customers.clvScore,
        churnRisk: customers.churnRisk,
        tier: customers.tier,
        sentiment7d: customers.sentiment7d,
        tags: customers.tags,
        isOptout: customers.isOptout,
        waSupportConsent: customers.waSupportConsent,
        waMarketingConsent: customers.waMarketingConsent,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
        lastConversationAt: convStats.lastConversationAt,
        conversationCount: convStats.conversationCount,
      })
        .from(customers)
        .leftJoin(convStats, eq(customers.id, convStats.customerId))
        .where(and(...conditions))
        .orderBy(sql`${sortCol} ${sortFn}`)
        .limit(q.pageSize)
        .offset(offset),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(customers)
        .where(and(...conditions)),
    ])

    const total = countResult[0]?.count ?? 0
    const totalPages = Math.ceil(total / q.pageSize)

    return reply.send({
      data: rows,
      pagination: {
        page: q.page, pageSize: q.pageSize, total, totalPages,
        hasNextPage: q.page < totalPages, hasPreviousPage: q.page > 1,
      },
    })
  })

  // ─── GET /customers/:id ───────────────────────────────────────────────────
  app.get('/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const tenantId = req.tenant.id

    const [customer] = await db.select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))

    if (!customer) return reply.status(404).send({ message: 'Customer not found' })

    // Last 10 conversations for this customer
    const recentConversations = await db.select({
      id: conversations.id,
      channel: conversations.channel,
      status: conversations.status,
      primaryIntent: conversations.primaryIntent,
      sentiment: conversations.sentiment,
      urgencyScore: conversations.urgencyScore,
      aiHandled: conversations.aiHandled,
      humanTouched: conversations.humanTouched,
      resolvedAt: conversations.resolvedAt,
      turnCount: conversations.turnCount,
      csatScore: conversations.csatScore,
      shopifyOrderId: conversations.shopifyOrderId,
      tags: conversations.tags,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
      .from(conversations)
      .where(and(
        eq(conversations.customerId, id),
        eq(conversations.tenantId, tenantId),
      ))
      .orderBy(desc(conversations.createdAt))
      .limit(10)

    // Aggregate conversation stats
    const [convAgg] = await db.select({
      totalConversations: sql<number>`cast(count(*) as integer)`,
      resolvedCount: sql<number>`cast(sum(case when ${conversations.status} = 'resolved' then 1 else 0 end) as integer)`,
      avgCsat: sql<string | null>`round(avg(${conversations.csatScore})::numeric, 2)`,
    })
      .from(conversations)
      .where(and(
        eq(conversations.customerId, id),
        eq(conversations.tenantId, tenantId),
      ))

    return reply.send({
      ...customer,
      recentConversations,
      conversationStats: {
        total: convAgg?.totalConversations ?? 0,
        resolved: convAgg?.resolvedCount ?? 0,
        avgCsat: convAgg?.avgCsat ?? null,
      },
    })
  })

  // ─── POST /customers ──────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const parsed = createCustomerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const tenantId = req.tenant.id
    const data = parsed.data

    // Prevent duplicate phone/whatsappId within tenant (soft check — DB unique index is the hard guard)
    if (data.phone) {
      const [existing] = await db.select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, data.phone)))
      if (existing) {
        return reply.status(409).send({ message: 'A customer with this phone number already exists' })
      }
    }

    const [created] = await db.insert(customers).values({
      tenantId,
      name: data.name,
      phone: data.phone,
      email: data.email,
      whatsappId: data.whatsappId,
      instagramId: data.instagramId,
      city: data.city,
      state: data.state,
      country: data.country,
      languagePref: data.languagePref,
      tags: data.tags,
      notes: data.notes,
      waSupportConsent: data.waSupportConsent,
      waMarketingConsent: data.waMarketingConsent,
      consentTimestamp: (data.waSupportConsent || data.waMarketingConsent) ? new Date() : undefined,
    }).returning()

    return reply.status(201).send(created)
  })

  // ─── PATCH /customers/:id ─────────────────────────────────────────────────
  app.patch('/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const parsed = patchCustomerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const tenantId = req.tenant.id

    const [existing] = await db.select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
    if (!existing) return reply.status(404).send({ message: 'Customer not found' })

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    const d = parsed.data

    if (d.name !== undefined) updates.name = d.name
    if (d.email !== undefined) updates.email = d.email
    if (d.phone !== undefined) updates.phone = d.phone
    if (d.city !== undefined) updates.city = d.city
    if (d.state !== undefined) updates.state = d.state
    if (d.country !== undefined) updates.country = d.country
    if (d.languagePref !== undefined) updates.languagePref = d.languagePref
    if (d.tags !== undefined) updates.tags = d.tags
    if (d.notes !== undefined) updates.notes = d.notes
    if (d.tier !== undefined) updates.tier = d.tier
    if (d.churnRisk !== undefined) updates.churnRisk = d.churnRisk
    if (d.waSupportConsent !== undefined) {
      updates.waSupportConsent = d.waSupportConsent
      updates.consentTimestamp = new Date()
    }
    if (d.waMarketingConsent !== undefined) {
      updates.waMarketingConsent = d.waMarketingConsent
      updates.consentTimestamp = new Date()
    }
    if (d.isOptout !== undefined) {
      updates.isOptout = d.isOptout
      if (d.isOptout) updates.optoutAt = new Date()
    }

    const [updated] = await db.update(customers)
      .set(updates as any)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .returning()

    return reply.send(updated)
  })
}
