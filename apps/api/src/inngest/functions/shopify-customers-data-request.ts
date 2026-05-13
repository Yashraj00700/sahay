import { eq, sql } from "drizzle-orm";
import {
  tenants,
  customers,
  conversations,
  messages,
  withTenant,
} from "@sahay/db";
import { inngest } from "../client";
import { sendEmail } from "../../services/email";
import { auditAction } from "../../services/audit";

/**
 * shopify-customers-data-request (GDPR / DPDP)
 *
 * On a data export request from Shopify, we have 30 days to deliver the
 * data to the merchant. We collect every Sahay record tied to the
 * Shopify customer id mentioned in the payload and email a JSON dump to
 * the shop owner so they can forward it to the requester.
 */
export const shopifyCustomersDataRequest = inngest.createFunction(
  {
    id: "shopify-customers-data-request",
    retries: 3,
  },
  { event: "shopify/customers.data_request" },
  async ({ event, step }) => {
    const { tenantId, shop, payload } = event.data;
    const shopifyCustomerId =
      payload["customer"] && typeof payload["customer"] === "object"
        ? String((payload["customer"] as { id?: unknown }).id ?? "")
        : "";

    if (!shopifyCustomerId) {
      return { skipped: true, reason: "no_customer_id" };
    }

    const dump = await step.run("collect", async () =>
      withTenant(tenantId, async (tx) => {
        const customer = await tx.query.customers.findFirst({
          where: sql`${customers.tenantId} = ${tenantId}
            AND ${customers.shopifyCustomerId} = ${BigInt(shopifyCustomerId)}`,
        });
        if (!customer) return null;

        const convs = await tx.query.conversations.findMany({
          where: eq(conversations.customerId, customer.id),
        });
        const msgIds = convs.map((c) => c.id);
        const allMessages = msgIds.length
          ? await tx
              .select()
              .from(messages)
              .where(
                sql`${messages.conversationId} IN (${sql.join(
                  msgIds.map((id) => sql`${id}`),
                  sql`, `,
                )})`,
              )
          : [];

        return { customer, conversations: convs, messages: allMessages };
      }),
    );

    if (!dump) return { skipped: true, reason: "customer_not_found" };

    const merchantEmail = await step.run("lookup-merchant-email", async () =>
      withTenant(tenantId, async (tx) => {
        const tenant = await tx.query.tenants.findFirst({
          where: eq(tenants.id, tenantId),
        });
        return tenant?.shopEmail ?? null;
      }),
    );

    if (!merchantEmail) {
      return { skipped: true, reason: "no_merchant_email" };
    }

    await step.run("email-dump", async () => {
      const json = JSON.stringify(dump, null, 2);
      await sendEmail({
        to: merchantEmail,
        subject: `[Sahay] Customer data export — Shopify customer ${shopifyCustomerId}`,
        html: `<p>Customer data export requested for Shopify customer <strong>${shopifyCustomerId}</strong> on shop <strong>${shop}</strong>.</p>
<p>Attached as JSON below. Please forward to the requester.</p>
<pre style="font-size:11px;background:#f4f4f4;padding:12px;border-radius:6px;overflow:auto">${escapeHtml(json)}</pre>`,
        text: `Customer data export requested for Shopify customer ${shopifyCustomerId} on shop ${shop}.\n\n${json}`,
        category: "generic",
      });
    });

    await step.run("audit", async () => {
      await auditAction({
        tenantId,
        actorType: "system",
        action: "gdpr.data_request_fulfilled",
        resourceType: "customer",
        resourceId: dump.customer.id,
        metadata: { shopifyCustomerId, shop },
      });
    });

    return {
      ok: true,
      recordsExported: 1 + dump.conversations.length + dump.messages.length,
    };
  },
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
