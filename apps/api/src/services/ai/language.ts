// ─── Language Detection Service ──────────────────────────────────────────────
// Heuristic-based language detection for Indian D2C customer messages.
// Detects: English, Hindi (Devanagari), Hinglish (Hindi-Latin code-mixed), Other.
// No external ML model dependency — ships with zero latency.

export type DetectedLanguage = 'en' | 'hi' | 'hinglish' | 'other'

export interface SentenceLanguage {
  sentence: string
  language: DetectedLanguage
}

export interface LanguageDetectionResult {
  language: DetectedLanguage
  /** Confidence score 0–1 */
  confidence: number
  /** Per-sentence breakdown for code-switched messages */
  sentences: SentenceLanguage[]
  /** True when a single message mixes two or more language codes */
  isCodeSwitched: boolean
}

// ─── Devanagari Unicode Range ─────────────────────────────────────────────────
// U+0900–U+097F: core Devanagari block
const DEVANAGARI_RE = /[\u0900-\u097F]/

// ─── Hinglish / Hindi-in-Latin Lexicon ────────────────────────────────────────
// High-precision tokens: appear almost exclusively in Hindi/Hinglish messages.
// Lowercase, no diacritics — we normalise before matching.
const HINGLISH_STRONG_TOKENS = new Set([
  // Pronouns & determiners
  'mera', 'meri', 'mere', 'mujhe', 'mujhko',
  'aapka', 'aapki', 'aapke', 'aap', 'apna', 'apni', 'apne',
  'tumhara', 'tumhari', 'tumhare', 'tum', 'tumhe',
  'uska', 'uski', 'uske', 'unka', 'unki', 'unke',
  'hamara', 'hamari', 'hamare', 'hum', 'humko', 'humein',
  'iska', 'iski', 'iske', 'inko', 'inhe',
  // Common verbs
  'hai', 'hain', 'tha', 'thi', 'the', 'hoga', 'hogi', 'hoge',
  'karo', 'karna', 'karta', 'karti', 'karte', 'karein', 'kijiye',
  'dena', 'dedo', 'denge', 'diya', 'diye', 'dijiye',
  'lena', 'lelo', 'lenge', 'liya', 'liye',
  'aana', 'aao', 'aaya', 'aayi', 'aaye',
  'jaana', 'jao', 'gaya', 'gayi', 'gaye',
  'milna', 'milo', 'mila', 'mili', 'mile',
  'chahiye', 'chahta', 'chahti', 'chahe',
  'batao', 'batana', 'bataiye',
  'raha', 'rahi', 'rahe', 'rehna',
  'hona', 'hua', 'hui', 'hue',
  // Negation
  'nahi', 'nahin', 'mat', 'na', 'bilkul',
  // Questions
  'kya', 'kab', 'kahan', 'kaisa', 'kaisi', 'kaise', 'kyun', 'kyunki', 'kitna', 'kitni',
  // Common nouns / connectors
  'aur', 'lekin', 'par', 'toh', 'bhi', 'sirf', 'bas', 'abhi', 'jaldi',
  'order', 'paisa', 'paise', 'rupaye', 'rupee',
  // Intensifiers / particles
  'bahut', 'thoda', 'zyada', 'bohot', 'accha', 'achha', 'theek', 'sahi',
  // Politeness
  'shukriya', 'dhanyawaad', 'please', 'bhai', 'bhaiya', 'didi', 'ji',
])

// Lower-weight tokens: frequently appear in Hinglish but occasionally in English too
const HINGLISH_WEAK_TOKENS = new Set([
  'ok', 'okay', 'hi', 'hello', 'thanks', 'thankyou',
  'problem', 'issue', 'help',
])

