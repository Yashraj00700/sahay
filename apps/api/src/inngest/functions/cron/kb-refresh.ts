import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db, tenants, withSystemBypass } from "@sahay/db";
import { inngest } from "../../client";

/**
 * cron/kb-refresh
 *
 * Runs once a day at 03:00 UTC (08:30 IST — outside India business
 * hours). For every active tenant with a Shopify connection we fan out
 * a `shopify/sync.requested` for products. The shopify-sync function
 * itself is throttled to concurrency:1 per tenant, so this can never
 * pile multiple syncs on the same shop.
 */
export const kbRefresh = inngest.createFunction(
  { id: "cron-kb-refresh", retries: 1 },
  { cron: "0 3 * * *" },
  async ({ step, logger }) => {
    const tenantList = await step.run("list-tenants", async () =>
      withSystemBypass(() =>
        db
          .select({ id: tenants.id, shopifyDomain: tenants.shopifyDomain })
          .from(tenants)
          .where(
            and(
              eq(tenants.isActive, true),
              isNotNull(tenants.shopifyAccessToken),
              ne(tenants.shopifyAccessToken, ""),
            ),
          ),
      ),
    );

    let scheduled = 0;
    for (const t of tenantList) {
      await inngest.send({
        name: "shopify/sync.requested",
        data: { tenantId: t.id, resource: "products" },
      });
      scheduled += 1;
    }

    logger.info({ scheduled }, "kb-refresh: queued daily product syncs");
    return { scheduled };
  },
);
