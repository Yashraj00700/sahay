import {
  pgTable, uuid, text, boolean, timestamp, decimal, integer,
  bigint, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Identity
  phone: text('phone'),                     // E.164 format: +919876543210
  email: text('email'),
  name: text('name'),
  shopifyCustomerId: bigint('shopify_customer_id', { mode: 'bigint' }),
  // Channel identifiers
  whatsappId: text('whatsapp_id'),           // WA phone number
  instagramId: text('instagram_id'),
  // Profile
  city: text('city'),
  state: text('state'),
  country: text('country').default('IN'),
  languagePref: text('language_pref').default('auto'),
  // Shopify data (cached)
  totalOrders: integer('total_orders').default(0),
  totalSpent: decimal('total_spent', { precision: 12, scale: 2 }).default('0'),
  lastOrderAt: timestamp('last_order_at', { withTimezone: true }),
  // AI insights
  clvScore: decimal('clv_score', { precision: 5, scale: 2 }),
  churnRisk: text('churn_risk').default('low'),
  tier: text('tier').default('new'),
  sentiment7d: decimal('sentiment_7d', { precision: 3, scale: 2 }),
  // Tags & Notes
  tags: text('tags').array().default([]),
  notes: jsonb('notes').default([]),
  // DPDP Act Consent
  waSupportConsent: boolean('wa_support_consent').default(false),
  waMarketingConsent: boolean('wa_marketing_consent').default(false),
  consentTimestamp: timestamp('consent_timestamp', { withTimezone: true }),
  consentTextVersion: text('consent_text_version'),
  isOptout: boolean('is_optout').default(false),
  optoutAt: timestamp('optout_at', { withTimezone: true }),
  // Meta
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantPhoneIdx: uniqueIndex('idx_customers_tenant_phone').on(table.tenantId, table.phone),
  tenantShopifyIdx: uniqueIndex('idx_customers_tenant_shopify').on(table.tenantId, table.shopifyCustomerId),
  tenantWaIdx: uniqueIndex('idx_customers_tenant_wa').on(table.tenantId, table.whatsappId),
  tenantIgIdx: uniqueIndex('idx_customers_tenant_ig').on(table.tenantId, table.instagramId),
  tierIdx: index('idx_customers_tier').on(table.tenantId, table.tier),
}))

export type CustomerRecord = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
