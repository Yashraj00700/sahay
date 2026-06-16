/* global self, clients */
/**
 * Sahay service worker — push notifications only.
 *
 * Lives in /public so Vite serves it verbatim from /sw.js (the path
 * `pushManager.subscribe()` will register against). Plain JS so we
 * don't drag in a build step for one file. No fetch caching — this
 * worker exists purely to surface push messages while the tab is
 * closed; we don't want to interfere with normal HTTP semantics.
 */

self.addEventListener('install', (event) => {
  // Activate immediately so the very first subscribe doesn't have to
  // wait for tabs to close + reopen before push starts working.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  // Take control of any open Sahay tabs so the next push goes
  // straight to this worker without a reload.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  /** @type {{ title?: string; body?: string; url?: string; icon?: string; badge?: string }} */
  let payload = {}
  try {
    if (event.data) payload = event.data.json()
  } catch (_err) {
    // Fall back to plain text — keeps the worker robust against
    // older / non-JSON push providers.
    try {
      payload = { title: 'Sahay', body: event.data ? event.data.text() : '' }
    } catch (_err2) {
      payload = { title: 'Sahay', body: '' }
    }
  }

  const title = payload.title || 'Sahay'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.svg',
    badge: payload.badge || '/favicon.svg',
    data: { url: payload.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((wins) => {
        // If the app is already open in a tab, focus it and navigate
        // there instead of spawning a duplicate window.
        for (const w of wins) {
          if ('focus' in w) {
            try {
              const url = new URL(targetUrl, self.location.origin)
              if (new URL(w.url).origin === url.origin) {
                w.focus()
                if ('navigate' in w) return w.navigate(url.toString())
                return undefined
              }
            } catch (_err) {
              // ignore malformed URL — fall through to openWindow
            }
          }
        }
        return self.clients.openWindow(targetUrl)
      }),
  )
})
