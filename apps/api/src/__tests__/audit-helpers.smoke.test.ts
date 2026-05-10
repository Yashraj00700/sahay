import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── DB stub ─────────────────────────────────────────────────────────────────
// Capture every `db.insert(auditLogs).values({...})` call so we can assert the
// shape that audit-helpers writes WITHOUT touching a real database.
//
// The stub lives in the `vi.mock` factory because vitest hoists `vi.mock`
// above all imports — referencing a top-level `let captured = []` from the
// factory would throw a hoisting error.

vi.mock('@sahay/db', () => {
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = []

  const auditLogs = { __name: 'audit_logs' as const }

  const db = {
    insert(table: unknown) {
      return {
        async values(values: Record<string, unknown>): Promise<void> {
          inserts.push({ table, values })
        },
      }
    },
  }

  return {
    db,
    auditLogs,
    __inserts: inserts,
  }
})

// Pull the captured-inserts handle out of the mocked module.
import * as dbModule from '@sahay/db'
const captured = (dbModule as unknown as {
  __inserts: Array<{ table: unknown; values: Record<string, unknown> }>
}).__inserts

import {
  auditConversationRead,
  auditConversationListRead,
  auditCustomerListRead,
  auditMessagesRead,
  redactQueryForAudit,
} from '../lib/audit-helpers'
import type { AuthedContext } from '../lib/handler'

// Minimal AuthedContext fixture — only the fields helpers read.
const buildCtx = (): AuthedContext => ({
  requestId: 'req-test-1',
  ip: '203.0.113.10',
  userAgent: 'vitest/1.0',
  agent: {
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: '22222222-2222-2222-2222-222222222222',
    role: 'agent',
    email: 'agent@example.com',
    name: 'Agent Test',
  },
  tenant: {
    id: '22222222-2222-2222-2222-222222222222',
    shopifyDomain: 'test.myshopify.com',
    plan: 'pro',
    aiPersonaName: 'Sahay',
    aiLanguage: 'en',
    aiTone: 'warm',
    aiConfidenceThreshold: '0.75',
  },
  withTenant: async () => {
    throw new Error('withTenant should not be called in audit tests')
  },
})

describe('audit-helpers smoke', () => {
  beforeEach(() => {
    captured.length = 0
  })

  it('auditConversationRead writes a data.read.conversation row with actor + tenant + IP context', async () => {
    const ctx = buildCtx()
    await auditConversationRead(ctx, '33333333-3333-3333-3333-333333333333')

    expect(captured).toHaveLength(1)
    const row = captured[0].values
    expect(row.action).toBe('data.read.conversation')
    expect(row.resourceType).toBe('conversation')
    expect(row.resourceId).toBe('33333333-3333-3333-3333-333333333333')
    expect(row.actorType).toBe('agent')
    expect(row.actorId).toBe(ctx.agent.id)
    expect(row.actorEmail).toBe(ctx.agent.email)
    expect(row.tenantId).toBe(ctx.tenant.id)
    expect(row.ipAddress).toBe(ctx.ip)
    expect(row.userAgent).toBe(ctx.userAgent)
    expect(row.requestId).toBe(ctx.requestId)
    // metadata.query is present (empty object for single-resource reads)
    expect(row.metadata).toEqual({ query: {} })
  })

  it('auditCustomerListRead captures page/pageSize but REDACTS PII search terms', async () => {
    const ctx = buildCtx()
    // Agent searched by phone + email + name AND paginated.
    await auditCustomerListRead(ctx, {
      page: 2,
      pageSize: 25,
      search: '+919876543210',
      email: 'leak@example.com',
      name: 'Priya',
      phone: '+919876543210',
      tier: 'vip',
    })

    expect(captured).toHaveLength(1)
    const row = captured[0].values
    expect(row.action).toBe('data.read.customer_list')
    expect(row.resourceType).toBe('customer_list')

    const meta = row.metadata as { query: Record<string, unknown> }
    // Pagination + safe enum filters preserved.
    expect(meta.query.page).toBe(2)
    expect(meta.query.pageSize).toBe(25)
    expect(meta.query.tier).toBe('vip')
    // Search shape preserved as a boolean — actual term must NEVER be stored.
    expect(meta.query.hasSearch).toBe(true)
    // PII keys must not appear in metadata.
    expect(meta.query.search).toBeUndefined()
    expect(meta.query.email).toBeUndefined()
    expect(meta.query.phone).toBeUndefined()
    expect(meta.query.name).toBeUndefined()
    // No DB rows / customer fields leaked.
    const stringified = JSON.stringify(row)
    expect(stringified).not.toContain('+919876543210')
    expect(stringified).not.toContain('leak@example.com')
    expect(stringified).not.toContain('Priya')
  })

  it('auditConversationListRead preserves pagination + sort but drops free-text search', async () => {
    const ctx = buildCtx()
    await auditConversationListRead(ctx, {
      page: 1,
      pageSize: 50,
      status: 'open',
      channel: 'whatsapp',
      sortBy: 'updatedAt',
      sortDir: 'desc',
      q: 'refund issue',
    })

    expect(captured).toHaveLength(1)
    const row = captured[0].values
    expect(row.action).toBe('data.read.conversation_list')
    const meta = row.metadata as { query: Record<string, unknown> }
    expect(meta.query).toEqual({
      page: 1,
      pageSize: 50,
      status: 'open',
      channel: 'whatsapp',
      sortBy: 'updatedAt',
      sortDir: 'desc',
      hasSearch: true,
    })
  })

  it('auditMessagesRead records only the count, never message bodies', async () => {
    const ctx = buildCtx()
    await auditMessagesRead(ctx, '44444444-4444-4444-4444-444444444444', 42)

    expect(captured).toHaveLength(1)
    const row = captured[0].values
    expect(row.action).toBe('data.read.conversation_messages')
    expect(row.resourceType).toBe('conversation_messages')
    expect(row.resourceId).toBe('44444444-4444-4444-4444-444444444444')
    expect(row.metadata).toEqual({ query: { messageCount: 42 } })
  })

  it('redactQueryForAudit returns {} for non-object inputs and is safe to call', () => {
    expect(redactQueryForAudit(undefined)).toEqual({})
    expect(redactQueryForAudit(null)).toEqual({})
    expect(redactQueryForAudit('string')).toEqual({})
    expect(redactQueryForAudit(['array'])).toEqual({})
    // Cursor presence flagged as boolean only — value not stored.
    expect(redactQueryForAudit({ cursor: '2024-01-01T00:00:00Z', limit: 50 })).toEqual({
      hasCursor: true,
      limit: 50,
    })
    // Unknown keys are dropped to be conservative (defense-in-depth).
    expect(redactQueryForAudit({ secretFilter: 'xxx', page: 1 })).toEqual({ page: 1 })
  })
})
