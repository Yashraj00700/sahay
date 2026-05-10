// ─── Agents: Invite (Vercel Function) ─────────────────────────────────────────
// POST /api/agents/invite — admin-only.
//
// Creates an inactive agent row carrying an invite token. The recipient
// follows the emailed link, accepts via /api/auth/accept-invite, and is then
// promoted to isActive=true with a hashed password.

import { z } from 'zod'
import { agents, tenants } from '@sahay/db'
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

    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

    const result = await ctx.withTenant(async (tx) => {
      // Block invite collisions with an active agent in the same tenant.
      const existing = await tx.query.agents.findFirst({
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
        await tx
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

        const tenant = await tx.query.tenants.findFirst({
          where: eq(tenants.id, ctx.tenant.id),
        })

        return {
          kind: 'reinvited' as const,
          agentId: existing.id,
          tenant,
        }
      }

      if (existing) {
        // Inactive but no invite token (deactivated agent). Refuse to overwrite —
        // admin should reactivate via PATCH instead of inviting fresh.
        throw new ValidationError(
          'An inactive agent with that email already exists; reactivate them instead.',
        )
      }

      const [inserted] = await tx
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

      const tenant = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenant.id),
      })

      return {
        kind: 'invited' as const,
        agentId: inserted.id,
        tenant,
      }
    })

    await dispatchInvite({
      token,
      toEmail: body.email,
      inviterName: ctx.agent.name,
      tenantId: ctx.tenant.id,
      tenantName:
        result.tenant?.shopName ?? result.tenant?.shopifyDomain ?? 'Sahay',
      agentId: result.agentId,
      actor: ctx,
      action: result.kind === 'reinvited' ? 'agent.reinvited' : 'agent.invited',
    })

    if (result.kind === 'reinvited') {
      res
        .status(200)
        .json({ success: true, agentId: result.agentId, reinvited: true })
      return
    }

    res.status(200).json({ success: true, agentId: result.agentId })
  },
  { methods: ['POST'] },
)

interface DispatchInviteArgs {
  token: string
  toEmail: string
  inviterName: string
  tenantId: string
  tenantName: string
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

  const result = await sendAgentInvite({
    to: args.toEmail,
    inviterName: args.inviterName,
    tenantName: args.tenantName,
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
