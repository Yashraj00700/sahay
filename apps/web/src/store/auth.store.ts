import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Agent, Tenant } from '@sahay/shared'

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
    (set) => ({
      token: null,
      refreshToken: null,
      agent: null,
      tenant: null,
      isAuthenticated: false,

      setAuth: ({ token, refreshToken, agent, tenant }) =>
        set({ token, refreshToken, agent, tenant, isAuthenticated: true }),

      setToken: (token) =>
        set({ token }),

      logout: () =>
        set({ token: null, refreshToken: null, agent: null, tenant: null, isAuthenticated: false }),
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
