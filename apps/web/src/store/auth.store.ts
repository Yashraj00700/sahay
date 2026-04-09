import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Agent, Tenant } from '@sahay/shared'

interface AuthState {
  // socketToken is held in memory only (never persisted) — used solely for Socket.IO
  // authentication handshake which cannot use httpOnly cookies.
  // The primary accessToken lives in an httpOnly cookie managed by the server.
  socketToken: string | null
  agent: Agent | null
  tenant: Tenant | null
  isAuthenticated: boolean
  // Actions
  setAuth: (params: { token: string; agent: Agent; tenant: Tenant }) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      socketToken: null,
      agent: null,
      tenant: null,
      isAuthenticated: false,

      setAuth: ({ token, agent, tenant }) =>
        set({ socketToken: token, agent, tenant, isAuthenticated: true }),

      logout: () =>
        set({ socketToken: null, agent: null, tenant: null, isAuthenticated: false }),
    }),
    {
      name: 'sahay-auth',
      // sessionStorage: cleared when the browser tab is closed.
      // Only non-sensitive profile data is persisted; socketToken is intentionally excluded.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        agent: state.agent,
        tenant: state.tenant,
        isAuthenticated: state.isAuthenticated,
        // socketToken is NOT persisted — it is only held in memory for the session.
      }),
    }
  )
)
