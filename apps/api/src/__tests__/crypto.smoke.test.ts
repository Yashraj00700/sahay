import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decrypt, encrypt, randomToken, verifyHmacSha256 } from "../lib/crypto";

describe("crypto smoke", () => {
  it("encrypt/decrypt roundtrip preserves UTF-8 strings", () => {
    const samples = [
      "hello world",
      "unicode: नमस्ते 你好 🙏",
      JSON.stringify({ token: "shpat_abc", expiresAt: 1234567890 }),
      " ", // single-byte edge case
    ];
    for (const plaintext of samples) {
      const ct = encrypt(plaintext);
      // Format is iv.tag.ciphertext (3 base64url chunks).
      expect(ct.split(".")).toHaveLength(3);
      expect(decrypt(ct)).toBe(plaintext);
    }
  });

  it("encrypt produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encrypt("same input");
    const b = encrypt("same input");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same input");
    expect(decrypt(b)).toBe("same input");
  });

  it("decrypt throws on malformed ciphertext", () => {
    expect(() => decrypt("not.even.close")).toThrow();
    expect(() => decrypt("only-two.parts")).toThrow(/Malformed/);
  });

  it("decrypt throws on tampered ciphertext", () => {
    const ct = encrypt("sensitive payload");
    const [iv, tag, body] = ct.split(".");
    // Flip a byte in the body — GCM auth tag should reject it.
    const tampered = `${iv}.${tag}.${body!.slice(0, -2)}AA`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it("verifyHmacSha256 returns true on a correct base64 signature", () => {
    const secret = "shopify-webhook-secret";
    const body = '{"event":"orders/create"}';
    const expected = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyHmacSha256(body, expected, secret, "base64")).toBe(true);
  });

  it("verifyHmacSha256 supports hex encoding", () => {
    const secret = "meta-webhook-secret";
    const body = Buffer.from('{"object":"whatsapp_business_account"}', "utf8");
    const expectedHex = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmacSha256(body, expectedHex, secret, "hex")).toBe(true);
  });

  it("verifyHmacSha256 returns false on a wrong signature of correct length", () => {
    const secret = "secret";
    const body = "payload";
    const real = createHmac("sha256", secret).update(body).digest("base64");
    // Same length, different content — flip the last char.
    const wrong = real.slice(0, -1) + (real.endsWith("A") ? "B" : "A");
    expect(verifyHmacSha256(body, wrong, secret, "base64")).toBe(false);
  });

  it("verifyHmacSha256 is timing-safe and does not crash on wrong-length signatures", () => {
    const secret = "secret";
    const body = "payload";
    expect(verifyHmacSha256(body, "", secret, "base64")).toBe(false);
    expect(verifyHmacSha256(body, "short", secret, "base64")).toBe(false);
    expect(verifyHmacSha256(body, "a".repeat(200), secret, "base64")).toBe(
      false,
    );
  });

  it("randomToken yields high-entropy distinct strings", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    // 32 bytes -> 43 base64url chars (no padding).
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
