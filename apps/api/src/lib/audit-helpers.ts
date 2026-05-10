/**
 * Read-event audit helpers (DPDP Section 9 / GDPR Article 30).
 *
 * Each helper is a thin wrapper around `auditRead` that:
 *   1. Pulls actor / tenant / IP / userAgent / requestId from the AuthedContext
 *      so route code only has to pass the resource id (and optional filter).
 *   2. Redacts PII from filter payloads before they hit the audit table —
 *      we record filter *shape* (`hasSearch`, `page`, `pageSize`), never the
 *      actual phone/email/name the agent typed.
 *   3. Catches any error from the audit pipeline. Audit failures must NEVER
 *      crash the parent request, so all of these are safe to `void` from the
 *      route. (auditRead → auditAction itself also swallows DB errors; this
 *      try/catch is a second line of defense for any synchronous mistake
 *      such as building the metadata object.)
 *
 * Usage from a route:
 *
 *     // fire-and-forget — DO NOT await
 *     void auditConversationRead(ctx, id)
 */
import type { AuthedContext } from './handler'
import { auditRead, type AuditReadQuery } from '../services/audit'

type UnknownRecord = Record<string, unknown>

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Convert a raw user-supplied query object into a redacted audit-safe shape.
 *
 * Rules:
 *   - Free-text search inputs (`search`, `q`, `query`, `phone`, `email`,
 *     `name`) are reduced to a boolean `hasSearch` flag.
 *   - Pagination and enum-like filters (page, pageSize, status, channel,
 *     sortBy, sortDir, cursor presence, limit, assignedTo, unassigned,
 *     tier) are passed through — they are not PII.
 *   - Anything else is dropped to be safe.
 */
export function redactQueryForAudit(query: unknown): AuditReadQuery {
  if (!isPlainObject(query)) return {}

  const out: AuditReadQuery = {}
  const piiKeys = new Set(['search', 'q', 'query', 'phone', 'email', 'name'])
  const allowKeys = new Set([
    'page',
    'pageSize',
    'limit',
    'status',
    'channel',
    'sortBy',
    'sortDir',
    'assignedTo',
    'unassigned',
    'tier',
  ])

  let hasSearch = false
  for (const [key, value] of Object.entries(query)) {
    if (piiKeys.has(key)) {
      if (value !== undefined && value !== null && value !== '') hasSearch = true
      continue
    }
    if (key === 'cursor') {
      out.hasCursor = value !== undefined && value !== null && value !== ''
      continue
    }
    if (allowKeys.has(key)) {
      out[key] = value
    }
  }
  if (hasSearch) out.hasSearch = true
  return out
}

interface BaseAuditArgs {
  tenantId: string
  actorId: string
  actorEmail: string
  ipAddress?: string
  userAgent?: string
  requestId?: string
}

function baseFromCtx(ctx: AuthedContext): BaseAuditArgs {
  return {
    tenantId: ctx.tenant.id,
    actorId: ctx.agent.id,
    actorEmail: ctx.agent.email,
    ipAddress: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  }
}

async function safeAudit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    // Defense-in-depth: auditAction already swallows DB errors. This guards
    // against synchronous failures (e.g. metadata serialization) so a bad
    // audit call can never propagate up into the route handler.
    console.error('Audit helper failed (suppressed):', err)
  }
}

/**
 * Audit a single-conversation read (`GET /api/conversations/:id`).
 */
export function auditConversationRead(
  ctx: AuthedContext,
  conversationId: string,
): Promise<void> {
  return safeAudit(() =>
    auditRead({
      ...baseFromCtx(ctx),
      resourceType: 'conversation',
      resourceId: conversationId,
    }),
  )
}

/**
 * Audit a conversation list/search read (`GET /api/conversations`).
 *
 * `query` is the parsed query object — it is redacted before being stored.
 */
export function auditConversationListRead(
  ctx: AuthedContext,
  query: unknown,
): Promise<void> {
  return safeAudit(() =>
    auditRead({
      ...baseFromCtx(ctx),
      resourceType: 'conversation_list',
      query: redactQueryForAudit(query),
    }),
  )
}

/**
 * Audit a customer profile read (`GET /api/customers/:id`).
 */
export function auditCustomerRead(
  ctx: AuthedContext,
  customerId: string,
): Promise<void> {
  return safeAudit(() =>
    auditRead({
      ...baseFromCtx(ctx),
      resourceType: 'customer',
      resourceId: customerId,
    }),
  )
}

/**
 * Audit a customer list/search read (`GET /api/customers`).
 */
export function auditCustomerListRead(
  ctx: AuthedContext,
  query: unknown,
): Promise<void> {
  return safeAudit(() =>
    auditRead({
      ...baseFromCtx(ctx),
      resourceType: 'customer_list',
      query: redactQueryForAudit(query),
    }),
  )
}

/**
 * Audit a message-history read (`GET /api/conversations/:id/messages`).
 *
 * `messageCount` records how many rows the agent saw (NOT the message
 * bodies) — useful for spotting bulk-export / scraping behaviour.
 */
export function auditMessagesRead(
  ctx: AuthedContext,
  conversationId: string,
  messageCount: number,
): Promise<void> {
  return safeAudit(() =>
    auditRead({
      ...baseFromCtx(ctx),
      resourceType: 'conversation_messages',
      resourceId: conversationId,
      query: { messageCount },
    }),
  )
}
