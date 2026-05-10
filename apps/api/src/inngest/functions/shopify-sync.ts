import { eq, sql } from 'drizzle-orm'
import {
  db,
  tenants,
  customers,
  orders,
  knowledgeChunks,
} from '@sahay/db'
import { inngest } from '../client'
import { ShopifyClient, SHOPIFY_API_VERSION } from '../../services/shopify/client'

/**
 * shopify-sync
 *
 * Backfill / refresh sync for one resource of a tenant. This is the
 * "pull" sync used for cold-start backfills and the daily KB refresh
 * cron — webhooks handle live deltas separately.
 *
 * For each resource type:
 *   - products:  paginate /admin/api/<v>/products.json and upsert into
 *                knowledge_chunks (one chunk per product). Each upserted
 *                chunk fans out an `ai/embed.requested` so the embedding
 *                pipeline keeps the vector index fresh.
 *   - orders:    paginate /orders.json and upsert into the orders mirror.
 *   - customers: paginate /customers.json and upsert into customers.
 *   - inventory: paginate /inventory_levels.json. We don't have a local
 *                inventory table (TODO P0.11) so we log totals only.
 *
 * Concurrency: 1 per tenant — running two big syncs in parallel for the
 * same shop blows past Shopify's leaky-bucket limits.
 * Retries: 5 with Inngest exponential backoff.
 */
