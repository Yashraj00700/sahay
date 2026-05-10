import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import { ZodError, z } from 'zod'
import { db, agents, tenants, withTenant as dbWithTenant, type Tx } from '@sahay/db'
import { and, eq } from 'drizzle-orm'
import { env } from './env'
import { verifyAccessToken } from './jwt'
import { AppError, AuthError, ValidationError } from './errors'
import { logger } from './logger'

export interface AuthedAgent {
  id: string
  tenantId: string
  role: string
  email: string
  name: string
}

export interface AuthedTenant {
  id: string
  shopifyDomain: string
  plan: string
  aiPersonaName: string
  aiLanguage: string
  aiTone: string
  aiConfidenceThreshold: string
}

export interface RequestContext {
  requestId: string
  ip: string
  userAgent: string
  agent?: AuthedAgent
  tenant?: AuthedTenant
}

export interface AuthedContext extends RequestContext {
  agent: AuthedAgent
  tenant: AuthedTenant
  /**
   * Run a callback inside a tenant-scoped transaction (Postgres RLS enforced
   * via `app.tenant_id`). Use this for any DB access in NEW routes:
   *
   *   const rows = await ctx.withTenant((tx) =>
   *     tx.query.conversations.findMany(...)
   *   )
   *
   * Existing routes that import `{ db }` from '@sahay/db' continue to work
   * (RLS does not activate without `set_config`), but they bypass the
   * defense-in-depth check. Migrate them progressively.
   *
   * TODO(rls): once all routes use this helper, drop the un-scoped `db`
   * export and switch the connection role to a non-BYPASSRLS role.
   */
  withTenant: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
}

export type Handler = (
  req: VercelRequest,
  res: VercelResponse,
  ctx: RequestContext,
) => Promise<unknown> | unknown

export type AuthedHandler = (
  req: VercelRequest,
  res: VercelResponse,
  ctx: AuthedContext,
) => Promise<unknown> | unknown

const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)

function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin
  if (origin && corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Request-Id',
  )
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}

function applySecurityHeaders(res: VercelResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

export interface HandlerOptions {
  methods?: ReadonlyArray<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>
}

export function defineHandler(handler: Handler, opts: HandlerOptions = {}) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID()
    res.setHeader('X-Request-Id', requestId)
    applySecurityHeaders(res)

    const log = logger.child({ requestId, method: req.method, path: req.url })

    if (applyCors(req, res)) return

    if (opts.methods && req.method && !opts.methods.includes(req.method as 'GET')) {
      res.setHeader('Allow', opts.methods.join(','))
      return sendError(res, 405, 'METHOD_NOT_ALLOWED' as const, 'Method not allowed', requestId)
    }

    const ctx: RequestContext = {
      requestId,
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
    }

    try {
      const result = await handler(req, res, ctx)
      if (!res.writableEnded && result !== undefined) {
        res.status(200).json(result)
      }
    } catch (err) {
      handleError(err, res, requestId, log)
    }
  }
}

export function defineAuthedHandler(handler: AuthedHandler, opts: HandlerOptions = {}) {
  return defineHandler(async (req, res, ctx) => {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new AuthError('Missing bearer token')
    }
    const token = auth.slice(7)
    let payload
    try {
      payload = verifyAccessToken(token)
    } catch {
      throw new AuthError('Invalid or expired token')
    }

    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, payload.agentId),
        eq(agents.tenantId, payload.tenantId),
        eq(agents.isActive, true),
      ),
    })
    if (!agent) throw new AuthError('Agent not found or inactive')

    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, payload.tenantId), eq(tenants.isActive, true)),
    })
    if (!tenant) throw new AuthError('Tenant not found or inactive')

    const authedCtx: AuthedContext = {
      ...ctx,
      agent: {
        id: agent.id,
        tenantId: agent.tenantId,
        role: agent.role,
        email: agent.email,
        name: agent.name,
      },
      tenant: {
        id: tenant.id,
        shopifyDomain: tenant.shopifyDomain,
        plan: tenant.plan,
        aiPersonaName: tenant.aiPersonaName ?? 'Sahay',
        aiLanguage: tenant.aiLanguage ?? 'hinglish',
        aiTone: tenant.aiTone ?? 'warm',
        aiConfidenceThreshold: tenant.aiConfidenceThreshold ?? '0.75',
      },
      // RLS-scoped DB helper. Each call opens a short transaction with
      // `app.tenant_id` set to the authed tenant's id, so even a missing
      // `WHERE tenant_id = ...` filter in route code cannot leak rows.
      withTenant: (fn) => dbWithTenant(tenant.id, fn),
    }
    return handler(req, res, authedCtx)
  }, opts)
}

export function requireRole(ctx: AuthedContext, allowed: ReadonlyArray<string>): void {
  if (!allowed.includes(ctx.agent.role)) {
    throw new AppError(
      'FORBIDDEN',
      `Requires one of: ${allowed.join(', ')}`,
      403,
    )
  }
}

export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new ValidationError('Invalid request body', result.error.flatten())
  }
  return result.data
}

export function parseQuery<S extends z.ZodTypeAny>(schema: S, query: unknown): z.output<S> {
  const result = schema.safeParse(query)
  if (!result.success) {
    throw new ValidationError('Invalid query parameters', result.error.flatten())
  }
  return result.data
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0].trim()
  if (Array.isArray(fwd) && fwd.length) return fwd[0]
  return (req.socket?.remoteAddress as string | undefined) ?? ''
}

function sendError(
  res: VercelResponse,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
) {
  res.status(status).json({
    error: { code, message, requestId, ...(details ? { details } : {}) },
  })
}

type AnyLogger = {
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  child: (bindings: Record<string, unknown>) => AnyLogger
}

function handleError(
  err: unknown,
  res: VercelResponse,
  requestId: string,
  log: AnyLogger,
) {
  if (err instanceof AppError) {
    log.warn({ err, code: err.code, status: err.statusCode }, err.message)
    return sendError(
      res,
      err.statusCode,
      err.code,
      err.expose ? err.message : 'Internal error',
      requestId,
      err.details,
    )
  }
  if (err instanceof ZodError) {
    log.warn({ issues: err.issues }, 'validation error')
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Invalid input',
      requestId,
      err.flatten(),
    )
  }
  log.error({ err }, 'unhandled error')
  const message =
    env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : err instanceof Error
        ? err.message
        : 'Unknown error'
  return sendError(res, 500, 'INTERNAL_ERROR', message, requestId)
}
