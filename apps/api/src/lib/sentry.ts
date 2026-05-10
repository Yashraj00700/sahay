import * as Sentry from '@sentry/node'
import { env } from './env'

let initialized = false

export function initSentry(): void {
  if (initialized) return
  if (!env.SENTRY_DSN) return
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    profilesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      const headers = event.request?.headers
      if (headers) {
        delete headers.authorization
        delete headers.cookie
      }
      return event
    },
  })
  initialized = true
}

export const captureException = (err: unknown, context?: Record<string, unknown>): void => {
  if (!initialized) return
  Sentry.withScope((scope) => {
    if (context) scope.setContext('extra', context)
    Sentry.captureException(err)
  })
}

export const setUser = (user: { id: string; tenantId: string; email?: string } | null): void => {
  if (!initialized) return
  Sentry.setUser(user ? { id: user.id, tenant: user.tenantId, email: user.email } : null)
}

export const flush = async (timeout = 2000): Promise<boolean> => {
  if (!initialized) return true
  return Sentry.flush(timeout)
}

initSentry()
