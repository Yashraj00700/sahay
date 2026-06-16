// ─── Shared Upstash Redis client ──────────────────────────────────────────────
// A single, lazily-imported Redis instance for serverless KV operations
// (install state nonces, idempotency markers, short-lived caches, etc).
//
// `rate-limit.ts` uses its own dedicated client so the @upstash/ratelimit
// library can manage its prefix conventions independently. Application code
// that needs raw GET/SET/DEL operations should import `upstash` from here.

import { Redis } from "@upstash/redis";
import { env } from "./env";

export const upstash = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});
