import { db, customers, conversations, knowledgeChunks } from '@sahay/db'
import { eq, and, sql } from 'drizzle-orm'
import { aiEmbedQueue, proactiveQueue, type ShopifySyncJob, type EmbedJob } from '../lib/queues'
import { logger } from '../lib/logger'

export async function processShopifySync(job: ShopifySyncJob): Promise<void> {
  const { type, tenantId, data } = job

  if (!data) {
    // Polling-style full sync — not handled here yet
    logger.info(`[shopify-sync] Polling sync type=${type} tenantId=${tenantId} — skipping (no data)`)
    return
  }

  switch (type) {
    case 'order':
      await handleOrder(tenantId, data)
      break
    case 'product':
      await handleProduct(tenantId, data)
      break
    case 'customer':
      await handleCustomer(tenantId, data)
      break
    case 'fulfillment':
      await handleFulfillment(tenantId, data)
      break
    default:
      logger.warn(`[shopify-sync] Unknown job type: ${type}`)
  }
}

// ─── Order Handler ────────────────────────────────────────────────────────────
// Upsert customer record with latest order statistics.
async function handleOrder(tenantId: string, data: Record<string, unknown>): Promise<void> {
  const shopifyCustomer = data['customer'] as Record<string, unknown> | undefined
  if (!shopifyCustomer) return

  const shopifyCustomerId = BigInt(shopifyCustomer['id'] as string | number)
  const email = (shopifyCustomer['email'] as string | undefined) ?? undefined
  const name = [shopifyCustomer['first_name'], shopifyCustomer['last_name']]
    .filter(Boolean)
    .join(' ') || undefined

  const ordersCount = Number((shopifyCustomer['orders_count'] as string | number | undefined) ?? 0)
  const totalSpent = String(shopifyCustomer['total_spent'] ?? '0')
  const lastOrderAt = data['created_at'] ? new Date(data['created_at'] as string) : undefined

  // Address fields
  const address = data['billing_address'] as Record<string, unknown> | undefined
  const city = (address?.['city'] as string | undefined) ?? undefined
  const state = (address?.['province'] as string | undefined) ?? undefined
  const country = (address?.['country_code'] as string | undefined) ?? undefined

  await db
    .insert(customers)
    .values({
      tenantId,
      shopifyCustomerId,
      email: email ?? null,
      name: name ?? null,
      totalOrders: ordersCount,
      totalSpent,
      lastOrderAt: lastOrderAt ?? null,
      city: city ?? null,
      state: state ?? null,
      country: country ?? 'IN',
    })
    .onConflictDoUpdate({
      target: [customers.tenantId, customers.shopifyCustomerId],
      set: {
        email: email ?? sql`excluded.email`,
        name: name ?? sql`excluded.name`,
        totalOrders: ordersCount,
        totalSpent,
        lastOrderAt: lastOrderAt ?? sql`excluded.last_order_at`,
        city: city ?? sql`excluded.city`,
        state: state ?? sql`excluded.state`,
        country: country ?? sql`excluded.country`,
        updatedAt: new Date(),
      },
    })

  logger.info(`[shopify-sync] order upserted customer shopifyId=${shopifyCustomerId} tenantId=${tenantId}`)

  // Proactive cancellation notification
  const isCancelled = data['financial_status'] === 'cancelled' || !!data['cancel_reason']
  if (isCancelled) {
    const customer = await db.query.customers.findFirst({
      where: and(
        eq(customers.tenantId, tenantId),
        eq(customers.shopifyCustomerId, shopifyCustomerId),
      ),
      columns: { id: true, phone: true, waMarketingConsent: true },
    })

    if (customer?.waMarketingConsent && customer?.phone) {
      const orderId = String(data['id'] ?? '')
      const orderName = (data['name'] as string | undefined) ?? orderId
      await proactiveQueue.add('order-update', {
        tenantId,
        to: customer.phone,
        templateName: 'order_cancelled',
        languageCode: 'en',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: orderName },
          ],
        }],
        customerId: customer.id,
      })
      logger.info(`[shopify-sync] order_cancelled proactive enqueued for shopifyCustomerId=${shopifyCustomerId} tenantId=${tenantId}`)
    }
  }
}

// ─── Product Handler ──────────────────────────────────────────────────────────
// Mark existing knowledge chunks stale and enqueue re-embedding.
async function handleProduct(tenantId: string, data: Record<string, unknown>): Promise<void> {
  const productId = String(data['id'] ?? '')
  if (!productId) return

  const isDelete = !data['published_at'] && data['status'] === 'archived'

  if (isDelete) {
    // Deactivate chunks for deleted/archived product
    await db
      .update(knowledgeChunks)
      .set({ isActive: false, lastUpdated: new Date() })
      .where(
        and(
          eq(knowledgeChunks.tenantId, tenantId),
          eq(knowledgeChunks.productId, productId),
        )
      )
    logger.info(`[shopify-sync] product chunks deactivated productId=${productId} tenantId=${tenantId}`)
    return
  }

  // Find existing chunks for this product
  const existingChunks = await db.query.knowledgeChunks.findMany({
    where: and(
      eq(knowledgeChunks.tenantId, tenantId),
      eq(knowledgeChunks.productId, productId),
    ),
    columns: { id: true },
  })

  if (existingChunks.length > 0) {
    // Mark chunks as stale (lastUpdated) so retrieval freshness logic can detect drift
    await db
      .update(knowledgeChunks)
      .set({ shopifyUpdatedAt: new Date(data['updated_at'] as string), lastUpdated: new Date() })
      .where(
        and(
          eq(knowledgeChunks.tenantId, tenantId),
          eq(knowledgeChunks.productId, productId),
        )
      )

    // Enqueue re-embedding for all affected chunks
    const embedJob: EmbedJob = {
      tenantId,
      chunkIds: existingChunks.map((c) => c.id),
      operation: 're-embed',
    }
    await aiEmbedQueue.add('re-embed-product', embedJob)
    logger.info(`[shopify-sync] product re-embed enqueued productId=${productId} chunks=${existingChunks.length} tenantId=${tenantId}`)
  } else {
    // No chunks yet — this will be populated during a full sync or manual import
    logger.info(`[shopify-sync] product updated but no chunks found yet productId=${productId} tenantId=${tenantId}`)
  }
}

