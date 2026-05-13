import { and, eq, sql } from "drizzle-orm";
import { orders, conversations, withTenant } from "@sahay/db";
import { inngest } from "../client";
import { upsertOrder } from "./shopify-orders-created";
import { triggerToTenant, triggerToConversation } from "../../lib/pusher";

/**
 * shopify-orders-fulfilled
 *
 * Upsert the order, mark fulfillment, and push the update into any open
 * conversations linked to that order so agents/the AI see the new status
 * in real time.
 */
export const shopifyOrdersFulfilled = inngest.createFunction(
  {
    id: "shopify-orders-fulfilled",
    retries: 5,
    concurrency: { limit: 50, key: "event.data.tenantId" },
  },
  { event: "shopify/orders.fulfilled" },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data;

    await step.run("upsert", async () => upsertOrder(tenantId, payload));

    await step.run("mark-fulfilled", async () => {
      const shopifyOrderId = String(payload["id"] ?? "");
      if (!shopifyOrderId) return;
      await withTenant(tenantId, (tx) =>
        tx
          .update(orders)
          .set({
            fulfillmentStatus:
              (payload["fulfillment_status"] as string | null) ?? "fulfilled",
            fulfilledAt: new Date(),
            syncedAt: new Date(),
          })
          .where(
            sql`${orders.tenantId} = ${tenantId} AND ${orders.shopifyOrderId} = ${shopifyOrderId}`,
          ),
      );
    });

    await step.run("broadcast", async () => {
      const shopifyOrderId = String(payload["id"] ?? "");
      // Notify each open conversation linked to this Shopify order.
      const linked = await withTenant(tenantId, (tx) =>
        tx.query.conversations.findMany({
          where: and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.shopifyOrderId, shopifyOrderId),
          ),
        }),
      );
      for (const conv of linked) {
        await triggerToConversation(conv.id, "conversation:updated", {
          conversation: {
            id: conv.id,
            shopifyOrderId,
            status: "fulfilled",
          },
        });
      }
      await triggerToTenant(tenantId, "conversation:updated", {
        shopifyOrderId,
        status: "fulfilled",
        affectedConversations: linked.map((c) => c.id),
      });
    });

    return { ok: true };
  },
);
