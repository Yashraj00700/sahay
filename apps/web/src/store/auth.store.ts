import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Agent, Tenant } from '@sahay/shared'
import { setSentryUser } from '../lib/sentry'
import { disconnectPusher } from '../lib/pusher'
import { unsubscribePush } from '../lib/push'

interface AuthState {
  token: string | null
  refreshToken: string | null
  agent: Agent | null
  tenant: Tenant | null
  isAuthenticated: boolean
  // Actions
  setAuth: (params: { token: string; refreshToken: string; agent: Agent; tenant: Tenant }) => void
  setToken: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      agent: null,
      tenant: null,
      isAuthenticated: false,

      setAuth: ({ token, refreshToken, agent, tenant }) => {
        // Identify the active agent in Sentry so errors are attributed
        // to the correct user/tenant in the dashboard.
        setSentryUser({ id: agent.id, tenantId: tenant.id, email: agent.email })
        set({ token, refreshToken, agent, tenant, isAuthenticated: true })
      },

      setToken: (token) =>
        set({ token }),

      logout: () => {
        // Clear Sentry user + tear down the Pusher singleton so the next
        // login establishes a fresh authenticated socket. We also try to
        // unsubscribe from web push (best-effort, fire-and-forget) so the
        // server doesn't keep delivering notifications to a logged-out
        // browser. The push unsubscribe needs the token, so it must run
        // BEFORE we clear state.
        const currentToken = get().token
        if (currentToken) {
          // Don't await — logout should be instant from the user's POV;
          // the unsubscribe uses keepalive so it survives navigation.
          void unsubscribePush(currentToken).catch(() => {
            // swallow: we can't block logout on a network failure
          })
        }
        setSentryUser(null)
        disconnectPusher()
        set({ token: null, refreshToken: null, agent: null, tenant: null, isAuthenticated: false })
      },
    }),
    {
      name: 'sahay-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        agent: state.agent,
        tenant: state.tenant,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
