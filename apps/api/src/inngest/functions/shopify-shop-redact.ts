import { eq } from 'drizzle-orm'
import {
  db,
  tenants,
  customers,
  conversations,
  messages,
  knowledgeChunks,
  orders,
  withSystemBypass,
} from '@sahay/db'
import { inngest } from '../client'
import { auditAction } from '../../services/audit'

/**
 * shopify-shop-redact (GDPR / DPDP)
 *
 * Shopify sends this 48 hours after app uninstall. We must wipe every
 * piece of merchant data we hold. Tables are deleted in dependency order
 * (children before parents) to satisfy foreign keys; the tenant row
 * itself is the last thing to go.
 */
export const shopifyShopRedact = inngest.createFunction(
  {
    id: 'shopify-shop-redact',
    retries: 3,
  },
  { event: 'shopify/shop.redact' },
  async ({ event, step }) => {
    const { tenantId, shop } = event.data

    await step.run('delete-data', async () =>
      withSystemBypass(async () => {
        // Children first (CASCADE constraints handle most of this, but doing
        // it explicitly makes the intent auditable). This deliberately uses
        // the un-scoped `db` connection because the operation deletes the
        // tenants row itself — a tenant-scoped tx would fail on its own
        // delete (RLS WITH CHECK on the tenants table).
        await db.delete(messages).where(eq(messages.tenantId, tenantId))
        await db.delete(conversations).where(eq(conversations.tenantId, tenantId))
        await db.delete(customers).where(eq(customers.tenantId, tenantId))
        await db.delete(orders).where(eq(orders.tenantId, tenantId))
        await db.delete(knowledgeChunks).where(eq(knowledgeChunks.tenantId, tenantId))
        // Tenant row last — cascades will pick up anything we missed.
        await db.delete(tenants).where(eq(tenants.id, tenantId))
      }),
    )

    await step.run('audit', async () => {
      // The audit log is intentionally NOT scoped to a tenantId here so
      // the row survives the tenant deletion above.
      await auditAction({
        actorType: 'system',
        action: 'gdpr.shop_redacted',
        resourceType: 'tenant',
        resourceId: tenantId,
        metadata: { shop },
      })
    })

    return { ok: true, tenantId }
  },
)
