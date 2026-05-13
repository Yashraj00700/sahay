// ─── Admin: Experiments (Vercel Function) ───────────────────────────────────
// GET  /api/admin/experiments — list experiments visible to the caller
//                               (tenant-scoped + global), plus a sample of
//                               recent assignments / outcomes per experiment.
// POST /api/admin/experiments — create or upsert an experiment by `key`.
//
// Auth: super_admin OR admin. Global experiments (tenantId = null) can only
// be created/edited by super_admin. Listing always includes globals — they
// affect every tenant — but only super_admin sees the "global" namespace
// admin controls.

import { z } from "zod";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  experiments,
  experimentAssignments,
  experimentOutcomes,
  type ExperimentVariant,
} from "@sahay/db";
import {
  defineAuthedHandler,
  parseBody,
  requireRole,
} from "../../../apps/api/src/lib/handler";
import { enforce, limits } from "../../../apps/api/src/lib/rate-limit";
import { auditAction } from "../../../apps/api/src/services/audit";
import { ValidationError } from "../../../apps/api/src/lib/errors";
import { normaliseVariants } from "../../../apps/api/src/services/ai/experiments";

// ─── Validation ─────────────────────────────────────────────────────────────

const VariantSchema = z.object({
  name: z.string().min(1).max(80),
  weight: z.number().nonnegative(),
  config: z.record(z.unknown()).default({}),
});

const UpsertSchema = z.object({
  key: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  variants: z.array(VariantSchema).min(1),
  isActive: z.boolean().optional().default(true),
  endsAt: z.string().datetime().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  /** super_admin only — when true, persists with tenantId = null. */
  global: z.boolean().optional().default(false),
});

// ─── Response types ─────────────────────────────────────────────────────────

