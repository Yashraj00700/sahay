import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth.store'
import { useInboxStore } from '../store/inbox.store'
import { queryKeys } from '../lib/queryClient'
import type { Conversation, Message } from '@sahay/shared'

let socket: Socket | null = null

export function useSocket() {
  const { token, agent, tenant } = useAuthStore()
  const queryClient = useQueryClient()
  const { setAgentViewing, removeAgentViewing } = useInboxStore()
  const isConnected = useRef(false)

  useEffect(() => {
    if (!token || !agent || !tenant) return
    if (isConnected.current) return

    socket = io('/', {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    })

    socket.on('connect', () => {
      isConnected.current = true
      console.log('🔌 Socket.io connected')
    })

    socket.on('disconnect', () => {
      isConnected.current = false
      console.log('🔌 Socket.io disconnected')
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
      // Update message status in all conversations (we don't know which conversation it's in)
      // This is handled by the conversation queries automatically
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
    socket.on('agent:viewing', ({ agentId, agentName, conversationId }: {
      agentId: string; agentName: string; conversationId: string
    }) => {
      if (agentId === agent.id) return // Don't show self
      setAgentViewing(conversationId, agentId, agentName)

      // Auto-remove after 30s of no update
      setTimeout(() => {
        removeAgentViewing(conversationId, agentId)
      }, 30000)
    })

    return () => {
      socket?.disconnect()
      socket = null
      isConnected.current = false
    }
  }, [token, agent?.id, tenant?.id])

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
