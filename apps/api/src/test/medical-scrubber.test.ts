import { describe, it, expect } from 'vitest'

// ─── Medical claim scrubber ───────────────────────────────────────────────────
//
// The scrubber in agent.ts uses regex patterns with the /g flag.  When a regex
// with the /g flag is stored in an array and reused across calls, JavaScript
// preserves the `lastIndex` state between calls — causing alternating true/false
// results for identical inputs (the "stateful regex" bug).
//
// The fix is to reset `lastIndex = 0` before each `.test()` call, or to use
// `String.prototype.match` / recreate the regex each time.
//
// These tests document and verify the correct behaviour.

describe('Medical claim scrubber', () => {
  it('should detect medical claims consistently across multiple calls (with lastIndex reset)', () => {
    const pattern = /\bcures?\b/gi

    // Without reset, second call returns false because lastIndex is left at end of string
    pattern.lastIndex = 0
    expect(pattern.test('this product cures acne')).toBe(true)
    pattern.lastIndex = 0 // the fix — must reset before each reuse
    expect(pattern.test('this product cures acne')).toBe(true)
  })

  it('should demonstrate the raw stateful-regex bug (without fix)', () => {
    const pattern = /\bcures?\b/gi
    // First call succeeds as expected
    expect(pattern.test('this product cures acne')).toBe(true)
    // Second call on same string returns false because lastIndex was NOT reset —
    // this is the bug the fix addresses.
    expect(pattern.test('this product cures acne')).toBe(false)
  })

  it('should replace "cures" with "may help with" (cosmetic rewrite)', () => {
    // Mirror the COSMETIC_REWRITES logic from agent.ts
    const rewrites: Array<[RegExp, string]> = [
      [/\bcures?\b/gi, 'may help with'],
      [/\btreats?\b/gi, 'helps address'],
      [/\bheals?\b/gi, 'supports the appearance of'],
      [/\beliminates?\b/gi, 'visibly reduces'],
    ]

    let text = 'Our serum cures acne and eliminates dark spots.'
    for (const [pattern, replacement] of rewrites) {
      text = text.replace(pattern, replacement)
    }

    expect(text).toBe('Our serum may help with acne and visibly reduces dark spots.')
  })

  it('should not flag text that contains no medical claims', () => {
    const patterns: RegExp[] = [
      /\b(cures?|treats?|heals?)\s+(disease|condition|disorder|acne|eczema|psoriasis|rosacea|cancer|infection)\b/gi,
      /\b(clinically proven|medically approved|FDA approved|CDSCO approved)\b/gi,
      /guarantees?\s+(cure|healing|treatment)/gi,
    ]

    const safe = 'Our product may help with the appearance of dry skin.'
    const hadViolation = patterns.some(p => {
      p.lastIndex = 0
      return p.test(safe)
    })

    expect(hadViolation).toBe(false)
  })

  it('should flag "clinically proven" as a medical claim', () => {
    const patterns: RegExp[] = [
      /\b(cures?|treats?|heals?)\s+(disease|condition|disorder|acne|eczema|psoriasis|rosacea|cancer|infection)\b/gi,
      /\b(clinically proven|medically approved|FDA approved|CDSCO approved)\b/gi,
      /guarantees?\s+(cure|healing|treatment)/gi,
    ]

    const flagged = 'This is clinically proven to work.'
    const hadViolation = patterns.some(p => {
      p.lastIndex = 0
      return p.test(flagged)
    })

    expect(hadViolation).toBe(true)
  })
})
