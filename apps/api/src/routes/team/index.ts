import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { agents, conversations, messages } from '@sahay/db'
import { eq, and, gte, lte, count, avg, sql } from 'drizzle-orm'
import { requireAuth, requireRole } from '../../middleware/auth.middleware'
import { createHash, randomBytes } from 'crypto'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashPassword(password: string): string {
  // SHA-256 with random salt — replace with bcrypt/argon2 in production
  const salt = randomBytes(16).toString('hex')
  const hash = createHash('sha256').update(salt + password).digest('hex')
  return `${salt}:${hash}`
}

// ─── Available roles ──────────────────────────────────────────────────────────

const AVAILABLE_ROLES = [
  { role: 'super_admin', label: 'Super Admin',  description: 'Full platform access' },
  { role: 'admin',       label: 'Admin',         description: 'Manage team, billing and settings' },
  { role: 'agent',       label: 'Agent',         description: 'Handle conversations' },
  { role: 'viewer',      label: 'Viewer',        description: 'Read-only access' },
]

// ─── Schemas ──────────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  name:     z.string().min(1).max(255),
  email:    z.string().email(),
  role:     z.enum(['admin', 'agent', 'viewer']).default('agent'),
  password: z.string().min(8).max(128),
})

const patchRoleSchema = z.object({
  role: z.enum(['admin', 'agent', 'viewer']),
})

