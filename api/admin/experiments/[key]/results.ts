// ─── Admin: Experiment Results (Vercel Function) ────────────────────────────
// GET /api/admin/experiments/:key/results — aggregated outcomes per variant.
//
// For each variant we return:
//   - n           : assignment count
//   - csatMean    : mean csat across recorded outcomes (null if none)
//   - escalatedRate: ratio of escalations to assignments (0..1)
//   - turnCountMean: mean turn_count across recorded outcomes
//
// Cross-tenant (global) experiments are visible to super_admin only — admins
// only see their own tenant's row.

import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  experiments,
  experimentAssignments,
  experimentOutcomes,
  type ExperimentVariant,
} from "@sahay/db";
import {
  defineAuthedHandler,
  requireRole,
} from "../../../../apps/api/src/lib/handler";
import { enforce, limits } from "../../../../apps/api/src/lib/rate-limit";
import { AppError } from "../../../../apps/api/src/lib/errors";

interface VariantResult {
  variant: string;
  n: number;
  csatMean: number | null;
  escalatedRate: number;
  turnCountMean: number;
}

interface AggregateRow {
  variant: string;
  assignmentCount: number;
  csatSum: number | null;
  csatCount: number;
  escalatedSum: number;
  turnCountSum: number | null;
  turnCountCount: number;
}

export default defineAuthedHandler(
  async (req, res, ctx) => {
    requireRole(ctx, ["super_admin", "admin"]);
    await enforce(limits.perTenant(), ctx.tenant.id);

    const key =
      typeof req.query.key === "string"
        ? req.query.key
        : Array.isArray(req.query.key)
          ? req.query.key[0]
          : null;
    if (!key)
      throw new AppError("VALIDATION_ERROR", "Missing experiment key", 400);

    // Find the experiment. Tenant-scoped first, then global if super_admin.
    const expRows = await ctx.withTenant((tx) =>
      tx
        .select()
        .from(experiments)
        .where(
          and(
            eq(experiments.key, key),
            ctx.agent.role === "super_admin"
              ? or(
                  eq(experiments.tenantId, ctx.tenant.id),
                  isNull(experiments.tenantId),
                )
              : eq(experiments.tenantId, ctx.tenant.id),
          ),
        )
        .limit(1),
    );

    const exp = expRows[0];
    if (!exp) throw new AppError("NOT_FOUND", "Experiment not found", 404);

    // Pull aggregates in one trip:
    //   - count(*) per variant for assignment count
    //   - SUM/COUNT for each metric we care about, grouped by variant
    const aggRowsRaw = await ctx.withTenant((tx) =>
      tx.execute(sql`
        SELECT
          a.variant AS variant,
          COUNT(DISTINCT a.id)::int AS assignment_count,
          SUM(CASE WHEN o.metric = 'csat' THEN o.value::numeric ELSE 0 END) AS csat_sum,
          COUNT(*) FILTER (WHERE o.metric = 'csat')::int AS csat_count,
          COUNT(*) FILTER (WHERE o.metric = 'escalated' AND o.value::numeric > 0)::int AS escalated_sum,
          SUM(CASE WHEN o.metric = 'turn_count' THEN o.value::numeric ELSE 0 END) AS turn_count_sum,
          COUNT(*) FILTER (WHERE o.metric = 'turn_count')::int AS turn_count_count
        FROM ${experimentAssignments} a
        LEFT JOIN ${experimentOutcomes} o ON o.assignment_id = a.id
        WHERE a.experiment_id = ${exp.id}
        GROUP BY a.variant
      `),
    );

    // drizzle's `.execute` returns differently shaped objects depending on
    // driver; normalise to plain row records.
    const rows =
      (aggRowsRaw as unknown as { rows?: Record<string, unknown>[] }).rows ??
      (aggRowsRaw as unknown as Record<string, unknown>[]);

    const aggByVariant = new Map<string, AggregateRow>();
    for (const r of rows) {
      const variant = String(r.variant);
      aggByVariant.set(variant, {
        variant,
        assignmentCount: Number(r.assignment_count ?? 0),
        csatSum: r.csat_sum != null ? Number(r.csat_sum) : null,
        csatCount: Number(r.csat_count ?? 0),
        escalatedSum: Number(r.escalated_sum ?? 0),
        turnCountSum:
          r.turn_count_sum != null ? Number(r.turn_count_sum) : null,
        turnCountCount: Number(r.turn_count_count ?? 0),
      });
    }

    // Build the response: one row per defined variant (so a variant with
    // zero assignments still appears with n=0).
    const variants = (exp.variants ?? []) as ExperimentVariant[];
    const results: VariantResult[] = variants.map((v) => {
      const agg = aggByVariant.get(v.name);
      const n = agg?.assignmentCount ?? 0;
      const csatMean =
        agg && agg.csatCount > 0 && agg.csatSum != null
          ? agg.csatSum / agg.csatCount
          : null;
      const escalatedRate = n > 0 ? (agg?.escalatedSum ?? 0) / n : 0;
      const turnCountMean =
        agg && agg.turnCountCount > 0 && agg.turnCountSum != null
          ? agg.turnCountSum / agg.turnCountCount
          : 0;
      return {
        variant: v.name,
        n,
        csatMean,
        escalatedRate,
        turnCountMean,
      };
    });

    // Include any "orphan" variants present in assignments but missing from
    // the current variants list (e.g. variant was renamed/removed) — ensures
    // historical traffic is still accounted for.
    for (const [name, agg] of aggByVariant.entries()) {
      if (!variants.some((v) => v.name === name)) {
        results.push({
          variant: name,
          n: agg.assignmentCount,
          csatMean:
            agg.csatCount > 0 && agg.csatSum != null
              ? agg.csatSum / agg.csatCount
              : null,
          escalatedRate:
            agg.assignmentCount > 0
              ? agg.escalatedSum / agg.assignmentCount
              : 0,
          turnCountMean:
            agg.turnCountCount > 0 && agg.turnCountSum != null
              ? agg.turnCountSum / agg.turnCountCount
              : 0,
        });
      }
    }

    res.status(200).json({
      experiment: {
        id: exp.id,
        key: exp.key,
        tenantId: exp.tenantId,
        isActive: exp.isActive ?? false,
      },
      results,
    });
  },
  { methods: ["GET"] },
);
