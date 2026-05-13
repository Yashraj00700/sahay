import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  analyticsDaily,
  conversations,
  messages,
  withTenant,
  withSystemBypass,
} from "@sahay/db";
import { inngest } from "../../client";

/**
 * cron/analytics-rollup
 *
 * Runs hourly. Aggregates per-tenant metrics for the current day into
 * the `analytics_daily` table (upsert by (tenantId, date, channel=null)).
 * The schema only has a daily grain — we re-aggregate the day's totals
 * each hour so the dashboard always sees fresh numbers without needing a
 * separate hourly table.
 */
export const analyticsRollup = inngest.createFunction(
  { id: "cron-analytics-rollup", retries: 1 },
  { cron: "0 * * * *" },
  async ({ step, logger }) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    // Find every tenant that has either a conversation OR a message today.
    // Cross-tenant aggregation — uses the un-scoped connection.
    const activeTenants = await step.run("list-active-tenants", async () =>
      withSystemBypass(async () => {
        const rows = await db
          .selectDistinct({ tenantId: conversations.tenantId })
          .from(conversations)
          .where(gte(conversations.createdAt, today));
        return rows.map((r) => r.tenantId);
      }),
    );

    let upserts = 0;
    for (const tenantId of activeTenants) {
      await step.run(`rollup-${tenantId}`, async () =>
        withTenant(tenantId, async (tx) => {
          const totalsRow = await tx
            .select({
              total: sql<number>`COUNT(*)::int`,
              resolved: sql<number>`COUNT(*) FILTER (WHERE ${conversations.status} IN ('resolved','closed'))::int`,
              aiHandled: sql<number>`COUNT(*) FILTER (WHERE ${conversations.aiHandled} = true)::int`,
              escalated: sql<number>`COUNT(*) FILTER (WHERE ${conversations.routingDecision} LIKE 'route_to_%')::int`,
            })
            .from(conversations)
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                gte(conversations.createdAt, today),
              ),
            );
          const totals = totalsRow[0] ?? {
            total: 0,
            resolved: 0,
            aiHandled: 0,
            escalated: 0,
          };

          const messageRow = await tx
            .select({
              total: sql<number>`COUNT(*)::int`,
              ai: sql<number>`COUNT(*) FILTER (WHERE ${messages.senderType} = 'ai')::int`,
              human: sql<number>`COUNT(*) FILTER (WHERE ${messages.senderType} = 'agent')::int`,
            })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                gte(messages.createdAt, today),
              ),
            );
          const msgTotals = messageRow[0] ?? { total: 0, ai: 0, human: 0 };

          const existing = await tx.query.analyticsDaily.findFirst({
            where: sql`${analyticsDaily.tenantId} = ${tenantId}
              AND ${analyticsDaily.date} = ${todayStr}
              AND ${analyticsDaily.channel} IS NULL`,
          });

          const values = {
            tenantId,
            date: todayStr,
            channel: null,
            totalConversations: totals.total,
            resolvedConversations: totals.resolved,
            aiResolved: totals.aiHandled,
            aiEscalated: totals.escalated,
            totalMessages: msgTotals.total,
            aiMessages: msgTotals.ai,
            humanMessages: msgTotals.human,
            updatedAt: new Date(),
          };

          if (existing) {
            await tx
              .update(analyticsDaily)
              .set(values)
              .where(eq(analyticsDaily.id, existing.id));
          } else {
            await tx.insert(analyticsDaily).values(values);
          }
          upserts += 1;
        }),
      );
    }

    logger.info(
      { tenants: activeTenants.length, upserts },
      "analytics-rollup complete",
    );
    return { tenants: activeTenants.length, upserts };
  },
);
