import { create } from 'zustand'
import type { Conversation, Channel, ConversationStatus, SentimentLevel } from '@sahay/shared'

export interface InboxFilters {
  channel?: Channel
  status?: ConversationStatus
  assignedTo?: string | 'me' | 'unassigned'
  tag?: string
  sentiment?: SentimentLevel
  tier?: 'new' | 'loyal' | 'vip'
  search?: string
}

export type InboxSort =
  | 'newest'
  | 'oldest_unresolved'
  | 'urgency_desc'
  | 'vip_first'
  | 'assigned_to_me_first'

interface InboxState {
  // Active conversation
  activeConversationId: string | null
  setActiveConversation: (id: string | null) => void

  // Filters
  filters: InboxFilters
  setFilter: <K extends keyof InboxFilters>(key: K, value: InboxFilters[K]) => void
  clearFilters: () => void

  // Sort
  sort: InboxSort
  setSort: (sort: InboxSort) => void

  // Selected (for bulk actions)
  selectedIds: Set<string>
  toggleSelected: (id: string) => void
  clearSelected: () => void

  // UI state
  isSidebarOpen: boolean
  toggleSidebar: () => void
  isFocusMode: boolean
  toggleFocusMode: () => void

  // Collision tracking: which conversations are being viewed by other agents
  agentsViewing: Record<string, Array<{ agentId: string; agentName: string }>>
  setAgentViewing: (conversationId: string, agentId: string, agentName: string) => void
  removeAgentViewing: (conversationId: string, agentId: string) => void
}

export const useInboxStore = create<InboxState>((set) => ({
  activeConversationId: null,
  setActiveConversation: (id) => set({ activeConversationId: id }),

  filters: {},
  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  clearFilters: () => set({ filters: {} }),

  sort: 'newest',
  setSort: (sort) => set({ sort }),

  selectedIds: new Set(),
  toggleSelected: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedIds: next }
    }),
  clearSelected: () => set({ selectedIds: new Set() }),

  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  isFocusMode: false,
  toggleFocusMode: () => set((state) => ({ isFocusMode: !state.isFocusMode })),

  agentsViewing: {},
  setAgentViewing: (conversationId, agentId, agentName) =>
    set((state) => {
      const existing = state.agentsViewing[conversationId] ?? []
      const filtered = existing.filter(a => a.agentId !== agentId)
      return {
        agentsViewing: {
          ...state.agentsViewing,
          [conversationId]: [...filtered, { agentId, agentName }],
        },
      }
    }),
  removeAgentViewing: (conversationId, agentId) =>
    set((state) => ({
      agentsViewing: {
        ...state.agentsViewing,
        [conversationId]: (state.agentsViewing[conversationId] ?? [])
          .filter(a => a.agentId !== agentId),
      },
    })),
}))
