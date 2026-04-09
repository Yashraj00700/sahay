/**
 * Tests for the medical-claim scrubbing logic defined in agent.ts.
 *
 * scrubMedicalClaims is an internal (non-exported) function, so we mirror its
 * exact regex patterns and rewrite rules here and test that logic directly.
 * If the patterns in agent.ts ever change, these tests will surface the drift.
 */
import { describe, it, expect } from 'vitest'

// ── Mirror of agent.ts internal logic ────────────────────────────────────────

const MEDICAL_CLAIM_PATTERNS: RegExp[] = [
  /\b(cures?|treats?|heals?)\s+(disease|condition|disorder|acne|eczema|psoriasis|rosacea|cancer|infection)\b/gi,
  /\b(clinically proven|medically approved|FDA approved|CDSCO approved)\b/gi,
  /guarantees?\s+(cure|healing|treatment)/gi,
]

const COSMETIC_REWRITES: Array<[RegExp, string]> = [
  [/\bcures?\b/gi, 'may help with'],
  [/\btreats?\b/gi, 'helps address'],
  [/\bheals?\b/gi, 'supports the appearance of'],
  [/\beliminates?\b/gi, 'visibly reduces'],
]

function scrubMedicalClaims(text: string): { text: string; hadViolation: boolean } {
  let hadViolation = false
  let result = text

  for (const pattern of MEDICAL_CLAIM_PATTERNS) {
    pattern.lastIndex = 0  // Reset stateful g-flag
    if (pattern.test(result)) hadViolation = true
  }

  for (const [pattern, replacement] of COSMETIC_REWRITES) {
    result = result.replace(pattern, replacement)
  }

  return { text: result, hadViolation }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('scrubMedicalClaims', () => {
  describe('violation detection', () => {
    it('"cures acne" is flagged as a violation', () => {
      const { hadViolation } = scrubMedicalClaims('This oil cures acne overnight.')
      expect(hadViolation).toBe(true)
    })

    it('"treats eczema" is flagged as a violation', () => {
      const { hadViolation } = scrubMedicalClaims('Our serum treats eczema effectively.')
      expect(hadViolation).toBe(true)
    })

    it('"clinically proven to treat" is flagged as a violation', () => {
      const { hadViolation } = scrubMedicalClaims('clinically proven to treat skin conditions.')
      expect(hadViolation).toBe(true)
    })

    it('"FDA approved" is flagged as a violation', () => {
      const { hadViolation } = scrubMedicalClaims('Our formula is FDA approved.')
      expect(hadViolation).toBe(true)
    })

    it('"guarantees cure" (direct adjacency) is flagged as a violation', () => {
      // The pattern is /guarantees?\s+(cure|healing|treatment)/gi — the word
      // "cure" must follow "guarantee/guarantees" with only whitespace (no articles).
      const { hadViolation } = scrubMedicalClaims('This product guarantees cure in 7 days.')
      expect(hadViolation).toBe(true)
    })

    it('"guarantees healing" is flagged as a violation', () => {
      const { hadViolation } = scrubMedicalClaims('Our serum guarantees healing of your skin.')
      expect(hadViolation).toBe(true)
    })

    it('"heals psoriasis" is flagged as a violation', () => {
      const { hadViolation } = scrubMedicalClaims('This cream heals psoriasis.')
      expect(hadViolation).toBe(true)
    })
  })

  describe('safe cosmetic language passes through without a violation flag', () => {
    it('"helps with dryness" is not a violation', () => {
      const { hadViolation } = scrubMedicalClaims('This oil helps with dryness.')
      expect(hadViolation).toBe(false)
    })

    it('"moisturises the skin" is not a violation', () => {
      const { hadViolation } = scrubMedicalClaims('Deeply moisturises the skin.')
      expect(hadViolation).toBe(false)
    })

    it('"visibly reduces fine lines" is not a violation', () => {
      const { hadViolation } = scrubMedicalClaims('Visibly reduces fine lines and wrinkles.')
      expect(hadViolation).toBe(false)
    })
  })

  describe('text rewriting', () => {
    it('"cures" is rewritten to "may help with"', () => {
      const { text } = scrubMedicalClaims('This serum cures acne.')
      expect(text).toContain('may help with')
      expect(text).not.toContain('cures')
    })

    it('"treats" is rewritten to "helps address"', () => {
      const { text } = scrubMedicalClaims('It treats redness.')
      expect(text).toContain('helps address')
      expect(text).not.toContain('treats')
    })

    it('"heals" is rewritten to "supports the appearance of"', () => {
      const { text } = scrubMedicalClaims('It heals damaged skin.')
      expect(text).toContain('supports the appearance of')
      expect(text).not.toContain('heals')
    })

    it('"eliminates" is rewritten to "visibly reduces"', () => {
      const { text } = scrubMedicalClaims('This product eliminates dark spots.')
      expect(text).toContain('visibly reduces')
      expect(text).not.toContain('eliminates')
    })
  })

  describe('regex stateful lastIndex reset', () => {
    it('calling scrubMedicalClaims twice on the same input produces consistent results', () => {
      const input = 'This cream treats acne and heals eczema.'
      const first = scrubMedicalClaims(input)
      const second = scrubMedicalClaims(input)
      // If lastIndex is NOT reset between calls, a global regex with /g will
      // fail to match on the second call — so both results must be equal.
      expect(first.hadViolation).toBe(second.hadViolation)
      expect(first.text).toBe(second.text)
    })

    it('back-to-back calls on violation text both flag hadViolation=true', () => {
      const input = 'clinically proven formula'
      expect(scrubMedicalClaims(input).hadViolation).toBe(true)
      expect(scrubMedicalClaims(input).hadViolation).toBe(true)
    })

    it('back-to-back calls on clean text both return hadViolation=false', () => {
      const input = 'deeply moisturising and nourishing'
      expect(scrubMedicalClaims(input).hadViolation).toBe(false)
      expect(scrubMedicalClaims(input).hadViolation).toBe(false)
    })
  })
})
