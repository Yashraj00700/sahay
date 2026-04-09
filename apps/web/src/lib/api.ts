import axios from 'axios'
import type { AxiosError, AxiosResponse } from 'axios'
import { useAuthStore } from '../store/auth.store'

export const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  // withCredentials ensures the browser sends httpOnly cookies (accessToken, refreshToken)
  // on every request, including cross-origin requests to the API.
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

// No request interceptor needed — the browser automatically attaches the httpOnly
// accessToken cookie on every request. Manual Authorization header injection is removed.

// Response interceptor — handle silent token refresh on 401
let isRefreshing = false
let refreshSubscribers: Array<() => void> = []

function subscribeTokenRefresh(callback: () => void) {
  refreshSubscribers.push(callback)
}

function onTokenRefreshed() {
  refreshSubscribers.forEach(callback => callback())
  refreshSubscribers = []
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue request until the refresh completes; cookies will be updated by then
        return new Promise((resolve) => {
          subscribeTokenRefresh(() => {
            resolve(api(originalRequest))
          })
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        // POST to /api/auth/refresh — the httpOnly refreshToken cookie is sent
        // automatically by the browser (no token read from store required).
        await axios.post('/api/auth/refresh', {}, { withCredentials: true })

        onTokenRefreshed()
        isRefreshing = false

        // Retry the original request; the new accessToken cookie is now set
        return api(originalRequest)
      } catch {
        useAuthStore.getState().logout()
        isRefreshing = false
        return Promise.reject(error)
      }
    }

    return Promise.reject(error)
  }
)

// Type-safe API helper
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  data?: unknown,
  params?: Record<string, unknown>
): Promise<T> {
  const response = await api.request<T>({ method, url, data, params })
  return response.data
}
