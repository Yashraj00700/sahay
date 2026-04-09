import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { conversations, messages, customers, agents } from '@sahay/db'
import { eq, and, desc, asc, sql, isNull, lt, gte, lte, or, inArray } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth.middleware'
import { auditAction } from '../../services/audit'
import { getIO } from '../../lib/socket'
import { csatQueue } from '../../lib/queues'

// ─── Request schemas ─────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.enum(['open', 'pending', 'snoozed', 'resolved', 'closed', 'all']).default('open'),
  channel: z.enum(['whatsapp', 'instagram', 'webchat', 'email', 'all']).default('all'),
  assignedTo: z.string().optional(), // uuid or 'unassigned'
  unassigned: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['createdAt', 'updatedAt', 'urgencyScore']).default('updatedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

const patchConversationSchema = z.object({
  status: z.enum(['open', 'pending', 'snoozed', 'resolved', 'closed']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  snoozeUntil: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  urgencyScore: z.number().int().min(1).max(5).optional(),
})

const addNoteSchema = z.object({
  content: z.string().min(1).max(4000),
})

const assignSchema = z.object({
  agentId: z.string().uuid().nullable(),
})

const messagesQuerySchema = z.object({
  cursor: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const uuidSchema = z.string().uuid()

const bulkActionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['resolve', 'assign']),
  assignTo: z.string().uuid().optional(),
})

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /conversations ───────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query parameters', errors: parsed.error.flatten() })
    }

    const q = parsed.data
    const tenantId = req.tenant.id
    const offset = (q.page - 1) * q.pageSize

    const conditions = [eq(conversations.tenantId, tenantId)]
    if (q.status !== 'all') conditions.push(eq(conversations.status, q.status))
    if (q.channel !== 'all') conditions.push(eq(conversations.channel, q.channel))

    // assignedTo can be a UUID or the literal string 'unassigned'
    if (q.assignedTo === 'unassigned') {
      conditions.push(isNull(conversations.assignedTo))
    } else if (q.assignedTo) {
      conditions.push(eq(conversations.assignedTo, q.assignedTo))
    }
    if (q.unassigned) conditions.push(isNull(conversations.assignedTo))

    // Full-text search on customer name and phone
    if (q.search) {
      const term = `%${q.search}%`
      conditions.push(
        or(
          sql`${customers.name} ILIKE ${term}`,
          sql`${customers.phone} ILIKE ${term}`,
        )!
      )
    }

    // Date range filters (on conversations.createdAt)
    if (q.dateFrom) conditions.push(gte(conversations.createdAt, new Date(q.dateFrom)))
    if (q.dateTo) conditions.push(lte(conversations.createdAt, new Date(q.dateTo)))

    const sortColMap = {
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      urgencyScore: conversations.urgencyScore,
    }
    const sortCol = sortColMap[q.sortBy]
    const sortFn = q.sortDir === 'asc' ? asc : desc

    const [rows, countResult] = await Promise.all([
      db.select({
        id: conversations.id,
        channel: conversations.channel,
        status: conversations.status,
        primaryIntent: conversations.primaryIntent,
        sentiment: conversations.sentiment,
        urgencyScore: conversations.urgencyScore,
        aiHandled: conversations.aiHandled,
        humanTouched: conversations.humanTouched,
        assignedTo: conversations.assignedTo,
        tags: conversations.tags,
        turnCount: conversations.turnCount,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        resolvedAt: conversations.resolvedAt,
        customerId: customers.id,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerTier: customers.tier,
        agentName: agents.name,
      })
        .from(conversations)
        .leftJoin(customers, eq(conversations.customerId, customers.id))
        .leftJoin(agents, eq(conversations.assignedTo, agents.id))
        .where(and(...conditions))
        .orderBy(sortFn(sortCol))
        .limit(q.pageSize)
        .offset(offset),

      // Must join customers when search is active (conditions reference customers columns)
      q.search
        ? db.select({ count: sql<number>`cast(count(*) as integer)` })
            .from(conversations)
            .leftJoin(customers, eq(conversations.customerId, customers.id))
            .where(and(...conditions))
        : db.select({ count: sql<number>`cast(count(*) as integer)` })
            .from(conversations)
            .where(and(...conditions)),
    ])

    const total = countResult[0]?.count ?? 0
    const totalPages = Math.ceil(total / q.pageSize)

    return reply.send({
      data: rows,
      pagination: {
        page: q.page, pageSize: q.pageSize, total, totalPages,
        hasNextPage: q.page < totalPages, hasPreviousPage: q.page > 1
      },
    })
  })

  // ─── GET /conversations/:id ────────────────────────────────────────────────
  app.get('/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data

    const [row] = await db.select({
      id: conversations.id,
      tenantId: conversations.tenantId,
      customerId: conversations.customerId,
      channel: conversations.channel,
      status: conversations.status,
      assignedTo: conversations.assignedTo,
      primaryIntent: conversations.primaryIntent,
      sentiment: conversations.sentiment,
      sentimentScore: conversations.sentimentScore,
      urgencyScore: conversations.urgencyScore,
      aiHandled: conversations.aiHandled,
      humanTouched: conversations.humanTouched,
      escalationReason: conversations.escalationReason,
      routingDecision: conversations.routingDecision,
      firstReplyAt: conversations.firstReplyAt,
      resolvedAt: conversations.resolvedAt,
      sessionExpiresAt: conversations.sessionExpiresAt,
      csatScore: conversations.csatScore,
      resolutionTimeSeconds: conversations.resolutionTimeSeconds,
      turnCount: conversations.turnCount,
      tags: conversations.tags,
      shopifyOrderId: conversations.shopifyOrderId,
      codConversionOffered: conversations.codConversionOffered,
      codConversionAccepted: conversations.codConversionAccepted,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      customerTier: customers.tier,
      customerWhatsappId: customers.whatsappId,
      customerLanguagePref: customers.languagePref,
      agentName: agents.name,
      agentEmail: agents.email,
    })
      .from(conversations)
      .leftJoin(customers, eq(conversations.customerId, customers.id))
      .leftJoin(agents, eq(conversations.assignedTo, agents.id))
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id)))

    if (!row) return reply.status(404).send({ message: 'Conversation not found' })
    return reply.send(row)
  })

  // ─── GET /conversations/:id/messages ──────────────────────────────────────
  app.get('/:id/messages', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data

    const qParsed = messagesQuerySchema.safeParse(req.query)
    if (!qParsed.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', errors: qParsed.error.flatten() })
    }
    const { cursor, limit } = qParsed.data

    const [conv] = await db.select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id)))
    if (!conv) return reply.status(404).send({ message: 'Conversation not found' })

    const conditions = [eq(messages.conversationId, id)]
    if (cursor) conditions.push(lt(messages.sentAt, new Date(cursor)))

    const rows = await db.select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.sentAt))
      .limit(limit)

    return reply.send({
      messages: rows.reverse(), // chronological for chat display
      nextCursor: rows.length === limit ? rows[0]?.sentAt?.toISOString() : null,
    })
  })

  // ─── PATCH /conversations/:id ──────────────────────────────────────────────
  app.patch('/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const parsed = patchConversationSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const [existing] = await db.select({ id: conversations.id, createdAt: conversations.createdAt, status: conversations.status, customerId: conversations.customerId })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id)))
    if (!existing) return reply.status(404).send({ message: 'Not found' })

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    const becomingResolved = parsed.data.status === 'resolved' && existing.status !== 'resolved'

    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status
      if (becomingResolved) {
        updates.resolvedAt = new Date()
        updates.resolutionTimeSeconds = Math.floor(
          (Date.now() - (existing.createdAt?.getTime() ?? Date.now())) / 1000
        )
      }
    }
    if (parsed.data.assignedTo !== undefined) {
      updates.assignedTo = parsed.data.assignedTo
      if (parsed.data.assignedTo !== null) updates.humanTouched = true
    }
    if (parsed.data.snoozeUntil) {
      updates.snoozeUntil = new Date(parsed.data.snoozeUntil)
      updates.status = 'snoozed'
    }
    if (parsed.data.tags !== undefined) updates.tags = parsed.data.tags
    if (parsed.data.urgencyScore !== undefined) updates.urgencyScore = parsed.data.urgencyScore

    const [updated] = await db.update(conversations)
      .set(updates as any)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id)))
      .returning()

    // Emit real-time update
    const socketIo = getIO()
    socketIo?.to(`tenant:${req.tenant.id}`).emit('conversation:updated', updated)

    await auditAction({
      tenantId: req.tenant.id,
      actorId: req.agent.id,
      actorType: 'agent',
      action: 'conversation.updated',
      resourceType: 'conversation',
      resourceId: id,
      metadata: parsed.data,
    })

    // Dispatch CSAT survey when conversation is newly resolved
    if (becomingResolved && existing.customerId) {
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, existing.customerId),
        columns: { phone: true, name: true, isOptout: true, waSupportConsent: true },
      })
      if (customer?.phone && !customer.isOptout && customer.waSupportConsent) {
        csatQueue.add('send-survey', {
          tenantId:      req.tenant.id,
          conversationId: id,
          customerId:    existing.customerId,
          customerPhone: customer.phone,
          customerName:  customer.name ?? 'there',
        }).catch((err) => req.log.error({ err }, '[CSAT] Failed to enqueue survey job'))
      }
    }

    return reply.send(updated)
  })

  // ─── POST /conversations/:id/assign ───────────────────────────────────────
  app.post('/:id/assign', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data

    const parsed = assignSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', errors: parsed.error.flatten() })
    }
    const { agentId } = parsed.data

    const [updated] = await db.update(conversations)
      .set({ assignedTo: agentId ?? null, humanTouched: agentId !== null, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id)))
      .returning()

    if (!updated) return reply.status(404).send({ message: 'Not found' })
    const socketIo = getIO()
    socketIo?.to(`tenant:${req.tenant.id}`).emit('conversation:updated', updated)
    return reply.send(updated)
  })

  // ─── POST /conversations/:id/notes (internal agent note) ──────────────────
  app.post('/:id/notes', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const parsed = addNoteSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid body' })

    const [conv] = await db.select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id)))
    if (!conv) return reply.status(404).send({ message: 'Not found' })

    const [note] = await db.insert(messages).values({
      conversationId: id,
      tenantId: req.tenant.id,
      senderType: 'agent',
      senderId: req.agent.id,
      contentType: 'note',
      content: parsed.data.content,
    }).returning()

    const socketIo = getIO()
    socketIo?.to(`tenant:${req.tenant.id}`).emit('message:new', note)
    return reply.status(201).send(note)
  })

  // ─── POST /conversations/:id/resolve ──────────────────────────────────────
  app.post('/:id/resolve', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const [existing] = await db.select({ createdAt: conversations.createdAt, customerId: conversations.customerId, status: conversations.status })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id)))
    if (!existing) return reply.status(404).send({ message: 'Not found' })

    // Guard: only dispatch CSAT once (skip if already resolved)
    const becomingResolved = existing.status !== 'resolved'

    const [updated] = await db.update(conversations).set({
      status: 'resolved',
      resolvedAt: new Date(),
      resolutionTimeSeconds: Math.floor((Date.now() - (existing.createdAt?.getTime() ?? Date.now())) / 1000),
      updatedAt: new Date(),
    }).where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id))).returning()

    const socketIo = getIO()
    socketIo?.to(`tenant:${req.tenant.id}`).emit('conversation:updated', updated)

    // Dispatch CSAT survey when conversation is newly resolved
    if (becomingResolved && existing.customerId) {
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, existing.customerId),
        columns: { phone: true, name: true, isOptout: true, waSupportConsent: true },
      })
      if (customer?.phone && !customer.isOptout && customer.waSupportConsent) {
        csatQueue.add('send-survey', {
          tenantId:       req.tenant.id,
          conversationId: id,
          customerId:     existing.customerId,
          customerPhone:  customer.phone,
          customerName:   customer.name ?? 'there',
        }).catch((err) => req.log.error({ err }, '[CSAT] Failed to enqueue survey job'))
      }
    }

    return reply.send(updated)
  })

  // ─── POST /conversations/:id/reopen ───────────────────────────────────────
  app.post('/:id/reopen', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const [updated] = await db.update(conversations)
      .set({ status: 'open', resolvedAt: null as any, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, req.tenant.id)))
      .returning()

    if (!updated) return reply.status(404).send({ message: 'Not found' })
    const socketIo = getIO()
    socketIo?.to(`tenant:${req.tenant.id}`).emit('conversation:updated', updated)
    return reply.send(updated)
  })

  // ─── PATCH /conversations/bulk ─────────────────────────────────────────────
  app.patch('/bulk', async (req, reply) => {
    const parsed = bulkActionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const { ids, action, assignTo } = parsed.data
    const tenantId = req.tenant.id

    // Verify all IDs belong to this tenant
    const owned = await db.select({ id: conversations.id })
      .from(conversations)
      .where(and(inArray(conversations.id, ids), eq(conversations.tenantId, tenantId)))

    if (owned.length !== ids.length) {
      return reply.status(403).send({ message: 'One or more conversation IDs not found or not accessible' })
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (action === 'resolve') {
      updates.status = 'resolved'
      updates.resolvedAt = new Date()
    } else if (action === 'assign') {
      if (!assignTo) {
        return reply.status(400).send({ message: 'assignTo is required for assign action' })
      }
      updates.assignedTo = assignTo
      updates.humanTouched = true
    }

    await db.update(conversations)
      .set(updates as any)
      .where(and(inArray(conversations.id, ids), eq(conversations.tenantId, tenantId)))

    const socketIo = getIO()
    socketIo?.to(`tenant:${tenantId}`).emit('conversations:bulk_updated', { ids, action })

    await auditAction({
      tenantId,
      actorId: req.agent.id,
      actorType: 'agent',
      action: 'conversations.bulk_updated',
      resourceType: 'conversation',
      resourceId: ids.join(','),
      metadata: { action, assignTo, count: ids.length },
    })

    return reply.send({ updated: ids.length })
  })
}
