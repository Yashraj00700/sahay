import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '@sahay/db'
import { kbArticles, knowledgeChunks } from '@sahay/db'
import { eq, and, ilike, or, desc, sql } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth.middleware'
import { aiEmbedQueue } from '../../lib/queues'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  status: z.enum(['published', 'unpublished', 'all']).default('all'),
})

const uuidSchema = z.string().uuid()

const createArticleSchema = z.object({
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(500),
  content: z.string().min(1).max(500_000), // ~500 KB per article
  language: z.string().default('en'),
  titleHi: z.string().optional(),
  contentHi: z.string().optional(),
  titleHinglish: z.string().optional(),
  contentHinglish: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublished: z.boolean().default(false),
  isAiGenerated: z.boolean().default(false),
})

const updateArticleSchema = createArticleSchema.partial()

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export const kbRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ─── GET /kb/articles ────────────────────────────────────────────────────────
  app.get('/articles', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query parameters', errors: parsed.error.flatten() })
    }

    const q = parsed.data
    const tenantId = req.agent.tenantId
    const offset = (q.page - 1) * q.pageSize

    const conditions = [eq(kbArticles.tenantId, tenantId)]

    if (q.search) {
      conditions.push(
        or(
          ilike(kbArticles.title, `%${q.search}%`),
          ilike(kbArticles.content, `%${q.search}%`)
        )!
      )
    }

    if (q.category) {
      conditions.push(eq(kbArticles.category, q.category))
    }

    if (q.language) {
      conditions.push(eq(kbArticles.language, q.language))
    }

    if (q.status === 'published') {
      conditions.push(eq(kbArticles.isPublished, true))
    } else if (q.status === 'unpublished') {
      conditions.push(eq(kbArticles.isPublished, false))
    }

    const [rows, countResult] = await Promise.all([
      db.select({
        id: kbArticles.id,
        title: kbArticles.title,
        slug: kbArticles.slug,
        language: kbArticles.language,
        category: kbArticles.category,
        tags: kbArticles.tags,
        isPublished: kbArticles.isPublished,
        isAiGenerated: kbArticles.isAiGenerated,
        createdAt: kbArticles.createdAt,
        updatedAt: kbArticles.updatedAt,
      })
        .from(kbArticles)
        .where(and(...conditions))
        .orderBy(desc(kbArticles.updatedAt))
        .limit(q.pageSize)
        .offset(offset),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(kbArticles)
        .where(and(...conditions)),
    ])

    const total = countResult[0]?.count ?? 0
    const totalPages = Math.ceil(total / q.pageSize)

    return reply.send({
      data: rows,
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages,
        hasNextPage: q.page < totalPages,
        hasPreviousPage: q.page > 1,
      },
    })
  })

  // ─── GET /kb/stats ───────────────────────────────────────────────────────────
  app.get('/stats', async (req, reply) => {
    const tenantId = req.agent.tenantId

    const [totalResult, publishedResult, lastUpdatedResult] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(kbArticles)
        .where(eq(kbArticles.tenantId, tenantId)),

      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(kbArticles)
        .where(and(eq(kbArticles.tenantId, tenantId), eq(kbArticles.isPublished, true))),

      db.select({ updatedAt: kbArticles.updatedAt })
        .from(kbArticles)
        .where(eq(kbArticles.tenantId, tenantId))
        .orderBy(desc(kbArticles.updatedAt))
        .limit(1),
    ])

    return reply.send({
      totalArticles: totalResult[0]?.count ?? 0,
      publishedCount: publishedResult[0]?.count ?? 0,
      lastUpdated: lastUpdatedResult[0]?.updatedAt ?? null,
    })
  })

  // ─── GET /kb/articles/:id ────────────────────────────────────────────────────
  app.get('/articles/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const tenantId = req.agent.tenantId

    const [article] = await db.select()
      .from(kbArticles)
      .where(and(eq(kbArticles.id, id), eq(kbArticles.tenantId, tenantId)))

    if (!article) return reply.status(404).send({ message: 'Article not found' })

    // Fetch associated knowledge chunks (generated from this article's sourceId)
    const chunks = await db.select({
      id: knowledgeChunks.id,
      chunkIndex: knowledgeChunks.chunkIndex,
      chunkType: knowledgeChunks.chunkType,
      content: knowledgeChunks.content,
      language: knowledgeChunks.language,
      isActive: knowledgeChunks.isActive,
      retrievalCount: knowledgeChunks.retrievalCount,
      lastUpdated: knowledgeChunks.lastUpdated,
    })
      .from(knowledgeChunks)
      .where(and(
        eq(knowledgeChunks.tenantId, tenantId),
        eq(knowledgeChunks.sourceType, 'article'),
        eq(knowledgeChunks.sourceId, id),
        eq(knowledgeChunks.isActive, true),
      ))
      .orderBy(knowledgeChunks.chunkIndex)

    return reply.send({ ...article, chunks })
  })

  // ─── POST /kb/articles ───────────────────────────────────────────────────────
  app.post('/articles', async (req, reply) => {
    const parsed = createArticleSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const tenantId = req.agent.tenantId

    const [article] = await db.insert(kbArticles).values({
      tenantId,
      title: parsed.data.title,
      slug: parsed.data.slug,
      content: parsed.data.content,
      language: parsed.data.language,
      titleHi: parsed.data.titleHi,
      contentHi: parsed.data.contentHi,
      titleHinglish: parsed.data.titleHinglish,
      contentHinglish: parsed.data.contentHinglish,
      category: parsed.data.category,
      tags: parsed.data.tags ?? [],
      isPublished: parsed.data.isPublished,
      isAiGenerated: parsed.data.isAiGenerated,
      createdBy: req.agent.id,
      updatedBy: req.agent.id,
    }).returning()

    // Enqueue embedding job so the article becomes searchable via RAG
    await aiEmbedQueue.add('embed-article', {
      tenantId,
      chunkIds: [],           // embed worker resolves chunks by sourceId/sourceType
      operation: 'embed',
      sourceType: 'article',
      sourceId: article.id,
    } as any)

    return reply.status(201).send(article)
  })

  // ─── PATCH /kb/articles/:id ──────────────────────────────────────────────────
  app.patch('/articles/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const parsed = updateArticleSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid body', errors: parsed.error.flatten() })
    }

    const tenantId = req.agent.tenantId

    const [existing] = await db.select({ id: kbArticles.id })
      .from(kbArticles)
      .where(and(eq(kbArticles.id, id), eq(kbArticles.tenantId, tenantId)))

    if (!existing) return reply.status(404).send({ message: 'Article not found' })

    const updates: Record<string, unknown> = {
      ...parsed.data,
      updatedBy: req.agent.id,
      updatedAt: new Date(),
    }

    const [updated] = await db.update(kbArticles)
      .set(updates as any)
      .where(and(eq(kbArticles.id, id), eq(kbArticles.tenantId, tenantId)))
      .returning()

    // Re-enqueue embedding since content may have changed
    await aiEmbedQueue.add('re-embed-article', {
      tenantId,
      chunkIds: [],
      operation: 're-embed',
      sourceType: 'article',
      sourceId: id,
    } as any)

    return reply.send(updated)
  })

  // ─── DELETE /kb/articles/:id (soft delete) ───────────────────────────────────
  app.delete('/articles/:id', async (req, reply) => {
    const idParsed = uuidSchema.safeParse((req.params as { id: string }).id)
    if (!idParsed.success) return reply.status(400).send({ error: 'Invalid ID format' })
    const id = idParsed.data
    const tenantId = req.agent.tenantId

    const [existing] = await db.select({ id: kbArticles.id })
      .from(kbArticles)
      .where(and(eq(kbArticles.id, id), eq(kbArticles.tenantId, tenantId)))

    if (!existing) return reply.status(404).send({ message: 'Article not found' })

    // Soft delete: unpublish the article and deactivate its chunks
    await Promise.all([
      db.update(kbArticles)
        .set({ isPublished: false, updatedBy: req.agent.id, updatedAt: new Date() })
        .where(and(eq(kbArticles.id, id), eq(kbArticles.tenantId, tenantId))),

      db.update(knowledgeChunks)
        .set({ isActive: false, lastUpdated: new Date() })
        .where(and(
          eq(knowledgeChunks.tenantId, tenantId),
          eq(knowledgeChunks.sourceType, 'article'),
          eq(knowledgeChunks.sourceId, id),
        )),
    ])

    return reply.status(204).send()
  })
}
