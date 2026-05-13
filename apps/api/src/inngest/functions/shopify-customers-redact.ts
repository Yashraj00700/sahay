import { eq, sql } from "drizzle-orm";
import { customers, conversations, messages, withTenant } from "@sahay/db";
import { inngest } from "../client";
import { auditAction } from "../../services/audit";

/**
 * shopify-customers-redact (GDPR / DPDP)
 *
 * Hard-delete every Sahay record tied to the Shopify customer id passed
 * by the webhook. Cascades:
 *   1. delete messages whose conversationId belongs to a conversation of the customer
 *   2. delete conversations
 *   3. delete the customer row
 * Audit log records the redaction (the audit log is itself outside the
 * deletion scope — required to demonstrate compliance).
 */
export const shopifyCustomersRedact = inngest.createFunction(
  {
    id: "shopify-customers-redact",
    retries: 3,
  },
  { event: "shopify/customers.redact" },
  async ({ event, step }) => {
    const { tenantId, shop, payload } = event.data;
    const shopifyCustomerId =
      payload["customer"] && typeof payload["customer"] === "object"
        ? String((payload["customer"] as { id?: unknown }).id ?? "")
        : "";

    if (!shopifyCustomerId) return { skipped: true, reason: "no_customer_id" };

    const customer = await step.run("lookup", async () =>
      withTenant(tenantId, (tx) =>
        tx.query.customers.findFirst({
          where: sql`${customers.tenantId} = ${tenantId}
            AND ${customers.shopifyCustomerId} = ${BigInt(shopifyCustomerId)}`,
        }),
      ),
    );

    if (!customer) return { skipped: true, reason: "customer_not_found" };

    await step.run("delete-cascade", async () =>
      withTenant(tenantId, async (tx) => {
        const convs = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.customerId, customer.id));
        const convIds = convs.map((c) => c.id);

        if (convIds.length > 0) {
          await tx.delete(messages).where(
            sql`${messages.conversationId} IN (${sql.join(
              convIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
          await tx
            .delete(conversations)
            .where(eq(conversations.customerId, customer.id));
        }
        await tx.delete(customers).where(eq(customers.id, customer.id));
      }),
    );

    await step.run("audit", async () => {
      await auditAction({
        tenantId,
        actorType: "system",
        action: "gdpr.customer_redacted",
        resourceType: "customer",
        resourceId: customer.id,
        metadata: { shopifyCustomerId, shop },
      });
    });

    return { ok: true, redactedCustomerId: customer.id };
  },
);
