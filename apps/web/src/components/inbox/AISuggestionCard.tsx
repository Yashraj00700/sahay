import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThumbsUp, ThumbsDown, Check, Edit3, X, Sparkles, BookOpen } from 'lucide-react'
import clsx from 'clsx'
import type { MessageCitation } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AISuggestionCardProps {
  suggestion: string
  confidence: number
  citations: MessageCitation[]
  intent: string
  onAccept: () => void
  onEdit: () => void
  onDismiss: () => void
  onFeedback: (positive: boolean) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const { label, cls } = confidence > 0.85
    ? { label: 'High confidence', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
    : confidence > 0.65
    ? { label: 'Medium confidence', cls: 'bg-amber-100 text-amber-700 border-amber-200' }
    : { label: 'Low confidence', cls: 'bg-red-100 text-red-700 border-red-200' }

  return (
    <span className={clsx('text-[10px] font-medium px-2 py-0.5 rounded-full border', cls)}>
      {pct}% · {label}
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AISuggestionCard({
  suggestion,
  confidence,
  citations,
  intent,
  onAccept,
  onEdit,
  onDismiss,
  onFeedback,
}: AISuggestionCardProps) {

  // Esc key closes
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onDismiss()
  }, [onDismiss])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="mx-3 mb-2 bg-white border border-violet-200 rounded-2xl shadow-lg shadow-violet-100/50 overflow-hidden"
    >
      {/* Top accent bar */}
      <div className="h-0.5 bg-gradient-to-r from-violet-500 via-violet-400 to-violet-300" />

      <div className="px-4 pt-3 pb-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-violet-600" />
            </div>
            <span className="text-[12px] font-semibold text-violet-700">✦ Sahay suggests</span>
            <ConfidenceBadge confidence={confidence} />
          </div>

          <div className="flex items-center gap-1">
            {/* Feedback */}
            <button
              onClick={() => onFeedback(true)}
              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors"
              title="Good suggestion"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onFeedback(false)}
              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              title="Poor suggestion"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>

            {/* Dismiss */}
            <button
              onClick={onDismiss}
              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors ml-0.5"
              title="Dismiss (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Intent tag */}
        {intent && (
          <span className="inline-block text-[10px] text-violet-500 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full mb-2">
            {intent.replace(/_/g, ' ')}
          </span>
        )}

        {/* Suggested reply text */}
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 mb-3">
          <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap">
            {suggestion}
          </p>
        </div>

        {/* Citations */}
        {citations.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            <BookOpen className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="text-[10px] text-gray-400">Based on:</span>
            {citations.map((c, i) => (
              <span
                key={c.chunkId ?? i}
                className="text-[10px] text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-full"
              >
                {c.title}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onAccept}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-medium rounded-lg transition-colors shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            Use this
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-4 py-2 border border-violet-300 text-violet-600 hover:bg-violet-50 text-[12px] font-medium rounded-lg transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>
          <button
            onClick={onDismiss}
            className="px-4 py-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-[12px] font-medium rounded-lg transition-colors"
          >
            Dismiss
          </button>

          <span className="ml-auto text-[10px] text-gray-300">Esc to close</span>
        </div>
      </div>
    </motion.div>
  )
}