export const shopifySync = inngest.createFunction(
  {
    id: 'shopify-sync',
    retries: 5,
    concurrency: { limit: 1, key: 'event.data.tenantId' },
  },
  { event: 'shopify/sync.requested' },
  async ({ event, step, logger }) => {
    const { tenantId, resource, since } = event.data

    const tenant = await step.run('load-tenant', async () => {
      const row = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      })
      if (!row) throw new Error(`shopify-sync: tenant ${tenantId} not found`)
      return {
        shopifyDomain: row.shopifyDomain,
        accessToken: row.shopifyAccessToken,
      }
    })

    const client = new ShopifyClient(tenant.shopifyDomain, tenant.accessToken)

    if (resource === 'products') {
      return step.run('sync-products', async () => {
        const path = `/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250${
          since ? `&updated_at_min=${encodeURIComponent(since)}` : ''
        }`
        const resp = await client.rest.get<{
          products: Array<{
            id: number | string
            title?: string
            body_html?: string | null
            vendor?: string
            product_type?: string
            handle?: string
            updated_at?: string
            tags?: string
          }>
        }>(path)
        const products = resp.products ?? []

        const upserted: string[] = []
        for (const p of products) {
          const sourceId = String(p.id)
          const content = stripHtml(p.body_html ?? '') || (p.title ?? '')
          if (!content.trim()) continue

          // Look up existing chunk for this product (we keep one chunk
          // per product for the bulk sync; per-section chunking is a
          // future improvement that lives in the dedicated re-chunker).
          const existing = await db.query.knowledgeChunks.findFirst({
            where: sql`${knowledgeChunks.tenantId} = ${tenantId}
              AND ${knowledgeChunks.sourceType} = 'product'
              AND ${knowledgeChunks.sourceId} = ${sourceId}`,
          })

          if (existing) {
            await db
              .update(knowledgeChunks)
              .set({
                title: p.title ?? existing.title,
                content,
                productName: p.title ?? existing.productName,
                category: p.product_type ?? existing.category,
                shopifyUpdatedAt: p.updated_at ? new Date(p.updated_at) : existing.shopifyUpdatedAt,
                lastUpdated: new Date(),
                isActive: true,
              })
              .where(eq(knowledgeChunks.id, existing.id))
            upserted.push(existing.id)
          } else {
            const [created] = await db
              .insert(knowledgeChunks)
              .values({
                tenantId,
                sourceType: 'product',
                sourceId,
                title: p.title ?? null,
                content,
                productId: sourceId,
                productName: p.title ?? null,
                category: p.product_type ?? null,
                shopifyUpdatedAt: p.updated_at ? new Date(p.updated_at) : null,
              })
              .returning({ id: knowledgeChunks.id })
            if (created) upserted.push(created.id)
          }
        }

        // Fan out embedding work for each upserted chunk.
        for (const kbChunkId of upserted) {
          await inngest.send({
            name: 'ai/embed.requested',
            data: { tenantId, kbChunkId },
          })
        }

        logger.info(
          { tenantId, count: products.length, embedded: upserted.length },
          'shopify-sync: products synced',
        )
        return { resource, count: products.length, embedded: upserted.length }
      })
    }

    if (resource === 'orders') {
      return step.run('sync-orders', async () => {
        const path = `/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=250&status=any${
          since ? `&updated_at_min=${encodeURIComponent(since)}` : ''
        }`
        const resp = await client.rest.get<{
          orders: Array<Record<string, unknown>>
        }>(path)
        const list = resp.orders ?? []

        for (const o of list) {
          await upsertOrder(tenantId, o)
        }
        logger.info({ tenantId, count: list.length }, 'shopify-sync: orders synced')
        return { resource, count: list.length }
      })
    }

    if (resource === 'customers') {
      return step.run('sync-customers', async () => {
        const path = `/admin/api/${SHOPIFY_API_VERSION}/customers.json?limit=250${
          since ? `&updated_at_min=${encodeURIComponent(since)}` : ''
        }`
        const resp = await client.rest.get<{
          customers: Array<Record<string, unknown>>
        }>(path)
        const list = resp.customers ?? []

        for (const c of list) {
          await upsertCustomer(tenantId, c)
        }
        logger.info({ tenantId, count: list.length }, 'shopify-sync: customers synced')
        return { resource, count: list.length }
      })
    }

    if (resource === 'inventory') {
      // TODO(P0.11): persist inventory levels into a dedicated table.
      logger.warn(
        { tenantId },
        'shopify-sync: inventory resource not yet persisted — skipping (TODO P0.11)',
      )
      return { resource, skipped: true }
    }

    return { resource, skipped: true, reason: 'unknown_resource' }
  },
)

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function upsertOrder(tenantId: string, raw: Record<string, unknown>): Promise<void> {
  const shopifyOrderId = String(raw['id'] ?? '')
  if (!shopifyOrderId) return
  const totalPrice = String(raw['total_price'] ?? '0')
  const currency = String(raw['currency'] ?? 'INR')

  const existing = await db.query.orders.findFirst({
    where: sql`${orders.tenantId} = ${tenantId} AND ${orders.shopifyOrderId} = ${shopifyOrderId}`,
  })

  const values = {
    tenantId,
    shopifyOrderId,
    shopifyOrderNumber: raw['name'] ? String(raw['name']) : null,
    shopifyCustomerId: raw['customer']
      ? String((raw['customer'] as { id?: unknown }).id ?? '')
      : null,
    email: (raw['email'] as string | null) ?? null,
    phone: (raw['phone'] as string | null) ?? null,
    financialStatus: (raw['financial_status'] as string | null) ?? null,
    fulfillmentStatus: (raw['fulfillment_status'] as string | null) ?? null,
    currency,
    totalPrice,
    subtotalPrice: raw['subtotal_price'] ? String(raw['subtotal_price']) : null,
    totalTax: raw['total_tax'] ? String(raw['total_tax']) : null,
    totalDiscounts: raw['total_discounts'] ? String(raw['total_discounts']) : null,
    lineItemCount: Array.isArray(raw['line_items']) ? (raw['line_items'] as unknown[]).length : null,
    lineItems: raw['line_items'] ?? null,
    shippingAddress: raw['shipping_address'] ?? null,
    billingAddress: raw['billing_address'] ?? null,
    tags: (raw['tags'] as string | null) ?? null,
    note: (raw['note'] as string | null) ?? null,
    cancelledAt: raw['cancelled_at'] ? new Date(String(raw['cancelled_at'])) : null,
    cancelReason: (raw['cancel_reason'] as string | null) ?? null,
    fulfilledAt: raw['closed_at'] ? new Date(String(raw['closed_at'])) : null,
    rawPayload: raw,
    syncedAt: new Date(),
  }

  if (existing) {
    await db.update(orders).set(values).where(eq(orders.id, existing.id))
  } else {
    await db.insert(orders).values({
      ...values,
      createdAt: raw['created_at'] ? new Date(String(raw['created_at'])) : new Date(),
      updatedAt: raw['updated_at'] ? new Date(String(raw['updated_at'])) : new Date(),
    })
  }
}

async function upsertCustomer(tenantId: string, raw: Record<string, unknown>): Promise<void> {
  const shopifyCustomerId = raw['id'] ? BigInt(String(raw['id'])) : null
  if (shopifyCustomerId === null) return
  const email = (raw['email'] as string | null) ?? null
  const phone = (raw['phone'] as string | null) ?? null

  const existing = await db.query.customers.findFirst({
    where: sql`${customers.tenantId} = ${tenantId}
      AND ${customers.shopifyCustomerId} = ${shopifyCustomerId}`,
  })

  const firstName = (raw['first_name'] as string | null) ?? ''
  const lastName = (raw['last_name'] as string | null) ?? ''
  const name = `${firstName} ${lastName}`.trim() || null

  const values = {
    tenantId,
    shopifyCustomerId,
    email,
    phone,
    name,
    totalOrders: Number(raw['orders_count'] ?? 0),
    totalSpent: String(raw['total_spent'] ?? '0'),
  }

  if (existing) {
    await db.update(customers).set(values).where(eq(customers.id, existing.id))
  } else {
    await db.insert(customers).values(values)
  }
}
