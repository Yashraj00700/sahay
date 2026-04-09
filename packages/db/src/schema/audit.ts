import {
  pgTable, uuid, text, boolean, timestamp, jsonb, inet, index,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

// DPDP Act compliance — append-only audit log (NO updatedAt)
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  // Who
  actorType: text('actor_type').notNull(), // agent|system|ai|api
  actorId: uuid('actor_id'),
  actorEmail: text('actor_email'),
  // What
  action: text('action').notNull(),
  // e.g. conversation.resolve|message.send|customer.delete|consent.grant
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id'),
  // Data
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  metadata: jsonb('metadata').default({}),
  // Context
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  // When — append-only, no updates
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantIdx: index('idx_audit_tenant').on(table.tenantId, table.createdAt),
  resourceIdx: index('idx_audit_resource').on(table.resourceType, table.resourceId),
  actionIdx: index('idx_audit_action').on(table.action, table.createdAt),
  actorIdx: index('idx_audit_actor').on(table.actorId, table.createdAt),
}))

// DPDP Act — explicit consent tracking
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  customerId: uuid('customer_id').notNull(),
  consentType: text('consent_type').notNull(), // wa_support|wa_marketing|data_processing
  channel: text('channel').notNull(),           // whatsapp|website|shopify_checkout
  granted: boolean('granted').notNull(),
  consentText: text('consent_text').notNull(),  // exact text shown to user
  consentVersion: text('consent_version').notNull(),
  // Proof
  ipAddress: inet('ip_address'),
  deviceInfo: text('device_info'),
  doubleOptIn: boolean('double_opt_in').default(false),
  doubleOptInAt: timestamp('double_opt_in_at', { withTimezone: true }),
  // Revocation
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revocationChannel: text('revocation_channel'),
  revocationMethod: text('revocation_method'), // STOP_keyword|dashboard|api
  // Append-only
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  customerIdx: index('idx_consent_customer').on(table.customerId, table.consentType, table.createdAt),
  tenantIdx: index('idx_consent_tenant').on(table.tenantId, table.createdAt),
}))

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
export type ConsentRecord = typeof consentRecords.$inferSelect
export type NewConsentRecord = typeof consentRecords.$inferInsert
