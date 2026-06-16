import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  defineAuthedHandler,
  parseQuery,
} from "../../apps/api/src/lib/handler";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";
import { auditRead } from "../../apps/api/src/services/audit";
import type { AnalyticsOverview, Channel } from "@sahay/shared";

/**
 * GET /api/analytics/overview
 *
 * Real aggregation over the conversations + messages tables, scoped to the
 * authed tenant via ctx.withTenant (RLS) plus an explicit
 * `WHERE tenant_id = ctx.tenant.id` clause for defense in depth.
 *
 * Accepts either:
 *   - `period` ∈ {1d, 7d, 30d} (kept for backwards compat with DashboardPage)
 *   - `dateFrom` / `dateTo` ISO timestamps
 *
 * If both are supplied, dateFrom/dateTo win.
 */

const querySchema = z
  .object({
    period: z.enum(["1d", "7d", "30d"]).default("30d"),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
  })
  .refine(
    (q) =>
      !q.dateFrom || !q.dateTo || new Date(q.dateFrom) <= new Date(q.dateTo),
    { message: "dateFrom must be <= dateTo" },
  );

const CHANNELS: ReadonlyArray<Channel> = [
  "whatsapp",
  "instagram",
  "webchat",
  "email",
];

function resolveRange(q: z.infer<typeof querySchema>): {
  from: Date;
  to: Date;
} {
  if (q.dateFrom && q.dateTo) {
    return { from: new Date(q.dateFrom), to: new Date(q.dateTo) };
  }
  const days = q.period === "1d" ? 1 : q.period === "7d" ? 7 : 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

interface AggRow {
  total_conversations: number;
  new_conversations: number;
  resolved_conversations: number;
  ai_resolved: number;
  avg_first_response_seconds: number | null;
  avg_resolution_seconds: number | null;
  avg_csat: number | null;
  csat_responses: number;
  cod_conversions: number;
  cod_conversion_revenue: number | null;
  total_messages: number;
}

interface ChannelRow {
  channel: string;
  count: number;
}

interface IntentRow {
  primary_intent: string | null;
  count: number;
}

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id);

    const q = parseQuery(querySchema, req.query);
    const { from, to } = resolveRange(q);
    const period = q.period;
    const tenantId = ctx.tenant.id;

    // Previous period of equal length for trend deltas.
    const lengthMs = to.getTime() - from.getTime();
    const prevTo = from;
    const prevFrom = new Date(from.getTime() - lengthMs);

    const result = await ctx.withTenant(async (tx) => {
      // ── Current-window aggregates (single row) ──────────────────────
      const aggRows = (await tx.execute(sql`
        SELECT
          CAST(COUNT(*) AS integer)                               AS total_conversations,
          CAST(COUNT(*) FILTER (WHERE created_at >= ${from})
            AS integer)                                           AS new_conversations,
          CAST(COUNT(*) FILTER (
            WHERE status = 'resolved' OR resolved_at IS NOT NULL
          ) AS integer)                                           AS resolved_conversations,
          CAST(COUNT(*) FILTER (
            WHERE human_touched = false AND ai_handled = true
              AND (status = 'resolved' OR resolved_at IS NOT NULL)
          ) AS integer)                                           AS ai_resolved,
          AVG(EXTRACT(EPOCH FROM (first_reply_at - created_at)))
            FILTER (WHERE first_reply_at IS NOT NULL)             AS avg_first_response_seconds,
          AVG(
            COALESCE(
              resolution_time_seconds,
              EXTRACT(EPOCH FROM (resolved_at - created_at))
            )
          ) FILTER (WHERE resolved_at IS NOT NULL)                AS avg_resolution_seconds,
          AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL)   AS avg_csat,
          CAST(COUNT(*) FILTER (WHERE csat_score IS NOT NULL)
            AS integer)                                           AS csat_responses,
          CAST(COUNT(*) FILTER (WHERE cod_conversion_accepted = true)
            AS integer)                                           AS cod_conversions,
          COALESCE(SUM(cod_conversion_revenue)
            FILTER (WHERE cod_conversion_accepted = true), 0)     AS cod_conversion_revenue,
          0                                                       AS total_messages
        FROM conversations
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${from}
          AND created_at <= ${to}
      `)) as unknown as AggRow[];

      const agg: AggRow = aggRows[0] ?? {
        total_conversations: 0,
        new_conversations: 0,
        resolved_conversations: 0,
        ai_resolved: 0,
        avg_first_response_seconds: null,
        avg_resolution_seconds: null,
        avg_csat: null,
        csat_responses: 0,
        cod_conversions: 0,
        cod_conversion_revenue: null,
        total_messages: 0,
      };

      // ── Total messages sent (agent + AI) in the window ──────────────
      const msgRows = (await tx.execute(sql`
        SELECT CAST(COUNT(*) AS integer) AS total_messages
        FROM messages
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${from}
          AND created_at <= ${to}
          AND sender_type IN ('agent', 'ai')
      `)) as unknown as Array<{ total_messages: number }>;
      const totalMessages = msgRows[0]?.total_messages ?? 0;

      // ── Per-channel breakdown ───────────────────────────────────────
      const channelRows = (await tx.execute(sql`
        SELECT channel, CAST(COUNT(*) AS integer) AS count
        FROM conversations
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${from}
          AND created_at <= ${to}
        GROUP BY channel
      `)) as unknown as ChannelRow[];

      // ── Top intent (mode) ───────────────────────────────────────────
      const intentRows = (await tx.execute(sql`
        SELECT primary_intent, CAST(COUNT(*) AS integer) AS count
        FROM conversations
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${from}
          AND created_at <= ${to}
          AND primary_intent IS NOT NULL
        GROUP BY primary_intent
        ORDER BY count DESC
        LIMIT 1
      `)) as unknown as IntentRow[];

      // ── Previous-period totals for deltas (cheap; only what we need) ─
      const prevRows = (await tx.execute(sql`
        SELECT
          CAST(COUNT(*) AS integer)                               AS total_conversations,
          CAST(COUNT(*) FILTER (
            WHERE human_touched = false AND ai_handled = true
              AND (status = 'resolved' OR resolved_at IS NOT NULL)
          ) AS integer)                                           AS ai_resolved,
          AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL)   AS avg_csat
        FROM conversations
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${prevFrom}
          AND created_at < ${prevTo}
      `)) as unknown as Array<{
        total_conversations: number;
        ai_resolved: number;
        avg_csat: number | null;
      }>;
      const prev = prevRows[0] ?? {
        total_conversations: 0,
        ai_resolved: 0,
        avg_csat: null,
      };

      return { agg, totalMessages, channelRows, intentRows, prev };
    });

    const { agg, totalMessages, channelRows, intentRows, prev } = result;

    const channelBreakdown: Record<Channel, number> = {
      whatsapp: 0,
      instagram: 0,
      webchat: 0,
      email: 0,
    };
    for (const row of channelRows) {
      if ((CHANNELS as ReadonlyArray<string>).includes(row.channel)) {
        channelBreakdown[row.channel as Channel] = Number(row.count) || 0;
      }
    }

    const totalConversations = Number(agg.total_conversations) || 0;
    const resolved = Number(agg.resolved_conversations) || 0;
    const aiResolved = Number(agg.ai_resolved) || 0;

    const aiResolutionRate =
      totalConversations > 0 ? (aiResolved / totalConversations) * 100 : 0;
    const resolvedRate =
      totalConversations > 0 ? (resolved / totalConversations) * 100 : 0;

    // Trend deltas (% change vs previous period)
    const conversationsDelta =
      prev.total_conversations > 0
        ? ((totalConversations - prev.total_conversations) /
            prev.total_conversations) *
          100
        : 0;
    const prevAiRate =
      prev.total_conversations > 0
        ? (prev.ai_resolved / prev.total_conversations) * 100
        : 0;
    const aiResolutionDelta = aiResolutionRate - prevAiRate;
    const csatDelta =
      prev.avg_csat !== null && agg.avg_csat !== null
        ? Number(agg.avg_csat) - Number(prev.avg_csat)
        : null;

    const overview: AnalyticsOverview = {
      period,
      totalConversations,
      newConversations: Number(agg.new_conversations) || 0,
      resolvedConversations: resolved,
      resolvedRate: Math.round(resolvedRate * 10) / 10,
      aiResolved,
      aiResolutionRate: Math.round(aiResolutionRate * 10) / 10,
      avgFirstResponseSeconds: Math.round(
        Number(agg.avg_first_response_seconds) || 0,
      ),
      avgResolutionSeconds: Math.round(Number(agg.avg_resolution_seconds) || 0),
      avgCsat:
        agg.avg_csat !== null && agg.avg_csat !== undefined
          ? Math.round(Number(agg.avg_csat) * 10) / 10
          : null,
      csatResponses: Number(agg.csat_responses) || 0,
      totalMessages,
      topIntent: intentRows[0]?.primary_intent ?? null,
      codConversions: Number(agg.cod_conversions) || 0,
      codConversionRevenue: Math.round(Number(agg.cod_conversion_revenue) || 0),
      channelBreakdown,
      trends: {
        conversationsDelta: Math.round(conversationsDelta * 10) / 10,
        aiResolutionDelta: Math.round(aiResolutionDelta * 10) / 10,
        csatDelta:
          csatDelta !== null ? Math.round(csatDelta * 100) / 100 : null,
      },
    };

    void auditRead({
      tenantId,
      actorId: ctx.agent.id,
      actorEmail: ctx.agent.email,
      resourceType: "analytics_overview",
      query: { period, hasDateRange: !!(q.dateFrom && q.dateTo) },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    res.status(200).json(overview);
  },
  { methods: ["GET"] },
);
