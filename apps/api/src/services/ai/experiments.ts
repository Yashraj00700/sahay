// ─── A/B Experiments Service ─────────────────────────────────────────────────
//
// Tiny harness for picking a system-prompt variant per conversation and
// recording outcome metrics. Goals:
//
//   1. Sticky: a given (experimentKey, subjectType, subjectId) tuple is
//      assigned a variant once and keeps it forever. We rely on a unique
//      index + ON CONFLICT DO NOTHING — concurrent inserts can't double-pick.
//
//   2. Fail-soft: if anything blows up (DB down, no active experiment), the
//      caller receives `null` and falls back to the default code path. We
//      NEVER throw from `recordOutcome`.
//
//   3. Tenant-scoped by default; global (`tenantId IS NULL`) experiments are
//      only used as a fallback when no tenant-specific experiment with the
//      same key is active.

import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  experiments,
  experimentAssignments,
  experimentOutcomes,
  withSystemBypass,
  withTenant,
  type ExperimentVariant,
} from "@sahay/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VariantSelection {
  /** UUID of experiment_assignments row — pass this to recordOutcome. */
  assignmentId: string;
  /** UUID of the matched experiment row. */
  experimentId: string;
  variantName: string;
  config: Record<string, unknown>;
}

export type SubjectType = "conversation" | "customer" | "tenant";

export interface GetVariantArgs {
  experimentKey: string;
  /** Tenant scope. May be null/undefined for global experiments. */
  tenantId?: string | null;
  subjectType: SubjectType;
  subjectId: string;
}

