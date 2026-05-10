import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Lightweight in-memory Redis stub ────────────────────────────────────────
// Implements just the subset of @upstash/redis that login-lockout uses:
// `incr`, `get`, `expireat`, `del`. Keys with an `expireat` in the past are
// pruned on read so tests can simulate the 15-minute window expiring.
//
// The stub is created INSIDE the vi.mock factory so it lives in the hoisted
// scope alongside the mocked module — vitest hoists vi.mock above all imports
// and forbids referencing top-level variables from the factory.

vi.mock('../lib/upstash', () => {
  const store = new Map<string, number>()
  const expiries = new Map<string, number>()

  const prune = (key: string): void => {
    const exp = expiries.get(key)
    if (exp !== undefined && exp <= Math.floor(Date.now() / 1000)) {
      store.delete(key)
      expiries.delete(key)
    }
  }

  const upstash = {
    async incr(key: string): Promise<number> {
      prune(key)
      const next = (store.get(key) ?? 0) + 1
      store.set(key, next)
      return next
    },
    async get<T>(key: string): Promise<T | null> {
      prune(key)
      const v = store.get(key)
      return (v === undefined ? null : v) as T | null
    },
    async expireat(key: string, at: number): Promise<number> {
      if (!store.has(key)) return 0
      expiries.set(key, at)
      return 1
    },
    async del(...keys: string[]): Promise<number> {
      let n = 0
      for (const k of keys) {
        if (store.delete(k)) n++
        expiries.delete(k)
      }
      return n
    },
    __reset(): void {
      store.clear()
      expiries.clear()
    },
  }

  return { upstash }
})

import { upstash } from '../lib/upstash'
import {
  EMAIL_THRESHOLD,
  IP_THRESHOLD,
  checkLockout,
  clearLockout,
  recordFailedAttempt,
} from '../lib/login-lockout'
import { AppError } from '../lib/errors'

// Cast through unknown to reach the test-only reset helper without leaking
// the type into production code.
const resetStub = (): void => {
  ;(upstash as unknown as { __reset: () => void }).__reset()
}

const IP = '203.0.113.42'

const failOnce = (email: string, ip = IP): Promise<void> =>
  recordFailedAttempt({ email, ip })

describe('login-lockout smoke', () => {
  beforeEach(() => {
    resetStub()
  })

  it('allows attempts below the email threshold and blocks the (N+1)th', async () => {
    const email = 'user@example.com'
    for (let i = 0; i < EMAIL_THRESHOLD; i++) {
      await failOnce(email)
    }
    // 5 failures recorded; the next checkLockout must throw.
    await expect(checkLockout({ email, ip: IP })).rejects.toBeInstanceOf(AppError)
    try {
      await checkLockout({ email, ip: IP })
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      if (err instanceof AppError) {
        expect(err.code).toBe('FORBIDDEN')
        expect(err.statusCode).toBe(429)
        // Must NOT leak whether email exists.
        expect(err.message.toLowerCase()).toContain('locked')
      }
    }
  })

  it('clearLockout resets the email counter so the user can log in again', async () => {
    const email = 'user2@example.com'
    for (let i = 0; i < EMAIL_THRESHOLD; i++) {
      await failOnce(email)
    }
    await expect(checkLockout({ email, ip: IP })).rejects.toBeInstanceOf(AppError)

    await clearLockout({ email, ip: IP })

    // After clearing, both counters are gone — checkLockout should pass.
    await expect(checkLockout({ email, ip: IP })).resolves.toBeUndefined()
  })

  it('does NOT block a single IP that is below the per-IP threshold across many emails', async () => {
    // Distribute 5 failures across 5 different emails from the SAME ip.
    // Each email counter stays at 1 (below EMAIL_THRESHOLD), and ip counter
    // hits 5 (well below IP_THRESHOLD=20).
    for (let i = 0; i < 5; i++) {
      await failOnce(`spread-${i}@example.com`)
    }
    // A fresh email from the same IP should still be permitted.
    await expect(
      checkLockout({ email: 'fresh@example.com', ip: IP }),
    ).resolves.toBeUndefined()
  })

  it('blocks once the per-IP threshold is exceeded across many emails', async () => {
    // 21 failures spread across 21 unique emails from the same IP. Each
    // email counter is 1 (well under 5), but the IP counter hits 21 — over
    // IP_THRESHOLD=20 — which must trigger lockout for any new email.
    for (let i = 0; i < IP_THRESHOLD + 1; i++) {
      await failOnce(`burst-${i}@example.com`)
    }

    await expect(
      checkLockout({ email: 'unrelated@example.com', ip: IP }),
    ).rejects.toBeInstanceOf(AppError)
  })
})
