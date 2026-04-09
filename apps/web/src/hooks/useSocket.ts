import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth.store'
import { useInboxStore } from '../store/inbox.store'
import { queryKeys } from '../lib/queryClient'
import type { Conversation, Message } from '@sahay/shared'

let socket: Socket | null = null

export function useSocket() {
  const { socketToken, agent, tenant } = useAuthStore()
  const queryClient = useQueryClient()
  const { setAgentViewing, removeAgentViewing } = useInboxStore()
  const isConnected = useRef(false)

  useEffect(() => {
    if (!socketToken || !agent || !tenant) return
    if (isConnected.current) return

    socket = io('/', {
      auth: { token: socketToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    })

    socket.on('connect', () => {
      isConnected.current = true
      if (Notification.permission === 'default') {
        Notification.requestPermission()
      }
    })

    socket.on('disconnect', () => {
      isConnected.current = false
    })

    socket.on('auth:expired', () => {
      // Clear auth state and redirect to login
      useAuthStore.getState().logout()
      window.location.href = '/login'
    })

    // ─── New conversation arrived ─────────────────────────
    socket.on('conversation:new', ({ conversation }: { conversation: Conversation }) => {
      // Invalidate conversation list to show new conversation
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all(tenant.id) })

      // Optimistically add to cache
      queryClient.setQueryData(
        queryKeys.conversations.detail(conversation.id),
        conversation
      )
    })

    // ─── Conversation updated ─────────────────────────────
    socket.on('conversation:updated', (update: Partial<Conversation> & { id: string }) => {
      queryClient.setQueryData(
        queryKeys.conversations.detail(update.id),
        (old: Conversation | undefined) => old ? { ...old, ...update } : old
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all(tenant.id) })
    })

    // ─── New message ──────────────────────────────────────
    socket.on('message:new', ({ message, conversationId }: { message: Message; conversationId: string }) => {
      // Append message to cache
      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (old: Message[] | undefined) => {
          if (!old) return [message]
          // Prevent duplicates
          if (old.find(m => m.id === message.id)) return old
          return [...old, message]
        }
      )

      // Update conversation last message
      queryClient.setQueryData(
        queryKeys.conversations.detail(conversationId),
        (old: Conversation | undefined) => old ? { ...old, lastMessage: message, updatedAt: message.sentAt } : old
      )

      // Invalidate list to update ordering
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all(tenant.id) })
    })

    // ─── Message status update ────────────────────────────
    socket.on('message:status', ({ messageId, status, timestamp }: {
      messageId: string; status: string; timestamp: string
    }) => {
      // Update the message in all cached message lists (keyed as ['conversations', id, 'messages'])
      queryClient.setQueriesData(
        { queryKey: ['conversations'] },
        (oldData: any) => {
          if (!oldData) return oldData
          // Only operate on arrays (message lists), not conversation objects/lists
          const messages = Array.isArray(oldData) ? oldData : oldData.data || oldData.messages
          if (!Array.isArray(messages)) return oldData
          const updated = messages.map((msg: any) =>
            msg.id === messageId
              ? {
                  ...msg,
                  channelStatus: status,
                  deliveredAt: status === 'delivered' ? timestamp : msg.deliveredAt,
                  readAt: status === 'read' ? timestamp : msg.readAt,
                }
              : msg
          )
          return Array.isArray(oldData) ? updated : { ...oldData, data: updated }
        }
      )
    })

    // ─── AI suggestion ready ──────────────────────────────
    socket.on('ai:suggestion', ({ conversationId, suggestion }: {
      conversationId: string; suggestion: unknown
    }) => {
      queryClient.setQueryData(
        queryKeys.ai.suggestion(conversationId),
        suggestion
      )
    })

    // ─── Agent viewing collision ──────────────────────────
    const viewingTimers: ReturnType<typeof setTimeout>[] = []
    socket.on('agent:viewing', ({ agentId, agentName, conversationId }: {
      agentId: string; agentName: string; conversationId: string
    }) => {
      if (agentId === agent.id) return // Don't show self
      setAgentViewing(conversationId, agentId, agentName)

      // Auto-remove after 30s of no update
      const timerId = setTimeout(() => {
        removeAgentViewing(conversationId, agentId)
      }, 30000)
      viewingTimers.push(timerId)
    })

    // ─── Agent typing indicator ───────────────────────────
    socket.on('agent:typing', ({ agentId, conversationId, isTyping }: {
      agentId: string; conversationId: string; isTyping: boolean
    }) => {
      useInboxStore.getState().setTypingIndicator(conversationId, agentId, isTyping)
    })

    // ─── Bulk conversation update ─────────────────────────
    socket.on('conversations:bulk_updated', () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all(tenant.id) })
    })

    // ─── Live dashboard metrics ───────────────────────────
    socket.on('dashboard:metrics', (metrics: { activeConversations: number; queueDepth: number; aiResolutionRate: number }) => {
      queryClient.setQueryData(['dashboard', 'metrics', tenant?.id], (old: any) => ({
        ...old,
        ...metrics,
      }))
    })

    return () => {
      viewingTimers.forEach(clearTimeout)
      socket?.disconnect()
      socket = null
      isConnected.current = false
    }
  }, [socketToken, agent?.id, tenant?.id])

  // Emit helpers
  const emitTypingStart = useCallback((conversationId: string) => {
    socket?.emit('agent:typing:start', { conversationId })
  }, [])

  const emitTypingStop = useCallback((conversationId: string) => {
    socket?.emit('agent:typing:stop', { conversationId })
  }, [])

  const emitViewing = useCallback((conversationId: string) => {
    socket?.emit('agent:viewing', { conversationId })
  }, [])

  return {
    socket,
    isConnected: isConnected.current,
    emitTypingStart,
    emitTypingStop,
    emitViewing,
  }
}

// HMR cleanup — disconnect socket before Vite hot-replaces this module
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (socket) {
      socket.disconnect()
      socket = null
    }
  })
}
