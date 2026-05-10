import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── DB stub ─────────────────────────────────────────────────────────────────
//
// We mock `@sahay/db` end-to-end so the experiments service can be tested
// without a real Postgres. The stub provides:
//
//   - withTenant / withSystemBypass: pass-throughs that invoke the inner fn.
//   - db: a chainable query-builder mock that records every call. Tests can
//     program return values for select/insert sequences and inspect the
//     resulting payloads.
//
// Important: the mock factory MUST construct everything inline — vi.mock is
// hoisted above all imports.

vi.mock('@sahay/db', () => {
  // Sentinel column / table objects — we don't need real drizzle objects, the
  // service code only passes them through to query builders that we control.
  const experiments = { __name: 'experiments' as const }
  const experimentAssignments = {
    __name: 'experiment_assignments' as const,
    experimentId: { __col: 'experiment_id' as const },
    subjectType: { __col: 'subject_type' as const },
    subjectId: { __col: 'subject_id' as const },
    id: { __col: 'id' as const },
    variant: { __col: 'variant' as const },
  }
  const experimentOutcomes = { __name: 'experiment_outcomes' as const }

  // Per-test programmable queues. Tests reach into these via dbModule.__state.
  interface State {
    selectResults: Array<unknown[]>
    insertResults: Array<unknown[]>
    inserts: Array<{ table: unknown; values: unknown }>
    failNextSelect: boolean
    failNextInsert: boolean
  }
  const state: State = {
    selectResults: [],
    insertResults: [],
    inserts: [],
    failNextSelect: false,
    failNextInsert: false,
  }

  function makeSelectChain(): unknown {
    return {
      from: () => ({
        where: () => ({
          limit: async () => {
            if (state.failNextSelect) {
              state.failNextSelect = false
              throw new Error('select failure (programmed)')
            }
            return state.selectResults.shift() ?? []
          },
          orderBy: () => ({
            limit: async () => state.selectResults.shift() ?? [],
          }),
          // No limit — used by loadActiveExperiment.
          then: (
            onFulfilled: (rows: unknown[]) => unknown,
            onRejected?: (err: unknown) => unknown,
          ) => {
            if (state.failNextSelect) {
              state.failNextSelect = false
              return Promise.reject(new Error('select failure (programmed)')).then(
                onFulfilled,
                onRejected,
              )
            }
            return Promise.resolve(state.selectResults.shift() ?? []).then(
              onFulfilled,
              onRejected,
            )
          },
        }),
      }),
    }
  }

  function makeInsertChain(): unknown {
    let captured: { table: unknown; values: unknown } = { table: null, values: null }
    return (table: unknown) => {
      captured = { table, values: null }
      return {
        values(values: unknown) {
          captured.values = values
          state.inserts.push({ ...captured })
          return {
            onConflictDoNothing: () => ({
              returning: async () => {
                if (state.failNextInsert) {
                  state.failNextInsert = false
                  throw new Error('insert failure (programmed)')
                }
                return state.insertResults.shift() ?? []
              },
            }),
            returning: async () => {
              if (state.failNextInsert) {
                state.failNextInsert = false
                throw new Error('insert failure (programmed)')
              }
              return state.insertResults.shift() ?? []
            },
            then: (
              onFulfilled: (v: unknown) => unknown,
              onRejected?: (err: unknown) => unknown,
            ) => {
              if (state.failNextInsert) {
                state.failNextInsert = false
                return Promise.reject(new Error('insert failure (programmed)')).then(
                  onFulfilled,
                  onRejected,
                )
              }
              return Promise.resolve().then(onFulfilled, onRejected)
            },
          }
        },
      }
    }
  }

  const insertImpl = makeInsertChain()
  const db = {
    select: () => makeSelectChain(),
    insert: insertImpl,
  }

  // Tx mock for withTenant — same shape as `db`.
  const tx = db

  return {
    db,
    experiments,
    experimentAssignments,
    experimentOutcomes,
    withTenant: async <T>(_tenantId: string, fn: (tx: unknown) => Promise<T>) =>
      fn(tx),
    withSystemBypass: async <T>(fn: () => Promise<T>) => fn(),
    __state: state,
  }
})

// Pull the mock state handle.
import * as dbModule from '@sahay/db'
const state = (dbModule as unknown as {
  __state: {
    selectResults: Array<unknown[]>
    insertResults: Array<unknown[]>
    inserts: Array<{ table: unknown; values: unknown }>
    failNextSelect: boolean
    failNextInsert: boolean
  }
}).__state

