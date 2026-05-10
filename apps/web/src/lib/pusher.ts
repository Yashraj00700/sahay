import Pusher from 'pusher-js'

export type RealtimeEvent =
  | 'message:new'
  | 'message:updated'
  | 'conversation:updated'
  | 'conversation:assigned'
  | 'agent:typing'
  | 'agent:viewing'
  | 'agent:presence'
  | 'ai:suggestion'
  | 'notification'

interface PusherSingleton {
  instance: Pusher
  token: string
}

let singleton: PusherSingleton | null = null

/**
 * Returns a process-wide Pusher singleton bound to the supplied JWT.
 *
 * If the token has changed since last call (e.g. logout + re-login), the old
 * connection is fully torn down and a fresh client is created. This guarantees
 * the auth header on the next /api/realtime/auth request is always current.
 */
export function getPusher(token: string): Pusher {
  if (singleton && singleton.token === token) {
    return singleton.instance
  }

  if (singleton) {
    singleton.instance.disconnect()
    singleton = null
  }

  const key = import.meta.env.VITE_PUSHER_KEY
  const cluster = import.meta.env.VITE_PUSHER_CLUSTER
  const apiUrl = import.meta.env.VITE_API_URL ?? ''

  const instance = new Pusher(key, {
    cluster,
    authEndpoint: `${apiUrl}/api/realtime/auth`,
    auth: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    forceTLS: true,
  })

  singleton = { instance, token }
  return instance
}

/** Tear down the singleton (use on logout). Safe to call when not connected. */
export function disconnectPusher(): void {
  if (!singleton) return
  singleton.instance.disconnect()
  singleton = null
}
