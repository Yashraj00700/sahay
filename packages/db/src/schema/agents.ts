import {
  pgTable, uuid, text, boolean, timestamp, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('agent'), // super_admin|admin|agent|viewer
  isActive: boolean('is_active').default(true),
  isOnline: boolean('is_online').default(false),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  passwordHash: text('password_hash'),
  // Preferences
  pushSubscriptions: jsonb('push_subscriptions').default([]),
  notificationPrefs: jsonb('notification_prefs').default({}),
  // Password reset
  resetToken: text('reset_token'),
  resetTokenExpiresAt: timestamp('reset_token_expires_at', { withTimezone: true }),
  // Invite
  inviteToken: text('invite_token'),
  inviteTokenExpiresAt: timestamp('invite_token_expires_at', { withTimezone: true }),
  invitedBy: uuid('invited_by'),
  inviteAcceptedAt: timestamp('invite_accepted_at', { withTimezone: true }),
  // Meta
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantEmailIdx: uniqueIndex('idx_agents_tenant_email').on(table.tenantId, table.email),
  tenantActiveIdx: index('idx_agents_tenant_active').on(table.tenantId),
  emailIdx: index('idx_agents_email').on(table.email),
}))

export type AgentRecord = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
