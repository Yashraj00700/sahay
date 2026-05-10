/**
 * Web Push delivery service.
 *
 * Wraps the `web-push` library with a couple of project conventions:
 *   - VAPID details are configured exactly once on first use (lazy singleton);
 *     this keeps cold starts cheap and lets the rest of the codebase load
 *     even when push is unconfigured (dev / preview).
 *   - `sendPush` never throws. It returns a tagged result so callers can
 *     decide whether to prune the subscription (410 Gone, 404) without
 *     wrapping every call in try/catch. This mirrors the resend / pusher
 *     services elsewhere in apps/api.
 *   - 60s TTL: if the user's browser is offline for more than a minute the
 *     push goes stale rather than piling up. Sahay notifications are
 *     interactive — a notification an hour later is just noise.
 */
import webpush from 'web-push'
import { env } from '../lib/env'
import { logger } from '../lib/logger'

export interface WebPushKeys {
  p256dh: string
  auth: string
}

export interface WebPushSubscription {
  endpoint: string
  keys: WebPushKeys
}

export interface WebPushPayload {
  title: string
  body: string
  url?: string
  badge?: string
  icon?: string
}

export type SendPushResult =
  | { ok: true }
  | { ok: false; statusCode?: number; error: string }

const PUSH_TTL_SECONDS = 60

let configured = false

/**
 * Returns the configured webpush singleton, or `null` when VAPID env vars
 * are missing (dev / preview without push setup). Callers MUST handle the
 * null case — typically by short-circuiting.
 */
function getWebPush(): typeof webpush | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null
  if (!configured) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    )
    configured = true
  }
  return webpush
}

/**
 * True when VAPID is configured and we can actually deliver pushes.
 * Useful for endpoints that should 503 when push is intentionally off.
 */
export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

/**
 * Delivers a single web push payload to one subscription.
 *
 * Caller contract:
 *   - On `{ ok: false, statusCode: 410 | 404 }` → prune the subscription
 *     from the agent row; the browser endpoint is permanently dead.
 *   - On any other failure (`statusCode` 5xx, network) → keep the sub and
 *     let the inngest retry policy handle it.
 */
export async function sendPush(
  subscription: WebPushSubscription,
  payload: WebPushPayload,
): Promise<SendPushResult> {
  const wp = getWebPush()
  if (!wp) {
    return { ok: false, error: 'VAPID keys not configured' }
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    badge: payload.badge,
    icon: payload.icon,
  })

  try {
    await wp.sendNotification(subscription, body, { TTL: PUSH_TTL_SECONDS })
    return { ok: true }
  } catch (err) {
    // web-push throws WebPushError with `.statusCode` for HTTP failures,
    // and a generic Error for anything else (DNS, abort, etc).
    const statusCode =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? Number((err as { statusCode?: unknown }).statusCode)
        : undefined
    const message = err instanceof Error ? err.message : String(err)

    // Stale subscriptions are by far the most common failure: we want them
    // logged at debug, not error, so the audit trail isn't noise.
    if (statusCode === 410 || statusCode === 404) {
      logger.debug(
        { endpoint: subscription.endpoint, statusCode },
        'push: subscription gone, will prune',
      )
    } else {
      logger.warn(
        { endpoint: subscription.endpoint, statusCode, err: message },
        'push: send failed',
      )
    }

    return { ok: false, statusCode, error: message }
  }
}
