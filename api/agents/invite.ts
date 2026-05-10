// ─── Agents: Invite (Vercel Function) ─────────────────────────────────────────
// POST /api/agents/invite — admin-only.
//
// Creates an inactive agent row carrying an invite token. The recipient
// follows the emailed link, accepts via /api/auth/accept-invite, and is then
// promoted to isActive=true with a hashed password.

import { z } from 'zod'
import { db, agents, tenants } from '@sahay/db'
import { and, eq } from 'drizzle-orm'
import {
  defineAuthedHandler,
  parseBody,
  requireRole,
} from '../../apps/api/src/lib/handler'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'
import { randomToken } from '../../apps/api/src/lib/crypto'
import { env } from '../../apps/api/src/lib/env'
import { logger } from '../../apps/api/src/lib/logger'
import { AppError, ValidationError } from '../../apps/api/src/lib/errors'
import { sendAgentInvite } from '../../apps/api/src/services/email'
import { auditAction } from '../../apps/api/src/services/audit'

const Schema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
  name: z.string().min(1).max(120),
  role: z.enum(['agent', 'admin']),
})

const INVITE_TTL_MS = 72 * 60 * 60 * 1000

export default defineAuthedHandler(
  async (req, res, ctx) => {
    requireRole(ctx, ['super_admin', 'admin'])
    await enforce(limits.perTenant(), ctx.tenant.id)

    const body = parseBody(Schema, req.body)

    // Block invite collisions with an active agent in the same tenant.
    const existing = await db.query.agents.findFirst({
      where: and(
        eq(agents.tenantId, ctx.tenant.id),
        eq(agents.email, body.email),
      ),
    })

    if (existing && existing.isActive === true) {
      throw new AppError(
        'CONFLICT',
        'An active agent with that email already exists in this tenant',
        409,
      )
    }

    if (existing && existing.isActive === false && existing.inviteToken) {
      // Re-invite flow: refresh the existing token instead of inserting a duplicate.
      const token = randomToken(32)
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
      await db
        .update(agents)
        .set({
          name: body.name,
          role: body.role,
          inviteToken: token,
          inviteTokenExpiresAt: expiresAt,
          invitedBy: ctx.agent.id,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, existing.id))

      await dispatchInvite({
        token,
        toEmail: body.email,
        inviterName: ctx.agent.name,
        tenantId: ctx.tenant.id,
        agentId: existing.id,
        actor: ctx,
        action: 'agent.reinvited',
      })

      res.status(200).json({ success: true, agentId: existing.id, reinvited: true })
      return
    }

    if (existing) {
      // Inactive but no invite token (deactivated agent). Refuse to overwrite —
      // admin should reactivate via PATCH instead of inviting fresh.
      throw new ValidationError(
        'An inactive agent with that email already exists; reactivate them instead.',
      )
    }

    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

    const [inserted] = await db
      .insert(agents)
      .values({
        tenantId: ctx.tenant.id,
        email: body.email,
        name: body.name,
        role: body.role,
        passwordHash: null,
        isActive: false,
        inviteToken: token,
        inviteTokenExpiresAt: expiresAt,
        invitedBy: ctx.agent.id,
      })
      .returning({ id: agents.id })

    if (!inserted) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create agent', 500)
    }

    await dispatchInvite({
      token,
      toEmail: body.email,
      inviterName: ctx.agent.name,
      tenantId: ctx.tenant.id,
      agentId: inserted.id,
      actor: ctx,
      action: 'agent.invited',
    })

    res.status(200).json({ success: true, agentId: inserted.id })
  },
  { methods: ['POST'] },
)

interface DispatchInviteArgs {
  token: string
  toEmail: string
  inviterName: string
  tenantId: string
  agentId: string
  actor: {
    agent: { id: string; email: string }
    tenant: { id: string }
    ip: string
    userAgent: string
    requestId: string
  }
  action: string
}

async function dispatchInvite(args: DispatchInviteArgs): Promise<void> {
  const inviteUrl = `${env.WEB_URL.replace(/\/$/, '')}/auth/accept-invite?token=${args.token}`

  // Look up tenant display name for the email body.
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, args.tenantId),
  })
  const tenantName = tenant?.shopName ?? tenant?.shopifyDomain ?? 'Sahay'

  const result = await sendAgentInvite({
    to: args.toEmail,
    inviterName: args.inviterName,
    tenantName,
    inviteUrl,
    expiresInHours: 72,
  })

  if (!result.ok) {
    logger.warn(
      { agentId: args.agentId, error: result.error },
      'Agent invite email failed',
    )
  }

  await auditAction({
    tenantId: args.tenantId,
    actorType: 'agent',
    actorId: args.actor.agent.id,
    actorEmail: args.actor.agent.email,
    action: args.action,
    resourceType: 'agent',
    resourceId: args.agentId,
    metadata: { email: args.toEmail },
    ipAddress: args.actor.ip,
    userAgent: args.actor.userAgent,
    requestId: args.actor.requestId,
  })
}
