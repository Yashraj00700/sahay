// ─── Agents: detail / update / deactivate ─────────────────────────────────────
// GET    /api/agents/:id  — admin-readable agent details
// PATCH  /api/agents/:id  — update name/role
// DELETE /api/agents/:id  — soft-deactivate (isActive=false)
//
// Admin-only. Refuses to demote/deactivate the last super_admin so a tenant
// cannot lock itself out.

import { z } from "zod";
import { agents, type Tx } from "@sahay/db";
import { and, eq, ne, count } from "drizzle-orm";
import {
  defineAuthedHandler,
  parseBody,
  requireRole,
} from "../../../apps/api/src/lib/handler";
import { enforce, limits } from "../../../apps/api/src/lib/rate-limit";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "../../../apps/api/src/lib/errors";
import { auditAction } from "../../../apps/api/src/services/audit";

const PatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    role: z.enum(["super_admin", "admin", "agent", "viewer"]).optional(),
  })
  .refine((v) => v.name !== undefined || v.role !== undefined, {
    message: "At least one of name, role must be provided",
  });

export default defineAuthedHandler(
  async (req, res, ctx) => {
    requireRole(ctx, ["super_admin", "admin"]);
    await enforce(limits.perTenant(), ctx.tenant.id);

    const idParam = req.query.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id || typeof id !== "string") {
      throw new ValidationError("Missing agent id");
    }

    if (req.method === "GET") {
      const target = await ctx.withTenant((tx) =>
        tx.query.agents.findFirst({
          where: and(eq(agents.id, id), eq(agents.tenantId, ctx.tenant.id)),
        }),
      );
      if (!target) throw new NotFoundError("Agent not found");

      res.status(200).json({
        agent: {
          id: target.id,
          email: target.email,
          name: target.name,
          avatarUrl: target.avatarUrl,
          role: target.role,
          isActive: target.isActive ?? false,
          isOnline: target.isOnline ?? false,
          lastSeenAt: target.lastSeenAt?.toISOString() ?? null,
          invitePending:
            target.inviteToken !== null && target.inviteAcceptedAt === null,
          createdAt: target.createdAt?.toISOString() ?? null,
        },
      });
      return;
    }

    if (req.method === "PATCH") {
      const body = parseBody(PatchSchema, req.body);

      const { target, updated } = await ctx.withTenant(async (tx) => {
        const target = await tx.query.agents.findFirst({
          where: and(eq(agents.id, id), eq(agents.tenantId, ctx.tenant.id)),
        });
        if (!target) throw new NotFoundError("Agent not found");

        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (body.name !== undefined) updates.name = body.name;

        if (body.role !== undefined && body.role !== target.role) {
          // Super-admin role is reserved: only an existing super_admin can grant it.
          if (body.role === "super_admin" && ctx.agent.role !== "super_admin") {
            throw new AppError(
              "FORBIDDEN",
              "Only a super_admin may grant super_admin",
              403,
            );
          }

          // Block self-demotion if I'm the last super_admin in this tenant.
          if (
            target.id === ctx.agent.id &&
            target.role === "super_admin" &&
            body.role !== "super_admin"
          ) {
            await assertAnotherSuperAdminExists(tx, ctx.tenant.id, target.id);
          }

          // Block demoting another super_admin if they are the only one left.
          if (target.role === "super_admin" && body.role !== "super_admin") {
            await assertAnotherSuperAdminExists(tx, ctx.tenant.id, target.id);
          }

          updates.role = body.role;
        }

        const [updated] = await tx
          .update(agents)
          .set(updates)
          .where(eq(agents.id, target.id))
          .returning({
            id: agents.id,
            name: agents.name,
            role: agents.role,
            email: agents.email,
          });

        return { target, updated };
      });

      await auditAction({
        tenantId: ctx.tenant.id,
        actorType: "agent",
        actorId: ctx.agent.id,
        actorEmail: ctx.agent.email,
        action: "agent.updated",
        resourceType: "agent",
        resourceId: target.id,
        beforeState: { name: target.name, role: target.role },
        afterState: updated as unknown as Record<string, unknown>,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });

      res.status(200).json({ agent: updated });
      return;
    }

    if (req.method === "DELETE") {
      const target = await ctx.withTenant(async (tx) => {
        const target = await tx.query.agents.findFirst({
          where: and(eq(agents.id, id), eq(agents.tenantId, ctx.tenant.id)),
        });
        if (!target) throw new NotFoundError("Agent not found");

        if (target.id === ctx.agent.id) {
          throw new ValidationError("You cannot deactivate yourself");
        }
        if (target.role === "super_admin") {
          await assertAnotherSuperAdminExists(tx, ctx.tenant.id, target.id);
        }

        await tx
          .update(agents)
          .set({
            isActive: false,
            isOnline: false,
            inviteToken: null,
            inviteTokenExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(agents.id, target.id));

        return target;
      });

      await auditAction({
        tenantId: ctx.tenant.id,
        actorType: "agent",
        actorId: ctx.agent.id,
        actorEmail: ctx.agent.email,
        action: "agent.deactivated",
        resourceType: "agent",
        resourceId: target.id,
        beforeState: { isActive: target.isActive, role: target.role },
        afterState: { isActive: false },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });

      res.status(200).json({ success: true });
      return;
    }
  },
  { methods: ["GET", "PATCH", "DELETE"] },
);

async function assertAnotherSuperAdminExists(
  tx: Tx,
  tenantId: string,
  excludeAgentId: string,
): Promise<void> {
  const [row] = await tx
    .select({ count: count() })
    .from(agents)
    .where(
      and(
        eq(agents.tenantId, tenantId),
        eq(agents.role, "super_admin"),
        eq(agents.isActive, true),
        ne(agents.id, excludeAgentId),
      ),
    );
  const n = Number(row?.count ?? 0);
  if (n < 1) {
    throw new ValidationError(
      "Cannot remove the last super_admin from this tenant",
    );
  }
}
