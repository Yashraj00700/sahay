// ─── AI Embed Worker ──────────────────────────────────────────────────────────
// Consumes jobs from the ai-embed queue.
// For each knowledge_chunk ID in the job:
//   - Fetch the chunk content from DB
//   - Generate a 1536-dim embedding via the existing embeddings service (cached)
//   - Write the embedding back to knowledge_chunks.embedding
//
// Supports three operations:
//   embed     — generate and store embedding for chunks that lack one
//   re-embed  — force-regenerate embedding regardless of existing value
//   delete    — null-out the embedding (removes chunk from vector search)
//
// job.data: EmbedJob
//   tenantId  — owning tenant (used for scoped query validation)
//   chunkIds  — knowledge_chunks.id[] to process
//   operation — 'embed' | 're-embed' | 'delete'

import type { EmbedJob } from '../lib/queues'
import { db, knowledgeChunks } from '@sahay/db'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { generateBatchEmbeddings } from '../services/ai/embeddings'
import { logger } from '../lib/logger'

export async function processAIEmbed(job: EmbedJob): Promise<void> {
  const { tenantId, chunkIds, operation } = job

  logger.info(
    `[EmbedWorker] op=${operation} chunks=${chunkIds.length} tenant=${tenantId}`
  )

  // ── Delete operation: wipe embeddings ─────────────────────────────────────
  if (operation === 'delete') {
    await db
      .update(knowledgeChunks)
      .set({ embedding: null, lastUpdated: new Date() })
      .where(
        and(
          eq(knowledgeChunks.tenantId, tenantId),
          inArray(knowledgeChunks.id, chunkIds)
        )
      )
    logger.info(`[EmbedWorker] Deleted embeddings for ${chunkIds.length} chunks`)
    return
  }

  // ── Fetch chunks that need embedding ──────────────────────────────────────
  const rows = await db.query.knowledgeChunks.findMany({
    where: and(
      eq(knowledgeChunks.tenantId, tenantId),
      inArray(knowledgeChunks.id, chunkIds),
      eq(knowledgeChunks.isActive, true)
    ),
    columns: {
      id: true,
      content: true,
      embedding: true,
    },
  })

  // For plain 'embed', skip chunks that already have an embedding
  const toEmbed =
    operation === 're-embed'
      ? rows
      : rows.filter((r) => r.embedding == null || r.embedding.length === 0)

  if (toEmbed.length === 0) {
    logger.info('[EmbedWorker] All chunks already embedded, nothing to do')
    return
  }

  logger.info(`[EmbedWorker] Generating embeddings for ${toEmbed.length} chunks`)

  // ── Batch embed (max 100 per call, enforced by generateBatchEmbeddings) ───
  const BATCH = 100
  for (let i = 0; i < toEmbed.length; i += BATCH) {
    const batch = toEmbed.slice(i, i + BATCH)
    const texts = batch.map((c) => c.content)

    const embeddings = await generateBatchEmbeddings(texts)

    // Write back to DB
    await Promise.all(
      batch.map(async (chunk, j) => {
        const embedding = embeddings[j]
        if (!embedding) {
          logger.warn(`[EmbedWorker] Missing embedding at batch index ${j}, skipping`)
          return
        }
        await db
          .update(knowledgeChunks)
          .set({ embedding, lastUpdated: new Date() })
          .where(eq(knowledgeChunks.id, chunk.id))
      })
    )

    logger.info(
      `[EmbedWorker] Batch ${Math.floor(i / BATCH) + 1}: wrote ${batch.length} embeddings`
    )
  }

  logger.info(`[EmbedWorker] Done — embedded ${toEmbed.length} chunks`)
}
