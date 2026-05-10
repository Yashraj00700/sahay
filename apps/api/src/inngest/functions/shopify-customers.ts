import { eq, sql } from 'drizzle-orm'
import { db, customers } from '@sahay/db'
import { inngest } from '../client'

/**
 * shopify-customers (created + updated)
 *
 * Mirror Shopify customers/* webhooks into our local customers row.
 * Idempotent on (tenantId, shopifyCustomerId).
 */

async function upsertShopifyCustomer(
  tenantId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  if (!raw['id']) return
  const shopifyCustomerId = BigInt(String(raw['id']))

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
    email: (raw['email'] as string | null) ?? null,
    phone: (raw['phone'] as string | null) ?? null,
    name,
    totalOrders: Number(raw['orders_count'] ?? 0),
    totalSpent: String(raw['total_spent'] ?? '0'),
    updatedAt: new Date(),
  }

  if (existing) {
    await db.update(customers).set(values).where(eq(customers.id, existing.id))
  } else {
    await db.insert(customers).values(values)
  }
}

export const shopifyCustomersCreated = inngest.createFunction(
  {
    id: 'shopify-customers-created',
    retries: 5,
    concurrency: { limit: 50, key: 'event.data.tenantId' },
  },
  { event: 'shopify/customers.created' },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data
    await step.run('upsert', async () => upsertShopifyCustomer(tenantId, payload))
    return { ok: true }
  },
)

export const shopifyCustomersUpdated = inngest.createFunction(
  {
    id: 'shopify-customers-updated',
    retries: 5,
    concurrency: { limit: 50, key: 'event.data.tenantId' },
  },
  { event: 'shopify/customers.updated' },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data
    await step.run('upsert', async () => upsertShopifyCustomer(tenantId, payload))
    return { ok: true }
  },
)
