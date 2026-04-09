import { useEffect, useCallback, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ConversationList } from '../../components/inbox/ConversationList'
import { ChatThread } from '../../components/inbox/ChatThread'
import { CustomerSidebar } from '../../components/inbox/CustomerSidebar'
import { EmptyInboxState } from '../../components/inbox/EmptyInboxState'
import { CommandPalette } from '../../components/inbox/CommandPalette'
import { ErrorBoundary } from '../../components/shared/ErrorBoundary'
import { useInboxStore } from '../../store/inbox.store'
import { useAuthStore } from '../../store/auth.store'
import { queryKeys, queryClient } from '../../lib/queryClient'
import { api } from '../../lib/api'
import type { Conversation } from '@sahay/shared'
import { KeyboardShortcutsPanel } from '../../components/inbox/KeyboardShortcutsPanel'

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

  // Ref to expose reply composer focus from child
  const replyComposerFocusRef = useRef<(() => void) | null>(null)

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

  // Fetch conversation list for "next" navigation
  const conversationsListQuery = useQuery({
    queryKey: queryKeys.conversations.list(tenant?.id ?? '', {}),
    queryFn: () => api.get<{ data: Conversation[] }>('/conversations').then(r => r.data),
    enabled: !!tenant?.id,
    staleTime: 15_000,
  })
  const conversationsList = conversationsListQuery.data?.data ?? []

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      // Toggle focus mode always
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleFocusMode()
        return
      }

      // Blur/unfocus on Escape
      if (e.key === 'Escape') {
        if (inInput) {
          ;(target as HTMLInputElement | HTMLTextAreaElement).blur()
        }
        return
      }

      // Shortcuts below only when a conversation is active and not in an input
      if (!activeConversationId || inInput) return

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        replyComposerFocusRef.current?.()
        return
      }

      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        api.patch(`/conversations/${activeConversationId}`, { status: 'pending' }).then(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(activeConversationId) })
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
        })
        return
      }

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        api.post(`/conversations/${activeConversationId}/resolve`).then(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(activeConversationId) })
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
        })
        return
      }

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        if (conversationsList.length === 0) return
        const currentIdx = conversationsList.findIndex(c => c.id === activeConversationId)
        const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % conversationsList.length
        const nextConv = conversationsList[nextIdx]
        if (nextConv) {
          handleSelectConversation(nextConv.id)
        }
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleFocusMode, activeConversationId, conversationsList, handleSelectConversation])

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
            <ErrorBoundary>
              <ChatThread
                conversationId={activeConversationId}
                replyFocusRef={replyComposerFocusRef}
              />
            </ErrorBoundary>
          </div>

          {/* Customer Sidebar */}
          {isSidebarOpen && (
            <div className="w-72 flex-shrink-0 border-l border-border bg-white overflow-y-auto flex flex-col">
              {activeConv.data?.customerId && (
                <ErrorBoundary>
                  <CustomerSidebar
                    customerId={activeConv.data.customerId}
                    conversation={activeConv.data}
                  />
                </ErrorBoundary>
              )}
              <KeyboardShortcutsPanel />
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
