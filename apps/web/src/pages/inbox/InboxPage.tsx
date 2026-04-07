import { useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ConversationList } from '../../components/inbox/ConversationList'
import { ChatThread } from '../../components/inbox/ChatThread'
import { CustomerSidebar } from '../../components/inbox/CustomerSidebar'
import { EmptyInboxState } from '../../components/inbox/EmptyInboxState'
import { CommandPalette } from '../../components/inbox/CommandPalette'
import { useInboxStore } from '../../store/inbox.store'
import { useAuthStore } from '../../store/auth.store'
import { queryKeys, queryClient } from '../../lib/queryClient'
import { api } from '../../lib/api'
import type { Conversation } from '@sahay/shared'

export function InboxPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { tenant } = useAuthStore()
  const {
    activeConversationId,
    setActiveConversation,
    isSidebarOpen,
    isFocusMode,
    toggleFocusMode,
  } = useInboxStore()

  // Sync URL param with store
  useEffect(() => {
    if (conversationId && conversationId !== activeConversationId) {
      setActiveConversation(conversationId)
    }
  }, [conversationId])

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversation(id)
    navigate(`/inbox/${id}`, { replace: true })
  }, [navigate, setActiveConversation])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only fire if not in an input/textarea
      const target = e.target as HTMLElement
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleFocusMode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleFocusMode])

  const activeConv = useQuery({
    queryKey: queryKeys.conversations.detail(activeConversationId ?? ''),
    queryFn: () => api.get<Conversation>(`/conversations/${activeConversationId}`).then(r => r.data),
    enabled: !!activeConversationId,
  })

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Conversation List Panel ──────────────────────── */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-border bg-white">
        <ConversationList
          onSelect={handleSelectConversation}
          activeId={activeConversationId}
        />
      </div>

      {/* ─── Main Workspace ───────────────────────────────── */}
      {activeConversationId ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Chat Thread */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <ChatThread conversationId={activeConversationId} />
          </div>

          {/* Customer Sidebar */}
          {isSidebarOpen && (
            <div className="w-72 flex-shrink-0 border-l border-border bg-white overflow-y-auto">
              {activeConv.data?.customerId && (
                <CustomerSidebar
                  customerId={activeConv.data.customerId}
                  conversation={activeConv.data}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <EmptyInboxState />
        </div>
      )}

      {/* Command Palette (Cmd+K) */}
      <CommandPalette />
    </div>
  )
}