import {
  getVariant,
  pickWeightedVariant,
  recordOutcome,
} from '../services/ai/experiments'

const ACTIVE_EXPERIMENT_ROW = {
  id: 'exp-1',
  tenantId: 'tenant-1',
  variants: [
    { name: 'control', weight: 70, config: { tone: 'warm' } },
    { name: 'treatment', weight: 30, config: { tone: 'casual' } },
  ],
  startsAt: new Date(Date.now() - 60_000),
  endsAt: null,
  isActive: true,
  key: 'system_prompt',
  description: null,
}

beforeEach(() => {
  state.selectResults = []
  state.insertResults = []
  state.inserts = []
  state.failNextSelect = false
  state.failNextInsert = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('experiments smoke', () => {
  it('weighted random selection respects weights over many trials', () => {
    const variants = [
      { name: 'a', weight: 80, config: {} },
      { name: 'b', weight: 20, config: {} },
    ]
    const counts: Record<string, number> = { a: 0, b: 0 }
    // Deterministic-ish PRNG (xorshift) seeded so the test is reproducible.
    let seed = 0xc0ffee
    const rng = (): number => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      // Convert to [0, 1).
      return ((seed >>> 0) % 1_000_000) / 1_000_000
    }

    const N = 5000
    for (let i = 0; i < N; i++) {
      const picked = pickWeightedVariant(variants, rng)
      expect(picked).not.toBeNull()
      counts[picked!.name]++
    }
    // Expected ~80/20 split. Allow a generous ±5% absolute tolerance for
    // the cheap PRNG above (well within chi-square at 5000 samples).
    const ratioA = counts.a / N
    expect(ratioA).toBeGreaterThan(0.75)
    expect(ratioA).toBeLessThan(0.85)
    // Total should always equal N (no nulls dropped).
    expect(counts.a + counts.b).toBe(N)
  })

  it('sticky assignment returns the same variant on repeat calls', async () => {
    // Call 1: experiment lookup → existing-assignment lookup (empty) → insert.
    state.selectResults = [
      [ACTIVE_EXPERIMENT_ROW], // loadActiveExperiment
      [],                       // existing-assignment lookup (none)
    ]
    state.insertResults = [
      [{ id: 'assignment-1', variant: 'control' }], // insert returning
    ]

    const first = await getVariant({
      experimentKey: 'system_prompt',
      tenantId: 'tenant-1',
      subjectType: 'conversation',
      subjectId: 'conv-1',
    })
    expect(first).not.toBeNull()
    expect(first!.assignmentId).toBe('assignment-1')
    const stickyVariant = first!.variantName

    // Call 2: experiment lookup → existing-assignment lookup returns the row.
    state.selectResults = [
      [ACTIVE_EXPERIMENT_ROW],
      [{ id: 'assignment-1', variant: stickyVariant }],
    ]

    const second = await getVariant({
      experimentKey: 'system_prompt',
      tenantId: 'tenant-1',
      subjectType: 'conversation',
      subjectId: 'conv-1',
    })
    expect(second).not.toBeNull()
    expect(second!.variantName).toBe(stickyVariant)
    expect(second!.assignmentId).toBe('assignment-1')
    // Second call must NOT have inserted a new assignment.
    expect(state.inserts).toHaveLength(1)
  })

  it('returns null when no active experiment matches', async () => {
    state.selectResults = [[]] // loadActiveExperiment returns nothing

    const result = await getVariant({
      experimentKey: 'never_used_key',
      tenantId: 'tenant-1',
      subjectType: 'conversation',
      subjectId: 'conv-2',
    })
    expect(result).toBeNull()
    expect(state.inserts).toHaveLength(0)
  })

  it('recordOutcome fire-and-forget swallows errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Force the first insert (the real one) to fail.
    state.failNextInsert = true

    await expect(
      recordOutcome({ assignmentId: 'assignment-1', metric: 'csat', value: 4 }),
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).toContain('recordOutcome failed')

    // Even non-finite values must not throw.
    state.failNextInsert = false
    await expect(
      recordOutcome({
        assignmentId: 'assignment-1',
        metric: 'turn_count',
        value: Number.NaN,
      }),
    ).resolves.toBeUndefined()
  })
})
