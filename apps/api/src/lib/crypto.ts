import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

const ALGO = "aes-256-gcm";

const keyBuf = (): Buffer =>
  createHash("sha256").update(env.ENCRYPTION_KEY).digest();

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBuf(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(token: string): string {
  const [ivB64, tagB64, ctB64] = token.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed ciphertext");
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv(ALGO, keyBuf(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function verifyHmacSha256(
  rawBody: Buffer | string,
  signatureB64OrHex: string,
  secret: string,
  encoding: "base64" | "hex" = "base64",
): boolean {
  const body =
    typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", secret).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(signatureB64OrHex, encoding);
  } catch {
    return false;
  }
  if (got.length !== expected.length) return false;
  return timingSafeEqual(expected, got);
}

export const randomToken = (bytes = 32): string =>
  randomBytes(bytes).toString("base64url");
