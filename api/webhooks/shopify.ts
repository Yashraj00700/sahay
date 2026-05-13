// ─── Shopify Webhook Receiver (Vercel Function) ───────────────────────────────
// POST /api/webhooks/shopify
//
// Shopify enforces a 5-second response budget; anything heavier than HMAC
// verification + an Inngest enqueue is unacceptable here. The handler:
//   1. reads the raw body (HMAC is computed over the exact bytes)
//   2. validates `x-shopify-hmac-sha256` against SHOPIFY_API_SECRET
//   3. resolves the tenant from `x-shopify-shop-domain` (401 if unknown)
//   4. maps `x-shopify-topic` to a typed Inngest event name
//   5. enqueues the event and returns 200
//
// All real processing (DB upserts, downstream notifications) happens in
// Inngest functions — those are out of scope for this file.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, tenants } from "@sahay/db";
import { eq } from "drizzle-orm";
import { env } from "../../apps/api/src/lib/env";
import { verifyHmacSha256 } from "../../apps/api/src/lib/crypto";
import { readRawBody } from "../../apps/api/src/lib/raw-body";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";
import { logger } from "../../apps/api/src/lib/logger";
import {
  sendEvent,
  type SahayEventName,
} from "../../apps/api/src/inngest/client";

// Required: HMAC must be computed over the exact bytes Shopify signed.
export const config = { api: { bodyParser: false } };

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

// ─── Topic → Inngest event name mapping ──────────────────────────────────────
// Keep in sync with apps/api/src/services/shopify/webhooks.ts and the event
// map in apps/api/src/inngest/client.ts.

const TOPIC_TO_EVENT = {
  "orders/create": "shopify/orders.created",
  "orders/updated": "shopify/orders.updated",
  "orders/cancelled": "shopify/orders.cancelled",
  "orders/fulfilled": "shopify/orders.fulfilled",
  "customers/create": "shopify/customers.created",
  "customers/update": "shopify/customers.updated",
  "products/create": "shopify/products.created",
  "products/update": "shopify/products.updated",
  "products/delete": "shopify/products.deleted",
  "app/uninstalled": "shopify/app.uninstalled",
  "customers/data_request": "shopify/customers.data_request",
  "customers/redact": "shopify/customers.redact",
  "shop/redact": "shopify/shop.redact",
} as const satisfies Record<string, SahayEventName>;

type ShopifyTopic = keyof typeof TOPIC_TO_EVENT;
type ShopifyInngestEvent = (typeof TOPIC_TO_EVENT)[ShopifyTopic];

