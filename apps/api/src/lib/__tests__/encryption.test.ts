import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt, safeDecrypt } from '../encryption'

// A valid 32-byte (64 hex chars) key for testing
const TEST_KEY = 'a'.repeat(64)

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY
})

describe('encryption', () => {
  it('round-trips plaintext', () => {
    const input = 'secret-token-12345'
    expect(decrypt(encrypt(input))).toBe(input)
  })

  it('produces different ciphertexts for same input (random IV)', () => {
    const a = encrypt('test')
    const b = encrypt('test')
    expect(a).not.toBe(b)
  })

  it('encrypted output has iv:tag:ciphertext format', () => {
    const result = encrypt('hello')
    const parts = result.split(':')
    expect(parts).toHaveLength(3)
    // IV = 12 bytes → 24 hex chars; tag = 16 bytes → 32 hex chars
    expect(parts[0]).toHaveLength(24)
    expect(parts[1]).toHaveLength(32)
  })

  it('safeDecrypt returns null for null input', () => {
    expect(safeDecrypt(null)).toBeNull()
  })

  it('safeDecrypt returns null for undefined input', () => {
    expect(safeDecrypt(undefined)).toBeNull()
  })

  it('safeDecrypt passthrough for non-encrypted string (no colon)', () => {
    // decrypt() short-circuits when there are no colons — returns as-is
    expect(safeDecrypt('plaintext')).toBe('plaintext')
  })

  it('safeDecrypt returns null for a tampered ciphertext', () => {
    const good = encrypt('data')
    // Corrupt the tag section (middle part)
    const [iv, , ct] = good.split(':')
    const tampered = `${iv}:${'0'.repeat(32)}:${ct}`
    expect(safeDecrypt(tampered)).toBeNull()
  })

  it('round-trips unicode / Hinglish content', () => {
    const input = 'Aapka order dispatch ho chuka hai! ✅ आपका ऑर्डर'
    expect(decrypt(encrypt(input))).toBe(input)
  })
})
