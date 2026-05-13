import { eq, sql } from "drizzle-orm";
import { db, orders } from "@sahay/db";
import { inngest } from "../client";
import { upsertOrder } from "./shopify-orders-created";
import { triggerToTenant } from "../../lib/pusher";

/**
 * shopify-orders-cancelled
 *
 * Mark the local order as cancelled and broadcast the change so any
 * agent currently viewing the related conversation sees the new status.
 */
export const shopifyOrdersCancelled = inngest.createFunction(
  {
    id: "shopify-orders-cancelled",
    retries: 5,
    concurrency: { limit: 50, key: "event.data.tenantId" },
  },
  { event: "shopify/orders.cancelled" },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data;
    await step.run("upsert", async () => upsertOrder(tenantId, payload));

    await step.run("mark-cancelled", async () => {
      const shopifyOrderId = String(payload["id"] ?? "");
      if (!shopifyOrderId) return;
      await db
        .update(orders)
        .set({
          cancelledAt: new Date(),
          cancelReason: (payload["cancel_reason"] as string | null) ?? null,
          syncedAt: new Date(),
        })
        .where(
          sql`${orders.tenantId} = ${tenantId} AND ${orders.shopifyOrderId} = ${shopifyOrderId}`,
        );
    });

    await step.run("broadcast", async () => {
      await triggerToTenant(tenantId, "conversation:updated", {
        shopifyOrderId: payload["id"] ?? null,
        status: "cancelled",
      });
    });

    return { ok: true };
  },
);

// Suppress unused `eq` if linter complains — kept for parity with other handlers
void eq;