interface ExperimentSummary {
  id: string;
  tenantId: string | null;
  key: string;
  description: string | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  variants: ExperimentVariant[];
  recentAssignments: Array<{
    id: string;
    variant: string;
    subjectType: string;
    subjectId: string;
    assignedAt: string | null;
  }>;
  recentOutcomes: Array<{
    id: string;
    metric: string;
    value: number;
    recordedAt: string | null;
  }>;
  totalAssignments: number;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default defineAuthedHandler(
  async (req, res, ctx) => {
    requireRole(ctx, ["super_admin", "admin"]);
    await enforce(limits.perTenant(), ctx.tenant.id);

    if (req.method === "GET") {
      // List experiments visible to this tenant + globals.
      const rows = await ctx.withTenant((tx) =>
        tx
          .select()
          .from(experiments)
          .where(
            or(
              eq(experiments.tenantId, ctx.tenant.id),
              isNull(experiments.tenantId),
            ),
          )
          .orderBy(desc(experiments.createdAt)),
      );

      const summaries: ExperimentSummary[] = [];

      for (const exp of rows) {
        const [assignments, outcomes, totalRows] = await ctx.withTenant((tx) =>
          Promise.all([
            tx
              .select({
                id: experimentAssignments.id,
                variant: experimentAssignments.variant,
                subjectType: experimentAssignments.subjectType,
                subjectId: experimentAssignments.subjectId,
                assignedAt: experimentAssignments.assignedAt,
              })
              .from(experimentAssignments)
              .where(eq(experimentAssignments.experimentId, exp.id))
              .orderBy(desc(experimentAssignments.assignedAt))
              .limit(20),
            tx
              .select({
                id: experimentOutcomes.id,
                metric: experimentOutcomes.metric,
                value: experimentOutcomes.value,
                recordedAt: experimentOutcomes.recordedAt,
                assignmentId: experimentOutcomes.assignmentId,
              })
              .from(experimentOutcomes)
              .innerJoin(
                experimentAssignments,
                eq(experimentOutcomes.assignmentId, experimentAssignments.id),
              )
              .where(eq(experimentAssignments.experimentId, exp.id))
              .orderBy(desc(experimentOutcomes.recordedAt))
              .limit(20),
            tx
              .select({ count: sql<number>`COUNT(*)::int` })
              .from(experimentAssignments)
              .where(eq(experimentAssignments.experimentId, exp.id)),
          ]),
        );

        summaries.push({
          id: exp.id,
          tenantId: exp.tenantId,
          key: exp.key,
          description: exp.description,
          isActive: exp.isActive ?? false,
          startsAt: exp.startsAt ? exp.startsAt.toISOString() : null,
          endsAt: exp.endsAt ? exp.endsAt.toISOString() : null,
          variants: (exp.variants ?? []) as ExperimentVariant[],
          recentAssignments: assignments.map((a) => ({
            id: a.id,
            variant: a.variant,
            subjectType: a.subjectType,
            subjectId: a.subjectId,
            assignedAt: a.assignedAt ? a.assignedAt.toISOString() : null,
          })),
          recentOutcomes: outcomes.map((o) => ({
            id: o.id,
            metric: o.metric,
            value: Number(o.value),
            recordedAt: o.recordedAt ? o.recordedAt.toISOString() : null,
          })),
          totalAssignments: totalRows[0]?.count ?? 0,
        });
      }

      res.status(200).json({ experiments: summaries });
      return;
    }

    if (req.method === "POST") {
      const body = parseBody(UpsertSchema, req.body);

      if (body.global && ctx.agent.role !== "super_admin") {
        throw new ValidationError(
          "Only super_admin may create or update global experiments",
        );
      }

      const norm = normaliseVariants(body.variants);
      if (!norm.ok) throw new ValidationError(norm.reason);

      const targetTenantId = body.global ? null : ctx.tenant.id;

      // Upsert by (tenantId, key). Drizzle doesn't natively support
      // composite ON CONFLICT without a unique index, so we do find-then-
      // update / insert manually within the tenant transaction.
      const result = await ctx.withTenant(async (tx) => {
        const existingRows = await tx
          .select()
          .from(experiments)
          .where(
            and(
              eq(experiments.key, body.key),
              targetTenantId
                ? eq(experiments.tenantId, targetTenantId)
                : isNull(experiments.tenantId),
            ),
          )
          .limit(1);

        const startsAt = body.startsAt ? new Date(body.startsAt) : undefined;
        const endsAt = body.endsAt ? new Date(body.endsAt) : null;

        if (existingRows[0]) {
          const updated = await tx
            .update(experiments)
            .set({
              description: body.description,
              variants: norm.variants,
              isActive: body.isActive,
              ...(startsAt !== undefined ? { startsAt } : {}),
              endsAt,
              updatedAt: new Date(),
            })
            .where(eq(experiments.id, existingRows[0].id))
            .returning();
          return { row: updated[0], created: false };
        }

        const inserted = await tx
          .insert(experiments)
          .values({
            tenantId: targetTenantId,
            key: body.key,
            description: body.description,
            variants: norm.variants,
            isActive: body.isActive,
            ...(startsAt !== undefined ? { startsAt } : {}),
            endsAt,
          })
          .returning();
        return { row: inserted[0], created: true };
      });

      await auditAction({
        tenantId: ctx.tenant.id,
        actorType: "agent",
        actorId: ctx.agent.id,
        actorEmail: ctx.agent.email,
        action: result.created ? "experiment.create" : "experiment.update",
        resourceType: "experiment",
        resourceId: result.row.id,
        metadata: {
          key: body.key,
          isActive: body.isActive,
          global: body.global,
          variantNames: norm.variants.map((v) => v.name),
        },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });

      res.status(result.created ? 201 : 200).json({
        experiment: {
          id: result.row.id,
          tenantId: result.row.tenantId,
          key: result.row.key,
          description: result.row.description,
          variants: result.row.variants,
          isActive: result.row.isActive,
          startsAt: result.row.startsAt
            ? result.row.startsAt.toISOString()
            : null,
          endsAt: result.row.endsAt ? result.row.endsAt.toISOString() : null,
          createdAt: result.row.createdAt
            ? result.row.createdAt.toISOString()
            : null,
          updatedAt: result.row.updatedAt
            ? result.row.updatedAt.toISOString()
            : null,
        },
        created: result.created,
      });
      return;
    }
  },
  { methods: ["GET", "POST"] },
);