// ─── Sentence Splitter ────────────────────────────────────────────────────────
function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation, newlines, or Devanagari danda (।)
  return text
    .split(/(?<=[.!?।\n])\s+|[\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

// ─── Per-sentence language classifier ────────────────────────────────────────
function classifySentence(sentence: string): DetectedLanguage {
  // Devanagari → pure Hindi
  if (DEVANAGARI_RE.test(sentence)) return 'hi'

  const normalised = sentence.toLowerCase().replace(/[^a-z\s]/g, ' ')
  const tokens = normalised.split(/\s+/).filter(Boolean)

  if (tokens.length === 0) return 'en'

  let strongHits = 0
  let weakHits = 0

  for (const tok of tokens) {
    if (HINGLISH_STRONG_TOKENS.has(tok)) strongHits++
    else if (HINGLISH_WEAK_TOKENS.has(tok)) weakHits++
  }

  const strongRatio = strongHits / tokens.length
  const totalHinglishRatio = (strongHits + weakHits * 0.3) / tokens.length

  if (strongHits >= 2 || strongRatio >= 0.25) return 'hinglish'
  if (totalHinglishRatio >= 0.2) return 'hinglish'

  return 'en'
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Detect the language of a customer message.
 *
 * @param text - Raw message text (may include emoji, Devanagari, Latin)
 * @returns LanguageDetectionResult with top-level language + per-sentence breakdown
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  if (!text || text.trim().length === 0) {
    return { language: 'en', confidence: 1.0, sentences: [], isCodeSwitched: false }
  }

  // ── Pass 1: Document-level Devanagari check ──────────────────────────────
  const devanagariChars = (text.match(/[\u0900-\u097F]/g) ?? []).length
  const totalChars = text.replace(/\s/g, '').length || 1
  const devanagariRatio = devanagariChars / totalChars

  if (devanagariRatio >= 0.4) {
    // Predominantly Hindi script
    const sentences = splitIntoSentences(text).map(s => ({
      sentence: s,
      language: classifySentence(s),
    }))
    const langs = new Set(sentences.map(s => s.language))
    return {
      language: 'hi',
      confidence: Math.min(0.95, 0.7 + devanagariRatio * 0.5),
      sentences,
      isCodeSwitched: langs.size > 1,
    }
  }

  // ── Pass 2: Per-sentence classification ──────────────────────────────────
  const rawSentences = splitIntoSentences(text)
  const sentences: SentenceLanguage[] = rawSentences.map(s => ({
    sentence: s,
    language: classifySentence(s),
  }))

  const langCounts: Record<DetectedLanguage, number> = {
    en: 0, hi: 0, hinglish: 0, other: 0,
  }
  for (const s of sentences) langCounts[s.language]++

  const total = sentences.length || 1
  const uniqueLangs = new Set(sentences.map(s => s.language))
  const isCodeSwitched = uniqueLangs.size > 1

  // ── Pass 3: Document-level verdict ───────────────────────────────────────
  let language: DetectedLanguage
  let confidence: number

  const hiRatio = langCounts.hi / total
  const hinglishRatio = langCounts.hinglish / total
  const enRatio = langCounts.en / total

  if (hiRatio >= 0.5) {
    language = 'hi'
    confidence = 0.7 + hiRatio * 0.25
  } else if (hinglishRatio >= 0.3 || (hinglishRatio + hiRatio) >= 0.4) {
    language = 'hinglish'
    confidence = 0.65 + (hinglishRatio + hiRatio * 0.5) * 0.3
  } else if (enRatio >= 0.7) {
    language = 'en'
    confidence = 0.7 + enRatio * 0.25
  } else if (isCodeSwitched) {
    // Mixed — call it hinglish if any Hindi tokens present
    language = (langCounts.hinglish + langCounts.hi) > 0 ? 'hinglish' : 'en'
    confidence = 0.6
  } else {
    language = 'en'
    confidence = 0.75
  }

  // Cap confidence
  confidence = Math.min(0.98, confidence)

  return {
    language,
    confidence,
    sentences,
    isCodeSwitched,
  }
}
