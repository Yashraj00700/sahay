import { useRef, useEffect, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UserPlus, BellOff, CheckCircle2, MoreHorizontal,
  ChevronRight, Wifi, Sparkles,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import { useAuthStore } from '../../store/auth.store'
import type { Conversation, Message, MessageSenderType, PaginatedResponse } from '@sahay/shared'
import { MessageBubble } from './MessageBubble'
import { AISuggestionCard } from './AISuggestionCard'
import { ReplyComposer } from './ReplyComposer'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatThreadProps {
  conversationId: string
  /** Pass a mutable ref; it will be forwarded to ReplyComposer so the parent can call focus() */
  replyFocusRef?: React.MutableRefObject<(() => void) | null>
}

// ─── Channel Badge ────────────────────────────────────────────────────────────

function ChannelBadge({ channel }: { channel: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    whatsapp:  { label: 'WhatsApp',  cls: 'bg-green-100 text-green-700 border-green-200' },
    instagram: { label: 'Instagram', cls: 'bg-pink-100 text-pink-700 border-pink-200' },
    webchat:   { label: 'Web Chat',  cls: 'bg-violet-100 text-violet-700 border-violet-200' },
    email:     { label: 'Email',     cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  }
  const c = config[channel] ?? config.webchat

  return (
    <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded border', c.cls)}>
      {c.label}
    </span>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    open:     { label: 'Open',     cls: 'bg-emerald-100 text-emerald-700' },
    pending:  { label: 'Pending',  cls: 'bg-amber-100 text-amber-700' },
    snoozed:  { label: 'Snoozed',  cls: 'bg-slate-100 text-slate-600' },
    resolved: { label: 'Resolved', cls: 'bg-gray-100 text-gray-500' },
    closed:   { label: 'Closed',   cls: 'bg-gray-100 text-gray-400' },
  }
  const c = config[status] ?? config.open

  return (
    <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full', c.cls)}>
      {c.label}
    </span>
  )
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator({ type }: { type: 'ai' | 'agent' }) {
  if (type === 'ai') {
    return (
      <div className="flex items-end justify-end px-4 py-1">
        <div className="bg-gradient-to-br from-violet-600 to-violet-500 px-3 py-2 rounded-[18px_18px_4px_18px] flex items-center gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              animate={{ scaleY: [0.4, 1, 0.4], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
              className="w-1 h-3 bg-white/70 rounded-full"
            />
          ))}
          <span className="text-[9px] text-white/70 ml-1">✦ AI</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end px-4 py-1">
      <div className="bg-gray-100 px-3 py-2 rounded-[18px_18px_18px_4px] flex items-center gap-1">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 0.6, delay: i * 0.1, repeat: Infinity }}
            className="w-1.5 h-1.5 bg-gray-400 rounded-full"
          />
        ))}
      </div>
    </div>
  )
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {/* Customer bubble */}
      <div className="flex items-end gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse flex-shrink-0" />
        <div className="space-y-1.5">
          <div className="h-10 w-48 bg-gray-100 rounded-[18px_18px_18px_4px] animate-pulse" />
          <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
      {/* AI bubble */}
      <div className="flex items-end justify-end gap-2">
        <div className="space-y-1.5">
          <div className="h-14 w-56 bg-violet-100 rounded-[18px_18px_4px_18px] animate-pulse" />
          <div className="h-3 w-16 bg-gray-100 rounded animate-pulse ml-auto" />
        </div>
      </div>
      {/* Customer bubble */}
      <div className="flex items-end gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse flex-shrink-0 opacity-0" />
        <div className="h-8 w-36 bg-gray-100 rounded-[18px_18px_18px_4px] animate-pulse" />
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ChatThread({ conversationId, replyFocusRef }: ChatThreadProps) {
  const agent = useAuthStore(s => s.agent)
  const queryClient = useQueryClient()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [aiTyping, setAiTyping] = useState(false)
  const [agentTyping, setAgentTyping] = useState(false)
  // Text to append to the reply composer (used by product recommendation "Add to reply")
  const [composerAppendText, setComposerAppendText] = useState<string | null>(null)

  // Fetch conversation detail
  const { data: conversation } = useQuery<Conversation>({
    queryKey: queryKeys.conversations.detail(conversationId),
    queryFn: async () => {
      const res = await api.get<Conversation>(`/conversations/${conversationId}`)
      return res.data
    },
    enabled: !!conversationId,
  })

  // Fetch messages
  const { data: messagesData, isLoading } = useQuery<PaginatedResponse<Message>>({
    queryKey: queryKeys.conversations.messages(conversationId),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Message>>(
        `/conversations/${conversationId}/messages`
      )
      return res.data
    },
    enabled: !!conversationId,
    refetchInterval: 10_000,
  })

  // Fetch AI suggestion
  const { data: aiSuggestion } = useQuery({
    queryKey: queryKeys.ai.suggestion(conversationId),
    queryFn: async () => {
      const res = await api.get(`/ai/suggestion/${conversationId}`)
      return res.data
    },
    enabled: !!conversationId,
  })

  const messages = messagesData?.data ?? []

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, aiTyping])

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await api.post(`/conversations/${conversationId}/messages`, {
        content,
        contentType: 'text',
        senderType: 'agent',
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.messages(conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) })
    },
  })

  // Status mutations
  const resolveMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/conversations/${conversationId}/resolve`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) })
    },
  })

  const snoozeMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/conversations/${conversationId}/snooze`, {
        until: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      })
    },
  })

  const handleAcceptSuggestion = useCallback(() => {
    if (aiSuggestion?.suggestion) {
      sendMutation.mutate(aiSuggestion.suggestion)
    }
  }, [aiSuggestion, sendMutation])

  const handleEditSuggestion = useCallback(() => {
    if (aiSuggestion?.suggestion) {
      setComposerAppendText(aiSuggestion.suggestion)
    }
  }, [aiSuggestion])

  const handleAddToReply = useCallback((text: string) => {
    setComposerAppendText(text)
  }, [])

  return (
    <div className="flex flex-col h-full bg-[#F8F7FF]">

      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-[12px] font-semibold text-violet-700 flex-shrink-0">
            {(conversation?.customer?.name?.[0] ?? '?').toUpperCase()}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold text-gray-900 truncate">
                {conversation?.customer?.name ?? 'Loading…'}
              </span>
              {conversation && <ChannelBadge channel={conversation.channel} />}
              {conversation && <StatusBadge status={conversation.status} />}
            </div>
            {conversation?.customer?.phone && (
              <span className="text-[11px] text-gray-400">{conversation.customer.phone}</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Assign"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Assign</span>
          </button>

          <button
            onClick={() => snoozeMutation.mutate()}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Snooze 2h"
          >
            <BellOff className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Snooze</span>
          </button>

          <button
            onClick={() => resolveMutation.mutate()}
            disabled={conversation?.status === 'resolved'}
            className={clsx(
              'flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-lg transition-colors',
              conversation?.status === 'resolved'
                ? 'text-gray-300 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
            )}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Resolve</span>
          </button>

          <button className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Message list ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-4">
        {isLoading ? (
          <ThreadSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center mb-3">
              <Wifi className="w-6 h-6 text-violet-400" />
            </div>
            <p className="text-[13px] text-gray-500">No messages yet.</p>
            <p className="text-[12px] text-gray-400 mt-1">Start the conversation below.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg, idx) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                previousSenderType={idx > 0 ? messages[idx - 1].senderType : undefined}
              />
            ))}
          </AnimatePresence>
        )}

        {/* Typing indicators */}
        <AnimatePresence>
          {aiTyping && (
            <motion.div key="ai-typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <TypingIndicator type="ai" />
            </motion.div>
          )}
          {agentTyping && (
            <motion.div key="agent-typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <TypingIndicator type="agent" />
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {/* ── AI Suggestion Card ────────────────────────────── */}
      <AnimatePresence>
        {aiSuggestion && (
          <AISuggestionCard
            suggestion={aiSuggestion.suggestion}
            confidence={aiSuggestion.confidence}
            citations={aiSuggestion.citations ?? []}
            intent={aiSuggestion.intent ?? ''}
            onAccept={handleAcceptSuggestion}
            onEdit={handleEditSuggestion}
            onDismiss={() => queryClient.removeQueries({ queryKey: queryKeys.ai.suggestion(conversationId) })}
            onFeedback={(positive) => {
              api.post(`/ai/feedback`, { conversationId, positive })
            }}
            onAddToReply={handleAddToReply}
          />
        )}
      </AnimatePresence>

      {/* ── Reply Composer ────────────────────────────────── */}
      <ReplyComposer
        conversationId={conversationId}
        channel={conversation?.channel ?? 'webchat'}
        onSend={(content) => sendMutation.mutate(content)}
        customerName={conversation?.customer?.name}
        focusRef={replyFocusRef}
        appendText={composerAppendText}
        onAppendConsumed={() => setComposerAppendText(null)}
      />
    </div>
  )
}