const uuidSchema = z.string().uuid()

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const teamRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /team/roles ──────────────────────────────────────────────────────
  // Registered before /:id routes to avoid param collision
  app.get('/roles', async (_req, reply) => {
    return reply.send({ data: AVAILABLE_ROLES })
  })

  // ─── GET /team/members ────────────────────────────────────────────────────
  app.get('/members', async (req, reply) => {
    const tenantId = req.agent.tenantId

    const members = await db.select({
      id:               agents.id,
      name:             agents.name,
      email:            agents.email,
      role:             agents.role,
      avatarUrl:        agents.avatarUrl,
      isActive:         agents.isActive,
      isOnline:         agents.isOnline,
      lastSeenAt:       agents.lastSeenAt,
      inviteAcceptedAt: agents.inviteAcceptedAt,
      createdAt:        agents.createdAt,
    })
      .from(agents)
      .where(and(
        eq(agents.tenantId, tenantId),
        eq(agents.isActive, true),
      ))

    return reply.send({ data: members, total: members.length })
  })

  // ─── POST /team/invite ────────────────────────────────────────────────────
  app.post('/invite', { preHandler: [requireRole(['admin', 'super_admin'])] }, async (req, reply) => {
    const parsed = inviteSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const tenantId = req.agent.tenantId
    const { name, email, role, password } = parsed.data

    // Check for existing active agent with same email in this tenant
    const [existing] = await db.select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.email, email)))

    if (existing) {
      return reply.status(409).send({ message: 'An agent with this email already exists in the team' })
    }

    const [created] = await db.insert(agents).values({
      tenantId,
      name,
      email,
      role,
      passwordHash:     hashPassword(password),
      invitedBy:        req.agent.id,
      inviteAcceptedAt: new Date(), // treat as accepted since password is provided
    }).returning({
      id:        agents.id,
      name:      agents.name,
      email:     agents.email,
      role:      agents.role,
      isActive:  agents.isActive,
      createdAt: agents.createdAt,
    })

    return reply.status(201).send(created)
  })

  // ─── PATCH /team/members/:id/role ─────────────────────────────────────────
  app.patch('/members/:id/role', { preHandler: [requireRole(['admin', 'super_admin'])] }, async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const parsed = patchRoleSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const tenantId = req.agent.tenantId

    const [existing] = await db.select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId), eq(agents.isActive, true)))

    if (!existing) return reply.status(404).send({ message: 'Team member not found' })

    const [updated] = await db.update(agents)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
      .returning({
        id:        agents.id,
        name:      agents.name,
        email:     agents.email,
        role:      agents.role,
        updatedAt: agents.updatedAt,
      })

    return reply.send(updated)
  })

  // ─── GET /team/performance ────────────────────────────────────────────────
  // Query params: ?startDate&endDate&period=week|month
  // Returns per-agent performance stats ordered by conversationsHandled DESC
  app.get('/performance', async (req, reply) => {
    const tenantId = req.agent.tenantId

    const query = req.query as { startDate?: string; endDate?: string; period?: string }

    // Compute date range from period or explicit dates
    const now = new Date()
    let start: Date
    let end: Date

    if (query.startDate) {
      start = new Date(query.startDate)
    } else if (query.period === 'week') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
    } else if (query.period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
    } else {
      // Default: last 30 days
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
    }
    end = query.endDate ? new Date(query.endDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    // Per-agent conversation stats: join conversations + agents
    // Group by assignedTo agent, count conversations, avg csat, resolution rate
    const convStats = await db
      .select({
        agentId: conversations.assignedTo,
        conversationsHandled: count(conversations.id),
        csatAvgRating: avg(conversations.csatScore).mapWith(Number),
        resolvedCount: sql<number>`cast(count(*) filter (where ${conversations.status} in ('resolved','closed')) as integer)`,
        avgResponseTimeSec: avg(conversations.resolutionTimeSeconds).mapWith(Number),
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          sql`${conversations.assignedTo} IS NOT NULL`,
          gte(conversations.createdAt, start),
          lte(conversations.createdAt, end),
        )
      )
      .groupBy(conversations.assignedTo)

    if (convStats.length === 0) {
      return reply.send({
        data: [],
        period: { startDate: start.toISOString(), endDate: end.toISOString() },
      })
    }

    // Collect agent IDs to fetch their names/avatars
    const agentIds = convStats
      .map(r => r.agentId)
      .filter((id): id is string => id !== null)

    const agentRows = await db
      .select({ id: agents.id, name: agents.name, avatarUrl: agents.avatarUrl })
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.isActive, true)))

    const agentMap = new Map(agentRows.map(a => [a.id, a]))

    // Per-agent message count: count messages sent by each agent in range
    const msgStats = await db
      .select({
        senderId: messages.senderId,
        totalMessages: count(messages.id),
      })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          sql`${messages.senderId} IS NOT NULL`,
          sql`${messages.senderType} = 'agent'`,
          gte(messages.createdAt, start),
          lte(messages.createdAt, end),
        )
      )
      .groupBy(messages.senderId)

    const msgMap = new Map(msgStats.map(m => [m.senderId, m.totalMessages]))

    // Compose final stats, filter out agents not in agentMap (deleted agents)
    const data = convStats
      .filter(r => r.agentId !== null && agentMap.has(r.agentId!))
      .map(r => {
        const agent = agentMap.get(r.agentId!)!
        const handled = r.conversationsHandled ?? 0
        const resolved = r.resolvedCount ?? 0
        return {
          agentId: r.agentId!,
          agentName: agent.name,
          agentAvatar: agent.avatarUrl ?? null,
          conversationsHandled: handled,
          avgResponseTimeSec: r.avgResponseTimeSec ?? null,
          csatAvgRating: r.csatAvgRating ?? null,
          resolutionRate: handled > 0 ? Number(((resolved / handled) * 100).toFixed(1)) : 0,
          totalMessages: msgMap.get(r.agentId!) ?? 0,
        }
      })
      .sort((a, b) => b.conversationsHandled - a.conversationsHandled)

    return reply.send({
      data,
      period: { startDate: start.toISOString(), endDate: end.toISOString() },
    })
  })

  // ─── DELETE /team/members/:id ─────────────────────────────────────────────
  app.delete('/members/:id', { preHandler: [requireRole(['admin', 'super_admin'])] }, async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const tenantId = req.agent.tenantId

    // Prevent self-deletion
    if (id === req.agent.id) {
      return reply.status(400).send({ message: 'You cannot remove yourself from the team' })
    }

    const [existing] = await db.select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId), eq(agents.isActive, true)))

    if (!existing) return reply.status(404).send({ message: 'Team member not found' })

    // Soft delete — set isActive=false
    await db.update(agents)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))

    return reply.status(204).send()
  })
}
