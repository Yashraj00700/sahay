import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import { setIO } from './lib/socket'

// Routes
import { authRoutes } from './routes/auth'
import { conversationRoutes } from './routes/conversations'
import { customerRoutes } from './routes/customers'
import { aiRoutes } from './routes/ai'
import { kbRoutes } from './routes/knowledge-base'
import { analyticsRoutes } from './routes/analytics'
import { settingsRoutes } from './routes/settings'
import { whatsappWebhook } from './routes/webhooks/whatsapp'
import { instagramWebhook } from './routes/webhooks/instagram'
import { shopifyWebhook } from './routes/webhooks/shopify'

// Workers
import { startWorkers } from './workers'

async function buildApp() {
  const isProd = process.env.NODE_ENV === 'production'

  const app = Fastify({
    logger: isProd
      ? { level: 'info' }
      : { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } },
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
  })

  // ─── Security ────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // handled by frontend
  })

  await app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down.',
    }),
  })

  // ─── Auth ─────────────────────────────────────────────────
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? '1h' },
  })

  await app.register(cookie, {
    secret: process.env.JWT_SECRET,
    parseOptions: { httpOnly: true, secure: process.env.NODE_ENV === 'production' },
  })

  // ─── Routes ───────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(conversationRoutes, { prefix: '/api/conversations' })
  await app.register(customerRoutes, { prefix: '/api/customers' })
  await app.register(aiRoutes, { prefix: '/api/ai' })
  await app.register(kbRoutes, { prefix: '/api/kb' })
  await app.register(analyticsRoutes, { prefix: '/api/analytics' })
  await app.register(settingsRoutes, { prefix: '/api/settings' })

  // Webhooks (no auth middleware — verified via HMAC)
  await app.register(whatsappWebhook, { prefix: '/webhooks' })
  await app.register(instagramWebhook, { prefix: '/webhooks' })
  await app.register(shopifyWebhook, { prefix: '/webhooks' })

  // ─── Health Check ─────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
  }))

  // ─── Socket.io ────────────────────────────────────────────
  const pubClient = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' })
  const subClient = pubClient.duplicate()

  await Promise.all([pubClient.connect(), subClient.connect()])

  const io = new Server(app.server, {
    cors: {
      origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    adapter: createAdapter(pubClient, subClient),
  })

  // Register io singleton for use in routes/workers
  setIO(io)

  // Attach io to app for use in routes (optional convenience)
  app.decorate('io', io)

  // Socket.io authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token as string
    if (!token) return next(new Error('Authentication required'))
    try {
      const payload = app.jwt.verify(token) as { tenantId: string; agentId: string }
      socket.data.tenantId = payload.tenantId
      socket.data.agentId = payload.agentId
      socket.join(`tenant:${payload.tenantId}`)
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    const { tenantId, agentId } = socket.data as { tenantId: string; agentId: string }
    app.log.info({ tenantId, agentId }, 'Agent connected via WebSocket')

    socket.on('agent:viewing', ({ conversationId }: { conversationId: string }) => {
      socket.to(`tenant:${tenantId}`).emit('agent:viewing', {
        agentId,
        conversationId,
        timestamp: new Date().toISOString(),
      })
    })

    socket.on('agent:typing:start', ({ conversationId }: { conversationId: string }) => {
      socket.to(`conversation:${conversationId}`).emit('agent:typing', {
        agentId, conversationId, isTyping: true,
      })
    })

    socket.on('agent:typing:stop', ({ conversationId }: { conversationId: string }) => {
      socket.to(`conversation:${conversationId}`).emit('agent:typing', {
        agentId, conversationId, isTyping: false,
      })
    })

    socket.on('disconnect', () => {
      app.log.info({ tenantId, agentId }, 'Agent disconnected')
    })
  })

  // ─── Error Handler ────────────────────────────────────────
  app.setErrorHandler((error: any, _request, reply) => {
    const statusCode = (error.statusCode as number) ?? 500
    logger.error({ err: error, statusCode }, String(error.message))

    reply.status(statusCode).send({
      statusCode,
      error: (error.name as string) ?? 'Internal Server Error',
      message: statusCode === 500 && process.env.NODE_ENV === 'production'
        ? 'Something went wrong. Please try again.'
        : String(error.message),
    })
  })

  return app
}

async function main() {
  const app = await buildApp()

  // Start BullMQ workers
  await startWorkers()

  const port = parseInt(process.env.PORT ?? '3001', 10)
  const host = process.env.HOST ?? '0.0.0.0'

  await app.listen({ port, host })
  app.log.info(`🚀 Sahay API running at http://${host}:${port}`)
}

main().catch((err) => {
  console.error('Fatal error starting server:', err)
  process.exit(1)
})