function isKnownTopic(t: string): t is ShopifyTopic {
  return Object.prototype.hasOwnProperty.call(TOPIC_TO_EVENT, t);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const log = logger.child({ webhook: "shopify" });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // ─── 1. Raw body ──────────────────────────────────────────────────────────
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    log.error({ err }, "failed to read Shopify webhook body");
    // Fail loud — Shopify will retry, and a missing body means our infra is
    // broken. No silent 200.
    res.status(500).json({ error: "body_read_failed" });
    return;
  }

  // ─── 2. HMAC ──────────────────────────────────────────────────────────────
  const hmacHeader = pickHeader(req.headers["x-shopify-hmac-sha256"]);
  if (!hmacHeader) {
    log.warn("shopify webhook missing HMAC header");
    res.status(401).json({ error: "missing_signature" });
    return;
  }
  const valid = verifyHmacSha256(
    rawBody,
    hmacHeader,
    env.SHOPIFY_WEBHOOK_SECRET,
    "base64",
  );
  if (!valid) {
    log.warn("shopify webhook HMAC verification failed");
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  // ─── 3. Resolve tenant ────────────────────────────────────────────────────
  const shopRaw = pickHeader(req.headers["x-shopify-shop-domain"]);
  if (!shopRaw) {
    log.warn("shopify webhook missing shop-domain header");
    res.status(401).json({ error: "missing_shop" });
    return;
  }
  const shop = shopRaw.toLowerCase();
  if (!SHOP_DOMAIN_RE.test(shop)) {
    log.warn({ shop }, "shopify webhook invalid shop domain");
    res.status(401).json({ error: "invalid_shop" });
    return;
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.shopifyDomain, shop),
  });
  if (!tenant) {
    // Per the spec: never silent-200 a missing tenant. Shopify will retry,
    // and we want the row in our logs so the on-call engineer can investigate.
    log.warn({ shop }, "shopify webhook for unknown tenant");
    res.status(401).json({ error: "unknown_tenant" });
    return;
  }

  // ─── 4. Rate limit ────────────────────────────────────────────────────────
  try {
    await enforce(limits.perWebhookSource(), `shopify:${shop}`);
  } catch {
    // 429 — Shopify will retry, which is the desired behaviour.
    log.warn({ shop }, "shopify webhook rate limited");
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  // ─── 5. Topic → event mapping ─────────────────────────────────────────────
  const topic = pickHeader(req.headers["x-shopify-topic"]);
  if (!topic) {
    log.warn({ shop }, "shopify webhook missing topic header");
    res.status(400).json({ error: "missing_topic" });
    return;
  }
  if (!isKnownTopic(topic)) {
    log.warn({ shop, topic }, "shopify webhook unknown topic; ignoring");
    // 200 here — we acknowledge to Shopify. Unknown topic means we
    // (intentionally) don't subscribe to it; no need to make Shopify retry.
    res.status(200).end();
    return;
  }
  const eventName: ShopifyInngestEvent = TOPIC_TO_EVENT[topic];

  // ─── 6. Parse JSON payload ────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch (err) {
    log.error({ shop, topic, err }, "shopify webhook JSON parse failed");
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  const eventId = pickHeader(req.headers["x-shopify-event-id"]) ?? "";

  // ─── 7. Enqueue + ack ─────────────────────────────────────────────────────
  // The Inngest event-map's data shape varies (most carry `payload`+`eventId`,
  // `app/uninstalled` carries only tenantId+shop, GDPR ones carry payload but
  // no eventId). We resolve the right shape per topic so TypeScript stays happy.
  try {
    await dispatch(eventName, {
      tenantId: tenant.id,
      shop,
      payload,
      eventId,
    });
  } catch (err) {
    log.error({ shop, topic, err }, "failed to enqueue shopify Inngest event");
    // Return 500 so Shopify retries — losing a webhook silently is worse
    // than a duplicate delivery (Inngest events are idempotent on eventId
    // for downstream handlers).
    res.status(500).json({ error: "enqueue_failed" });
    return;
  }

  res.status(200).end();
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function pickHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

interface DispatchInput {
  tenantId: string;
  shop: string;
  payload: Record<string, unknown>;
  eventId: string;
}

/**
 * Narrow the Inngest event shape per topic. The map entries differ in
 * payload structure (some omit eventId; app/uninstalled has no payload),
 * so we route through a discriminated switch to preserve full type safety
 * without resorting to `any`.
 */
async function dispatch(
  name: ShopifyInngestEvent,
  input: DispatchInput,
): Promise<void> {
  switch (name) {
    case "shopify/orders.created":
    case "shopify/orders.updated":
    case "shopify/orders.cancelled":
    case "shopify/orders.fulfilled":
    case "shopify/customers.created":
    case "shopify/customers.updated":
    case "shopify/products.created":
    case "shopify/products.updated":
    case "shopify/products.deleted":
      await sendEvent({
        name,
        data: {
          tenantId: input.tenantId,
          shop: input.shop,
          payload: input.payload,
          eventId: input.eventId,
        },
      });
      return;
    case "shopify/app.uninstalled":
      await sendEvent({
        name,
        data: { tenantId: input.tenantId, shop: input.shop },
      });
      return;
    case "shopify/customers.data_request":
    case "shopify/customers.redact":
    case "shopify/shop.redact":
      await sendEvent({
        name,
        data: {
          tenantId: input.tenantId,
          shop: input.shop,
          payload: input.payload,
        },
      });
      return;
    default: {
      // Should be unreachable: TOPIC_TO_EVENT only contains the names above.
      const exhaustive: never = name;
      throw new Error(`unhandled shopify event ${String(exhaustive)}`);
    }
  }
}
