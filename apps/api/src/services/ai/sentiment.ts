// ─── Sentiment Analysis Service ───────────────────────────────────────────────
// Two-stage analysis:
//   Stage 1 — Fast heuristic pre-filter for obvious Hinglish signals & emoji.
//   Stage 2 — Claude API for nuanced / ambiguous cases and sarcasm detection.
//
// Outputs a 5-point sentiment scale plus fine-grained emotion tags.

import Anthropic from '@anthropic-ai/sdk'
import type { SentimentLevel, EmotionTag } from '@sahay/shared'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SentimentResult {
  sentiment: SentimentLevel
  /** Normalised score: -1.0 (very negative) → +1.0 (very positive) */
  score: number
  emotions: EmotionTag[]
  /** True when sarcasm was detected */
  isSarcastic: boolean
  /** True when urgency language is present */
  isUrgent: boolean
  /** Confidence in the sentiment classification 0–1 */
  confidence: number
  /** Which stage produced the final result: 'heuristic' | 'ai' */
  source: 'heuristic' | 'ai'
}

// ─── Heuristic Signal Tables ──────────────────────────────────────────────────

/** Maps normalised token → sentiment score (-2 to +2) */
const HINGLISH_LEXICON: Record<string, number> = {
  // Very negative
  bekar: -2, bakwaas: -2, 'ghatiya': -2, 'cheat': -2, 'fraud': -2, 'scam': -2,
  'faltu': -2, 'worst': -2, 'horrible': -2, 'terrible': -2, 'pathetic': -2,
  // Negative
  'bura': -1, 'buri': -1, 'bure': -1, 'problem': -1, 'issue': -1, 'complaint': -1,
  'naraz': -1, 'pareshan': -1, 'disappointed': -1, 'bad': -1, 'poor': -1,
  'galat': -1, 'wrong': -1, 'late': -1, 'delay': -1,
  'nahi mila': -1, 'nahi aaya': -1,
  // Positive
  'achha': 1, 'accha': 1, 'badhiya': 1, 'sahi': 1, 'theek': 1, 'good': 1,
  'nice': 1, 'happy': 1, 'satisfied': 1, 'helpful': 1, 'thank': 1, 'thanks': 1,
  'shukriya': 1, 'dhanyawaad': 1,
  // Very positive
  'bahut achha': 2, 'bahut badhiya': 2, 'bohot achha': 2, 'amazing': 2,
  'excellent': 2, 'superb': 2, 'fantastic': 2, 'love': 2, 'loved': 2,
  'awesome': 2, 'wonderful': 2, 'best': 2, 'perfect': 2,
  'bilkul sahi': 1, // NOT sarcasm-detected context
}

/** Phrases that are definitively negative regardless of context */
const VERY_NEGATIVE_PHRASES = [
  'bilkul sahi nahi',
  'bilkul theek nahi',
  'kuch kaam nahi',
  'koi fayda nahi',
  'total waste',
  'pura waste',
  'money wasted',
  'paisa waste',
  'worst experience',
  'never buy again',
  'dobara nahi lunga',
  'dobara nahi lungi',
]

/** Sarcasm markers — "bilkul" or "wah" in negative contexts */
const SARCASM_TRIGGERS = ['bilkul', 'wah wah', 'wah re', 'kya baat', 'bahut shukriya']

/** Urgency signals */
const URGENCY_SIGNALS = [
  'urgent', 'jaldi', 'asap', 'immediately', 'abhi', 'turant', 'right now',
  'emergency', 'kal tak', 'aaj chahiye', 'last chance', 'deadline',
]

// ─── Emoji Sentiment Map ──────────────────────────────────────────────────────

const EMOJI_SENTIMENT: Record<string, { score: number; emotions?: EmotionTag[] }> = {
  '😡': { score: -2, emotions: ['frustrated'] },
  '🤬': { score: -2, emotions: ['frustrated'] },
  '😤': { score: -1, emotions: ['frustrated'] },
  '😠': { score: -1, emotions: ['frustrated'] },
  '😢': { score: -1.5, emotions: ['grief'] },
  '😭': { score: -1.5, emotions: ['grief'] },
  '😞': { score: -1, emotions: ['frustrated'] },
  '😔': { score: -1 },
  '😕': { score: -0.5, emotions: ['confused'] },
  '🤔': { score: 0, emotions: ['confused'] },
  '😐': { score: 0 },
  '🙂': { score: 0.5 },
  '😊': { score: 1 },
  '😍': { score: 2, emotions: ['delighted'] },
  '🥰': { score: 2, emotions: ['delighted'] },
  '❤️': { score: 1.5, emotions: ['delighted'] },
  '👍': { score: 1 },
  '🙏': { score: 0.5 },
  '✨': { score: 1 },
  '🔥': { score: 0.5 },
  '⚠️': { score: -0.5, emotions: ['urgent'] },
  '🆘': { score: -1.5, emotions: ['urgent'] },
}

