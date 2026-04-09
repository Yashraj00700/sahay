import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.middleware'
import { db } from '@sahay/db'
import { tenants } from '@sahay/db/schema'
import { eq } from 'drizzle-orm'
import { encrypt } from '../../lib/encryption'

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)
  app.get('/channels', async () => ({ channels: {} }))

  const onboardingSchema = z.object({
    brandName: z.string().min(1).max(255),
    brandDescription: z.string().max(2000).optional(),
    aiPersonaName: z.string().max(100).optional(),
    primaryColor: z.string().max(20).optional(),
    whatsappPhoneNumber: z.string().max(30).optional(),
    channels: z.object({
      whatsappToken: z.string().max(512).optional(),
      instagramToken: z.string().max(512).optional(),
      whatsappPhoneId: z.string().max(64).optional(),
      waAppSecret: z.string().max(128).optional(),
    }).optional(),
  })

  // ─── GET /settings/cod-conversion ────────────────────────────────────────
  app.get('/cod-conversion', async (request, reply) => {
    const { tenantId } = request.agent

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { codConversionSettings: true },
    })

    const defaults = { enabled: false, discountPercent: 10, delayHours: 1 }

    if (!tenant?.codConversionSettings) {
      return reply.send(defaults)
    }

    try {
      return reply.send(JSON.parse(tenant.codConversionSettings))
    } catch {
      return reply.send(defaults)
    }
  })

  // ─── PATCH /settings/cod-conversion ──────────────────────────────────────
  const codConversionSchema = z.object({
    enabled:         z.boolean(),
    discountPercent: z.number().int().min(1).max(100),
    delayHours:      z.number().int().min(0).max(72),
  })

  app.patch('/cod-conversion', async (request, reply) => {
    const parsed = codConversionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', errors: parsed.error.flatten() })
    }

    const { tenantId } = request.agent

    await db.update(tenants)
      .set({
        codConversionSettings: JSON.stringify(parsed.data),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))

    return reply.send({ success: true, settings: parsed.data })
  })

  app.post('/onboarding', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = onboardingSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', errors: parsed.error.flatten() })
    }

    const { tenantId } = request.agent
    const body = parsed.data

    await db.update(tenants)
      .set({
        shopName: body.brandName,
        aiPersonaName: body.aiPersonaName || 'Sahay',
        // Encrypt tokens at rest if provided
        ...(body.channels?.whatsappToken
          ? { whatsappToken: encrypt(body.channels.whatsappToken) }
          : {}),
        ...(body.channels?.instagramToken
          ? { instagramToken: encrypt(body.channels.instagramToken) }
          : {}),
        ...(body.channels?.whatsappPhoneId
          ? { whatsappPhoneNumberId: body.channels.whatsappPhoneId }
          : {}),
        ...(body.channels?.waAppSecret ? { waAppSecret: encrypt(body.channels.waAppSecret) } : {}),
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))

    return reply.send({ success: true })
  })
}
