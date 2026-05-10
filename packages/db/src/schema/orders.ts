import {
  pgTable, uuid, text, timestamp, numeric, integer, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { customers } from './customers'

/**
 * Shopify order mirror. Populated by webhook fan-out functions
 * (`shopify/orders.created` etc.) so that downstream features (AI context,
 * analytics, agent inbox) can read order state from our own database without
 * an extra Shopify API round-trip.
 *
 * `rawPayload` keeps the last full webhook body so we can replay parsing
 * logic when fields evolve, and so debugging webhook regressions is cheap.
 */
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  // Shopify identity — keep as text to allow both numeric ids and gid:// urls
  shopifyOrderId: text('shopify_order_id').notNull(),
  shopifyOrderNumber: text('shopify_order_number'),
  // Customer linkage
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  shopifyCustomerId: text('shopify_customer_id'),
  email: text('email'),
  phone: text('phone'),
  // Status
  financialStatus: text('financial_status'),     // paid|pending|refunded|partially_refunded|...
  fulfillmentStatus: text('fulfillment_status'), // fulfilled|partial|null|restocked|...
  // Money
  currency: text('currency').notNull().default('INR'),
  totalPrice: numeric('total_price', { precision: 12, scale: 2 }).notNull(),
  subtotalPrice: numeric('subtotal_price', { precision: 12, scale: 2 }),
  totalTax: numeric('total_tax', { precision: 12, scale: 2 }),
  totalDiscounts: numeric('total_discounts', { precision: 12, scale: 2 }),
  // Line items
  lineItemCount: integer('line_item_count'),
  lineItems: jsonb('line_items'), // [{ title, quantity, price, sku, productId }]
  // Addresses
  shippingAddress: jsonb('shipping_address'),
  billingAddress: jsonb('billing_address'),
  // Metadata
  tags: text('tags'),
  note: text('note'),
  // Lifecycle
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  // Timestamps — `createdAt` / `updatedAt` reflect Shopify's own fields,
  // not Sahay's row insertion time. `syncedAt` is our local clock.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  rawPayload: jsonb('raw_payload'),
}, (table) => ({
  tenantOrderIdx: uniqueIndex('idx_orders_tenant_shopify_order')
    .on(table.tenantId, table.shopifyOrderId),
  tenantCustomerIdx: index('idx_orders_tenant_customer')
    .on(table.tenantId, table.customerId),
  tenantCreatedIdx: index('idx_orders_tenant_created')
    .on(table.tenantId, table.createdAt),
}))

export type OrderRecord = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
