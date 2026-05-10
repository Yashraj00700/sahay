import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Channel } from 'pusher-js'
import { useAuthStore } from '../store/auth.store'
import { useInboxStore } from '../store/inbox.store'
import { getPusher, type RealtimeEvent } from '../lib/pusher'
import { queryKeys } from '../lib/queryClient'
import type { Conversation, Message } from '@sahay/shared'

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected'

type Handler = (payload: unknown) => void

interface UseRealtimeReturn {
  /** Subscribe to a server-emitted event. Returns an unsubscribe fn. */
  on: (event: RealtimeEvent, handler: Handler) => () => void
  /** Send a Pusher client-event on the tenant channel. */
  emit: (
    event: 'agent:typing:start' | 'agent:typing:stop' | 'agent:viewing',
    payload: Record<string, unknown>,
  ) => void
  status: RealtimeStatus
}

/**
 * Subscribe to the tenant-scoped private channel and bridge events into
 * react-query + zustand stores. Mirrors the legacy useSocket() side-effects.
 *
 * Each component call gets its own subscribe/unsubscribe lifecycle, but the
 * underlying Pusher connection is shared via the lib/pusher singleton so we
 * don't open one socket per hook instance.
 */
export function useRealtime(): UseRealtimeReturn {
  const token = useAuthStore((s) => s.token)
  const agent = useAuthStore((s) => s.agent)
  const tenant = useAuthStore((s) => s.tenant)
  const queryClient = useQueryClient()
  const setAgentViewing = useInboxStore((s) => s.setAgentViewing)
  const removeAgentViewing = useInboxStore((s) => s.removeAgentViewing)

  const channelRef = useRef<Channel | null>(null)
  const handlersRef = useRef<Map<RealtimeEvent, Set<Handler>>>(new Map())
  const [status, setStatus] = useState<RealtimeStatus>('disconnected')

  // ─── Subscribe to tenant channel + bind connection state ───
  useEffect(() => {
    if (!token || !agent || !tenant) {
      setStatus('disconnected')
      return
    }

    const pusher = getPusher(token)
    const channelName = `private-tenant-${tenant.id}`
    const channel = pusher.subscribe(channelName)
    channelRef.current = channel

    const mapState = (state: string): RealtimeStatus => {
      if (state === 'connected') return 'connected'
      if (state === 'disconnected' || state === 'failed' || state === 'unavailable') {
        return 'disconnected'
      }
      return 'connecting'
    }
    setStatus(mapState(pusher.connection.state))

    const onStateChange = (states: { current: string }) => {
      setStatus(mapState(states.current))
    }
    pusher.connection.bind('state_change', onStateChange)

    // ─── Default cache-bridge handlers ─────────────────────
    // Mirrors the side-effects the old useSocket performed so consumers
    // don't have to wire react-query updates themselves.

    const handleMessageNew = (payload: unknown): void => {
      const { message, conversationId } = payload as {
        message: Message
        conversationId: string
      }
      queryClient.setQueryData<Message[]>(
        queryKeys.conversations.messages(conversationId),
        (old) => {
          if (!old) return [message]
          if (old.find((m) => m.id === message.id)) return old
          return [...old, message]
        },
      )
      queryClient.setQueryData<Conversation | undefined>(
        queryKeys.conversations.detail(conversationId),
        (old) =>
          old ? { ...old, lastMessage: message, updatedAt: message.sentAt } : old,
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all(tenant.id) })
    }

    const handleConversationUpdated = (payload: unknown): void => {
      const update = payload as Partial<Conversation> & { id: string }
      queryClient.setQueryData<Conversation | undefined>(
        queryKeys.conversations.detail(update.id),
        (old) => (old ? { ...old, ...update } : old),
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all(tenant.id) })
    }

    const handleAiSuggestion = (payload: unknown): void => {
      const { conversationId, suggestion } = payload as {
        conversationId: string
        suggestion: unknown
      }
      queryClient.setQueryData(queryKeys.ai.suggestion(conversationId), suggestion)
    }

    const handleAgentViewing = (payload: unknown): void => {
      const { agentId, agentName, conversationId } = payload as {
        agentId: string
        agentName: string
        conversationId: string
      }
      if (agentId === agent.id) return
      setAgentViewing(conversationId, agentId, agentName)
      // Auto-clear after 30s of silence (matches legacy behaviour)
      window.setTimeout(() => {
        removeAgentViewing(conversationId, agentId)
      }, 30_000)
    }

    channel.bind('message:new', handleMessageNew)
    channel.bind('conversation:updated', handleConversationUpdated)
    channel.bind('ai:suggestion', handleAiSuggestion)
    channel.bind('agent:viewing', handleAgentViewing)

    // ─── Fan out arbitrary events to consumer-supplied handlers ───
    const fanout = (event: RealtimeEvent) => (payload: unknown) => {
      const set = handlersRef.current.get(event)
      if (!set) return
      set.forEach((h) => h(payload))
    }
    const fanoutEvents: RealtimeEvent[] = [
      'message:new',
      'message:updated',
      'conversation:updated',
      'conversation:assigned',
      'agent:typing',
      'agent:viewing',
      'agent:presence',
      'ai:suggestion',
      'notification',
    ]
    const boundFanouts = new Map<RealtimeEvent, (payload: unknown) => void>()
    fanoutEvents.forEach((evt) => {
      const fn = fanout(evt)
      boundFanouts.set(evt, fn)
      channel.bind(evt, fn)
    })

    return () => {
      pusher.connection.unbind('state_change', onStateChange)
      channel.unbind('message:new', handleMessageNew)
      channel.unbind('conversation:updated', handleConversationUpdated)
      channel.unbind('ai:suggestion', handleAiSuggestion)
      channel.unbind('agent:viewing', handleAgentViewing)
      boundFanouts.forEach((fn, evt) => channel.unbind(evt, fn))
      // Unsubscribe from this channel only; keep the shared Pusher socket
      // alive for other hook instances. disconnectPusher() runs on logout.
      pusher.unsubscribe(channelName)
      channelRef.current = null
    }
  }, [token, agent, tenant, queryClient, setAgentViewing, removeAgentViewing])

  // ─── Public API ────────────────────────────────────────────
  const on = useCallback((event: RealtimeEvent, handler: Handler): (() => void) => {
    let set = handlersRef.current.get(event)
    if (!set) {
      set = new Set()
      handlersRef.current.set(event, set)
    }
    set.add(handler)
    return () => {
      const current = handlersRef.current.get(event)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) handlersRef.current.delete(event)
    }
  }, [])

  const emit = useCallback(
    (
      event: 'agent:typing:start' | 'agent:typing:stop' | 'agent:viewing',
      payload: Record<string, unknown>,
    ): void => {
      const channel = channelRef.current
      if (!channel) return
      // Pusher client-events must be prefixed with `client-`.
      channel.trigger(`client-${event}`, payload)
    },
    [],
  )

  return { on, emit, status }
}
