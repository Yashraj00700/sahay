// ─── Auth: Accept agent invite (Vercel Function) ──────────────────────────────
// POST /api/auth/accept-invite
//
// Body: { token, password }
//
// Looks up the agent by inviteToken, verifies the token has not expired, hashes
// the password, marks the agent active, and clears the invite token. Returns
// the same { token, refreshToken, agent, tenant } shape as /auth/login so the
// frontend can hydrate the auth store and navigate the user straight in.

import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db, agents, tenants } from '@sahay/db'
import { and, eq } from 'drizzle-orm'
import { defineHandler, parseBody } from '../../apps/api/src/lib/handler'
import {
  signAccessToken,
  signRefreshToken,
  accessTtlSec,
} from '../../apps/api/src/lib/jwt'
import { ValidationError, AuthError } from '../../apps/api/src/lib/errors'
import { auditAction } from '../../apps/api/src/services/audit'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'

const Schema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(100)
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
})

export default defineHandler(
  async (req, res, ctx) => {
    await enforce(limits.perIpAuth(), ctx.ip || 'unknown')

    const { token, password } = parseBody(Schema, req.body)

    const agent = await db.query.agents.findFirst({
      where: eq(agents.inviteToken, token),
    })

    if (!agent || !agent.inviteTokenExpiresAt) {
      throw new ValidationError('Invalid or expired invite token')
    }
    if (agent.inviteTokenExpiresAt < new Date()) {
      throw new ValidationError('Invite token has expired')
    }

    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, agent.tenantId), eq(tenants.isActive, true)),
    })
    if (!tenant) {
      throw new AuthError('Tenant inactive — contact your administrator')
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const now = new Date()

    await db
      .update(agents)
      .set({
        passwordHash,
        isActive: true,
        inviteToken: null,
        inviteTokenExpiresAt: null,
        inviteAcceptedAt: now,
        lastSeenAt: now,
        isOnline: true,
        updatedAt: now,
      })
      .where(eq(agents.id, agent.id))

    const payload = {
      agentId: agent.id,
      tenantId: agent.tenantId,
      role: agent.role,
      email: agent.email,
    }
    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    await auditAction({
      tenantId: agent.tenantId,
      actorType: 'agent',
      actorId: agent.id,
      actorEmail: agent.email,
      action: 'agent.invite_accepted',
      resourceType: 'agent',
      resourceId: agent.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    res.status(200).json({
      token: accessToken,
      refreshToken,
      expiresIn: accessTtlSec(),
      agent: {
        id: agent.id,
        tenantId: agent.tenantId,
        email: agent.email,
        name: agent.name,
        avatarUrl: agent.avatarUrl,
        role: agent.role,
        isActive: true,
        isOnline: true,
        createdAt: agent.createdAt?.toISOString() ?? new Date().toISOString(),
      },
      tenant: {
        id: tenant.id,
        shopifyDomain: tenant.shopifyDomain,
        shopName: tenant.shopName,
        plan: tenant.plan,
        aiPersonaName: tenant.aiPersonaName ?? 'Sahay',
        aiLanguage: tenant.aiLanguage ?? 'hinglish',
        aiTone: tenant.aiTone ?? 'warm',
        aiConfidenceThreshold: Number(tenant.aiConfidenceThreshold ?? '0.75'),
        timezone: tenant.timezone ?? 'Asia/Kolkata',
        isActive: tenant.isActive ?? true,
        createdAt: tenant.createdAt?.toISOString() ?? new Date().toISOString(),
      },
    })
  },
  { methods: ['POST'] },
)
