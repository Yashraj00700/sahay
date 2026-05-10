import { eq } from 'drizzle-orm'
import { knowledgeChunks, withTenant } from '@sahay/db'
import { inngest } from '../client'
import { generateEmbedding } from '../../services/ai/embeddings'

/**
 * ai-embed
 *
 * Consumes `ai/embed.requested` jobs and refreshes the embedding for a
 * single knowledge_chunks row. Skips work if the chunk already has an
 * embedding AND its `lastUpdated` is fresher than the chunk's source
 * timestamp (`shopifyUpdatedAt`).
 */
export const aiEmbed = inngest.createFunction(
  {
    id: 'ai-embed',
    retries: 3,
    concurrency: { limit: 30, key: 'event.data.tenantId' },
  },
  { event: 'ai/embed.requested' },
  async ({ event, step, logger }) => {
    const { tenantId, kbChunkId } = event.data

    const chunk = await step.run('load-chunk', async () =>
      withTenant(tenantId, async (tx) => {
        const row = await tx.query.knowledgeChunks.findFirst({
          where: eq(knowledgeChunks.id, kbChunkId),
        })
        if (!row) throw new Error(`ai-embed: chunk ${kbChunkId} not found`)
        return row
      }),
    )

    if (chunk.tenantId !== tenantId) {
      logger.warn(
        { kbChunkId, tenantId, chunkTenant: chunk.tenantId },
        'ai-embed: tenant mismatch — refusing to embed',
      )
      return { skipped: true, reason: 'tenant_mismatch' }
    }

    const isStale =
      !chunk.embedding ||
      (chunk.shopifyUpdatedAt && chunk.lastUpdated && chunk.shopifyUpdatedAt > chunk.lastUpdated)

    if (!isStale) {
      return { skipped: true, reason: 'fresh' }
    }

    const embedding = await step.run('compute-embedding', async () => {
      if (!chunk.content || chunk.content.trim().length === 0) {
        throw new Error(`ai-embed: chunk ${kbChunkId} has empty content`)
      }
      return generateEmbedding(chunk.content)
    })

    await step.run('persist-embedding', async () =>
      withTenant(tenantId, (tx) =>
        tx
          .update(knowledgeChunks)
          .set({
            embedding,
            lastUpdated: new Date(),
          })
          .where(eq(knowledgeChunks.id, kbChunkId)),
      ),
    )

    return { kbChunkId, dimensions: embedding.length }
  },
)
