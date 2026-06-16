import * as Sentry from "@sentry/react";

interface SentryUser {
  id: string;
  tenantId: string;
  email?: string;
}

/**
 * Initialize Sentry error monitoring + tracing + session replay.
 * No-op when VITE_SENTRY_DSN is unset (e.g. local dev without DSN).
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  const isProd = import.meta.env.MODE === "production";

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: isProd ? 0.1 : 0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: true,
      }),
    ],
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  });
}

/**
 * Set or clear the active user for Sentry events.
 * Call on login with the agent/tenant; pass null on logout.
 */
export function setSentryUser(user: SentryUser | null): void {
  if (user === null) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id,
    email: user.email,
    // segment: arbitrary tenant tag for filtering in Sentry UI
    tenant_id: user.tenantId,
  });
}

/** Re-export Sentry's ErrorBoundary so app code only imports from this module. */
export const SentryErrorBoundary = Sentry.ErrorBoundary;
