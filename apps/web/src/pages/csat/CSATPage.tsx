import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

// ─── Types ────────────────────────────────────────────────────────────────────

type SubmitState = 'idle' | 'submitting' | 'success' | 'error' | 'already_submitted'

// ─── Star Rating Component ────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (rating: number) => void
  disabled: boolean
}) {
  const [hovered, setHovered] = useState(0)

  const labels: Record<number, string> = {
    1: 'Very dissatisfied',
    2: 'Dissatisfied',
    3: 'Neutral',
    4: 'Satisfied',
    5: 'Very satisfied',
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-2" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((star) => {
          const active = hovered ? star <= hovered : star <= value
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={star === value}
              aria-label={`${star} star${star > 1 ? 's' : ''} — ${labels[star]}`}
              disabled={disabled}
              onClick={() => onChange(star)}
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(0)}
              className={[
                'text-4xl transition-transform duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded',
                active ? 'text-yellow-400 scale-110' : 'text-gray-300',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:scale-110',
              ].join(' ')}
            >
              ★
            </button>
          )
        })}
      </div>
      {(hovered || value) ? (
        <p className="text-sm text-gray-500 h-5">{labels[hovered || value]}</p>
      ) : (
        <p className="text-sm text-gray-400 h-5">Tap a star to rate</p>
      )}
    </div>
  )
}

// ─── Thank You Screen ─────────────────────────────────────────────────────────

function ThankYouScreen({ alreadySubmitted }: { alreadySubmitted?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100">
        <svg className="h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900">
        {alreadySubmitted ? 'Already submitted' : 'Thank you!'}
      </h2>
      <p className="text-gray-500 max-w-xs">
        {alreadySubmitted
          ? 'We already received your feedback for this conversation.'
          : 'Your feedback helps us improve the support experience for everyone.'}
      </p>
    </div>
  )
}

// ─── Error Screen ─────────────────────────────────────────────────────────────

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
        <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900">Something went wrong</h2>
      <p className="text-sm text-gray-500 max-w-xs">{message}</p>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function CSATPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const [searchParams] = useSearchParams()

  const tenantId = searchParams.get('tenantId') ?? ''
  const token    = searchParams.get('token') ?? ''

  const [rating,  setRating]  = useState(0)
  const [comment, setComment] = useState('')
  const [state,   setState]   = useState<SubmitState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const isSubmitting = state === 'submitting'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!rating) return
    if (!conversationId || !tenantId || !token) {
      setState('error')
      setErrorMsg('Invalid survey link. Please use the link sent to you via WhatsApp.')
      return
    }

    setState('submitting')

    try {
      const res = await fetch('/api/csat/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          conversationId,
          rating,
          comment: comment.trim() || undefined,
          tenantId,
          token,
        }),
      })

      if (res.status === 403) {
        setState('error')
        setErrorMsg('This survey link is invalid or has expired.')
        return
      }

      if (res.status === 404) {
        setState('error')
        setErrorMsg('We could not find the conversation linked to this survey.')
        return
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string }
        setState('error')
        setErrorMsg(body.message ?? 'An unexpected error occurred. Please try again.')
        return
      }

      const body = await res.json() as { alreadySubmitted?: boolean }
      setState(body.alreadySubmitted ? 'already_submitted' : 'success')
    } catch {
      setState('error')
      setErrorMsg('Network error. Please check your connection and try again.')
    }
  }

  const showForm = state === 'idle' || state === 'submitting'

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-5 text-white">
          <h1 className="text-lg font-semibold">How was your experience?</h1>
          <p className="mt-1 text-sm text-indigo-200">
            Your feedback helps us serve you better.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {(state === 'success' || state === 'already_submitted') && (
            <ThankYouScreen alreadySubmitted={state === 'already_submitted'} />
          )}

          {state === 'error' && <ErrorScreen message={errorMsg} />}

          {showForm && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              {/* Star rating */}
              <StarRating value={rating} onChange={setRating} disabled={isSubmitting} />

              {/* Optional comment */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="csat-comment" className="text-sm font-medium text-gray-700">
                  Any additional comments? <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  id="csat-comment"
                  rows={3}
                  disabled={isSubmitting}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={2000}
                  placeholder="Tell us more about your experience..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 resize-none"
                />
                <p className="text-xs text-gray-400 text-right">{comment.length}/2000</p>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={!rating || isSubmitting}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                    Submitting…
                  </span>
                ) : (
                  'Submit feedback'
                )}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-3 text-center">
          <p className="text-xs text-gray-400">
            Powered by <span className="font-medium text-indigo-500">Sahay</span>
          </p>
        </div>
      </div>
    </div>
  )
}
