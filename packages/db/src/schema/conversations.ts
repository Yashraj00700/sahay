import {
  pgTable, uuid, text, boolean, timestamp, decimal, integer,
  jsonb, index, pgEnum,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { customers } from './customers'
import { agents } from './agents'

export const conversationStatusEnum = pgEnum('conversation_status', ['open', 'pending', 'snoozed', 'resolved', 'closed'])
export const conversationChannelEnum = pgEnum('conversation_channel', ['whatsapp', 'instagram', 'webchat', 'email'])
export const routingDecisionEnum = pgEnum('routing_decision', ['auto_respond', 'draft_for_review', 'route_to_human', 'route_to_senior'])

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  channel: conversationChannelEnum('channel').notNull(),
  // State
  status: conversationStatusEnum('status').default('open'),
  assignedTo: uuid('assigned_to').references(() => agents.id),
  // AI analysis
  primaryIntent: text('primary_intent'),
  sentiment: text('sentiment').default('neutral'),
  sentimentScore: decimal('sentiment_score', { precision: 3, scale: 2 }),
  urgencyScore: integer('urgency_score').default(0), // 1-5
  emotionTags: text('emotion_tags').array().default([]),
  // Routing
  aiHandled: boolean('ai_handled').default(false),
  aiResolutionRate: decimal('ai_resolution_rate', { precision: 3, scale: 2 }),
  humanTouched: boolean('human_touched').default(false),
  escalationReason: text('escalation_reason'),
  routingDecision: routingDecisionEnum('routing_decision'),
  // Timing
  firstReplyAt: timestamp('first_reply_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  snoozeUntil: timestamp('snooze_until', { withTimezone: true }),
  sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }), // WA/IG 24h window
  // Quality
  csatScore: integer('csat_score'), // 1-5
  csatSubmittedAt: timestamp('csat_submitted_at', { withTimezone: true }),
  resolutionTimeSeconds: integer('resolution_time_seconds'),
  turnCount: integer('turn_count').default(0),
  // Circular conversation detection
  circularCount: integer('circular_count').default(0),
  // COD conversion tracking
  codConversionOffered: boolean('cod_conversion_offered').default(false),
  codConversionAccepted: boolean('cod_conversion_accepted').default(false),
  codConversionRevenue: decimal('cod_conversion_revenue', { precision: 12, scale: 2 }),
  // Meta
  tags: text('tags').array().default([]),
  customFields: jsonb('custom_fields').default({}),
  shopifyOrderId: text('shopify_order_id'),  // linked order if applicable
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantStatusIdx: index('idx_conversations_tenant_status').on(table.tenantId, table.status, table.createdAt),
  customerIdx: index('idx_conversations_customer').on(table.customerId, table.createdAt),
  assignedIdx: index('idx_conversations_assigned').on(table.tenantId, table.assignedTo, table.status),
  channelIdx: index('idx_conversations_channel').on(table.tenantId, table.channel),
  snoozeIdx: index('idx_conversations_snooze').on(table.snoozeUntil),
  sessionIdx: index('idx_conversations_session').on(table.sessionExpiresAt),
}))

export type ConversationRecord = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
