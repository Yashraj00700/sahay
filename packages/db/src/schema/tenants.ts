import {
  pgTable, uuid, text, boolean, timestamp, real, index, uniqueIndex,
} from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Shopify
  shopifyDomain: text('shopify_domain').notNull().unique(),
  shopifyAccessToken: text('shopify_access_token').notNull(),
  shopName: text('shop_name').notNull(),
  shopEmail: text('shop_email'),
  shopCurrency: text('shop_currency').default('INR'),
  // Billing
  plan: text('plan').notNull().default('trial'),
  planStartedAt: timestamp('plan_started_at', { withTimezone: true }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  // WhatsApp
  whatsappPhoneNumberId: text('whatsapp_phone_number_id'),
  whatsappToken: text('whatsapp_token'),
  whatsappVerifyToken: text('whatsapp_verify_token'),
  whatsappBusinessAccountId: text('whatsapp_business_account_id'),
  waAppSecret: text('wa_app_secret'), // per-tenant WhatsApp App Secret for HMAC verification
  // Instagram
  instagramPageId: text('instagram_page_id'),
  instagramToken: text('instagram_token'),
  // AI Config
  aiPersonaName: text('ai_persona_name').default('Sahay'),
  aiLanguage: text('ai_language').default('hinglish'),
  aiTone: text('ai_tone').default('warm'),
  aiConfidenceThreshold: real('ai_confidence_threshold').default(0.75),
  aiBrandVoice: text('ai_brand_voice'), // free text describing brand voice
  aiProhibitedPhrases: text('ai_prohibited_phrases').array().default([]),
  aiPreferredPhrases: text('ai_preferred_phrases').array().default([]),
  // Settings
  timezone: text('timezone').default('Asia/Kolkata'),
  businessHours: text('business_hours'), // JSON string of hours config
  slaPolicies: text('sla_policies'), // JSON string
  codConversionSettings: text('cod_conversion_settings'), // JSON: { enabled, discountPercent, delayHours }
  // Status
  isActive: boolean('is_active').default(true),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  // Metadata
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  shopifyDomainIdx: uniqueIndex('idx_tenants_shopify_domain').on(table.shopifyDomain),
  planIdx: index('idx_tenants_plan').on(table.plan),
}))

export type Tenant = typeof tenants.$inferSelect
export type NewTenant = typeof tenants.$inferInsert
