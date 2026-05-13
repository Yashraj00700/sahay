import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type JWTPayload,
} from "../lib/jwt";
import { env } from "../lib/env";

const samplePayload: Omit<JWTPayload, "type" | "iat" | "exp"> = {
  agentId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  role: "agent",
  email: "agent@example.com",
};

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64url");

/**
 * Build a JWT directly using the same HS256 scheme as `lib/jwt.ts`. Used
 * to construct edge-case tokens (expired, wrong type) without monkey-patching.
 */
function manualSign(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

describe("jwt smoke", () => {
  it("signAccessToken / verifyAccessToken roundtrip preserves payload", () => {
    const token = signAccessToken(samplePayload);
    const decoded = verifyAccessToken(token);
    expect(decoded.agentId).toBe(samplePayload.agentId);
    expect(decoded.tenantId).toBe(samplePayload.tenantId);
    expect(decoded.role).toBe(samplePayload.role);
    expect(decoded.email).toBe(samplePayload.email);
    expect(decoded.type).toBe("access");
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
  });

  it("verifyAccessToken throws on tampered signature", () => {
    const token = signAccessToken(samplePayload);
    const parts = token.split(".");
    // Flip the last char of the signature in a base64url-safe way.
    const sig = parts[2]!;
    const lastChar = sig.slice(-1);
    const tampered = sig.slice(0, -1) + (lastChar === "A" ? "B" : "A");
    const bad = `${parts[0]}.${parts[1]}.${tampered}`;
    expect(() => verifyAccessToken(bad)).toThrow(/Invalid signature/);
  });

  it("verifyAccessToken throws on tampered payload", () => {
    const token = signAccessToken(samplePayload);
    const parts = token.split(".");
    const evilPayload = b64url(
      JSON.stringify({ ...samplePayload, role: "admin", type: "access" }),
    );
    const bad = `${parts[0]}.${evilPayload}.${parts[2]}`;
    expect(() => verifyAccessToken(bad)).toThrow(/Invalid signature/);
  });

  it("verifyAccessToken throws on expired token", () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = manualSign(
      { ...samplePayload, type: "access", iat: now - 7200, exp: now - 3600 },
      env.JWT_SECRET,
    );
    expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
  });

  it("verifyAccessToken throws on malformed token", () => {
    expect(() => verifyAccessToken("not-a-jwt")).toThrow(/Malformed/);
  });

  it("signRefreshToken yields a different token than signAccessToken", () => {
    const access = signAccessToken(samplePayload);
    const refresh = signRefreshToken(samplePayload);
    expect(refresh).not.toBe(access);
    // They must verify under different secrets, too.
    expect(() => verifyAccessToken(refresh)).toThrow();
    expect(() => verifyRefreshToken(access)).toThrow();
  });

  it("verifyRefreshToken rejects an access token even when secrets coincide", () => {
    // Forge a token signed with the refresh secret but with type=access.
    const now = Math.floor(Date.now() / 1000);
    const forged = manualSign(
      { ...samplePayload, type: "access", iat: now, exp: now + 3600 },
      env.JWT_REFRESH_SECRET,
    );
    expect(() => verifyRefreshToken(forged)).toThrow(/Wrong token type/);
  });

  it("verifyRefreshToken accepts a real refresh token", () => {
    const token = signRefreshToken(samplePayload);
    const decoded = verifyRefreshToken(token);
    expect(decoded.type).toBe("refresh");
    expect(decoded.agentId).toBe(samplePayload.agentId);
  });
});
