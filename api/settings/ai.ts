// ─── Settings: AI persona (Vercel Function) ───────────────────────────────────
// GET   /api/settings/ai — current persona / language / tone
// PATCH /api/settings/ai — admin-only; update tenant AI fields

import { z } from 'zod'
import { db, tenants } from '@sahay/db'
import { eq } from 'drizzle-orm'
import {
  defineAuthedHandler,
  parseBody,
  requireRole,
} from '../../apps/api/src/lib/handler'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'
import { auditAction } from '../../apps/api/src/services/audit'
import { ValidationError } from '../../apps/api/src/lib/errors'

const PatchSchema = z.object({
  aiPersonaName: z.string().min(1).max(60).optional(),
  aiLanguage: z.enum(['en', 'hi', 'hinglish', 'auto']).optional(),
  aiTone: z.enum(['formal', 'warm', 'casual']).optional(),
  aiBrandVoice: z.string().max(2000).optional(),
  aiConfidenceThreshold: z.number().min(0).max(1).optional(),
}).refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Provide at least one field to update' },
)

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)

    if (req.method === 'GET') {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenant.id),
      })
      if (!tenant) throw new ValidationError('Tenant not found')

      res.status(200).json({
        ai: {
          aiPersonaName: tenant.aiPersonaName ?? 'Sahay',
          aiLanguage: tenant.aiLanguage ?? 'hinglish',
          aiTone: tenant.aiTone ?? 'warm',
          aiBrandVoice: tenant.aiBrandVoice ?? '',
          aiConfidenceThreshold: Number(tenant.aiConfidenceThreshold ?? '0.75'),
        },
      })
      return
    }

    if (req.method === 'PATCH') {
      requireRole(ctx, ['super_admin', 'admin'])
      const body = parseBody(PatchSchema, req.body)

      const updates: Record<string, unknown> = { updatedAt: new Date() }
      if (body.aiPersonaName !== undefined) updates.aiPersonaName = body.aiPersonaName
      if (body.aiLanguage !== undefined) updates.aiLanguage = body.aiLanguage
      if (body.aiTone !== undefined) updates.aiTone = body.aiTone
      if (body.aiBrandVoice !== undefined) updates.aiBrandVoice = body.aiBrandVoice
      if (body.aiConfidenceThreshold !== undefined) {
        // Drizzle decimal columns expect strings.
        updates.aiConfidenceThreshold = body.aiConfidenceThreshold.toFixed(2)
      }

      await db.update(tenants).set(updates).where(eq(tenants.id, ctx.tenant.id))

      await auditAction({
        tenantId: ctx.tenant.id,
        actorType: 'agent',
        actorId: ctx.agent.id,
        actorEmail: ctx.agent.email,
        action: 'ai.persona_updated',
        resourceType: 'tenant',
        resourceId: ctx.tenant.id,
        metadata: body,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      })

      res.status(200).json({ success: true })
      return
    }
  },
  { methods: ['GET', 'PATCH'] },
)
