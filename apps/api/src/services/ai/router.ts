// ─── Routing Decision Engine ──────────────────────────────────────────────────
// Determines how to handle an AI-analysed conversation turn.
// Priority order (first matching rule wins):
//   1. Safety overrides   — legal threat, allergy query, STOP keyword
//   2. Explicit signals   — customer requests human, opt-out
//   3. Sentiment guards   — very_negative sentiment
//   4. Turn-based rules   — unresolved after 3+ turns, circular conversation
//   5. Business rules     — VIP tier, high-value refund
//   6. Confidence matrix  — the standard confidence × sentiment routing matrix

import type { IntentCategory, SentimentLevel, RoutingDecision } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EscalationSignals {
  /** Customer explicitly requested a human */
  humanRequested: boolean
  /** Legal language detected in the message */
  legalThreat: boolean
  /** Number of consecutive turns without resolution */
  unresolvedTurns: number
  /** Number of times conversation has looped on the same topic */
  circularCount: number
  /** Whether this is a STOP / opt-out signal */
  stopKeyword: boolean
  /** True if an allergy-related intent was detected */
  allergyCheck: boolean
}

export interface RoutingParams {
  intent: IntentCategory
  sentiment: SentimentLevel
  /** AI confidence in intent classification (0–1) */
  confidence: number
  /** Customer tier from profile */
  customerTier: 'new' | 'loyal' | 'vip'
  /** Refund or order value in INR (relevant for high-value escalation) */
  orderValue?: number
  escalationSignals: EscalationSignals
  /** Tenant's configured confidence threshold (default 0.75) */
  confidenceThreshold?: number
}

export interface RoutingResult {
  decision: RoutingDecision
  /** Human-readable reason for audit log */
  reason: string
  /** Urgency level 1–5 for queue prioritisation */
  urgency: number
  /** True if the agent notification should be sent immediately */
  notifyNow: boolean
}

// ─── Threshold Constants ──────────────────────────────────────────────────────

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75
const HIGH_CONFIDENCE_THRESHOLD = 0.85
const LOW_CONFIDENCE_THRESHOLD = 0.65
const HIGH_VALUE_REFUND_INR = 2000
const MAX_UNRESOLVED_TURNS = 3

// ─── Intent Safety List ───────────────────────────────────────────────────────
// These intents should always go to human review regardless of confidence

const ALWAYS_HUMAN_INTENTS = new Set<IntentCategory>([
  'allergy_check',    // ingredient allergy — patient safety
  'human_request',   // explicit escalation
  'suspicious',      // possible fraud/abuse
])

const ALWAYS_SENIOR_INTENTS = new Set<IntentCategory>([
  // none currently, but extensible for legal or medical
])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sentimentScore(sentiment: SentimentLevel): number {
  const map: Record<SentimentLevel, number> = {
    very_negative: -2,
    negative: -1,
    neutral: 0,
    positive: 1,
    very_positive: 2,
  }
  return map[sentiment]
}