// ─── Score → SentimentLevel conversion ───────────────────────────────────────

function scoreToLevel(score: number): SentimentLevel {
  if (score <= -1.2) return 'very_negative'
  if (score <= -0.3) return 'negative'
  if (score < 0.3) return 'neutral'
  if (score < 1.2) return 'positive'
  return 'very_positive'
}

// ─── Heuristic Analyser ───────────────────────────────────────────────────────

interface HeuristicResult {
  score: number
  emotions: Set<EmotionTag>
  isSarcastic: boolean
  isUrgent: boolean
  /** Confidence that heuristics alone are sufficient */
  heuristicConfidence: number
}

function analyseHeuristic(text: string, language: string): HeuristicResult {
  const lower = text.toLowerCase()
  let score = 0
  const emotions = new Set<EmotionTag>()
  let isSarcastic = false
  let isUrgent = false
  let signals = 0

  // ── Very-negative phrases (highest priority) ────────────────────────────
  for (const phrase of VERY_NEGATIVE_PHRASES) {
    if (lower.includes(phrase)) {
      score -= 2
      signals += 2
      emotions.add('frustrated')
    }
  }

  // ── Urgency signals ─────────────────────────────────────────────────────
  for (const signal of URGENCY_SIGNALS) {
    if (lower.includes(signal)) {
      isUrgent = true
      emotions.add('urgent')
      signals++
      break
    }
  }

  // ── Emoji analysis ──────────────────────────────────────────────────────
  for (const [emoji, data] of Object.entries(EMOJI_SENTIMENT)) {
    if (text.includes(emoji)) {
      score += data.score
      data.emotions?.forEach(e => emotions.add(e))
      signals++
    }
  }

  // ── Lexicon token matching ───────────────────────────────────────────────
  // Test multi-word phrases first, then single tokens
  for (const [phrase, phraseScore] of Object.entries(HINGLISH_LEXICON)) {
    if (phrase.includes(' ') && lower.includes(phrase)) {
      score += phraseScore
      signals++
    }
  }

  const tokens = lower.split(/\s+/)
  for (const token of tokens) {
    const tok = token.replace(/[^a-z]/g, '')
    if (tok && HINGLISH_LEXICON[tok] !== undefined) {
      score += HINGLISH_LEXICON[tok] * 0.5 // single tokens count half vs. phrases
      signals++
    }
  }

  // ── Sarcasm detection ───────────────────────────────────────────────────
  // Sarcasm: a positive-sounding word in a sentence that also has negative signals
  if (score < 0) {
    for (const trigger of SARCASM_TRIGGERS) {
      if (lower.includes(trigger)) {
        isSarcastic = true
        score -= 1 // flip sarcasm bonus
        signals++
        break
      }
    }
  }

  // Negative question mark after "bilkul" or "wah" is strong sarcasm
  if (lower.match(/\b(bilkul|wah)\b.*[!?]/) && score < -0.5) {
    isSarcastic = true
  }

  // ── Emotion tagging ──────────────────────────────────────────────────────
  if (score <= -1.5) emotions.add('frustrated')
  if (lower.match(/\b(samajh nahi|confused|kya matlab|kyun)\b/)) emotions.add('confused')
  if (score >= 1.5) emotions.add('delighted')
  if (isUrgent) emotions.add('urgent')
  if (lower.match(/\b(grief|dukh|bahut bura|devastat)\b/)) emotions.add('grief')

  // Normalise score to -2..+2 range
  const clampedScore = Math.max(-2, Math.min(2, score))
  // Normalise to -1..+1
  const normScore = clampedScore / 2

  // Confidence: more signals = more confidence
  const heuristicConfidence = signals >= 3 ? 0.85 : signals >= 1 ? 0.6 : 0.3

  return {
    score: normScore,
    emotions,
    isSarcastic,
    isUrgent,
    heuristicConfidence,
  }
}

// ─── Claude Sentiment Prompt ──────────────────────────────────────────────────

