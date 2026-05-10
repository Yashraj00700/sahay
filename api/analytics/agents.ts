import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { defineAuthedHandler, parseQuery } from '../../apps/api/src/lib/handler'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'
import { auditRead } from '../../apps/api/src/services/audit'
import type { AgentMetric, AgentRole } from '@sahay/shared'

/**
 * GET /api/analytics/agents
 *
 * Per-agent performance metrics scoped to the authed tenant.
 * Includes only active agents (or just one when `agentId` is supplied).
 */

const querySchema = z
  .object({
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    agentId: z.string().uuid().optional(),
  })
  .refine(
    (q) =>
      !q.dateFrom || !q.dateTo || new Date(q.dateFrom) <= new Date(q.dateTo),
    { message: 'dateFrom must be <= dateTo' },
  )

const VALID_ROLES: ReadonlyArray<AgentRole> = [
  'super_admin',
  'admin',
  'agent',
  'viewer',
]

interface AgentRow {
  agent_id: string
  name: string
  role: string
  conversations_handled: number
  conversations_resolved: number
  avg_response_time_sec: number | null
  avg_resolution_time_sec: number | null
  avg_csat: number | null
  csat_count: number
  turn_count_avg: number | null
  ai_assisted: number
}

function defaultRange(q: z.infer<typeof querySchema>): { from: Date; to: Date } {
  if (q.dateFrom && q.dateTo) {
    return { from: new Date(q.dateFrom), to: new Date(q.dateTo) }
  }
  const to = new Date()
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from, to }
}

function normalizeRole(role: string): AgentRole {
  return (VALID_ROLES as ReadonlyArray<string>).includes(role)
    ? (role as AgentRole)
    : 'agent'
}

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)

    const q = parseQuery(querySchema, req.query)
    const { from, to } = defaultRange(q)
    const tenantId = ctx.tenant.id

    const agentFilter = q.agentId
      ? sql`AND a.id = ${q.agentId}`
      : sql``

    const rows = await ctx.withTenant(async (tx) => {
      // Single grouped query: LEFT JOIN agents → conversations within window
      // so agents with no conversations still appear with zeroes (helpful for
      // leaderboard UX), but a missing conversation contributes 0 / NULL.
      const result = (await tx.execute(sql`
        SELECT
          a.id                                                AS agent_id,
          a.name                                              AS name,
          a.role                                              AS role,
          CAST(COUNT(c.id) AS integer)                        AS conversations_handled,
          CAST(COUNT(c.id) FILTER (
            WHERE c.status = 'resolved' OR c.resolved_at IS NOT NULL
          ) AS integer)                                       AS conversations_resolved,
          AVG(EXTRACT(EPOCH FROM (c.first_reply_at - c.created_at)))
            FILTER (WHERE c.first_reply_at IS NOT NULL)       AS avg_response_time_sec,
          AVG(
            COALESCE(
              c.resolution_time_seconds,
              EXTRACT(EPOCH FROM (c.resolved_at - c.created_at))
            )
          ) FILTER (WHERE c.resolved_at IS NOT NULL)          AS avg_resolution_time_sec,
          AVG(c.csat_score) FILTER (WHERE c.csat_score IS NOT NULL)
                                                              AS avg_csat,
          CAST(COUNT(c.id) FILTER (WHERE c.csat_score IS NOT NULL)
            AS integer)                                       AS csat_count,
          AVG(c.turn_count) FILTER (WHERE c.turn_count IS NOT NULL)
                                                              AS turn_count_avg,
          CAST(COUNT(c.id) FILTER (
            WHERE c.human_touched = true AND c.ai_handled = true
          ) AS integer)                                       AS ai_assisted
        FROM agents a
        LEFT JOIN conversations c
          ON c.assigned_to = a.id
         AND c.tenant_id = ${tenantId}
         AND c.created_at >= ${from}
         AND c.created_at <= ${to}
        WHERE a.tenant_id = ${tenantId}
          AND a.is_active = true
          ${agentFilter}
        GROUP BY a.id, a.name, a.role
        ORDER BY conversations_handled DESC, a.name ASC
        LIMIT 500
      `)) as unknown as AgentRow[]
      return result
    })

    const metrics: AgentMetric[] = rows.map((r) => {
      const handled = Number(r.conversations_handled) || 0
      const aiAssisted = Number(r.ai_assisted) || 0
      return {
        agentId: r.agent_id,
        name: r.name,
        role: normalizeRole(r.role),
        conversationsHandled: handled,
        conversationsResolved: Number(r.conversations_resolved) || 0,
        avgResponseTimeSec:
          r.avg_response_time_sec !== null && r.avg_response_time_sec !== undefined
            ? Math.round(Number(r.avg_response_time_sec))
            : null,
        avgResolutionTimeSec:
          r.avg_resolution_time_sec !== null &&
          r.avg_resolution_time_sec !== undefined
            ? Math.round(Number(r.avg_resolution_time_sec))
            : null,
        avgCsat:
          r.avg_csat !== null && r.avg_csat !== undefined
            ? Math.round(Number(r.avg_csat) * 10) / 10
            : null,
        csatCount: Number(r.csat_count) || 0,
        turnCountAvg:
          r.turn_count_avg !== null && r.turn_count_avg !== undefined
            ? Math.round(Number(r.turn_count_avg) * 10) / 10
            : null,
        aiAssistedRate:
          handled > 0 ? Math.round((aiAssisted / handled) * 1000) / 1000 : 0,
      }
    })

    void auditRead({
      tenantId,
      actorId: ctx.agent.id,
      actorEmail: ctx.agent.email,
      resourceType: 'analytics_agents',
      query: {
        scopedToOne: !!q.agentId,
        hasDateRange: !!(q.dateFrom && q.dateTo),
        resultCount: metrics.length,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    res.status(200).json({ data: metrics })
  },
  { methods: ['GET'] },
)
