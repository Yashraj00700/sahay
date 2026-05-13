import { z } from "zod";
import { conversations, customers, agents } from "@sahay/db";
import { and, eq } from "drizzle-orm";
import { defineAuthedHandler, parseBody } from "../../apps/api/src/lib/handler";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";
import { NotFoundError } from "../../apps/api/src/lib/errors";
import { auditAction } from "../../apps/api/src/services/audit";
import { auditConversationRead } from "../../apps/api/src/lib/audit-helpers";
import { triggerToTenant } from "../../apps/api/src/lib/pusher";

const patchConversationSchema = z.object({
  status: z
    .enum(["open", "pending", "snoozed", "resolved", "closed"])
    .optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  snoozeUntil: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  urgencyScore: z.number().int().min(1).max(5).optional(),
});

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id);
    const id = req.query.id as string;
    const tenantId = ctx.tenant.id;

    if (req.method === "GET") {
      const [row] = await ctx.withTenant((tx) =>
        tx
          .select({
            id: conversations.id,
            tenantId: conversations.tenantId,
            customerId: conversations.customerId,
            channel: conversations.channel,
            status: conversations.status,
            assignedTo: conversations.assignedTo,
            primaryIntent: conversations.primaryIntent,
            sentiment: conversations.sentiment,
            sentimentScore: conversations.sentimentScore,
            urgencyScore: conversations.urgencyScore,
            aiHandled: conversations.aiHandled,
            humanTouched: conversations.humanTouched,
            escalationReason: conversations.escalationReason,
            routingDecision: conversations.routingDecision,
            firstReplyAt: conversations.firstReplyAt,
            resolvedAt: conversations.resolvedAt,
            sessionExpiresAt: conversations.sessionExpiresAt,
            csatScore: conversations.csatScore,
            resolutionTimeSeconds: conversations.resolutionTimeSeconds,
            turnCount: conversations.turnCount,
            tags: conversations.tags,
            shopifyOrderId: conversations.shopifyOrderId,
            codConversionOffered: conversations.codConversionOffered,
            codConversionAccepted: conversations.codConversionAccepted,
            createdAt: conversations.createdAt,
            updatedAt: conversations.updatedAt,
            customerName: customers.name,
            customerPhone: customers.phone,
            customerEmail: customers.email,
            customerTier: customers.tier,
            customerWhatsappId: customers.whatsappId,
            customerLanguagePref: customers.languagePref,
            agentName: agents.name,
            agentEmail: agents.email,
          })
          .from(conversations)
          .leftJoin(customers, eq(conversations.customerId, customers.id))
          .leftJoin(agents, eq(conversations.assignedTo, agents.id))
          .where(
            and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)),
          ),
      );

      if (!row) throw new NotFoundError("Conversation not found");

      // DPDP/GDPR read audit — fire-and-forget; only audits successful reads.
      void auditConversationRead(ctx, id);

      res.status(200).json(row);
      return;
    }

    if (req.method === "PATCH") {
      const body = parseBody(patchConversationSchema, req.body);

      const updated = await ctx.withTenant(async (tx) => {
        const [existing] = await tx
          .select({
            id: conversations.id,
            createdAt: conversations.createdAt,
            status: conversations.status,
          })
          .from(conversations)
          .where(
            and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)),
          );
        if (!existing) throw new NotFoundError("Not found");

        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (body.status !== undefined) {
          updates.status = body.status;
          if (body.status === "resolved" && existing.status !== "resolved") {
            updates.resolvedAt = new Date();
            updates.resolutionTimeSeconds = Math.floor(
              (Date.now() - (existing.createdAt?.getTime() ?? Date.now())) /
                1000,
            );
          }
        }
        if (body.assignedTo !== undefined) {
          updates.assignedTo = body.assignedTo;
          if (body.assignedTo !== null) updates.humanTouched = true;
        }
        if (body.snoozeUntil) {
          updates.snoozeUntil = new Date(body.snoozeUntil);
          updates.status = "snoozed";
        }
        if (body.tags !== undefined) updates.tags = body.tags;
        if (body.urgencyScore !== undefined)
          updates.urgencyScore = body.urgencyScore;

        const [updated] = await tx
          .update(conversations)
          .set(updates as any)
          .where(eq(conversations.id, id))
          .returning();

        return updated;
      });

      await triggerToTenant(
        tenantId,
        "conversation:updated",
        updated as unknown as Record<string, unknown>,
      );

      await auditAction({
        tenantId,
        actorId: ctx.agent.id,
        actorType: "agent",
        action: "conversation.updated",
        resourceType: "conversation",
        resourceId: id,
        metadata: body,
      });

      res.status(200).json(updated);
      return;
    }
  },
  { methods: ["GET", "PATCH"] },
);
