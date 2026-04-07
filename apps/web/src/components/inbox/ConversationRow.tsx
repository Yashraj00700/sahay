import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Flame } from 'lucide-react'
import clsx from 'clsx'
import { useInboxStore } from '../../store/inbox.store'
import type { Conversation, Channel } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationRowProps {
  conversation: Conversation
  isActive: boolean
  onClick: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PASTEL_PALETTE = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-pink-100 text-pink-700',
  'bg-indigo-100 text-indigo-700',
  'bg-teal-100 text-teal-700',
]

function deterministicPastel(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return PASTEL_PALETTE[hash % PASTEL_PALETTE.length]
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  if (hours < 48) return 'Yesterday'
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function truncate(text: string, len = 60): string {
  if (!text) return ''
  return text.length > len ? text.slice(0, len) + '…' : text
}

// ─── Channel Icon ─────────────────────────────────────────────────────────────

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === 'whatsapp') {
    return (
      <span className="flex-shrink-0 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
        {/* WhatsApp simplified checkmark */}
        <svg viewBox="0 0 24 24" fill="white" className="w-2.5 h-2.5">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
      </span>
    )
  }
  if (channel === 'instagram') {
    return (
      <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="white" className="w-2.5 h-2.5">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
      </span>
    )
  }
  // webchat / email
  return (
    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center">
      <svg viewBox="0 0 24 24" fill="white" className="w-2.5 h-2.5">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
      </svg>
    </span>
  )
}

// ─── Sentiment Chip ───────────────────────────────────────────────────────────

const SENTIMENT_MAP: Record<string, { emoji: string; cls: string }> = {
  very_negative: { emoji: '😤', cls: 'bg-red-50 text-red-700 border-red-100' },
  negative:      { emoji: '😐', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  neutral:       { emoji: '😐', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  positive:      { emoji: '😊', cls: 'bg-green-50 text-green-700 border-green-100' },
  very_positive: { emoji: '😊', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
}

// ─── Left Border Color ────────────────────────────────────────────────────────

function leftBorderColor(conv: Conversation): string {
  if (conv.csatScore !== undefined && conv.csatScore < 3) return 'border-l-red-400'
  if (conv.status === 'resolved') return 'border-l-emerald-400'

  // Unresolved > 4h
  if (conv.status === 'open') {
    const ageMs = Date.now() - new Date(conv.updatedAt).getTime()
    if (ageMs > 4 * 60 * 60 * 1000) return 'border-l-amber-400'
  }

  return 'border-l-violet-400'
}

// ─── Tier Badge ───────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  if (tier === 'vip')   return <span className="text-[10px]" title="VIP">👑</span>
  if (tier === 'loyal') return <span className="text-[10px]" title="Loyal">⭐</span>
  return <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" title="New" />
}

// ─── Collision Avatars ────────────────────────────────────────────────────────

function CollisionRing({ agents }: { agents: Array<{ agentId: string; agentName: string }> }) {
  if (!agents || agents.length === 0) return null
  return (
    <div className="flex -space-x-1 ml-1">
      {agents.slice(0, 2).map(a => (
        <div
          key={a.agentId}
          title={`${a.agentName} is viewing`}
          className="w-4 h-4 rounded-full bg-violet-200 border border-white flex items-center justify-center text-[8px] text-violet-800 font-bold ring-1 ring-violet-400"
        >
          {a.agentName[0]?.toUpperCase()}
        </div>
      ))}
      {agents.length > 2 && (
        <div className="w-4 h-4 rounded-full bg-gray-200 border border-white flex items-center justify-center text-[8px] text-gray-600 font-bold">
          +{agents.length - 2}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ConversationRow({ conversation, isActive, onClick }: ConversationRowProps) {
  const agentsViewing = useInboxStore(s => s.agentsViewing[conversation.id] ?? [])

  const customerName = conversation.customer?.name ?? 'Unknown'
  const avatarCls = useMemo(() => deterministicPastel(customerName), [customerName])
  const borderCls = leftBorderColor(conversation)
  const sentiment = SENTIMENT_MAP[conversation.sentiment] ?? SENTIMENT_MAP.neutral
  const previewText = truncate(conversation.lastMessage?.content ?? '', 60)
  const timestamp = conversation.updatedAt ? relativeTime(conversation.updatedAt) : ''
  const showUrgency = conversation.urgencyScore >= 4

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onClick={onClick}
      className={clsx(
        'relative flex items-start gap-3 px-4 py-3 cursor-pointer',
        'border-b border-gray-100 border-l-2 transition-colors',
        borderCls,
        isActive
          ? 'bg-violet-50 border-l-violet-500'
          : 'hover:bg-violet-50/60'
      )}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div
          className={clsx(
            'w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold',
            avatarCls
          )}
        >
          {initials(customerName)}
        </div>
        {/* Channel icon overlaid bottom-right */}
        <div className="absolute -bottom-0.5 -right-0.5">
          <ChannelIcon channel={conversation.channel} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Row 1: name + time + unread dot */}
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-medium text-gray-900 truncate">
              {customerName}
            </span>
            <TierBadge tier={conversation.customer?.tier ?? 'new'} />
            {showUrgency && <Flame className="w-3 h-3 text-orange-500 flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[11px] text-gray-400">{timestamp}</span>
            {(conversation.unreadCount ?? 0) > 0 && (
              <span className="w-2 h-2 rounded-full bg-violet-600 flex-shrink-0" />
            )}
          </div>
        </div>

        {/* Row 2: preview text */}
        <p className="text-[12px] text-gray-500 leading-relaxed line-clamp-1 mb-1">
          {previewText || <span className="text-gray-300 italic">No messages yet</span>}
        </p>

        {/* Row 3: sentiment + collision */}
        <div className="flex items-center gap-1.5">
          <span
            className={clsx(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] border',
              sentiment.cls
            )}
          >
            {sentiment.emoji}
          </span>

          {conversation.primaryIntent && (
            <span className="text-[10px] text-gray-400 truncate max-w-[100px]">
              {conversation.primaryIntent.replace(/_/g, ' ')}
            </span>
          )}

          <CollisionRing agents={agentsViewing} />
        </div>
      </div>
    </motion.div>
  )
}
