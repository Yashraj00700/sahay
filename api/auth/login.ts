import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db, agents, tenants } from '@sahay/db'
import { and, eq } from 'drizzle-orm'
import { defineHandler, parseBody } from '../../apps/api/src/lib/handler'
import { signAccessToken, signRefreshToken, accessTtlSec } from '../../apps/api/src/lib/jwt'
import { auditAction } from '../../apps/api/src/services/audit'
import { limits, enforce } from '../../apps/api/src/lib/rate-limit'
import { AuthError } from '../../apps/api/src/lib/errors'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const TIMING_HASH = '$2b$10$invalid.hash.to.prevent.timing.attack.bla'

export default defineHandler(
  async (req, res, ctx) => {
    await enforce(limits.perIpAuth(), ctx.ip || 'unknown')
    const { email, password } = parseBody(LoginSchema, req.body)

    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.email, email.toLowerCase()), eq(agents.isActive, true)),
    })

    if (!agent || !agent.passwordHash) {
      await bcrypt.compare(password, TIMING_HASH)
      throw new AuthError('Invalid email or password')
    }

    const valid = await bcrypt.compare(password, agent.passwordHash)
    if (!valid) throw new AuthError('Invalid email or password')

    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, agent.tenantId), eq(tenants.isActive, true)),
    })
    if (!tenant) throw new AuthError('Account inactive. Contact your administrator.')

    const payload = {
      agentId: agent.id,
      tenantId: agent.tenantId,
      role: agent.role,
      email: agent.email,
    }
    const token = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    await db
      .update(agents)
      .set({ lastSeenAt: new Date(), isOnline: true, updatedAt: new Date() })
      .where(eq(agents.id, agent.id))

    await auditAction({
      tenantId: agent.tenantId,
      actorType: 'agent',
      actorId: agent.id,
      actorEmail: agent.email,
      action: 'auth.login',
      resourceType: 'agent',
      resourceId: agent.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    res.status(200).json({
      token,
      refreshToken,
      expiresIn: accessTtlSec(),
      agent: {
        id: agent.id,
        tenantId: agent.tenantId,
        email: agent.email,
        name: agent.name,
        avatarUrl: agent.avatarUrl,
        role: agent.role,
      },
      tenant: {
        id: tenant.id,
        shopifyDomain: tenant.shopifyDomain,
        shopName: tenant.shopName,
        plan: tenant.plan,
        aiPersonaName: tenant.aiPersonaName,
        aiLanguage: tenant.aiLanguage,
        timezone: tenant.timezone,
      },
    })
  },
  { methods: ['POST'] },
)
