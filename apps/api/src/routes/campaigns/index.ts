import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.middleware'
import { db } from '@sahay/db'
import { tenants, customers } from '@sahay/db/schema'
import { eq, and } from 'drizzle-orm'
import { proactiveQueue } from '../../lib/queues'
import type { ProactiveJob } from '../../lib/queues'

// ─── NOTE ─────────────────────────────────────────────────────────────────────
// A dedicated `campaigns` table does not yet exist in the DB schema.
// All endpoints return graceful empty responses or stubs until the table is
// added and the imports below are uncommented.
// ─────────────────────────────────────────────────────────────────────────────

// import { campaigns } from '@sahay/db'
// import { desc, sql } from 'drizzle-orm'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

const createCampaignSchema = z.object({
  name:        z.string().min(1).max(255),
  type:        z.enum(['broadcast', 'drip', 'trigger']).default('broadcast'),
  channel:     z.enum(['whatsapp', 'instagram']).default('whatsapp'),
  templateId:  z.string().optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  audience:    z.object({
    tags:      z.array(z.string()).optional(),
    tier:      z.enum(['new', 'regular', 'vip', 'champion']).optional(),
    all:       z.boolean().optional(),
  }).optional(),
  metadata:    z.record(z.unknown()).optional(),
})

const patchCampaignSchema = createCampaignSchema.partial()

