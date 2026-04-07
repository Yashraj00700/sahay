// ─── RAG Retrieval Pipeline ───────────────────────────────────────────────────
// Hybrid retrieval combining pgvector cosine similarity search with BM25 full-text
// search, fused via Reciprocal Rank Fusion (RRF), then re-ranked by recency and
// retrieval frequency.
//
// Pipeline steps:
//   1. Metadata pre-filter  — narrows search space by skin_type, category, product_id
//   2. Vector similarity    — cosine ANN search via pgvector (<=>)
//   3. BM25 full-text       — PostgreSQL tsvector/tsquery full-text search
//   4. Reciprocal Rank Fusion — combines both ranked lists
//   5. Re-rank              — recency boost + retrieval frequency boost
//   Returns top-5 chunks.

import { db, knowledgeChunks } from '@sahay/db'
import { eq, and, sql } from 'drizzle-orm'
import { generateEmbedding } from './embeddings'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KBFilters {
  skinType?: string
  category?: string
  productId?: string
  chunkType?: string
  language?: string
}

export interface RAGChunk {
  id: string
  title: string | null
  content: string
  sourceType: string
  sourceId: string | null
  productName: string | null
  category: string | null
  chunkType: string | null
  language: string | null
  lastUpdated: Date | null
  retrievalCount: number | null
  /** Combined RRF score 0–1 */
  score: number
  /** Raw cosine similarity (if present in result set) */
  vectorSimilarity?: number
  /** Rank from BM25 full-text search (1 = best) */
  bm25Rank?: number
}