function isNegative(sentiment: SentimentLevel): boolean {
  return sentiment === 'negative' || sentiment === 'very_negative'
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Decide how to route a conversation turn.
 *
 * Rules are evaluated in strict priority order. The first matching rule wins.
 *
 * @param params - Routing parameters including intent, sentiment, confidence, etc.
 * @returns RoutingResult with decision + audit metadata
 */
export function decideRouting(params: RoutingParams): RoutingResult {
  const {
    intent,
    sentiment,
    confidence,
    customerTier,
    orderValue,
    escalationSignals,
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  } = params

  const {
    humanRequested,
    legalThreat,
    unresolvedTurns,
    circularCount,
    stopKeyword,
    allergyCheck,
  } = escalationSignals

  // ─── Tier 1: Absolute safety overrides ────────────────────────────────────

  if (stopKeyword) {
    return {
      decision: 'route_to_human',
      reason: 'STOP keyword detected — consent revocation requires immediate human handling',
      urgency: 5,
      notifyNow: true,
    }
  }

  if (legalThreat) {
    return {
      decision: 'route_to_senior',
      reason: 'Legal threat language detected — escalate to senior agent',
      urgency: 5,
      notifyNow: true,
    }
  }

  if (allergyCheck || intent === 'allergy_check') {
    return {
      decision: 'route_to_human',
      reason: 'Ingredient allergy query — safety concern requires human response',
      urgency: 4,
      notifyNow: true,
    }
  }

  // ─── Tier 2: Explicit customer escalation requests ─────────────────────────

  if (humanRequested || intent === 'human_request') {
    return {
      decision: 'route_to_human',
      reason: 'Customer explicitly requested human assistance',
      urgency: 4,
      notifyNow: true,
    }
  }

  // ─── Tier 3: Intents that always need a human / senior ────────────────────

  if (ALWAYS_SENIOR_INTENTS.has(intent)) {
    return {
      decision: 'route_to_senior',
      reason: `Intent "${intent}" always routes to senior agent`,
      urgency: 4,
      notifyNow: true,
    }
  }

  if (ALWAYS_HUMAN_INTENTS.has(intent)) {
    return {
      decision: 'route_to_human',
      reason: `Intent "${intent}" always routes to human agent`,
      urgency: 4,
      notifyNow: true,
    }
  }

  // ─── Tier 4: Sentiment-based escalation ───────────────────────────────────

  if (sentiment === 'very_negative') {
    // VIP + very negative → senior
    if (customerTier === 'vip') {
      return {
        decision: 'route_to_senior',
        reason: 'VIP customer with very negative sentiment — senior agent escalation',
        urgency: 5,
        notifyNow: true,
      }
    }
    return {
      decision: 'route_to_senior',
      reason: 'Very negative sentiment detected — escalate to senior agent',
      urgency: 5,
      notifyNow: true,
    }
  }

  // ─── Tier 5: Turn-based and circular-conversation rules ───────────────────

  if (circularCount >= 2) {
    return {
      decision: 'route_to_human',
      reason: `Circular conversation detected (${circularCount} loops) — human needed to break cycle`,
      urgency: 3,
      notifyNow: true,
    }
  }

  if (unresolvedTurns >= MAX_UNRESOLVED_TURNS) {
    return {
      decision: 'route_to_human',
      reason: `${unresolvedTurns} unresolved turns — conversation needs human intervention`,
      urgency: 3,
      notifyNow: true,
    }
  }

  // ─── Tier 6: Business rules ────────────────────────────────────────────────

  // High-value refund → draft_for_review even with high confidence
  if (
    (intent === 'order_return' || intent === 'refund_status' || intent === 'order_cancel') &&
    orderValue !== undefined &&
    orderValue > HIGH_VALUE_REFUND_INR
  ) {
    return {
      decision: 'draft_for_review',
      reason: `Refund/return on order value ₹${orderValue} > ₹${HIGH_VALUE_REFUND_INR} — draft requires agent approval`,
      urgency: 3,
      notifyNow: false,
    }
  }

  // VIP customer + any complaint intent → draft_for_review with flag
  if (
    customerTier === 'vip' &&
    (isNegative(sentiment) || intent.includes('complaint') || intent === 'damaged_item' || intent === 'wrong_item' || intent === 'missing_item')
  ) {
    return {
      decision: 'draft_for_review',
      reason: 'VIP customer with complaint — draft response for agent review before sending',
      urgency: 3,
      notifyNow: false,
    }
  }

  // ─── Tier 7: Confidence × Sentiment routing matrix ────────────────────────
  //
  // High confidence + neutral or better → auto-respond
  // Mid confidence + neutral or better  → draft for review
  // Low confidence (any sentiment)      → route to human
  // Negative (non-very-negative) + any  → draft for review (conservative)

  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    return {
      decision: 'route_to_human',
      reason: `Low confidence (${(confidence * 100).toFixed(0)}%) — human required for safe response`,
      urgency: 2,
      notifyNow: false,
    }
  }

  if (isNegative(sentiment)) {
    // Negative sentiment but not very_negative (handled above)
    // Draft for review so agent can check tone before sending
    return {
      decision: 'draft_for_review',
      reason: `Negative sentiment with confidence ${(confidence * 100).toFixed(0)}% — draft review recommended`,
      urgency: 2,
      notifyNow: false,
    }
  }

  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return {
      decision: 'auto_respond',
      reason: `High confidence (${(confidence * 100).toFixed(0)}%) + ${sentiment} sentiment → auto-respond`,
      urgency: 1,
      notifyNow: false,
    }
  }

  if (confidence >= confidenceThreshold) {
    return {
      decision: 'auto_respond',
      reason: `Confidence (${(confidence * 100).toFixed(0)}%) above tenant threshold + ${sentiment} sentiment → auto-respond`,
      urgency: 1,
      notifyNow: false,
    }
  }

  if (confidence >= LOW_CONFIDENCE_THRESHOLD) {
    return {
      decision: 'draft_for_review',
      reason: `Mid-range confidence (${(confidence * 100).toFixed(0)}%) — draft for agent review`,
      urgency: 2,
      notifyNow: false,
    }
  }

  // Fallback — should not normally be reached
  return {
    decision: 'route_to_human',
    reason: 'No routing rule matched — defaulting to human',
    urgency: 2,
    notifyNow: false,
  }
}