// ─── Customer Handler ─────────────────────────────────────────────────────────
// Upsert customer identity and profile fields.
async function handleCustomer(tenantId: string, data: Record<string, unknown>): Promise<void> {
  const shopifyCustomerId = BigInt(data['id'] as string | number)
  const email = (data['email'] as string | undefined) ?? null
  const name = [data['first_name'], data['last_name']].filter(Boolean).join(' ') || null
  const phone = (data['phone'] as string | undefined) ?? null

  const address = (data['default_address'] as Record<string, unknown> | undefined)
  const city = (address?.['city'] as string | undefined) ?? null
  const state = (address?.['province'] as string | undefined) ?? null
  const country = (address?.['country_code'] as string | undefined) ?? null

  const ordersCount = Number((data['orders_count'] as string | number | undefined) ?? 0)
  const totalSpent = String(data['total_spent'] ?? '0')

  await db
    .insert(customers)
    .values({
      tenantId,
      shopifyCustomerId,
      email,
      name,
      phone,
      totalOrders: ordersCount,
      totalSpent,
      city,
      state,
      country: country ?? 'IN',
    })
    .onConflictDoUpdate({
      target: [customers.tenantId, customers.shopifyCustomerId],
      set: {
        email: email ?? sql`excluded.email`,
        name: name ?? sql`excluded.name`,
        phone: phone ?? sql`excluded.phone`,
        totalOrders: ordersCount,
        totalSpent,
        city: city ?? sql`excluded.city`,
        state: state ?? sql`excluded.state`,
        country: country ?? sql`excluded.country`,
        updatedAt: new Date(),
      },
    })

  logger.info(`[shopify-sync] customer upserted shopifyId=${shopifyCustomerId} tenantId=${tenantId}`)
}

// ─── Fulfillment Handler ──────────────────────────────────────────────────────
// Update the shopifyOrderId-linked conversation with fulfillment status context.
async function handleFulfillment(tenantId: string, data: Record<string, unknown>): Promise<void> {
  const orderId = String(data['order_id'] ?? '')
  if (!orderId) return

  const fulfillmentStatus = (data['status'] as string | undefined) ?? 'unknown'
  const trackingCompany = (data['tracking_company'] as string | undefined) ?? null
  const trackingNumbers = (data['tracking_numbers'] as string[] | undefined) ?? []
  const trackingUrls = (data['tracking_urls'] as string[] | undefined) ?? []
  const trackingNumber = trackingNumbers[0] ?? null

  // Build a compact context note to attach to the conversation's customFields
  const fulfillmentNote = {
    fulfillmentStatus,
    trackingCompany,
    trackingNumber,
    trackingUrl: trackingUrls[0] ?? null,
    updatedAt: new Date().toISOString(),
  }

  // Find open conversations linked to this Shopify order
  const linkedConversations = await db.query.conversations.findMany({
    where: and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.shopifyOrderId, orderId),
    ),
    columns: { id: true, customFields: true },
  })

  if (linkedConversations.length === 0) {
    logger.info(`[shopify-sync] fulfillment: no conversation linked to orderId=${orderId} tenantId=${tenantId}`)
  } else {
    for (const conv of linkedConversations) {
      const existing = (conv.customFields as Record<string, unknown>) ?? {}
      await db
        .update(conversations)
        .set({
          customFields: { ...existing, fulfillment: fulfillmentNote },
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conv.id))
    }

    logger.info(`[shopify-sync] fulfillment status=${fulfillmentStatus} applied to ${linkedConversations.length} conversation(s) orderId=${orderId} tenantId=${tenantId}`)
  }

  // Proactive WhatsApp update — look up customer via the order payload
  const orderData = data['order'] as Record<string, unknown> | undefined
  const shopifyCustomerRaw = orderData?.['customer'] as Record<string, unknown> | undefined
  const customerId = shopifyCustomerRaw?.['id']
  const orderName = (orderData?.['name'] as string | undefined) ?? orderId

  if (customerId) {
    const shopifyCustomerId = BigInt(customerId as string | number)
    const customer = await db.query.customers.findFirst({
      where: and(
        eq(customers.tenantId, tenantId),
        eq(customers.shopifyCustomerId, shopifyCustomerId),
      ),
      columns: { id: true, phone: true, waMarketingConsent: true },
    })

    if (customer?.waMarketingConsent && customer?.phone) {
      const templateName = fulfillmentStatus === 'success'
        ? 'order_shipped'
        : fulfillmentStatus === 'delivered'
        ? 'order_delivered'
        : null

      if (templateName) {
        await proactiveQueue.add('order-update', {
          tenantId,
          to: customer.phone,
          templateName,
          languageCode: 'en',
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: orderName },
              { type: 'text', text: trackingNumber ?? 'Track via our website' },
            ],
          }],
          customerId: customer.id,
        })
        logger.info(`[shopify-sync] ${templateName} proactive enqueued for customerId=${customer.id} orderId=${orderId} tenantId=${tenantId}`)
      }
    }
  }
}
