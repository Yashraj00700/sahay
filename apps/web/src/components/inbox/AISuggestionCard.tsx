import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThumbsUp, ThumbsDown, Check, Edit3, X, Sparkles, BookOpen, ShoppingBag, PlusCircle } from 'lucide-react'
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
  /** Called with product info text to append to the reply composer */
  onAddToReply?: (text: string) => void
}

interface ParsedRecommendation {
  name: string
  description: string
  rawText: string
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

/**
 * Detect and parse the "## Recommended Products for This Customer" section
 * that the AI agent injects when product recommendation intents are triggered.
 *
 * Returns { suggestionBody, recommendations } where suggestionBody is the
 * customer-facing reply text (without the recommendations block) and
 * recommendations is the parsed list of products.
 */
function parseRecommendations(suggestion: string): {
  suggestionBody: string
  recommendations: ParsedRecommendation[]
} {
  const SECTION_HEADER = /## Recommended Products for This Customer\s*/i
  const parts = suggestion.split(SECTION_HEADER)

  if (parts.length < 2) {
    return { suggestionBody: suggestion, recommendations: [] }
  }

  const suggestionBody = parts[0]!.trim()
  const recBlock = parts[1]!.trim()

  // Each line starting with "- " is one product entry: "- Name: description"
  const recommendations: ParsedRecommendation[] = recBlock
    .split('\n')
    .filter(line => line.trimStart().startsWith('- '))
    .map(line => {
      const content = line.replace(/^[\s-]+/, '').trim()
      const colonIdx = content.indexOf(':')
      if (colonIdx === -1) {
        return { name: content, description: '', rawText: content }
      }
      const name = content.slice(0, colonIdx).trim()
      const description = content.slice(colonIdx + 1).trim()
      return { name, description, rawText: content }
    })
    .filter(r => r.name.length > 0)

  return { suggestionBody, recommendations }
}

// ─── Product Recommendation Card ─────────────────────────────────────────────

function ProductRecommendationCard({
  rec,
  onAddToReply,
}: {
  rec: ParsedRecommendation
  onAddToReply?: (text: string) => void
}) {
  return (
    <div className="flex items-start gap-2.5 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2.5">
      <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <ShoppingBag className="w-3.5 h-3.5 text-violet-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-gray-800 truncate">{rec.name}</p>
        {rec.description && (
          <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
            {rec.description}
          </p>
        )}
      </div>
      {onAddToReply && (
        <button
          onClick={() => onAddToReply(`\n\n✨ You might also like: **${rec.name}** — ${rec.description}`)}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 hover:bg-violet-100 rounded-lg transition-colors flex-shrink-0"
          title="Append product info to reply"
        >
          <PlusCircle className="w-3 h-3" />
          Add to reply
        </button>
      )}
    </div>
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
  onAddToReply,
}: AISuggestionCardProps) {

  // Esc key closes
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onDismiss()
  }, [onDismiss])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  const { suggestionBody, recommendations } = parseRecommendations(suggestion)
  const hasRecommendations = recommendations.length > 0

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

        {/* Suggested reply text (body only, no recommendations section) */}
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 mb-3">
          <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap">
            {suggestionBody}
          </p>
        </div>

        {/* Product Recommendations */}
        <AnimatePresence>
          {hasRecommendations && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mb-3"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <ShoppingBag className="w-3 h-3 text-violet-500 flex-shrink-0" />
                <span className="text-[10px] font-semibold text-violet-600 uppercase tracking-wide">
                  Recommended Products
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {recommendations.map((rec, i) => (
                  <ProductRecommendationCard
                    key={`${rec.name}-${i}`}
                    rec={rec}
                    onAddToReply={onAddToReply}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
