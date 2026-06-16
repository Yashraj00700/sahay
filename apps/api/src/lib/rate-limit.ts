import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "./env";
import { RateLimitError } from "./errors";

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const cache = new Map<string, Ratelimit>();

const get = (key: string, builder: () => Ratelimit): Ratelimit => {
  const existing = cache.get(key);
  if (existing) return existing;
  const r = builder();
  cache.set(key, r);
  return r;
};

export const limits = {
  /** Per-IP, generous: catches scraping but allows real users. */
  perIp: () =>
    get(
      "ip",
      () =>
        new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(120, "1 m"),
          prefix: "rl:ip",
          analytics: false,
        }),
    ),
  /** Per-IP, strict: for auth endpoints (login/forgot/reset). */
  perIpAuth: () =>
    get(
      "ip-auth",
      () =>
        new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(10, "1 m"),
          prefix: "rl:ip-auth",
          analytics: false,
        }),
    ),
  /** Per-tenant: prevents one tenant from saturating the API. */
  perTenant: () =>
    get(
      "tenant",
      () =>
        new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(600, "1 m"),
          prefix: "rl:tenant",
          analytics: false,
        }),
    ),
  /** Webhook bursts (Shopify can deliver 50+ events in a second). */
  perWebhookSource: () =>
    get(
      "webhook",
      () =>
        new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(300, "10 s"),
          prefix: "rl:webhook",
          analytics: false,
        }),
    ),
};

export async function enforce(rl: Ratelimit, key: string): Promise<void> {
  const { success, reset } = await rl.limit(key);
  if (!success) {
    const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    throw new RateLimitError(retryAfterSec);
  }
}
