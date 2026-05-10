import { eq, sql } from 'drizzle-orm'
import { db, orders } from '@sahay/db'
import { inngest } from '../client'

/**
 * shopify-orders-created
 *
 * Mirror Shopify orders/create webhook into our local `orders` table so
 * downstream features (AI context, agent inbox, analytics) don't have to
 * round-trip Shopify on every read.
 *
 * Idempotent on (tenantId, shopifyOrderId).
 */
export const shopifyOrdersCreated = inngest.createFunction(
  {
    id: 'shopify-orders-created',
    retries: 5,
    concurrency: { limit: 50, key: 'event.data.tenantId' },
  },
  { event: 'shopify/orders.created' },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data
    return step.run('upsert', async () => {
      await upsertOrder(tenantId, payload)
      return { ok: true }
    })
  },
)

export const shopifyOrdersUpdated = inngest.createFunction(
  {
    id: 'shopify-orders-updated',
    retries: 5,
    concurrency: { limit: 50, key: 'event.data.tenantId' },
  },
  { event: 'shopify/orders.updated' },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data
    return step.run('upsert', async () => {
      await upsertOrder(tenantId, payload)
      return { ok: true }
    })
  },
)

export async function upsertOrder(
  tenantId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const shopifyOrderId = String(raw['id'] ?? '')
  if (!shopifyOrderId) return

  const existing = await db.query.orders.findFirst({
    where: sql`${orders.tenantId} = ${tenantId} AND ${orders.shopifyOrderId} = ${shopifyOrderId}`,
  })

  const totalPrice = String(raw['total_price'] ?? '0')
  const currency = String(raw['currency'] ?? 'INR')

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
