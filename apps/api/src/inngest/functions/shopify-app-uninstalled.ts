import { eq } from 'drizzle-orm'
import { db, tenants } from '@sahay/db'
import { inngest } from '../client'
import { auditAction } from '../../services/audit'

/**
 * shopify-app-uninstalled
 *
 * Mark the tenant as inactive on the GDPR-mandatory app/uninstalled
 * webhook. We keep the tenant row around (don't hard-delete) because
 * Shopify customers/redact and shop/redact webhooks may still arrive in
 * the next 48 hours and they need the tenant for tenant-scoped DELETEs.
 * Tokens are nulled so any background worker that picks up a stale event
 * fails fast rather than calling Shopify with a revoked token.
 */
export const shopifyAppUninstalled = inngest.createFunction(
  {
    id: 'shopify-app-uninstalled',
    retries: 3,
  },
  { event: 'shopify/app.uninstalled' },
  async ({ event, step }) => {
    const { tenantId, shop } = event.data

    await step.run('mark-uninstalled', async () => {
      await db
        .update(tenants)
        .set({
          isActive: false,
          shopifyAccessToken: '',
          whatsappToken: null,
          instagramToken: null,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId))
    })

    await step.run('audit', async () => {
      await auditAction({
        tenantId,
        actorType: 'system',
        action: 'shopify.app_uninstalled',
        resourceType: 'tenant',
        resourceId: tenantId,
        metadata: { shop },
      })
    })

    return { ok: true }
  },
)