export interface RAGResult {
  chunks: RAGChunk[]
  totalCandidates: number
  retrievalMs: number
  queryEmbeddingMs: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOP_K_VECTOR = 15       // how many vector candidates to fetch
const TOP_K_BM25 = 15         // how many BM25 candidates to fetch
const TOP_K_FINAL = 5         // final results to return
const RRF_K = 60              // RRF constant (standard = 60)
const RECENCY_MAX_DAYS = 90   // recency boost window
const RECENCY_WEIGHT = 0.05   // max additive recency bonus
const FREQ_WEIGHT = 0.03      // max additive retrieval-frequency bonus
const FREQ_MAX = 500          // saturation point for retrieval count

// ─── Helper: Build Drizzle WHERE clause from filters ─────────────────────────

function buildFilterConditions(tenantId: string, filters?: KBFilters) {
  const conditions = [
    eq(knowledgeChunks.tenantId, tenantId),
    eq(knowledgeChunks.isActive, true),
  ]

  if (filters?.productId) {
    conditions.push(eq(knowledgeChunks.productId, filters.productId))
  }
  if (filters?.category) {
    conditions.push(eq(knowledgeChunks.category, filters.category))
  }
  if (filters?.chunkType) {
    conditions.push(eq(knowledgeChunks.chunkType, filters.chunkType))
  }
  if (filters?.language) {
    conditions.push(eq(knowledgeChunks.language, filters.language))
  }

  return conditions
}

// ─── Step 2: Vector Search ────────────────────────────────────────────────────

interface VectorCandidate {
  id: string
  similarity: number
}

async function vectorSearch(
  queryEmbedding: number[],
  tenantId: string,
  filters?: KBFilters,
): Promise<VectorCandidate[]> {
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`

  // Build dynamic WHERE clause for skin_type array filter
  let skinTypeFilter = ''
  if (filters?.skinType) {
    // skin_types is a text[] column — check for array containment
    skinTypeFilter = `AND (kc.skin_types IS NULL OR kc.skin_types = '{}' OR $3 = ANY(kc.skin_types))`
  }

  const filterParts: string[] = [
    `kc.tenant_id = '${tenantId}'`,
    `kc.is_active = true`,
    `kc.embedding IS NOT NULL`,
  ]

  if (filters?.productId) filterParts.push(`kc.product_id = '${filters.productId}'`)
  if (filters?.category) filterParts.push(`kc.category = '${filters.category}'`)
  if (filters?.chunkType) filterParts.push(`kc.chunk_type = '${filters.chunkType}'`)
  if (filters?.language) filterParts.push(`kc.language = '${filters.language}'`)

  const whereClause = filterParts.join(' AND ')

  const rows = await db.execute<{ id: string; similarity: number }>(
    sql.raw(`
      SELECT
        kc.id,
        1 - (kc.embedding <=> '${embeddingLiteral}'::vector) AS similarity
      FROM knowledge_chunks kc
      WHERE ${whereClause}
        ${filters?.skinType
          ? `AND (kc.skin_types IS NULL OR kc.skin_types = '{}' OR '${filters.skinType}' = ANY(kc.skin_types))`
          : ''
        }
      ORDER BY similarity DESC
      LIMIT ${TOP_K_VECTOR}
    `),
  )

  return (rows as VectorCandidate[]).filter(r => r.similarity > 0.3)
}

// ─── Step 3: BM25 Full-text Search ───────────────────────────────────────────

interface BM25Candidate {
  id: string
  rank: number
}

async function bm25Search(
  query: string,
  tenantId: string,
  filters?: KBFilters,
): Promise<BM25Candidate[]> {
  // Sanitise query for tsquery — replace special chars, split into tokens
  const sanitised = query
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 1)
    .join(' & ')

  if (!sanitised) return []

  const filterParts: string[] = [
    `kc.tenant_id = '${tenantId}'`,
    `kc.is_active = true`,
  ]

  if (filters?.productId) filterParts.push(`kc.product_id = '${filters.productId}'`)
  if (filters?.category) filterParts.push(`kc.category = '${filters.category}'`)
  if (filters?.chunkType) filterParts.push(`kc.chunk_type = '${filters.chunkType}'`)
  if (filters?.language) filterParts.push(`kc.language = '${filters.language}'`)
  if (filters?.skinType) {
    filterParts.push(`(kc.skin_types IS NULL OR kc.skin_types = '{}' OR '${filters.skinType}' = ANY(kc.skin_types))`)
  }

  const whereClause = filterParts.join(' AND ')

  const rows = await db.execute<{ id: string; rank: number }>(
    sql.raw(`
      SELECT
        kc.id,
        ts_rank_cd(
          to_tsvector('english', coalesce(kc.title, '') || ' ' || kc.content),
          to_tsquery('english', '${sanitised.replace(/'/g, "''")}')
        ) AS rank
      FROM knowledge_chunks kc
      WHERE ${whereClause}
        AND to_tsvector('english', coalesce(kc.title, '') || ' ' || kc.content)
            @@ to_tsquery('english', '${sanitised.replace(/'/g, "''")}')
      ORDER BY rank DESC
      LIMIT ${TOP_K_BM25}
    `),
  )

  return rows as BM25Candidate[]
}

// ─── Step 4: Reciprocal Rank Fusion ──────────────────────────────────────────

interface RRFEntry {
  id: string
  rrfScore: number
  vectorSimilarity?: number
  bm25Rank?: number
}

function reciprocalRankFusion(
  vectorCandidates: VectorCandidate[],
  bm25Candidates: BM25Candidate[],
): RRFEntry[] {
  const scores = new Map<string, RRFEntry>()

  // Vector ranked list
  vectorCandidates.forEach((c, idx) => {
    const rank = idx + 1
    const entry = scores.get(c.id) ?? { id: c.id, rrfScore: 0 }
    entry.rrfScore += 1 / (RRF_K + rank)
    entry.vectorSimilarity = c.similarity
    scores.set(c.id, entry)
  })

  // BM25 ranked list
  bm25Candidates.forEach((c, idx) => {
    const rank = idx + 1
    const entry = scores.get(c.id) ?? { id: c.id, rrfScore: 0 }
    entry.rrfScore += 1 / (RRF_K + rank)
    entry.bm25Rank = rank
    scores.set(c.id, entry)
  })

  return Array.from(scores.values()).sort((a, b) => b.rrfScore - a.rrfScore)
}

// ─── Step 5: Re-rank (recency + frequency) ────────────────────────────────────

interface FullChunkRow extends Record<string, unknown> {
  id: string
  title: string | null
  content: string
  sourceType: string
  sourceId: string | null
  productName: string | null
  category: string | null
  chunkType: string | null
  language: string | null
  lastUpdated: Date | null
  retrievalCount: number | null
}

function rerank(chunks: FullChunkRow[], rrfEntries: Map<string, RRFEntry>): Array<FullChunkRow & { finalScore: number; vectorSimilarity?: number; bm25Rank?: number }> {
  const now = Date.now()

  return chunks
    .map(chunk => {
      const rrf = rrfEntries.get(chunk.id)
      if (!rrf) return null

      let score = rrf.rrfScore

      // Recency boost: newer chunks get a small additive bonus
      if (chunk.lastUpdated) {
        const ageMs = now - chunk.lastUpdated.getTime()
        const ageDays = ageMs / (1000 * 60 * 60 * 24)
        if (ageDays < RECENCY_MAX_DAYS) {
          const recencyBonus = RECENCY_WEIGHT * (1 - ageDays / RECENCY_MAX_DAYS)
          score += recencyBonus
        }
      }

      // Retrieval frequency boost: frequently-used chunks are likely high quality
      if (chunk.retrievalCount && chunk.retrievalCount > 0) {
        const freqRatio = Math.min(chunk.retrievalCount, FREQ_MAX) / FREQ_MAX
        score += FREQ_WEIGHT * freqRatio
      }

      return {
        ...chunk,
        finalScore: score,
        vectorSimilarity: rrf.vectorSimilarity,
        bm25Rank: rrf.bm25Rank,
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.finalScore - a.finalScore)
}

// ─── Retrieval Count Increment (fire-and-forget) ─────────────────────────────

async function incrementRetrievalCounts(chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return
  try {
    await db.execute(
      sql.raw(`
        UPDATE knowledge_chunks
        SET retrieval_count = COALESCE(retrieval_count, 0) + 1
        WHERE id = ANY(ARRAY[${chunkIds.map(id => `'${id}'`).join(',')}]::uuid[])
      `),
    )
  } catch (err) {
    console.warn('[rag] Failed to increment retrieval counts:', err)
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Retrieve the most relevant knowledge chunks for a given query.
 *
 * @param query    - Customer query text (used for both vector embed + BM25)
 * @param tenantId - Tenant UUID for row-level isolation
 * @param filters  - Optional metadata pre-filters
 */
export async function retrieveContext(
  query: string,
  tenantId: string,
  filters?: KBFilters,
): Promise<RAGResult> {
  const pipelineStart = Date.now()

  // ── Step 1 + 2: Embed + Vector Search ────────────────────────────────────
  const embedStart = Date.now()
  const queryEmbedding = await generateEmbedding(query)
  const queryEmbeddingMs = Date.now() - embedStart

  // ── Steps 2 & 3: Run vector + BM25 searches in parallel ──────────────────
  const [vectorCandidates, bm25Candidates] = await Promise.all([
    vectorSearch(queryEmbedding, tenantId, filters),
    bm25Search(query, tenantId, filters),
  ])

  const totalCandidates = new Set([
    ...vectorCandidates.map(c => c.id),
    ...bm25Candidates.map(c => c.id),
  ]).size

  if (totalCandidates === 0) {
    return {
      chunks: [],
      totalCandidates: 0,
      retrievalMs: Date.now() - pipelineStart,
      queryEmbeddingMs,
    }
  }

  // ── Step 4: RRF ──────────────────────────────────────────────────────────
  const rrfResults = reciprocalRankFusion(vectorCandidates, bm25Candidates)
  const topRRFIds = rrfResults.slice(0, TOP_K_FINAL * 3).map(r => r.id)

  // ── Fetch full rows for top candidates ───────────────────────────────────
  const rows = await db.execute<FullChunkRow>(
    sql.raw(`
      SELECT
        kc.id,
        kc.title,
        kc.content,
        kc.source_type AS "sourceType",
        kc.source_id AS "sourceId",
        kc.product_name AS "productName",
        kc.category,
        kc.chunk_type AS "chunkType",
        kc.language,
        kc.last_updated AS "lastUpdated",
        kc.retrieval_count AS "retrievalCount"
      FROM knowledge_chunks kc
      WHERE kc.id = ANY(ARRAY[${topRRFIds.map(id => `'${id}'`).join(',')}]::uuid[])
    `),
  )

  // ── Step 5: Re-rank ──────────────────────────────────────────────────────
  const rrfMap = new Map(rrfResults.map(r => [r.id, r]))
  const reranked = rerank(rows as FullChunkRow[], rrfMap)
  const top5 = reranked.slice(0, TOP_K_FINAL)

  // ── Increment retrieval counts (fire-and-forget) ──────────────────────────
  void incrementRetrievalCounts(top5.map(c => c.id))

  const chunks: RAGChunk[] = top5.map(c => ({
    id: c.id,
    title: c.title,
    content: c.content,
    sourceType: c.sourceType,
    sourceId: c.sourceId,
    productName: c.productName,
    category: c.category,
    chunkType: c.chunkType,
    language: c.language,
    lastUpdated: c.lastUpdated,
    retrievalCount: c.retrievalCount,
    score: c.finalScore,
    vectorSimilarity: c.vectorSimilarity,
    bm25Rank: c.bm25Rank,
  }))

  return {
    chunks,
    totalCandidates,
    retrievalMs: Date.now() - pipelineStart,
    queryEmbeddingMs,
  }
}
