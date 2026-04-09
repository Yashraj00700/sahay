/**
 * Auth route integration tests using Fastify inject (no real DB / Redis needed).
 *
 * Strategy:
 *  - Build a minimal Fastify instance with only the plugins the auth routes need
 *    (JWT, cookie, rate-limit, the auth plugin itself).
 *  - Mock @sahay/db so no real DB connections are made.
 *  - Mock ../../lib/redis so no real Redis connections are made.
 *  - Mock ../../services/audit so audit writes are no-ops.
 *  - Mock resend so emails are not sent.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'

// ── Mock heavy dependencies before importing the route ──────────────────────

vi.mock('@sahay/db', () => ({
  db: {
    query: {
      agents: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      tenants: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  },
  agents: {},
  tenants: {},
}))

vi.mock('../../../lib/redis', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}))

vi.mock('../../../services/audit', () => ({
  auditAction: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn().mockResolvedValue({ id: 'mock-email-id' }) },
  })),
}))

// ── Import route AFTER mocks are in place ────────────────────────────────────

import { authRoutes } from '../index'

// ── Build minimal test app ───────────────────────────────────────────────────

const TEST_JWT_SECRET = 'test-secret-32-chars-long-enough!'

async function buildTestApp() {
  const app = Fastify({ logger: false })

  await app.register(cookie, {
    secret: TEST_JWT_SECRET,
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  await app.register(jwt, {
    secret: TEST_JWT_SECRET,
    sign: { expiresIn: '1h' },
    cookie: { cookieName: 'accessToken', signed: false },
  })

  await app.register(authRoutes, { prefix: '/api/auth' })

  return app
}

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET
    app = await buildTestApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 400 when body is missing entirely', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.statusCode).toBe(400)
    expect(body.error).toBe('Validation Error')
  })

  it('returns 400 when email is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email', password: 'password123' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when password is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', password: 'short' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 for valid format but unknown credentials (no DB record)', async () => {
    // db.query.agents.findFirst returns null (mocked), so expect 401
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'unknown@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error).toBe('Unauthorized')
    expect(body.message).toBe('Invalid email or password')
  })
})

describe('GET /api/auth/me', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET
    app = await buildTestApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 401 when no token is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when an invalid Bearer token is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when a token signed with a different secret is provided', async () => {
    // Sign with wrong secret
    const wrongApp = Fastify({ logger: false })
    await wrongApp.register(jwt, { secret: 'wrong-secret-abcdefghijklmnopqrst' })
    const badToken = wrongApp.jwt.sign({ agentId: 'x', tenantId: 'y', role: 'agent', email: 'a@b.com' })
    await wrongApp.close()

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { Authorization: `Bearer ${badToken}` },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/auth/refresh', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET
    app = await buildTestApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 400 when refreshToken is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 when refreshToken is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'bad.token.value' },
    })
    expect(res.statusCode).toBe(401)
  })
})
