import { createHmac, timingSafeEqual } from 'crypto'
import type { FastifyPluginAsync } from 'fastify'
import { db, tenants } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { shopifySyncQueue, type ShopifySyncJob } from '../../lib/queues'

export const shopifyWebhook: FastifyPluginAsync = async (app) => {
  app.post('/shopify', {
    config: { rawBody: true },
  }, async (request, reply) => {
    // ─── 1. HMAC Verification ────────────────────────────────────
    const receivedHmac = request.headers['x-shopify-hmac-sha256'] as string | undefined
    if (!receivedHmac) {
      request.log.warn('Shopify webhook missing HMAC header')
      return reply.code(400).send('Missing signature')
    }

    const secret = process.env.SHOPIFY_WEBHOOK_SECRET
    if (!secret) {
      request.log.error('SHOPIFY_WEBHOOK_SECRET not configured')
      return reply.code(500).send('Server misconfiguration')
    }

    const rawBody = (request as any).rawBody as Buffer
    const computedHmac = createHmac('sha256', secret).update(rawBody).digest('base64')

    // Pad both buffers to the same length before timingSafeEqual to avoid length-leak throws
    const computedBuf = Buffer.from(computedHmac)
    const receivedBuf = Buffer.from(receivedHmac)
    if (
      computedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(computedBuf, receivedBuf)
    ) {
      request.log.warn('Shopify webhook HMAC verification failed')
      return reply.code(401).send('Unauthorized')
    }

    // ─── 2. Resolve Tenant by shop domain ────────────────────────
    const shopDomain = request.headers['x-shopify-shop-domain'] as string | undefined
    if (!shopDomain) {
      request.log.warn('Shopify webhook missing shop domain header')
      return reply.code(400).send('Missing shop domain')
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.shopifyDomain, shopDomain),
    })

    if (!tenant) {
      // Return 200 to prevent Shopify from retrying for an unknown shop
      request.log.warn({ shopDomain }, 'No tenant found for Shopify shop domain')
      return reply.code(200).send('OK')
    }

    const tenantId = tenant.id

    // ─── 3. Topic Routing ─────────────────────────────────────────
    const topic = request.headers['x-shopify-topic'] as string | undefined
    if (!topic) {
      request.log.warn('Shopify webhook missing topic header')
      return reply.code(400).send('Missing topic')
    }

    const body = request.body as Record<string, unknown>

    let job: ShopifySyncJob | null = null

    switch (topic) {
      case 'orders/create':
      case 'orders/updated':
      case 'orders/cancelled':
        job = { type: 'order', data: body, tenantId }
        break

      case 'products/update':
      case 'products/delete':
        job = { type: 'product', data: body, tenantId }
        break

      case 'customers/update':
        job = { type: 'customer', data: body, tenantId }
        break

      case 'fulfillments/create':
      case 'fulfillments/update':
        job = { type: 'fulfillment', data: body, tenantId }
        break

      default:
        request.log.debug({ topic, tenantId }, 'Unhandled Shopify webhook topic — ignoring')
        return reply.code(200).send('OK')
    }

    await shopifySyncQueue.add(topic, job)

    request.log.info({ topic, tenantId, shopDomain }, 'Shopify webhook enqueued')
    return reply.code(200).send('OK')
  })
}
