// ─── Login lockout (brute-force defense) ─────────────────────────────────────
// Layered on top of the per-IP rate limit (`rate-limit.ts`). The rate limit
// catches request floods; this module catches slower, distributed credential
// stuffing where each IP/email stays under the rate-limit budget.
//
// Two independent counters live in Upstash Redis:
//   • `lockout:email:<lower>` — tracks failures per account (threshold 5)
//   • `lockout:ip:<ip>`       — tracks failures per source IP (threshold 20,
//                                deliberately looser to accommodate shared
//                                NATs / corporate proxies).
//
// Both counters expire 15 minutes after their FIRST increment (sliding window
// is intentional: a focused attacker can't keep a counter alive forever, and
// a real user who waits 15m gets a clean slate).
//
// IMPORTANT: callers MUST treat a lockout response identically to "invalid
// credentials" from the user's perspective — leaking that an email is locked
// would also leak that the email exists. The thrown AppError uses a generic
// message; the caller decides what HTTP body to send.

import { upstash } from "./upstash";
import { AppError } from "./errors";

/** How long a counter persists after its first failure (seconds). */
const WINDOW_SEC = 15 * 60;

/** Per-account threshold: 5 failures within the window triggers lockout. */
export const EMAIL_THRESHOLD = 5;

/** Per-IP threshold: 20 failures within the window triggers lockout. */
export const IP_THRESHOLD = 20;

interface LockoutKey {
  email: string;
  ip: string;
}

const emailKey = (email: string): string =>
  `lockout:email:${email.trim().toLowerCase()}`;

const ipKey = (ip: string): string => `lockout:ip:${ip || "unknown"}`;

/**
 * Throws `AppError('FORBIDDEN', ..., 429)` if either counter is at or above
 * its threshold. Resolves silently otherwise.
 *
 * The error message is deliberately generic so we don't leak whether an
 * email exists in the system (a locked email and a missing email both yield
 * the same "Account temporarily locked" response).
 */
export async function checkLockout({ email, ip }: LockoutKey): Promise<void> {
  const [emailCount, ipCount] = await Promise.all([
    upstash.get<number>(emailKey(email)),
    upstash.get<number>(ipKey(ip)),
  ]);

  const eHits = Number(emailCount ?? 0);
  const iHits = Number(ipCount ?? 0);

  if (eHits >= EMAIL_THRESHOLD || iHits >= IP_THRESHOLD) {
    const minutes = Math.ceil(WINDOW_SEC / 60);
    throw new AppError(
      "FORBIDDEN",
      `Account temporarily locked. Try again in ${minutes} minutes.`,
      429,
    );
  }
}

/**
 * Increment both counters. We use INCR (which creates the key if missing,
 * starting at 1) and only set the EXPIREAT when we just created it — this
 * gives us a true sliding-from-first-failure window rather than refreshing
 * the TTL on every failure (which would let an attacker keep a key alive
 * indefinitely).
 */
export async function recordFailedAttempt({
  email,
  ip,
}: LockoutKey): Promise<void> {
  const expireAt = Math.floor(Date.now() / 1000) + WINDOW_SEC;
  const eKey = emailKey(email);
  const iKey = ipKey(ip);

  const [eCount, iCount] = await Promise.all([
    upstash.incr(eKey),
    upstash.incr(iKey),
  ]);

  // Only set the expiry when we just created the key (count === 1). For
  // subsequent increments the existing TTL stays in place.
  const expiries: Promise<unknown>[] = [];
  if (eCount === 1) expiries.push(upstash.expireat(eKey, expireAt));
  if (iCount === 1) expiries.push(upstash.expireat(iKey, expireAt));
  if (expiries.length) await Promise.all(expiries);
}

/**
 * Wipe both counters. Call on a successful login so a user who legitimately
 * fat-fingered their password 4 times doesn't have those failures count
 * against their next login attempt.
 */
export async function clearLockout({ email, ip }: LockoutKey): Promise<void> {
  await Promise.all([upstash.del(emailKey(email)), upstash.del(ipKey(ip))]);
}
