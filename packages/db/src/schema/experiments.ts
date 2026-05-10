import {
  pgTable, uuid, text, boolean, timestamp, numeric, jsonb,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

// ─── Experiment definition ───────────────────────────────────────────────────
//
// One row per A/B test. `tenantId` may be NULL — those are global default
// experiments that apply to every tenant unless a tenant-scoped row with the
// same `key` overrides them.
//
// `variants` is the source of truth for available branches. Each variant has
// a name (the value stored in `experiment_assignments.variant`), a positive
// numeric weight (we normalise — weights do not need to sum to 100), and a
// free-form `config` blob the agent code consults at prompt-build time.

export interface ExperimentVariant {
  name: string
  weight: number
  config: Record<string, unknown>
}

export const experiments = pgTable('experiments', {
  id: uuid('id').primaryKey().defaultRandom(),
  // null = global default (no tenant scope). When set, references tenants.id
  // and cascades on delete so tenant data is GDPR/DPDP-friendly.
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(), // e.g. 'system_prompt' / 'system_prompt_v1'
  description: text('description'),
  // [{ name: 'control', weight: 50, config: {...} }, ...]
  variants: jsonb('variants').$type<ExperimentVariant[]>().notNull(),
  isActive: boolean('is_active').default(true),
  startsAt: timestamp('starts_at', { withTimezone: true }).defaultNow(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // Lookup by (tenant, key) is the hot path for getVariant.
  tenantKeyIdx: index('idx_experiments_tenant_key').on(table.tenantId, table.key, table.isActive),
  keyIdx: index('idx_experiments_key_active').on(table.key, table.isActive),
}))

// ─── Sticky assignment ───────────────────────────────────────────────────────
//
// Once a subject (conversation, customer, or tenant) is assigned a variant for
// a given experiment, it stays on that variant for the experiment's lifetime.
// The unique index on (experimentId, subjectType, subjectId) is also used as
// the ON CONFLICT target so concurrent inserts can't double-assign.

export const experimentAssignments = pgTable('experiment_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  experimentId: uuid('experiment_id')
    .notNull()
    .references(() => experiments.id, { onDelete: 'cascade' }),
  // Denormalised tenant id for fast filtering / RLS. Null for global
  // experiments (we default to the global experiment's tenantId, which is
  // null) — RLS does NOT apply since no tenant context is set in those flows.
  tenantId: uuid('tenant_id'),
  subjectType: text('subject_type').notNull(), // 'conversation' | 'customer' | 'tenant'
  subjectId: uuid('subject_id').notNull(),
  variant: text('variant').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueAssignment: uniqueIndex('idx_exp_assignment_unique').on(
    table.experimentId, table.subjectType, table.subjectId,
  ),
  experimentIdx: index('idx_exp_assignment_experiment').on(table.experimentId, table.variant),
  tenantIdx: index('idx_exp_assignment_tenant').on(table.tenantId, table.experimentId),
}))

// ─── Outcome metrics ────────────────────────────────────────────────────────
//
// Append-only — many rows per assignment. We store the metric name as text
// instead of an enum so adding new ones doesn't require a migration.
// Allowed values today: 'csat' | 'resolved' | 'escalated' | 'turn_count'.

export const experimentOutcomes = pgTable('experiment_outcomes', {
  id: uuid('id').primaryKey().defaultRandom(),
  assignmentId: uuid('assignment_id')
    .notNull()
    .references(() => experimentAssignments.id, { onDelete: 'cascade' }),
  metric: text('metric').notNull(),
  // numeric(10,4) handles csat (1–5), turn_count, and 0/1 boolean-ish metrics.
  value: numeric('value', { precision: 10, scale: 4 }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  assignmentIdx: index('idx_exp_outcome_assignment').on(table.assignmentId, table.metric),
  metricIdx: index('idx_exp_outcome_metric').on(table.metric, table.recordedAt),
}))

export type Experiment = typeof experiments.$inferSelect
export type NewExperiment = typeof experiments.$inferInsert
export type ExperimentAssignment = typeof experimentAssignments.$inferSelect
export type NewExperimentAssignment = typeof experimentAssignments.$inferInsert
export type ExperimentOutcome = typeof experimentOutcomes.$inferSelect
export type NewExperimentOutcome = typeof experimentOutcomes.$inferInsert