const SENTIMENT_SYSTEM_PROMPT = `You are a sentiment analyst for an Indian D2C customer support platform.
Analyse the customer message and return a JSON sentiment assessment.

## Sentiment Scale
- very_negative : Strong complaint, anger, threat, grief. Score: -1.0 to -0.6
- negative      : Dissatisfied, frustrated, disappointed. Score: -0.6 to -0.1
- neutral        : Matter-of-fact inquiry, no emotional charge. Score: -0.1 to +0.1
- positive       : Happy, satisfied, grateful. Score: +0.1 to +0.6
- very_positive  : Delighted, ecstatic, raving. Score: +0.6 to +1.0

## Emotion Tags (select all that apply)
- frustrated : Anger, irritation, repeated complaints
- confused   : Uncertainty, multiple questions, "I don't understand"
- delighted  : Excited, very happy, love the product
- urgent     : Time-sensitive, deadline language
- grief      : Loss, strong disappointment
- skeptical  : Doubt about claims, suspicious

## Special Hinglish Signals
- "bekar", "bakwaas", "ghatiya", "faltu" → very_negative
- "bilkul sahi nahi", "koi fayda nahi" → very_negative
- "bahut achha", "bahut badhiya", "ekdum sahi" → very_positive
- "theek hai", "sahi hai" → neutral to positive
- Sarcasm: "bilkul sahi" in complaint context → very_negative
- "🙏" alone → polite/neutral; "🙏" with complaint → frustrated

## Output Format
Return ONLY valid JSON:
{
  "sentiment": "<level>",
  "score": <-1.0 to 1.0>,
  "emotions": ["<tag>", ...],
  "isSarcastic": <true|false>,
  "isUrgent": <true|false>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one sentence>"
}`

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Analyse the sentiment of a customer message.
 *
 * @param text     - Raw customer message text
 * @param language - Detected language ('en' | 'hi' | 'hinglish' | 'other')
 */
export async function analyzeSentiment(
  text: string,
  language: string,
): Promise<SentimentResult> {
  if (!text || text.trim().length === 0) {
    return {
      sentiment: 'neutral',
      score: 0,
      emotions: [],
      isSarcastic: false,
      isUrgent: false,
      confidence: 0.9,
      source: 'heuristic',
    }
  }

  // ── Stage 1: Fast heuristic pass ─────────────────────────────────────────
  const heuristic = analyseHeuristic(text, language)

  if (heuristic.heuristicConfidence >= 0.85) {
    // High-confidence heuristic result — skip Claude API
    return {
      sentiment: scoreToLevel(heuristic.score),
      score: heuristic.score,
      emotions: Array.from(heuristic.emotions),
      isSarcastic: heuristic.isSarcastic,
      isUrgent: heuristic.isUrgent,
      confidence: heuristic.heuristicConfidence,
      source: 'heuristic',
    }
  }

  // ── Stage 2: Claude API for nuanced / low-signal cases ───────────────────
  const userPrompt = `Language: ${language}
Message: "${text}"

Analyse sentiment and return JSON only.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 256,
      temperature: 0,
      system: SENTIMENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const block = response.content[0]
    if (block.type !== 'text') throw new Error('Unexpected Claude response type')

    const raw = block.text.trim()
    const jsonStr = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const parsed = JSON.parse(jsonStr) as {
      sentiment: SentimentLevel
      score: number
      emotions: EmotionTag[]
      isSarcastic: boolean
      isUrgent: boolean
      confidence: number
      reasoning?: string
    }

    return {
      sentiment: parsed.sentiment,
      score: Math.min(1, Math.max(-1, parsed.score ?? 0)),
      emotions: Array.isArray(parsed.emotions) ? parsed.emotions : [],
      isSarcastic: Boolean(parsed.isSarcastic),
      isUrgent: Boolean(parsed.isUrgent) || heuristic.isUrgent,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
      source: 'ai',
    }
  } catch (err) {
    console.error('[sentiment] Claude API error or parse failure:', err)

    // Fall back to heuristic result
    return {
      sentiment: scoreToLevel(heuristic.score),
      score: heuristic.score,
      emotions: Array.from(heuristic.emotions),
      isSarcastic: heuristic.isSarcastic,
      isUrgent: heuristic.isUrgent,
      confidence: Math.max(0.4, heuristic.heuristicConfidence - 0.1),
      source: 'heuristic',
    }
  }
}
