import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db, agents, tenants } from '@sahay/db'
import { and, eq } from 'drizzle-orm'
import { defineHandler, parseBody } from '../../apps/api/src/lib/handler'
import { signAccessToken, signRefreshToken, accessTtlSec } from '../../apps/api/src/lib/jwt'
import { auditAction } from '../../apps/api/src/services/audit'
import { limits, enforce } from '../../apps/api/src/lib/rate-limit'
import { AuthError, AppError } from '../../apps/api/src/lib/errors'
import {
  checkLockout,
  recordFailedAttempt,
  clearLockout,
} from '../../apps/api/src/lib/login-lockout'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const TIMING_HASH = '$2b$10$invalid.hash.to.prevent.timing.attack.bla'

export default defineHandler(
  async (req, res, ctx) => {
    await enforce(limits.perIpAuth(), ctx.ip || 'unknown')
    const { email, password } = parseBody(LoginSchema, req.body)
    const ip = ctx.ip || 'unknown'

    // Brute-force lockout check BEFORE any DB lookup so we don't even
    // confirm the email exists once the attacker is over threshold.
    try {
      await checkLockout({ email, ip })
    } catch (err) {
      if (err instanceof AppError && err.code === 'FORBIDDEN') {
        await auditAction({
          actorType: 'system',
          actorEmail: email.toLowerCase(),
          action: 'auth.login.lockout_denied',
          resourceType: 'agent',
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: { reason: 'lockout_threshold_exceeded' },
        })
      }
      throw err
    }

    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.email, email.toLowerCase()), eq(agents.isActive, true)),
    })

    if (!agent || !agent.passwordHash) {
      await bcrypt.compare(password, TIMING_HASH)
      await recordFailedAttempt({ email, ip })
      throw new AuthError('Invalid email or password')
    }

    const valid = await bcrypt.compare(password, agent.passwordHash)
    if (!valid) {
      await recordFailedAttempt({ email, ip })
      throw new AuthError('Invalid email or password')
    }

    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, agent.tenantId), eq(tenants.isActive, true)),
    })
    if (!tenant) {
      // Don't punish the user with a lockout counter for an admin-side
      // tenant deactivation — but do clear any prior counters since the
      // password itself was valid.
      await clearLockout({ email, ip })
      throw new AuthError('Account inactive. Contact your administrator.')
    }

    // Successful auth: wipe both counters BEFORE issuing tokens so that even
    // if token-signing fails the user isn't left with stale failure counts.
    await clearLockout({ email, ip })

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