export interface RecordOutcomeArgs {
  assignmentId: string;
  metric: "csat" | "resolved" | "escalated" | "turn_count";
  value: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Weighted random pick. Sums all (positive) weights, draws a uniform random
 * value in [0, sum), and walks the list. NOT cryptographic — Math.random is
 * fine for traffic-splitting; we don't need unpredictability.
 */
export function pickWeightedVariant(
  variants: ReadonlyArray<ExperimentVariant>,
  rng: () => number = Math.random,
): ExperimentVariant | null {
  if (variants.length === 0) return null;

  let totalWeight = 0;
  for (const v of variants) {
    if (v.weight > 0) totalWeight += v.weight;
  }
  if (totalWeight <= 0) return null;

  const target = rng() * totalWeight;
  let cumulative = 0;
  for (const v of variants) {
    if (v.weight <= 0) continue;
    cumulative += v.weight;
    if (target < cumulative) return v;
  }
  // Fallback for floating-point edge cases — return the last positive-weight
  // variant we saw.
  for (let i = variants.length - 1; i >= 0; i--) {
    if (variants[i].weight > 0) return variants[i];
  }
  return null;
}

/**
 * Look up the active experiment to use for a given key + tenant. We prefer a
 * tenant-scoped experiment; otherwise fall back to a global one (tenantId
 * IS NULL). Returns null if neither exists.
 */
async function loadActiveExperiment(
  experimentKey: string,
  tenantId: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: any,
): Promise<{
  id: string;
  tenantId: string | null;
  variants: ExperimentVariant[];
} | null> {
  const now = new Date();

  const tenantCondition = tenantId
    ? or(eq(experiments.tenantId, tenantId), isNull(experiments.tenantId))
    : isNull(experiments.tenantId);

  const rows = await conn
    .select({
      id: experiments.id,
      tenantId: experiments.tenantId,
      variants: experiments.variants,
      startsAt: experiments.startsAt,
      endsAt: experiments.endsAt,
    })
    .from(experiments)
    .where(
      and(
        eq(experiments.key, experimentKey),
        eq(experiments.isActive, true),
        tenantCondition,
      ),
    );

  if (rows.length === 0) return null;

  // Filter by time window.
  const live = rows.filter(
    (r: { startsAt: Date | null; endsAt: Date | null }) => {
      if (r.startsAt && r.startsAt.getTime() > now.getTime()) return false;
      if (r.endsAt && r.endsAt.getTime() < now.getTime()) return false;
      return true;
    },
  );
  if (live.length === 0) return null;

  // Tenant-scoped wins over global.
  const tenantScoped = live.find(
    (r: { tenantId: string | null }) => r.tenantId !== null,
  );
  const chosen = tenantScoped ?? live[0];

  return {
    id: chosen.id as string,
    tenantId: chosen.tenantId as string | null,
    variants: (chosen.variants as ExperimentVariant[]) ?? [],
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up an existing assignment without creating one. Useful when callers
 * have already passed the AI pipeline and just want to know which variant a
 * subject was on (e.g. recording a delayed CSAT).
 */
export async function findAssignment(args: GetVariantArgs): Promise<{
  assignmentId: string;
  experimentId: string;
  variantName: string;
  config: Record<string, unknown>;
} | null> {
  const { experimentKey, tenantId, subjectType, subjectId } = args;

  const runner = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
  ): Promise<{
    assignmentId: string;
    experimentId: string;
    variantName: string;
    config: Record<string, unknown>;
  } | null> => {
    const exp = await loadActiveExperiment(experimentKey, tenantId, conn);
    if (!exp) return null;

    const rows = await conn
      .select({
        id: experimentAssignments.id,
        variant: experimentAssignments.variant,
      })
      .from(experimentAssignments)
      .where(
        and(
          eq(experimentAssignments.experimentId, exp.id),
          eq(experimentAssignments.subjectType, subjectType),
          eq(experimentAssignments.subjectId, subjectId),
        ),
      )
      .limit(1);

    const existing = rows[0];
    if (!existing) return null;

    const matched = exp.variants.find((v) => v.name === existing.variant);
    return {
      assignmentId: existing.id as string,
      experimentId: exp.id,
      variantName: existing.variant as string,
      config: matched?.config ?? {},
    };
  };

  try {
    if (tenantId) {
      return await withTenant(tenantId, runner);
    }
    return await withSystemBypass(() => runner(db));
  } catch (err) {
    console.error("[experiments] findAssignment failed:", err);
    return null;
  }
}

/**
 * Pick a variant for a subject. Sticky: repeated calls with the same
 * (experimentKey, subjectType, subjectId) return the same variant.
 *
 * Returns null when:
 *   - no active experiment matches the key
 *   - all variants have non-positive weights
 *   - the DB call fails (we never let an experiment lookup take down a
 *     conversation — caller falls back to default behaviour)
 */
export async function getVariant(
  args: GetVariantArgs,
): Promise<VariantSelection | null> {
  const { experimentKey, tenantId, subjectType, subjectId } = args;

  const runner = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
  ): Promise<VariantSelection | null> => {
    const exp = await loadActiveExperiment(experimentKey, tenantId, conn);
    if (!exp) return null;

    // 1. Sticky: existing assignment wins.
    const existingRows = await conn
      .select({
        id: experimentAssignments.id,
        variant: experimentAssignments.variant,
      })
      .from(experimentAssignments)
      .where(
        and(
          eq(experimentAssignments.experimentId, exp.id),
          eq(experimentAssignments.subjectType, subjectType),
          eq(experimentAssignments.subjectId, subjectId),
        ),
      )
      .limit(1);

    if (existingRows[0]) {
      const matched = exp.variants.find(
        (v) => v.name === existingRows[0].variant,
      );
      if (!matched) {
        // Variant was renamed/removed since assignment. Honour the historical
        // assignment (sticky) but return an empty config so callers fall back.
        return {
          assignmentId: existingRows[0].id as string,
          experimentId: exp.id,
          variantName: existingRows[0].variant as string,
          config: {},
        };
      }
      return {
        assignmentId: existingRows[0].id as string,
        experimentId: exp.id,
        variantName: matched.name,
        config: matched.config,
      };
    }

    // 2. Pick a variant by weight.
    const picked = pickWeightedVariant(exp.variants);
    if (!picked) return null;

    // 3. Insert; ON CONFLICT DO NOTHING handles concurrent assignment.
    const inserted = await conn
      .insert(experimentAssignments)
      .values({
        experimentId: exp.id,
        tenantId: exp.tenantId,
        subjectType,
        subjectId,
        variant: picked.name,
      })
      .onConflictDoNothing({
        target: [
          experimentAssignments.experimentId,
          experimentAssignments.subjectType,
          experimentAssignments.subjectId,
        ],
      })
      .returning({
        id: experimentAssignments.id,
        variant: experimentAssignments.variant,
      });

    if (inserted[0]) {
      return {
        assignmentId: inserted[0].id as string,
        experimentId: exp.id,
        variantName: inserted[0].variant as string,
        config: picked.config,
      };
    }

    // 4. Conflict: someone else just inserted — re-read.
    const reread = await conn
      .select({
        id: experimentAssignments.id,
        variant: experimentAssignments.variant,
      })
      .from(experimentAssignments)
      .where(
        and(
          eq(experimentAssignments.experimentId, exp.id),
          eq(experimentAssignments.subjectType, subjectType),
          eq(experimentAssignments.subjectId, subjectId),
        ),
      )
      .limit(1);

    if (!reread[0]) return null;
    const matched = exp.variants.find((v) => v.name === reread[0].variant);
    return {
      assignmentId: reread[0].id as string,
      experimentId: exp.id,
      variantName: reread[0].variant as string,
      config: matched?.config ?? {},
    };
  };

  try {
    if (tenantId) {
      return await withTenant(tenantId, runner);
    }
    return await withSystemBypass(() => runner(db));
  } catch (err) {
    console.error("[experiments] getVariant failed:", err);
    return null;
  }
}

/**
 * Append an outcome row. Fire-and-forget — never throws, never blocks.
 *
 * Callers MAY `await` it for ordering, but the contract is that any failure
 * is logged and swallowed. We deliberately don't take a `tenantId` here
 * because outcomes are write-only and pinned to an assignment row by FK.
 */
export async function recordOutcome(args: RecordOutcomeArgs): Promise<void> {
  try {
    if (!Number.isFinite(args.value)) {
      console.error("[experiments] recordOutcome: non-finite value", args);
      return;
    }
    // Drizzle numeric columns expect strings.
    const valueStr = args.value.toFixed(4);

    await withSystemBypass(() =>
      db
        .insert(experimentOutcomes)
        .values({
          assignmentId: args.assignmentId,
          metric: args.metric,
          value: valueStr,
        })
        .then(() => undefined),
    );
  } catch (err) {
    // NEVER re-throw. Outcomes are best-effort; the AI pipeline must not
    // fail because metrics couldn't be recorded.
    console.error("[experiments] recordOutcome failed (suppressed):", err);
  }
}

// Side-effect free helper exported for tests + admin endpoint validation.
export function normaliseVariants(
  raw: unknown,
): { ok: true; variants: ExperimentVariant[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw))
    return { ok: false, reason: "variants must be an array" };
  const out: ExperimentVariant[] = [];
  let totalWeight = 0;
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object")
      return { ok: false, reason: "variant must be an object" };
    const v = item as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!name) return { ok: false, reason: "variant.name is required" };
    if (seen.has(name))
      return { ok: false, reason: `duplicate variant name: ${name}` };
    seen.add(name);
    const weight = typeof v.weight === "number" ? v.weight : Number(v.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      return {
        ok: false,
        reason: `variant.weight must be a non-negative number (got ${String(v.weight)})`,
      };
    }
    totalWeight += weight;
    const config =
      v.config && typeof v.config === "object" && !Array.isArray(v.config)
        ? (v.config as Record<string, unknown>)
        : {};
    out.push({ name, weight, config });
  }
  if (totalWeight <= 0)
    return { ok: false, reason: "sum of variant weights must be > 0" };
  return { ok: true, variants: out };
}

// Re-export the variant type for consumer convenience.
export type { ExperimentVariant };
