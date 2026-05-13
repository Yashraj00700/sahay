import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export interface JWTPayload {
  agentId: string;
  tenantId: string;
  role: string;
  email: string;
  type?: "access" | "refresh";
  iat?: number;
  exp?: number;
}

const enc = (s: string | Buffer) => Buffer.from(s).toString("base64url");

const dec = (s: string) => Buffer.from(s, "base64url");

function sign(payload: object, secret: string, expiresInSec: number): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const headB64 = enc(JSON.stringify(header));
  const bodyB64 = enc(JSON.stringify(body));
  const data = `${headB64}.${bodyB64}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify<T extends object>(token: string, secret: string): T {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [h, p, s] = parts;
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = dec(s);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    throw new Error("Invalid signature");
  }
  const payload = JSON.parse(dec(p).toString("utf8")) as T & { exp?: number };
  if (
    typeof payload.exp === "number" &&
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Token expired");
  }
  return payload;
}

const parseDuration = (input: string, fallbackSec: number): number => {
  const m = /^(\d+)\s*([smhd])$/.exec(input.trim());
  if (!m) return fallbackSec;
  const n = Number(m[1]);
  const unit = m[2];
  const mult =
    unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return n * mult;
};

export const accessTtlSec = (): number =>
  parseDuration(env.JWT_EXPIRES_IN, 3600);

export const refreshTtlSec = (): number =>
  parseDuration(env.JWT_REFRESH_EXPIRES_IN, 30 * 86400);

export function signAccessToken(
  payload: Omit<JWTPayload, "type" | "iat" | "exp">,
): string {
  return sign({ ...payload, type: "access" }, env.JWT_SECRET, accessTtlSec());
}

export function signRefreshToken(
  payload: Omit<JWTPayload, "type" | "iat" | "exp">,
): string {
  return sign(
    { ...payload, type: "refresh" },
    env.JWT_REFRESH_SECRET,
    refreshTtlSec(),
  );
}

export function verifyAccessToken(token: string): JWTPayload {
  const p = verify<JWTPayload>(token, env.JWT_SECRET);
  if (p.type && p.type !== "access") throw new Error("Wrong token type");
  return p;
}

export function verifyRefreshToken(token: string): JWTPayload {
  const p = verify<JWTPayload>(token, env.JWT_REFRESH_SECRET);
  if (p.type !== "refresh") throw new Error("Wrong token type");
  return p;
}
