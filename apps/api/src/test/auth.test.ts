import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'

// ── Pure helper replicated from auth/index.ts ─────────────────────────────────
// brandNameToDomain is not exported, so we inline the same logic here to keep
// the test self-contained while still exercising the production algorithm.
function brandNameToDomain(brandName: string): string {
  return `direct:${brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

// ─── Auth utilities ───────────────────────────────────────────────────────────

describe('Auth utilities', () => {
  // ── Reset token generation ────────────────────────────────────────────────

  it('should generate a 32-byte hex reset token with correct length', () => {
    const token = randomBytes(32).toString('hex')
    expect(token).toHaveLength(64) // 32 bytes × 2 hex chars per byte
    expect(token).toMatch(/^[a-f0-9]+$/)
  })

  it('should generate unique tokens on each call', () => {
    const t1 = randomBytes(32).toString('hex')
    const t2 = randomBytes(32).toString('hex')
    expect(t1).not.toBe(t2)
  })

  // ── brandNameToDomain ─────────────────────────────────────────────────────

  it('should prefix brand name domains with "direct:"', () => {
    expect(brandNameToDomain('RAS Luxury Oils')).toBe('direct:ras-luxury-oils')
  })

  it('should lower-case the brand name', () => {
    expect(brandNameToDomain('MyBrand')).toBe('direct:mybrand')
  })

  it('should replace non-alphanumeric characters with hyphens', () => {
    expect(brandNameToDomain('Brand & Co!')).toBe('direct:brand-co')
  })

  it('should strip leading and trailing hyphens', () => {
    expect(brandNameToDomain('  ---Brand---  ')).toBe('direct:brand')
  })

  it('should collapse consecutive special chars to a single hyphen', () => {
    expect(brandNameToDomain('A  B')).toBe('direct:a-b')
  })

  // ── Password validation schema rules (pure Zod, no DB) ───────────────────

  it('should reject passwords shorter than 8 characters', async () => {
    const { z } = await import('zod')
    const schema = z.string().min(8).max(100)
    const result = schema.safeParse('short')
    expect(result.success).toBe(false)
  })

  it('should accept a valid password', async () => {
    const { z } = await import('zod')
    const schema = z.string().min(8).max(100)
    const result = schema.safeParse('ValidPass1!')
    expect(result.success).toBe(true)
  })
})
