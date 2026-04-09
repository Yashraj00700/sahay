import { useState } from 'react'
import { motion } from 'framer-motion'
import { Lock, Play, Pause } from 'lucide-react'
import clsx from 'clsx'
import type { Message, MessageSenderType } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: Message
  previousSenderType?: MessageSenderType
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatIST(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return ''
  }
}

function initials(name?: string): string {
  if (!name) return '?'
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

// ─── Voice Note Player ────────────────────────────────────────────────────────

function VoiceNotePlayer({ durationSeconds }: { durationSeconds?: number }) {
  const [playing, setPlaying] = useState(false)
  const barCount = 24
  const bars = Array.from({ length: barCount }, (_, i) => {
    const h = 4 + Math.sin(i * 0.9) * 6 + Math.cos(i * 1.7) * 4 + Math.random() * 4
    return Math.max(4, Math.min(20, h))
  })

  const duration = durationSeconds
    ? `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')}`
    : '0:00'

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <button
        onClick={() => setPlaying(v => !v)}
        className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white flex-shrink-0 hover:bg-violet-700 transition-colors"
      >
        {playing
          ? <Pause className="w-3.5 h-3.5" />
          : <Play className="w-3.5 h-3.5 ml-0.5" />
        }
      </button>

      {/* Waveform */}
      <div className="flex items-center gap-px h-6">
        {bars.map((h, i) => (
          <div
            key={i}
            style={{ height: `${h}px` }}
            className={clsx(
              'w-1 rounded-full transition-colors',
              playing && i < barCount * 0.4
                ? 'bg-violet-600'
                : 'bg-gray-300'
            )}
          />
        ))}
      </div>

      <span className="text-[11px] text-gray-400 flex-shrink-0">{duration}</span>
    </div>
  )
}

// ─── Channel Watermark ────────────────────────────────────────────────────────

function ChannelWatermark({ channel }: { channel?: string }) {
  if (!channel) return null
  const icons: Record<string, string> = {
    whatsapp: '📱',
    instagram: '📸',
    webchat: '💬',
    email: '📧',
  }
  return (
    <span className="absolute bottom-1 right-2 text-[9px] opacity-30 select-none">
      {icons[channel] ?? '💬'}
    </span>
  )
}

// ─── Confidence Badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  if (confidence == null) return null
  const pct = Math.round(confidence * 100)
  const cls = confidence > 0.85
    ? 'bg-emerald-500/20 text-emerald-200'
    : confidence > 0.65
    ? 'bg-amber-400/20 text-amber-200'
    : 'bg-red-400/20 text-red-200'

  return (
    <span className={clsx('text-[9px] px-1.5 py-0.5 rounded-full font-medium', cls)}>
      {pct}%
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MessageBubble({ message, previousSenderType }: MessageBubbleProps) {
  const [showTimestamp, setShowTimestamp] = useState(false)
  const isFirstInSequence = previousSenderType !== message.senderType

  // ── System Event ──────────────────────────────────────────
  if (message.contentType === 'system_event') {
    return (
      <div className="flex items-center gap-3 px-4 my-3">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-[11px] text-gray-400 px-3 py-1 bg-gray-100 rounded-full whitespace-nowrap">
          {message.content}
          <span className="ml-1 text-gray-300">· {formatIST(message.sentAt)}</span>
        </span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>
    )
  }

  // ── Note ──────────────────────────────────────────────────
  if (message.contentType === 'note') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-4 my-2"
      >
        <div className="border border-dashed border-amber-300 bg-amber-50 rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Lock className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] text-amber-600 font-medium">
              Only your team can see this
            </span>
          </div>
          <p className="text-[13px] text-amber-900 leading-relaxed">{message.content}</p>
          <div className="text-[10px] text-amber-400 mt-1 text-right">
            {message.senderAgent?.name ?? 'Agent'} · {formatIST(message.sentAt)}
          </div>
        </div>
      </motion.div>
    )
  }

  // ── Customer ──────────────────────────────────────────────
  if (message.senderType === 'customer') {
    return (
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.15 }}
        className="flex items-end gap-2 px-4 my-1 group"
        onMouseEnter={() => setShowTimestamp(true)}
        onMouseLeave={() => setShowTimestamp(false)}
      >
        {/* Avatar — only on first in sequence */}
        {isFirstInSequence ? (
          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[11px] font-semibold text-gray-600 flex-shrink-0 mb-0.5">
            ?
          </div>
        ) : (
          <div className="w-7 flex-shrink-0" />
        )}

        <div className="max-w-[72%]">
          <div
            className="relative bg-gray-100 text-gray-900 px-3.5 py-2.5 text-[13px] leading-relaxed"
            style={{ borderRadius: '18px 18px 18px 4px' }}
          >
            {message.contentType === 'audio'
              ? <VoiceNotePlayer durationSeconds={message.voiceDurationSeconds} />
              : <p className="whitespace-pre-wrap break-words pr-4">{message.content}</p>
            }
            <ChannelWatermark channel={undefined} />
          </div>

          {message.transcription && (
            <p className="text-[10px] text-gray-400 mt-0.5 px-1 italic">
              "{message.transcription}"
            </p>
          )}

          {showTimestamp && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[10px] text-gray-400 mt-0.5 block pl-1"
            >
              {formatIST(message.sentAt)} IST
            </motion.span>
          )}
        </div>
      </motion.div>
    )
  }

  // ── AI ────────────────────────────────────────────────────
  if (message.senderType === 'ai') {
    return (
      <motion.div
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.15 }}
        className="flex items-end justify-end gap-2 px-4 my-1 group"
        onMouseEnter={() => setShowTimestamp(true)}
        onMouseLeave={() => setShowTimestamp(false)}
      >
        <div className="max-w-[72%]">
          {/* AI chip */}
          {isFirstInSequence && (
            <div className="flex items-center justify-end gap-1.5 mb-1">
              <span className="text-[10px] font-medium text-violet-600">✦ AI</span>
              <ConfidenceBadge confidence={message.aiConfidence} />
            </div>
          )}

          <div
            className="relative bg-gradient-to-br from-violet-600 to-violet-500 text-white px-3.5 py-2.5 text-[13px] leading-relaxed"
            style={{ borderRadius: '18px 18px 4px 18px' }}
          >
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>

          {showTimestamp && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[10px] text-gray-400 mt-0.5 block text-right pr-1"
            >
              {formatIST(message.sentAt)} IST
            </motion.span>
          )}
        </div>
      </motion.div>
    )
  }

  // ── Agent ─────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
      className="flex items-end justify-end gap-2 px-4 my-1 group"
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => setShowTimestamp(false)}
    >
      <div className="max-w-[72%]">
        {isFirstInSequence && message.senderAgent && (
          <div className="flex items-center justify-end gap-1 mb-1">
            <span className="text-[10px] text-gray-500">{message.senderAgent.name}</span>
          </div>
        )}

        <div
          className="relative bg-white border border-violet-200 text-gray-900 px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm"
          style={{ borderRadius: '18px 18px 4px 18px' }}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>

        {showTimestamp && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[10px] text-gray-400 mt-0.5 block text-right pr-1"
          >
            {formatIST(message.sentAt)} IST
          </motion.span>
        )}
      </div>

      {/* Agent avatar */}
      {isFirstInSequence ? (
        <div className="w-7 h-7 rounded-full bg-violet-100 border border-violet-300 flex items-center justify-center text-[11px] font-semibold text-violet-700 flex-shrink-0 mb-0.5">
          {initials(message.senderAgent?.name)}
        </div>
      ) : (
        <div className="w-7 flex-shrink-0" />
      )}
    </motion.div>
  )
}
