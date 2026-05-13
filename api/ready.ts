import type { VercelRequest, VercelResponse } from "@vercel/node";
import { defineHandler } from "../apps/api/src/lib/handler";
import { db } from "@sahay/db";
import { sql } from "drizzle-orm";
import { Redis } from "@upstash/redis";
import { env } from "../apps/api/src/lib/env";

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

type Probe = { name: string; ok: boolean; latencyMs: number; error?: string };

const probe = async (
  name: string,
  fn: () => Promise<unknown>,
): Promise<Probe> => {
  const start = Date.now();
  try {
    await fn();
    return { name, ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
};

export default defineHandler(
  async (_req: VercelRequest, res: VercelResponse) => {
    const probes = await Promise.all([
      probe("database", () => db.execute(sql`SELECT 1`)),
      probe("redis", () => redis.ping()),
      probe("anthropic", async () => {
        const r = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
      }),
    ]);

    const ok = probes.every((p) => p.ok);
    res
      .status(ok ? 200 : 503)
      .json({ ok, probes, timestamp: new Date().toISOString() });
  },
  { methods: ["GET"] },
);
