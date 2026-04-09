import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt, safeDecrypt } from '../lib/encryption'

describe('Encryption utility', () => {
  beforeAll(() => {
    // Set a test encryption key (64 hex chars = 32 bytes)
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
  })

  it('should encrypt and decrypt a string round-trip', () => {
    const plaintext = 'test-shopify-access-token-12345'
    const ciphertext = encrypt(plaintext)
    expect(ciphertext).not.toBe(plaintext)
    expect(ciphertext).toContain(':') // iv:tag:ciphertext format
    const decrypted = decrypt(ciphertext)
    expect(decrypted).toBe(plaintext)
  })

  it('should produce different ciphertexts for same plaintext (random IV)', () => {
    const plaintext = 'same-secret'
    const ct1 = encrypt(plaintext)
    const ct2 = encrypt(plaintext)
    expect(ct1).not.toBe(ct2) // different IVs
    expect(decrypt(ct1)).toBe(plaintext)
    expect(decrypt(ct2)).toBe(plaintext)
  })

  it('should return null for invalid ciphertext via safeDecrypt', () => {
    // Use a different key so the authTag check fails
    process.env.ENCRYPTION_KEY = 'b'.repeat(64)
    // Encrypt something with key 'b', then change key back to 'a' — decryption should fail
    const ciphertext = encrypt('secret')
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    const result = safeDecrypt(ciphertext)
    expect(result).toBeNull()
  })

  it('should return null for a completely invalid ciphertext string', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    const result = safeDecrypt('invalid:data:here')
    expect(result).toBeNull()
  })

  it('should pass through non-encrypted strings (no colon)', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    const plaintext = 'not-encrypted'
    const result = decrypt(plaintext)
    expect(result).toBe(plaintext)
  })

  it('should throw for wrong number of colon-delimited parts', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    expect(() => decrypt('only:two')).toThrow('Invalid ciphertext format')
  })

  it('should throw when ENCRYPTION_KEY is missing', () => {
    const original = process.env.ENCRYPTION_KEY
    delete process.env.ENCRYPTION_KEY
    expect(() => encrypt('anything')).toThrow('ENCRYPTION_KEY')
    process.env.ENCRYPTION_KEY = original
  })
})
