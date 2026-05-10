/**
 * Idempotent Shopify webhook registration.
 *
 * Run once during the OAuth callback: lists the webhooks Shopify already
 * has on file for the shop, then creates only the topics that are missing
 * (or whose `address` differs from ours). Safe to run multiple times — this
 * is the post-install reconciliation that keeps a re-installed shop in sync
 * with whatever topic list this code currently knows about.
 *
 * Throws IntegrationError(topic) on the first failure so the caller can
 * surface a useful message to the merchant.
 */

import { env } from '../../lib/env'
import { IntegrationError } from '../../lib/errors'
import { logger } from '../../lib/logger'
import { ShopifyClient, SHOPIFY_API_VERSION } from './client'

/**
 * The set of webhook topics Sahay relies on. Order doesn't matter, but
 * keep this list in sync with the Inngest event map in `inngest/client.ts`.
 *
 * GDPR mandatory webhooks (customers/data_request, customers/redact,
 * shop/redact) are required by Shopify for app review — never remove them.
 */
export const MANDATORY_WEBHOOK_TOPICS: ReadonlyArray<string> = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'customers/create',
  'customers/update',
  'products/create',
  'products/update',
  'products/delete',
  'app/uninstalled',
  'customers/data_request',
  'customers/redact',
  'shop/redact',
]

interface RegisteredWebhook {
  id: number
  topic: string
  address: string
  format: string
}

interface WebhooksListResponse {
  webhooks: ReadonlyArray<RegisteredWebhook>
}

interface WebhookCreateResponse {
  webhook: RegisteredWebhook
}

const webhooksPath = `/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`

/**
 * Register every topic in MANDATORY_WEBHOOK_TOPICS for the given shop.
 * Skips topics that already point to our address; replaces topics whose
 * address has drifted (e.g. after a SHOPIFY_APP_URL change).
 */
export async function registerMandatoryWebhooks(
  shop: string,
  accessToken: string,
): Promise<void> {
  const client = new ShopifyClient(shop, accessToken)
  const address = `${env.SHOPIFY_APP_URL.replace(/\/$/, '')}/api/webhooks/shopify`

  // 1. List existing webhooks.
  let existing: ReadonlyArray<RegisteredWebhook>
  try {
    const res = await client.rest.get<WebhooksListResponse>(webhooksPath)
    existing = res.webhooks ?? []
  } catch (err) {
    throw new IntegrationError(
      'shopify',
      `failed to list webhooks for ${shop}`,
      err,
    )
  }

  const byTopic = new Map<string, RegisteredWebhook>()
  for (const w of existing) byTopic.set(w.topic, w)

  // 2. For each required topic, decide create / replace / skip.
  for (const topic of MANDATORY_WEBHOOK_TOPICS) {
    const current = byTopic.get(topic)

    if (current && current.address === address && current.format === 'json') {
      logger.debug({ shop, topic }, 'webhook already registered, skipping')
      continue
    }

    // If the topic exists with a stale address, delete it first so we don't
    // end up with two webhooks for the same topic.
    if (current && current.address !== address) {
      try {
        await client.rest.delete(
          `/admin/api/${SHOPIFY_API_VERSION}/webhooks/${current.id}.json`,
        )
        logger.info(
          { shop, topic, oldAddress: current.address },
          'replaced stale webhook',
        )
      } catch (err) {
        throw new IntegrationError(
          'shopify',
          `failed to delete stale webhook for topic ${topic}`,
          err,
        )
      }
    }

    try {
      await client.rest.post<WebhookCreateResponse>(webhooksPath, {
        webhook: { topic, address, format: 'json' },
      })
      logger.info({ shop, topic }, 'webhook registered')
    } catch (err) {
      throw new IntegrationError(
        'shopify',
        `failed to register webhook for topic ${topic}`,
        err,
      )
    }
  }
}
