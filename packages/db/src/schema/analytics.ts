import {
  pgTable, uuid, text, boolean, timestamp, decimal, integer, date,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

// Pre-aggregated analytics (refreshed by scheduled jobs, not real-time)
export const analyticsDaily = pgTable('analytics_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  channel: text('channel'), // null = all channels combined
  // Volume
  totalConversations: integer('total_conversations').default(0),
  newConversations: integer('new_conversations').default(0),
  resolvedConversations: integer('resolved_conversations').default(0),
  // AI
  aiResolved: integer('ai_resolved').default(0),
  aiEscalated: integer('ai_escalated').default(0),
  aiResolutionRate: decimal('ai_resolution_rate', { precision: 5, scale: 2 }),
  // Timing
  avgFirstResponseSeconds: integer('avg_first_response_seconds'),
  avgResolutionSeconds: integer('avg_resolution_seconds'),
  // Quality
  avgCsat: decimal('avg_csat', { precision: 3, scale: 2 }),
  csatResponses: integer('csat_responses').default(0),
  // Revenue
  codConversions: integer('cod_conversions').default(0),
  codConversionRevenue: decimal('cod_conversion_revenue', { precision: 12, scale: 2 }).default('0'),
  upsellRevenue: decimal('upsell_revenue', { precision: 12, scale: 2 }).default('0'),
  // Messages
  totalMessages: integer('total_messages').default(0),
  aiMessages: integer('ai_messages').default(0),
  humanMessages: integer('human_messages').default(0),
  // Agent stats
  uniqueAgentsActive: integer('unique_agents_active').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantDateIdx: uniqueIndex('idx_analytics_tenant_date_channel').on(table.tenantId, table.date, table.channel),
  dateIdx: index('idx_analytics_date').on(table.date),
}))

// WhatsApp templates
export const waTemplates = pgTable('wa_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  languageCode: text('language_code').default('en'),
  category: text('category').notNull(),  // UTILITY|MARKETING|AUTHENTICATION
  status: text('status').default('pending'), // pending|approved|rejected
  // Content
  headerType: text('header_type'),  // TEXT|IMAGE|VIDEO|DOCUMENT
  headerContent: text('header_content'),
  bodyText: text('body_text').notNull(),
  footerText: text('footer_text'),
  buttons: text('buttons'),  // JSON string
  // Use case
  useCase: text('use_case'), // order_shipped|cod_conversion|csat|restock etc.
  // Meta
  metaTemplateId: text('meta_template_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantNameLangIdx: uniqueIndex('idx_wa_templates_tenant_name_lang').on(table.tenantId, table.name, table.languageCode),
}))

// Canned responses
export const cannedResponses = pgTable('canned_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by'),
  title: text('title').notNull(),
  shortcut: text('shortcut'),  // /greeting, /tracking etc.
  content: text('content').notNull(),
  channel: text('channel'),    // null = all channels
  isShared: boolean('is_shared').default(true),  // true = team, false = personal
  tags: text('tags').array().default([]),
  useCount: integer('use_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantIdx: index('idx_canned_tenant').on(table.tenantId),
  shortcutIdx: index('idx_canned_shortcut').on(table.tenantId, table.shortcut),
}))

export type AnalyticsDailyRecord = typeof analyticsDaily.$inferSelect
export type WaTemplateRecord = typeof waTemplates.$inferSelect
export type CannedResponseRecord = typeof cannedResponses.$inferSelect