const uuidSchema = z.string().uuid()

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const campaignsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /campaigns ───────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query parameters', errors: parsed.error.flatten() })
    }

    // Campaigns table not yet created — return empty list gracefully
    return reply.send({
      data: [],
      pagination: {
        page:            parsed.data.page,
        pageSize:        parsed.data.pageSize,
        total:           0,
        totalPages:      0,
        hasNextPage:     false,
        hasPreviousPage: false,
      },
    })
  })

  // ─── POST /campaigns ──────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const parsed = createCampaignSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    // Campaigns table not yet created — return stub response
    return reply.status(501).send({
      message: 'Campaign creation is not yet available. The campaigns table has not been provisioned.',
      receivedData: parsed.data,
    })
  })

  // ─── GET /campaigns/:id ───────────────────────────────────────────────────
  app.get('/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    return reply.status(501).send({
      message: 'Campaigns are not yet available.',
    })
  })

  // ─── PATCH /campaigns/:id ─────────────────────────────────────────────────
  app.patch('/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const parsed = patchCampaignSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    return reply.status(501).send({
      message: 'Campaign updates are not yet available.',
    })
  })

  // ─── DELETE /campaigns/:id ────────────────────────────────────────────────
  app.delete('/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    return reply.status(501).send({
      message: 'Campaign deletion is not yet available.',
    })
  })

  // ─── POST /campaigns/cod-trigger ──────────────────────────────────────────
  // Triggered by a Shopify webhook (orders/create) when the payment method is
  // Cash on Delivery.  The caller passes the raw order context; this handler:
  //   1. Looks up the customer's WhatsApp number
  //   2. Checks whether the tenant has COD→Prepaid conversion enabled
  //   3. Reads the configured discount % and message delay from tenant settings
  //   4. Enqueues a delayed proactive WhatsApp message using the
  //      'cod_prepaid_offer' template
  //
  // This endpoint does NOT require agent auth — it is intended to be called
  // from the internal Shopify webhook pipeline (server-to-server).  A shared
  // secret check is performed instead.
  // ──────────────────────────────────────────────────────────────────────────

  const codTriggerSchema = z.object({
    orderId:     z.string(),
    customerId:  z.string(),          // Shopify customer ID (string or numeric)
    tenantId:    z.string().uuid(),
    orderTotal:  z.number().positive(),
    currency:    z.string().max(10).default('INR'),
  })

  app.post('/cod-trigger', {
    config: { skipAuth: true },
  }, async (req, reply) => {
    // ── Internal secret check ───────────────────────────────────────────────
    const internalSecret = process.env.INTERNAL_WEBHOOK_SECRET
    const provided       = req.headers['x-sahay-internal-secret'] as string | undefined

    if (internalSecret && provided !== internalSecret) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const parsed = codTriggerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const { orderId, customerId, tenantId, orderTotal, currency } = parsed.data

    // ── 1. Load tenant + COD settings ──────────────────────────────────────
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        id:                     true,
        codConversionSettings:  true,
      },
    })

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    // Parse COD settings (stored as JSON string)
    interface CodSettings {
      enabled:         boolean
      discountPercent: number
      delayHours:      number
    }

    let codSettings: CodSettings = { enabled: false, discountPercent: 10, delayHours: 1 }
    if (tenant.codConversionSettings) {
      try {
        codSettings = JSON.parse(tenant.codConversionSettings) as CodSettings
      } catch {
        req.log.warn({ tenantId }, '[CODTrigger] Failed to parse codConversionSettings — using defaults')
      }
    }

    if (!codSettings.enabled) {
      return reply.send({ queued: false, reason: 'COD conversion disabled for this tenant' })
    }

    // ── 2. Look up customer's WhatsApp number ──────────────────────────────
    // customerId from Shopify is a numeric string; stored as bigint in customers
    const shopifyCustomerIdBigInt = BigInt(customerId)

    const customer = await db.query.customers.findFirst({
      where: and(
        eq(customers.tenantId, tenantId),
        eq(customers.shopifyCustomerId, shopifyCustomerIdBigInt),
      ),
      columns: {
        id:          true,
        whatsappId:  true,
        phone:       true,
        isOptout:    true,
        waMarketingConsent: true,
      },
    })

    if (!customer) {
      return reply.status(404).send({ error: 'Customer not found for this tenant' })
    }

    if (customer.isOptout || !customer.waMarketingConsent) {
      return reply.send({ queued: false, reason: 'Customer opted out or no marketing consent' })
    }

    const recipientPhone = customer.whatsappId ?? customer.phone
    if (!recipientPhone) {
      return reply.send({ queued: false, reason: 'No WhatsApp number available for customer' })
    }

    // ── 3. Calculate discount amount and build template components ─────────
    const discountAmount   = ((orderTotal * codSettings.discountPercent) / 100).toFixed(2)
    const discountCode     = `COD2PRE-${orderId.toUpperCase().slice(-8)}`
    const delayMs          = codSettings.delayHours * 60 * 60 * 1000

    // WhatsApp template 'cod_prepaid_offer' expected parameters:
    //   {{1}} — discount percentage    e.g. "10"
    //   {{2}} — discount amount        e.g. "₹150.00"
    //   {{3}} — discount code          e.g. "COD2PRE-12345678"
    //   {{4}} — currency               e.g. "INR"
    const templateComponents: object[] = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: String(codSettings.discountPercent) },
          { type: 'text', text: `${currency === 'INR' ? '₹' : currency}${discountAmount}` },
          { type: 'text', text: discountCode },
          { type: 'text', text: currency },
        ],
      },
    ]

    const job: ProactiveJob = {
      tenantId,
      to:           recipientPhone,
      templateName: 'cod_prepaid_offer',
      languageCode: 'en_IN',
      components:   templateComponents,
      customerId:   customer.id,
    }

    // ── 4. Enqueue with delay ──────────────────────────────────────────────
    await proactiveQueue.add('cod-conversion', job, {
      delay: delayMs,
      jobId: `cod-${tenantId}-${orderId}`,   // idempotency: one message per order
    })

    req.log.info(
      { tenantId, orderId, customerId, delayHours: codSettings.delayHours },
      '[CODTrigger] COD conversion message enqueued',
    )

    return reply.send({
      queued:       true,
      discountCode,
      discountAmount,
      delayHours:   codSettings.delayHours,
      recipient:    recipientPhone,
    })
  })
}
