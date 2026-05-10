import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { defineAuthedHandler, parseQuery } from '../../apps/api/src/lib/handler'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'
import { auditRead } from '../../apps/api/src/services/audit'
import { ValidationError } from '../../apps/api/src/lib/errors'
import type {
  TimeseriesInterval,
  TimeseriesMetric,
  TimeseriesPoint,
  TimeseriesResponse,
} from '@sahay/shared'

/**
 * GET /api/analytics/timeseries
 *
 * Returns aggregated counts bucketed by `interval` ∈ {hour, day, week}.
 * - metric=conversations: COUNT(conversations) by created_at
 * - metric=resolutions:   COUNT(conversations) by resolved_at where resolved
 * - metric=messages:      COUNT(messages) by created_at where sender ∈ agent|ai
 * - metric=csat:          AVG(csat_score) by csat_submitted_at
 *
 * Capped at 365 buckets — caller picks a coarser interval for longer ranges.
 */

const querySchema = z
  .object({
    metric: z.enum(['conversations', 'resolutions', 'messages', 'csat']),
    interval: z.enum(['hour', 'day', 'week']).default('day'),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
  })
  .refine(
    (q) =>
      !q.dateFrom || !q.dateTo || new Date(q.dateFrom) <= new Date(q.dateTo),
    { message: 'dateFrom must be <= dateTo' },
  )

const MAX_BUCKETS = 365

function resolveRange(q: z.infer<typeof querySchema>): { from: Date; to: Date } {
  if (q.dateFrom && q.dateTo) {
    return { from: new Date(q.dateFrom), to: new Date(q.dateTo) }
  }
  const to = new Date()
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from, to }
}

function maxBucketsExceeded(
  from: Date,
  to: Date,
  interval: TimeseriesInterval,
): boolean {
  const ms = to.getTime() - from.getTime()
  const bucketMs =
    interval === 'hour'
      ? 60 * 60 * 1000
      : interval === 'day'
        ? 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000
  return Math.ceil(ms / bucketMs) > MAX_BUCKETS
}

interface BucketRow {
  bucket: string | Date
  value: number | string | null
}

function buildSql(
  metric: TimeseriesMetric,
  interval: TimeseriesInterval,
  tenantId: string,
  from: Date,
  to: Date,
) {
  // date_trunc takes a string literal — we're guarded by the zod enum.
  const trunc =
    interval === 'hour' ? 'hour' : interval === 'week' ? 'week' : 'day'

  if (metric === 'conversations') {
    return sql`
      SELECT
        date_trunc(${trunc}, created_at) AS bucket,
        CAST(COUNT(*) AS integer)        AS value
      FROM conversations
      WHERE tenant_id = ${tenantId}
        AND created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT ${MAX_BUCKETS}
    `
  }
  if (metric === 'resolutions') {
    return sql`
      SELECT
        date_trunc(${trunc}, resolved_at) AS bucket,
        CAST(COUNT(*) AS integer)         AS value
      FROM conversations
      WHERE tenant_id = ${tenantId}
        AND resolved_at IS NOT NULL
        AND resolved_at >= ${from}
        AND resolved_at <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT ${MAX_BUCKETS}
    `
  }
  if (metric === 'messages') {
    return sql`
      SELECT
        date_trunc(${trunc}, created_at) AS bucket,
        CAST(COUNT(*) AS integer)        AS value
      FROM messages
      WHERE tenant_id = ${tenantId}
        AND sender_type IN ('agent', 'ai')
        AND created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT ${MAX_BUCKETS}
    `
  }
  // csat
  return sql`
    SELECT
      date_trunc(${trunc}, csat_submitted_at) AS bucket,
      AVG(csat_score)                         AS value
    FROM conversations
    WHERE tenant_id = ${tenantId}
      AND csat_score IS NOT NULL
      AND csat_submitted_at IS NOT NULL
      AND csat_submitted_at >= ${from}
      AND csat_submitted_at <= ${to}
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT ${MAX_BUCKETS}
  `
}

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)

    const q = parseQuery(querySchema, req.query)
    const { from, to } = resolveRange(q)

    if (maxBucketsExceeded(from, to, q.interval)) {
      throw new ValidationError(
        `Range exceeds ${MAX_BUCKETS} buckets at ${q.interval} interval. Pick a coarser interval or shorter range.`,
      )
    }

    const tenantId = ctx.tenant.id

    const rows = await ctx.withTenant(async (tx) => {
      const result = (await tx.execute(
        buildSql(q.metric, q.interval, tenantId, from, to),
      )) as unknown as BucketRow[]
      return result
    })

    const points: TimeseriesPoint[] = rows.map((r) => {
      const ts =
        r.bucket instanceof Date ? r.bucket.toISOString() : new Date(r.bucket).toISOString()
      const raw = r.value === null || r.value === undefined ? 0 : Number(r.value)
      // CSAT we round to 2dp; counts are already integers.
      const value = q.metric === 'csat' ? Math.round(raw * 100) / 100 : raw
      return { ts, value }
    })

    void auditRead({
      tenantId,
      actorId: ctx.agent.id,
      actorEmail: ctx.agent.email,
      resourceType: 'analytics_timeseries',
      query: {
        metric: q.metric,
        interval: q.interval,
        hasDateRange: !!(q.dateFrom && q.dateTo),
        bucketCount: points.length,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    const body: TimeseriesResponse = {
      metric: q.metric,
      interval: q.interval,
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      points,
    }
    res.status(200).json(body)
  },
  { methods: ['GET'] },
)
