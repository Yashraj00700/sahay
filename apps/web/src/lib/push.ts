/**
 * Web Push client — registers /sw.js, subscribes the browser, and
 * persists the subscription on the server.
 *
 * Why this lives outside the React tree:
 *   - It needs to run during logout (auth.store) where hooks aren't
 *     available.
 *   - The subscription lifecycle is per-browser, not per-component,
 *     so colocating with the auth store is the right boundary.
 *
 * All functions are no-ops on browsers without service worker / push
 * support, so callers can invoke them unconditionally.
 */

interface VapidKeyResponse {
  publicKey: string | null
}

/**
 * Decodes a base64url-encoded VAPID public key into a plain ArrayBuffer.
 * `pushManager.subscribe()` requires a `BufferSource` for
 * `applicationServerKey`; we hand back the raw ArrayBuffer rather than
 * the Uint8Array view because TS's `BufferSource` type is unhappy with
 * `Uint8Array<ArrayBufferLike>` (the modern lib.dom typing).
 */
function urlBase64ToArrayBuffer(base64Url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buffer
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

async function fetchVapidKey(token: string): Promise<string | null> {
  const res = await fetch('/api/notifications/vapid-key', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 503) return null // push intentionally disabled on server
  if (!res.ok) throw new Error(`vapid-key: ${res.status}`)
  const data = (await res.json()) as VapidKeyResponse
  return data.publicKey
}

async function postSubscription(
  token: string,
  sub: PushSubscription,
): Promise<void> {
  const json = sub.toJSON()
  const res = await fetch('/api/notifications/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  })
  if (!res.ok) throw new Error(`subscribe: ${res.status}`)
}

async function postUnsubscription(token: string, endpoint: string): Promise<void> {
  // We use keepalive so this still completes if invoked during page-unload
  // (e.g. tab close immediately after logout).
  await fetch('/api/notifications/unsubscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ endpoint }),
    keepalive: true,
  })
}

/**
 * Registers the service worker and subscribes the browser to push.
 *
 * Caller MUST invoke this from a user gesture (button click) — Notification
 * permission cannot be requested otherwise on modern browsers, and Chrome
 * specifically demotes sites that prompt without one.
 *
 * Idempotent: if already subscribed, re-uses the existing subscription
 * and re-syncs it to the server (handy when the browser rotated the
 * endpoint without notifying us).
 */
export async function registerPushAndSubscribe(token: string): Promise<void> {
  if (!pushSupported()) throw new Error('Push notifications not supported')

  // Browser-imposed: must be granted in response to a user gesture.
  if (Notification.permission === 'denied') {
    throw new Error('Notifications permission denied')
  }
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission()
    if (result !== 'granted') throw new Error('Notifications permission not granted')
  }

  const publicKey = await fetchVapidKey(token)
  if (!publicKey) throw new Error('Push not configured on server')

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const existing = await registration.pushManager.getSubscription()
  const applicationServerKey = urlBase64ToArrayBuffer(publicKey)

  let subscription = existing
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })
  }

  await postSubscription(token, subscription)
}

/**
 * Tears down the local subscription and tells the server to forget it.
 * Safe to call when not subscribed; safe to call when offline (we still
 * try the server but swallow the error).
 */
export async function unsubscribePush(token: string): Promise<void> {
  if (!pushSupported()) return

  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!registration) return

  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  try {
    await subscription.unsubscribe()
  } catch {
    // Browser said no — server still needs to be told, fall through.
  }

  try {
    await postUnsubscription(token, endpoint)
  } catch {
    // Network errors during logout shouldn't block the user signing out.
  }
}

/**
 * Returns the current subscription state without prompting. Cheap enough
 * to call on mount.
 */
export async function getPushSubscriptionState(): Promise<{
  supported: boolean
  permission: NotificationPermission
  subscribed: boolean
}> {
  if (!pushSupported()) {
    return { supported: false, permission: 'denied', subscribed: false }
  }
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = registration ? await registration.pushManager.getSubscription() : null
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: Boolean(sub),
  }
}
