import { QueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { AxiosError } from 'axios'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,        // 30 seconds
      gcTime: 5 * 60 * 1000,       // 5 minutes cache
      retry: (failureCount, error) => {
        // Don't retry 4xx errors
        const status = (error as AxiosError)?.response?.status
        if (status && status >= 400 && status < 500) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      onError: (error: unknown) => {
        const axiosError = error as AxiosError<{ message?: string }>
        const message = axiosError.response?.data?.message ?? 'Something went wrong'
        toast.error(message)
      },
    },
  },
})

// Query keys — centralized to prevent cache key mismatches
export const queryKeys = {
  conversations: {
    all: (tenantId: string) => ['conversations', tenantId] as const,
    list: (tenantId: string, filters: Record<string, unknown>) =>
      ['conversations', tenantId, 'list', filters] as const,
    detail: (id: string) => ['conversations', id] as const,
    messages: (id: string) => ['conversations', id, 'messages'] as const,
  },
  customers: {
    all: (tenantId: string) => ['customers', tenantId] as const,
    detail: (id: string) => ['customers', id] as const,
    orders: (id: string) => ['customers', id, 'orders'] as const,
    conversations: (id: string) => ['customers', id, 'conversations'] as const,
  },
  ai: {
    suggestion: (conversationId: string) => ['ai', 'suggestion', conversationId] as const,
    metrics: (tenantId: string) => ['ai', 'metrics', tenantId] as const,
  },
  analytics: {
    overview: (tenantId: string, period: string) =>
      ['analytics', tenantId, 'overview', period] as const,
    conversations: (tenantId: string, period: string) =>
      ['analytics', tenantId, 'conversations', period] as const,
    agents: (tenantId: string, period: string) =>
      ['analytics', tenantId, 'agents', period] as const,
  },
  kb: {
    articles: (tenantId: string) => ['kb', tenantId, 'articles'] as const,
    gaps: (tenantId: string) => ['kb', tenantId, 'gaps'] as const,
  },
  settings: {
    channels: (tenantId: string) => ['settings', tenantId, 'channels'] as const,
    team: (tenantId: string) => ['settings', tenantId, 'team'] as const,
    ai: (tenantId: string) => ['settings', tenantId, 'ai'] as const,
    billing: (tenantId: string) => ['settings', tenantId, 'billing'] as const,
    cannedResponses: (tenantId: string) => ['settings', tenantId, 'canned-responses'] as const,
  },
}
