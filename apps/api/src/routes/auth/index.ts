import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db, agents, tenants } from '@sahay/db'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth.middleware'
import { auditAction } from '../../services/audit'

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
})

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(100),
})

export const authRoutes: FastifyPluginAsync = async (app) => {

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const body = LoginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Validation Error',
        message: 'Invalid request body',
        details: body.error.flatten().fieldErrors,
      })
    }

    const { email, password } = body.data

    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.email, email.toLowerCase()), eq(agents.isActive, true)),
    })

    if (!agent || !agent.passwordHash) {
      // Constant-time response to prevent enumeration
      await bcrypt.compare(password, '$2b$10$invalid.hash.to.prevent.timing.attack.blah')
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      })
    }

    const passwordValid = await bcrypt.compare(password, agent.passwordHash)
    if (!passwordValid) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      })
    }

    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, agent.tenantId), eq(tenants.isActive, true)),
    })

    if (!tenant) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Account is inactive. Please contact your administrator.',
      })
    }

    // Generate tokens
    const payload = {
      agentId: agent.id,
      tenantId: agent.tenantId,
      role: agent.role,
      email: agent.email,
    }

    const token = app.jwt.sign(payload, {
      expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    })

    const refreshToken = app.jwt.sign(
      { ...payload, type: 'refresh' },
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d' }
    )

    // Update last seen
    await db.update(agents)
      .set({ lastSeenAt: new Date(), isOnline: true, updatedAt: new Date() })
      .where(eq(agents.id, agent.id))

    // Audit log
    await auditAction({
      tenantId: agent.tenantId,
      actorType: 'agent',
      actorId: agent.id,
      actorEmail: agent.email,
      action: 'auth.login',
      resourceType: 'agent',
      resourceId: agent.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    })

    return reply.send({
      token,
      refreshToken,
      expiresIn: 3600,
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
  })

  // POST /api/auth/refresh
  app.post('/refresh', async (request, reply) => {
    const body = z.object({ refreshToken: z.string() }).safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'refreshToken is required' })
    }

    try {
      const payload = app.jwt.verify(body.data.refreshToken) as {
        agentId: string; tenantId: string; role: string; email: string; type?: string
      }

      if (payload.type !== 'refresh') {
        throw new Error('Not a refresh token')
      }

      const newToken = app.jwt.sign(
        { agentId: payload.agentId, tenantId: payload.tenantId, role: payload.role, email: payload.email },
        { expiresIn: process.env.JWT_EXPIRES_IN ?? '1h' }
      )

      return reply.send({ token: newToken, expiresIn: 3600 })
    } catch {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid refresh token' })
    }
  })

  // POST /api/auth/logout
  app.post('/logout', { preHandler: [requireAuth] }, async (request, reply) => {
    await db.update(agents)
      .set({ isOnline: false, updatedAt: new Date() })
      .where(eq(agents.id, request.agent.id))

    return reply.send({ success: true })
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({
      agent: request.agent,
      tenant: request.tenant,
    })
  })

  // POST /api/auth/forgot-password
  app.post('/forgot-password', async (request, reply) => {
    const body = ForgotPasswordSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Valid email is required' })
    }

    // Always return success to prevent email enumeration
    const agent = await db.query.agents.findFirst({
      where: eq(agents.email, body.data.email.toLowerCase()),
    })

    if (agent) {
      const resetToken = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      await db.update(agents)
        .set({
          resetToken,
          resetTokenExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id))

      // TODO: Send email via Resend
      // await sendPasswordResetEmail(agent.email, agent.name, resetToken)
      request.log.info({ agentId: agent.id, email: agent.email }, 'Password reset token generated')
    }

    return reply.send({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent.',
    })
  })

  // POST /api/auth/reset-password
  app.post('/reset-password', async (request, reply) => {
    const body = ResetPasswordSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid request' })
    }

    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.resetToken, body.data.token),
      ),
    })

    if (
      !agent ||
      !agent.resetTokenExpiresAt ||
      agent.resetTokenExpiresAt < new Date()
    ) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid or expired reset token',
      })
    }

    const passwordHash = await bcrypt.hash(body.data.password, 12)

    await db.update(agents)
      .set({
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id))

    return reply.send({ success: true, message: 'Password updated successfully. Please log in.' })
  })
}
