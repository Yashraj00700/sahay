import type { ShopifySyncJob } from '../lib/queues'
export async function processShopifySync(job: ShopifySyncJob): Promise<void> {
  console.log('TODO: Implement Shopify sync', job.type, job.tenantId)
}
