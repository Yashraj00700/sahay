// ─── Embeddings Service ───────────────────────────────────────────────────────
// Generates 1536-dimensional embeddings using OpenAI text-embedding-3-small.
// Features:
//   - Single and batch embedding generation (up to 100 texts per request)
//   - Redis cache with 24h TTL to avoid re-embedding identical content
//   - Token usage tracking for cost monitoring

import OpenAI from 'openai'
import { createHash } from 'crypto'
import { redis } from '../../lib/redis'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// ─── Constants ────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const CACHE_TTL_SECONDS = 86400          // 24 hours
const MAX_BATCH_SIZE = 100               // OpenAI hard limit
const CACHE_PREFIX = 'emb:v1:'

// Cost per 1M tokens for text-embedding-3-small (as of 2025)
const COST_PER_MILLION_TOKENS = 0.02    // USD

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmbeddingUsage {
  promptTokens: number
  totalTokens: number
  estimatedCostUsd: number
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────

function cacheKey(text: string): string {
  // SHA-256 of the text — keeps keys short and collision-resistant
  const hash = createHash('sha256').update(text).digest('hex')
  return `${CACHE_PREFIX}${hash}`
}

async function getCached(text: string): Promise<number[] | null> {
  try {
    const raw = await redis.get(cacheKey(text))
    if (!raw) return null
    return JSON.parse(raw) as number[]
  } catch {
    return null
  }
}

async function setCache(text: string, embedding: number[]): Promise<void> {
  try {
    await redis.setex(cacheKey(text), CACHE_TTL_SECONDS, JSON.stringify(embedding))
  } catch (err) {
    // Cache write failure should never crash the pipeline
    console.warn('[embeddings] Redis cache write failed:', err)
  }
}

// ─── Usage Logging ────────────────────────────────────────────────────────────

function logUsage(batchSize: number, usage: EmbeddingUsage): void {
  console.info(
    '[embeddings] usage',
    JSON.stringify({
      model: EMBEDDING_MODEL,
      batchSize,
      promptTokens: usage.promptTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd.toFixed(6),
    }),
  )
}

// ─── Core Embedding Fetch (no cache) ─────────────────────────────────────────

async function fetchEmbeddings(
  texts: string[],
): Promise<{ embeddings: number[][]; usage: EmbeddingUsage }> {
  if (texts.length === 0) return { embeddings: [], usage: { promptTokens: 0, totalTokens: 0, estimatedCostUsd: 0 } }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  })

  // Sort by index to guarantee order matches input order
  const sorted = [...response.data].sort((a, b) => a.index - b.index)
  const embeddings = sorted.map(d => d.embedding)

  const promptTokens = response.usage.prompt_tokens
  const totalTokens = response.usage.total_tokens
  const estimatedCostUsd = (totalTokens / 1_000_000) * COST_PER_MILLION_TOKENS

  return {
    embeddings,
    usage: { promptTokens, totalTokens, estimatedCostUsd },
  }
}

// ─── Main Exports ─────────────────────────────────────────────────────────────

/**
 * Generate a single 1536-dimensional embedding for the given text.
 * Checks Redis cache first; stores result on cache miss.
 *
 * @param text - Input text (should be < 8192 tokens)
 * @returns Embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    return new Array(EMBEDDING_DIMENSIONS).fill(0)
  }

  // ── Cache check ───────────────────────────────────────────────────────────
  const cached = await getCached(text)
  if (cached) return cached

  // ── API call ──────────────────────────────────────────────────────────────
  const { embeddings, usage } = await fetchEmbeddings([text])
  logUsage(1, usage)

  const embedding = embeddings[0]
  if (!embedding) throw new Error('[embeddings] OpenAI returned empty embedding')

  await setCache(text, embedding)
  return embedding
}

/**
 * Generate embeddings for multiple texts in batched OpenAI requests.
 * Each text is checked against Redis cache individually; only cache misses
 * are sent to the API. Results are stitched back in original input order.
 *
 * @param texts - Array of input texts (max 100 per call; larger arrays throw)
 * @returns Array of embedding vectors, same length and order as `texts`
 */
export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  if (texts.length > MAX_BATCH_SIZE) {
    throw new Error(
      `[embeddings] Batch size ${texts.length} exceeds maximum of ${MAX_BATCH_SIZE}. ` +
      'Split into smaller batches before calling generateBatchEmbeddings.',
    )
  }

  // Pre-allocate result array to maintain order
  const results: (number[] | null)[] = new Array(texts.length).fill(null)
  const uncachedIndices: number[] = []
  const uncachedTexts: string[] = []

  // ── Cache check for all texts ─────────────────────────────────────────────
  await Promise.all(
    texts.map(async (text, i) => {
      if (!text || text.trim().length === 0) {
        results[i] = new Array(EMBEDDING_DIMENSIONS).fill(0)
        return
      }
      const cached = await getCached(text)
      if (cached) {
        results[i] = cached
      } else {
        uncachedIndices.push(i)
        uncachedTexts.push(text)
      }
    }),
  )

  // ── Fetch only cache misses ───────────────────────────────────────────────
  if (uncachedTexts.length > 0) {
    const { embeddings, usage } = await fetchEmbeddings(uncachedTexts)
    logUsage(uncachedTexts.length, usage)

    await Promise.all(
      uncachedTexts.map(async (text, j) => {
        const embedding = embeddings[j]
        if (!embedding) throw new Error(`[embeddings] Missing embedding at index ${j}`)
        results[uncachedIndices[j]!] = embedding
        await setCache(text, embedding)
      }),
    )
  }

  // Ensure no nulls remain (TypeScript narrowing)
  return results.map((r, i) => {
    if (r === null) throw new Error(`[embeddings] Missing result for index ${i}`)
    return r
  })
}
