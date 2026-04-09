import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { tenants, conversations } from '@sahay/db'
import { eq, and, gte, sql } from 'drizzle-orm'
import { requireAuth, requireRole } from '../../middleware/auth.middleware'

// ─── Plan metadata ────────────────────────────────────────────────────────────

const PLAN_LIMITS: Record<string, { aiConversationsPerMonth: number; agentSeats: number; price: number }> = {
  trial:      { aiConversationsPerMonth: 100,   agentSeats: 2,   price: 0 },
  starter:    { aiConversationsPerMonth: 500,   agentSeats: 3,   price: 999 },
  growth:     { aiConversationsPerMonth: 2000,  agentSeats: 8,   price: 2999 },
  pro:        { aiConversationsPerMonth: 10000, agentSeats: 25,  price: 7999 },
  enterprise: { aiConversationsPerMonth: -1,    agentSeats: -1,  price: 0 },   // unlimited
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const upgradeSchema = z.object({
  plan: z.enum(['starter', 'growth', 'pro', 'enterprise']),
})

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /billing/subscription ────────────────────────────────────────────
  app.get('/subscription', async (req, reply) => {
    const tenantId = req.agent.tenantId

    const [tenant] = await db.select({
      id:            tenants.id,
      plan:          tenants.plan,
      planStartedAt: tenants.planStartedAt,
      trialEndsAt:   tenants.trialEndsAt,
      shopName:      tenants.shopName,
      shopEmail:     tenants.shopEmail,
    })
      .from(tenants)
      .where(eq(tenants.id, tenantId))

    if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

    const limits = PLAN_LIMITS[tenant.plan] ?? PLAN_LIMITS.trial

    return reply.send({
      plan:                   tenant.plan,
      planStartedAt:          tenant.planStartedAt,
      trialEndsAt:            tenant.trialEndsAt,
      shopName:               tenant.shopName,
      shopEmail:              tenant.shopEmail,
      limits: {
        aiConversationsPerMonth: limits.aiConversationsPerMonth,
        agentSeats:              limits.agentSeats,
      },
      priceInr: limits.price,
    })
  })

  // ─── GET /billing/usage ───────────────────────────────────────────────────
  app.get('/usage', async (req, reply) => {
    const tenantId = req.agent.tenantId

    // Current calendar month boundaries
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

    const [tenant] = await db.select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, tenantId))

    const plan = tenant?.plan ?? 'trial'
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.trial

    const [usageResult] = await db.select({
      aiConversations: sql<number>`cast(count(*) as integer)`,
    })
      .from(conversations)
      .where(and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.aiHandled, true),
        gte(conversations.createdAt, monthStart),
      ))

    const aiConversationsUsed = usageResult?.aiConversations ?? 0

    return reply.send({
      period: {
        start: monthStart.toISOString(),
        end:   monthEnd.toISOString(),
      },
      aiConversations: {
        used:      aiConversationsUsed,
        limit:     limits.aiConversationsPerMonth,
        unlimited: limits.aiConversationsPerMonth === -1,
        percent:   limits.aiConversationsPerMonth === -1
          ? null
          : Math.round((aiConversationsUsed / limits.aiConversationsPerMonth) * 100),
      },
    })
  })

  // ─── GET /billing/invoices ────────────────────────────────────────────────
  // Returns empty array until payment integration is wired up
  app.get('/invoices', async (_req, reply) => {
    return reply.send({ data: [], total: 0 })
  })

  // ─── POST /billing/upgrade ────────────────────────────────────────────────
  // Admin-only: update tenant plan
  app.post('/upgrade', { preHandler: [requireRole(['admin', 'super_admin'])] }, async (req, reply) => {
    const parsed = upgradeSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const tenantId = req.agent.tenantId
    const { plan } = parsed.data

    const [updated] = await db.update(tenants)
      .set({
        plan,
        planStartedAt: new Date(),
        updatedAt:     new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning({
        id:           tenants.id,
        plan:         tenants.plan,
        planStartedAt: tenants.planStartedAt,
      })

    return reply.send(updated)
  })
}
