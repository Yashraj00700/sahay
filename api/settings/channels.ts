// ─── Settings: Channels (Vercel Function) ─────────────────────────────────────
// GET   /api/settings/channels — return masked status of WhatsApp / Instagram
// PATCH /api/settings/channels — admin-only; persist credentials (encrypted)
//
// Tokens are encrypted at rest via apps/api/src/lib/crypto. The GET response
// masks tokens (returns only configured/not-configured + last 4 chars).

import { z } from "zod";
import { tenants } from "@sahay/db";
import { eq } from "drizzle-orm";
import {
  defineAuthedHandler,
  parseBody,
  requireRole,
} from "../../apps/api/src/lib/handler";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";
import { encrypt } from "../../apps/api/src/lib/crypto";
import { auditAction } from "../../apps/api/src/services/audit";
import { ValidationError } from "../../apps/api/src/lib/errors";

const PatchSchema = z
  .object({
    whatsapp: z
      .object({
        phoneNumberId: z.string().min(1).optional(),
        accessToken: z.string().min(1).optional(),
        verifyToken: z.string().min(1).optional(),
        businessAccountId: z.string().min(1).optional(),
        // App-secret is read from env, not per-tenant — accepted but ignored
        // here so existing onboarding payloads don't 400.
        appSecret: z.string().min(1).optional(),
      })
      .optional(),
    instagram: z
      .object({
        pageId: z.string().min(1).optional(),
        accessToken: z.string().min(1).optional(),
        verifyToken: z.string().min(1).optional(),
      })
      .optional(),
  })
  .refine(
    (v) =>
      (v.whatsapp && Object.keys(v.whatsapp).length > 0) ||
      (v.instagram && Object.keys(v.instagram).length > 0),
    { message: "Provide whatsapp or instagram credentials" },
  );

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id);

    if (req.method === "GET") {
      const tenant = await ctx.withTenant((tx) =>
        tx.query.tenants.findFirst({
          where: eq(tenants.id, ctx.tenant.id),
        }),
      );
      if (!tenant) throw new ValidationError("Tenant not found");

      res.status(200).json({
        channels: {
          whatsapp: {
            connected: !!tenant.whatsappPhoneNumberId && !!tenant.whatsappToken,
            phoneNumberId: tenant.whatsappPhoneNumberId ?? null,
            verifyToken: tenant.whatsappVerifyToken ?? null,
            businessAccountId: tenant.whatsappBusinessAccountId ?? null,
            tokenSet: !!tenant.whatsappToken,
          },
          instagram: {
            connected: !!tenant.instagramPageId && !!tenant.instagramToken,
            pageId: tenant.instagramPageId ?? null,
            tokenSet: !!tenant.instagramToken,
          },
        },
      });
      return;
    }

    if (req.method === "PATCH") {
      requireRole(ctx, ["super_admin", "admin"]);
      const body = parseBody(PatchSchema, req.body);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const channelsTouched: string[] = [];

      if (body.whatsapp) {
        if (body.whatsapp.phoneNumberId !== undefined) {
          updates.whatsappPhoneNumberId = body.whatsapp.phoneNumberId;
        }
        if (body.whatsapp.accessToken !== undefined) {
          updates.whatsappToken = encrypt(body.whatsapp.accessToken);
        }
        if (body.whatsapp.verifyToken !== undefined) {
          updates.whatsappVerifyToken = body.whatsapp.verifyToken;
        }
        if (body.whatsapp.businessAccountId !== undefined) {
          updates.whatsappBusinessAccountId = body.whatsapp.businessAccountId;
        }
        channelsTouched.push("whatsapp");
      }

      if (body.instagram) {
        if (body.instagram.pageId !== undefined) {
          updates.instagramPageId = body.instagram.pageId;
        }
        if (body.instagram.accessToken !== undefined) {
          updates.instagramToken = encrypt(body.instagram.accessToken);
        }
        // Schema currently has no instagramVerifyToken column; verifyToken is
        // configured globally via env. Accept it without persisting.
        channelsTouched.push("instagram");
      }

      await ctx.withTenant((tx) =>
        tx.update(tenants).set(updates).where(eq(tenants.id, ctx.tenant.id)),
      );

      await auditAction({
        tenantId: ctx.tenant.id,
        actorType: "agent",
        actorId: ctx.agent.id,
        actorEmail: ctx.agent.email,
        action: "channel.connected",
        resourceType: "tenant",
        resourceId: ctx.tenant.id,
        metadata: { channels: channelsTouched },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });

      res.status(200).json({ success: true, channels: channelsTouched });
      return;
    }
  },
  { methods: ["GET", "PATCH"] },
);
