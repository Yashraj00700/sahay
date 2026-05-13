import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../store/auth.store";
import {
  registerPushAndSubscribe,
  unsubscribePush,
  getPushSubscriptionState,
} from "../lib/push";

export interface UsePushNotificationsResult {
  /** True if the browser supports service-worker + push at all. */
  supported: boolean;
  /** Notification.permission, or 'denied' on unsupported browsers. */
  permission: NotificationPermission;
  /** True when an active subscription exists for this browser. */
  subscribed: boolean;
  /** True while a subscribe / unsubscribe is in flight. */
  loading: boolean;
  /** Last error from subscribe/unsubscribe, surfaced to the UI. */
  error: string | null;
  /** Subscribes the browser. Must be called from a user gesture. */
  subscribe: () => Promise<void>;
  /** Unsubscribes locally + on the server. */
  unsubscribe: () => Promise<void>;
}

/**
 * React hook that exposes the push subscription state and lets the UI
 * toggle it. Reads the auth token from the zustand store so callers
 * don't have to wire it through props.
 *
 * Initialisation: on mount we read the *current* state without ever
 * prompting (browser anti-pattern). The first prompt only happens
 * inside `subscribe()`, which the caller must invoke from a click.
 */
export function usePushNotifications(): UsePushNotificationsResult {
  const token = useAuthStore((s) => s.token);

  const [supported, setSupported] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate state from the browser on mount and whenever the token
  // changes (a different agent may have a different sub on the same
  // device, though in practice we unsubscribe on logout).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await getPushSubscriptionState();
      if (cancelled) return;
      setSupported(state.supported);
      setPermission(state.permission);
      setSubscribed(state.subscribed);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const subscribe = useCallback(async () => {
    if (!token) {
      setError("Not signed in");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await registerPushAndSubscribe(token);
      const next = await getPushSubscriptionState();
      setPermission(next.permission);
      setSubscribed(next.subscribed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to enable notifications",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  const unsubscribe = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      await unsubscribePush(token);
      const next = await getPushSubscriptionState();
      setSubscribed(next.subscribed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to disable notifications",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  return {
    supported,
    permission,
    subscribed,
    loading,
    error,
    subscribe,
    unsubscribe,
  };
}
