import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { analyticsDaily, conversations, messages } from '@sahay/db'
import { eq, and, gte, lte, sql, count, avg, sum } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth.middleware'

// ─── Shared query param schema ────────────────────────────────────────────────

const dateRangeSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

function parseDateRange(query: Record<string, unknown>) {
  const parsed = dateRangeSchema.safeParse(query)
  const raw = parsed.success ? parsed.data : {}
  const now = new Date()
  // Default: last 30 days
  const start = raw.startDate ? new Date(raw.startDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
  const end = raw.endDate ? new Date(raw.endDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) // exclusive upper bound
  return { start, end }
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /analytics/overview ───────────────────────────────────────────────
  // Summary stats aggregated from analyticsDaily (pre-aggregated rows).
  // Falls back to live conversation queries when no daily rows exist yet.
  app.get('/overview', async (req, reply) => {
    const tenantId = req.tenant.id
    const { start, end } = parseDateRange(req.query as Record<string, unknown>)

    // Try analyticsDaily first (channel = null means "all channels combined")
    const dailyRows = await db
      .select({
        totalConversations: sum(analyticsDaily.totalConversations).mapWith(Number),
        resolvedConversations: sum(analyticsDaily.resolvedConversations).mapWith(Number),
        aiResolved: sum(analyticsDaily.aiResolved).mapWith(Number),
        aiEscalated: sum(analyticsDaily.aiEscalated).mapWith(Number),
        avgFirstResponseSeconds: avg(analyticsDaily.avgFirstResponseSeconds).mapWith(Number),
        avgResolutionSeconds: avg(analyticsDaily.avgResolutionSeconds).mapWith(Number),
        avgCsat: avg(analyticsDaily.avgCsat).mapWith(Number),
        csatResponses: sum(analyticsDaily.csatResponses).mapWith(Number),
        totalMessages: sum(analyticsDaily.totalMessages).mapWith(Number),
        aiMessages: sum(analyticsDaily.aiMessages).mapWith(Number),
        codConversions: sum(analyticsDaily.codConversions).mapWith(Number),
        codConversionRevenue: sum(analyticsDaily.codConversionRevenue).mapWith(Number),
      })
      .from(analyticsDaily)
      .where(
        and(
          eq(analyticsDaily.tenantId, tenantId),
          sql`${analyticsDaily.channel} IS NULL`,
          gte(analyticsDaily.date, start.toISOString().split('T')[0]),
          lte(analyticsDaily.date, end.toISOString().split('T')[0]),
        )
      )

    const agg = dailyRows[0]

    // If pre-aggregated data exists, return it
    if (agg && (agg.totalConversations ?? 0) > 0) {
      const total = agg.totalConversations ?? 0
      const aiResolved = agg.aiResolved ?? 0
      return reply.send({
        period: { startDate: start.toISOString(), endDate: end.toISOString() },
        totalConversations: total,
        resolvedConversations: agg.resolvedConversations ?? 0,
        aiResolved,
        aiEscalated: agg.aiEscalated ?? 0,
        aiResolutionRate: total > 0 ? Number(((aiResolved / total) * 100).toFixed(2)) : 0,
        avgFirstResponseSeconds: agg.avgFirstResponseSeconds ?? null,
        avgResolutionSeconds: agg.avgResolutionSeconds ?? null,
        avgCsatScore: agg.avgCsat ?? null,
        csatResponses: agg.csatResponses ?? 0,
        totalMessages: agg.totalMessages ?? 0,
        aiMessages: agg.aiMessages ?? 0,
        codConversions: agg.codConversions ?? 0,
        codConversionRevenue: agg.codConversionRevenue ?? 0,
        source: 'analytics_daily',
      })
    }

    // Fallback: compute live from conversations table
    const [liveStats] = await db
      .select({
        totalConversations: count(),
        resolvedConversations: sql<number>`cast(count(*) filter (where ${conversations.status} in ('resolved','closed')) as integer)`,
        aiResolved: sql<number>`cast(count(*) filter (where ${conversations.aiHandled} = true and ${conversations.status} in ('resolved','closed')) as integer)`,
        humanTouched: sql<number>`cast(count(*) filter (where ${conversations.humanTouched} = true) as integer)`,
        avgFirstResponseSeconds: avg(conversations.resolutionTimeSeconds).mapWith(Number),
        avgCsat: avg(conversations.csatScore).mapWith(Number),
        csatResponses: sql<number>`cast(count(*) filter (where ${conversations.csatScore} is not null) as integer)`,
        codConversions: sql<number>`cast(count(*) filter (where ${conversations.codConversionAccepted} = true) as integer)`,
        codConversionRevenue: sum(conversations.codConversionRevenue).mapWith(Number),
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          gte(conversations.createdAt, start),
          lte(conversations.createdAt, end),
        )
      )

    const total = liveStats?.totalConversations ?? 0
    const aiResolved = liveStats?.aiResolved ?? 0

    return reply.send({
      period: { startDate: start.toISOString(), endDate: end.toISOString() },
      totalConversations: total,
      resolvedConversations: liveStats?.resolvedConversations ?? 0,
      aiResolved,
      aiEscalated: liveStats?.humanTouched ?? 0,
      aiResolutionRate: total > 0 ? Number(((aiResolved / total) * 100).toFixed(2)) : 0,
      avgFirstResponseSeconds: null, // not stored per-conversation
      avgResolutionSeconds: liveStats?.avgFirstResponseSeconds ?? null,
      avgCsatScore: liveStats?.avgCsat ?? null,
      csatResponses: liveStats?.csatResponses ?? 0,
      totalMessages: null,
      aiMessages: null,
      codConversions: liveStats?.codConversions ?? 0,
      codConversionRevenue: liveStats?.codConversionRevenue ?? 0,
      source: 'live',
    })
  })

  // ─── GET /analytics/conversations ─────────────────────────────────────────
  // Time-series: total conversations created per day.
  app.get('/conversations', async (req, reply) => {
    const tenantId = req.tenant.id
    const { start, end } = parseDateRange(req.query as Record<string, unknown>)

    const rows = await db
      .select({
        date: sql<string>`DATE_TRUNC('day', ${conversations.createdAt})::date`,
        total: count(),
        resolved: sql<number>`cast(count(*) filter (where ${conversations.status} in ('resolved','closed')) as integer)`,
        open: sql<number>`cast(count(*) filter (where ${conversations.status} = 'open') as integer)`,
        aiHandled: sql<number>`cast(count(*) filter (where ${conversations.aiHandled} = true) as integer)`,
        humanTouched: sql<number>`cast(count(*) filter (where ${conversations.humanTouched} = true) as integer)`,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          gte(conversations.createdAt, start),
          lte(conversations.createdAt, end),
        )
      )
      .groupBy(sql`DATE_TRUNC('day', ${conversations.createdAt})::date`)
      .orderBy(sql`DATE_TRUNC('day', ${conversations.createdAt})::date`)

    return reply.send({
      period: { startDate: start.toISOString(), endDate: end.toISOString() },
      data: rows,
    })
  })

  // ─── GET /analytics/resolution-rate ───────────────────────────────────────
  // Daily breakdown: AI-resolved vs human-resolved vs open.
  app.get('/resolution-rate', async (req, reply) => {
    const tenantId = req.tenant.id
    const { start, end } = parseDateRange(req.query as Record<string, unknown>)

    // First try the pre-aggregated table
    const dailyRows = await db
      .select({
        date: analyticsDaily.date,
        aiResolved: analyticsDaily.aiResolved,
        aiEscalated: analyticsDaily.aiEscalated,
        resolvedConversations: analyticsDaily.resolvedConversations,
        totalConversations: analyticsDaily.totalConversations,
        aiResolutionRate: analyticsDaily.aiResolutionRate,
      })
      .from(analyticsDaily)
      .where(
        and(
          eq(analyticsDaily.tenantId, tenantId),
          sql`${analyticsDaily.channel} IS NULL`,
          gte(analyticsDaily.date, start.toISOString().split('T')[0]),
          lte(analyticsDaily.date, end.toISOString().split('T')[0]),
        )
      )
      .orderBy(analyticsDaily.date)

    if (dailyRows.length > 0) {
      return reply.send({
        period: { startDate: start.toISOString(), endDate: end.toISOString() },
        data: dailyRows.map((r) => ({
          date: r.date,
          aiResolved: r.aiResolved ?? 0,
          humanResolved: (r.resolvedConversations ?? 0) - (r.aiResolved ?? 0),
          totalResolved: r.resolvedConversations ?? 0,
          totalConversations: r.totalConversations ?? 0,
          aiResolutionRate: r.aiResolutionRate ?? '0',
          source: 'analytics_daily',
        })),
      })
    }

    // Fallback: live query
    const rows = await db
      .select({
        date: sql<string>`DATE_TRUNC('day', ${conversations.createdAt})::date`,
        aiResolved: sql<number>`cast(count(*) filter (where ${conversations.aiHandled} = true and ${conversations.status} in ('resolved','closed')) as integer)`,
        humanResolved: sql<number>`cast(count(*) filter (where ${conversations.humanTouched} = true and ${conversations.status} in ('resolved','closed')) as integer)`,
        totalResolved: sql<number>`cast(count(*) filter (where ${conversations.status} in ('resolved','closed')) as integer)`,
        totalConversations: count(),
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          gte(conversations.createdAt, start),
          lte(conversations.createdAt, end),
        )
      )
      .groupBy(sql`DATE_TRUNC('day', ${conversations.createdAt})::date`)
      .orderBy(sql`DATE_TRUNC('day', ${conversations.createdAt})::date`)

    return reply.send({
      period: { startDate: start.toISOString(), endDate: end.toISOString() },
      data: rows.map((r) => ({
        ...r,
        aiResolutionRate:
          r.totalConversations > 0
            ? Number(((r.aiResolved / r.totalConversations) * 100).toFixed(2))
            : 0,
        source: 'live',
      })),
    })
  })

  // ─── GET /analytics/channel-breakdown ─────────────────────────────────────
  // Count of conversations grouped by channel for the period.
  app.get('/channel-breakdown', async (req, reply) => {
    const tenantId = req.tenant.id
    const { start, end } = parseDateRange(req.query as Record<string, unknown>)

    // Try analyticsDaily grouped by channel
    const dailyRows = await db
      .select({
        channel: analyticsDaily.channel,
        totalConversations: sum(analyticsDaily.totalConversations).mapWith(Number),
        aiResolved: sum(analyticsDaily.aiResolved).mapWith(Number),
        resolvedConversations: sum(analyticsDaily.resolvedConversations).mapWith(Number),
        totalMessages: sum(analyticsDaily.totalMessages).mapWith(Number),
      })
      .from(analyticsDaily)
      .where(
        and(
          eq(analyticsDaily.tenantId, tenantId),
          sql`${analyticsDaily.channel} IS NOT NULL`,
          gte(analyticsDaily.date, start.toISOString().split('T')[0]),
          lte(analyticsDaily.date, end.toISOString().split('T')[0]),
        )
      )
      .groupBy(analyticsDaily.channel)
      .orderBy(sql`sum(${analyticsDaily.totalConversations}) desc`)

    if (dailyRows.length > 0) {
      const grandTotal = dailyRows.reduce((acc, r) => acc + (r.totalConversations ?? 0), 0)
      return reply.send({
        period: { startDate: start.toISOString(), endDate: end.toISOString() },
        total: grandTotal,
        data: dailyRows.map((r) => ({
          channel: r.channel,
          totalConversations: r.totalConversations ?? 0,
          resolvedConversations: r.resolvedConversations ?? 0,
          aiResolved: r.aiResolved ?? 0,
          totalMessages: r.totalMessages ?? 0,
          share: grandTotal > 0 ? Number((((r.totalConversations ?? 0) / grandTotal) * 100).toFixed(2)) : 0,
          source: 'analytics_daily',
        })),
      })
    }

    // Fallback: live query
    const rows = await db
      .select({
        channel: conversations.channel,
        totalConversations: count(),
        resolved: sql<number>`cast(count(*) filter (where ${conversations.status} in ('resolved','closed')) as integer)`,
        aiResolved: sql<number>`cast(count(*) filter (where ${conversations.aiHandled} = true) as integer)`,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          gte(conversations.createdAt, start),
          lte(conversations.createdAt, end),
        )
      )
      .groupBy(conversations.channel)
      .orderBy(sql`count(*) desc`)

    const grandTotal = rows.reduce((acc, r) => acc + r.totalConversations, 0)

    return reply.send({
      period: { startDate: start.toISOString(), endDate: end.toISOString() },
      total: grandTotal,
      data: rows.map((r) => ({
        channel: r.channel,
        totalConversations: r.totalConversations,
        resolvedConversations: r.resolved,
        aiResolved: r.aiResolved,
        totalMessages: null,
        share: grandTotal > 0 ? Number(((r.totalConversations / grandTotal) * 100).toFixed(2)) : 0,
        source: 'live',
      })),
    })
  })

  // ─── GET /analytics/top-intents ───────────────────────────────────────────
  // Aggregate from conversations.primaryIntent, with per-intent message-level
  // detail from messages.aiIntent as a secondary source.
  app.get('/top-intents', async (req, reply) => {
    const tenantId = req.tenant.id
    const { start, end } = parseDateRange(req.query as Record<string, unknown>)
    const { limit = 10 } = req.query as { limit?: number }
    const topN = Math.min(Number(limit) || 10, 50)

    // Primary source: conversations.primaryIntent
    const convIntents = await db
      .select({
        intent: conversations.primaryIntent,
        total: count(),
        resolved: sql<number>`cast(count(*) filter (where ${conversations.status} in ('resolved','closed')) as integer)`,
        aiHandled: sql<number>`cast(count(*) filter (where ${conversations.aiHandled} = true) as integer)`,
        avgCsat: avg(conversations.csatScore).mapWith(Number),
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          sql`${conversations.primaryIntent} IS NOT NULL`,
          gte(conversations.createdAt, start),
          lte(conversations.createdAt, end),
        )
      )
      .groupBy(conversations.primaryIntent)
      .orderBy(sql`count(*) desc`)
      .limit(topN)

    // Secondary source: messages.aiIntent (for finer-grain intent signals)
    const msgIntents = await db
      .select({
        intent: messages.aiIntent,
        total: count(),
      })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          sql`${messages.aiIntent} IS NOT NULL`,
          gte(messages.createdAt, start),
          lte(messages.createdAt, end),
        )
      )
      .groupBy(messages.aiIntent)
      .orderBy(sql`count(*) desc`)
      .limit(topN)

    const grandTotal = convIntents.reduce((acc, r) => acc + r.total, 0)

    return reply.send({
      period: { startDate: start.toISOString(), endDate: end.toISOString() },
      topN,
      data: convIntents.map((r) => ({
        intent: r.intent,
        conversationCount: r.total,
        resolvedCount: r.resolved,
        aiHandledCount: r.aiHandled,
        avgCsatScore: r.avgCsat ?? null,
        share: grandTotal > 0 ? Number(((r.total / grandTotal) * 100).toFixed(2)) : 0,
      })),
      messageIntents: msgIntents.map((r) => ({
        intent: r.intent,
        messageCount: r.total,
      })),
    })
  })
}
