import {
  pgTable, uuid, text, boolean, timestamp, integer, decimal,
  customType, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

// pgvector custom type for embeddings
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    return `vector(${(config as { dimensions?: number })?.dimensions ?? 1536})`
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number)
  },
})

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Source
  sourceType: text('source_type').notNull(), // product|faq|policy|blog|custom
  sourceId: text('source_id'),               // shopify product ID, etc.
  sourceUrl: text('source_url'),
  // Content
  title: text('title'),
  content: text('content').notNull(),
  language: text('language').default('en'),  // en|hi|hinglish
  chunkType: text('chunk_type'),             // identity|benefits|ingredients|usage|suitability|certifications
  chunkIndex: integer('chunk_index').default(0), // order within source
  // Product metadata (for pre-filtering)
  productId: text('product_id'),
  productName: text('product_name'),
  category: text('category'),
  skinTypes: text('skin_types').array().default([]),
  priceTier: text('price_tier'),             // budget|mid|premium|luxury
  // Embedding (1536 dims for text-embedding-3-small)
  embedding: vector('embedding', { dimensions: 1536 }),
  // Analytics
  retrievalCount: integer('retrieval_count').default(0),
  avgCsatOnUse: decimal('avg_csat_on_use', { precision: 3, scale: 2 }),
  // Freshness
  lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
  shopifyUpdatedAt: timestamp('shopify_updated_at', { withTimezone: true }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantActiveIdx: index('idx_kc_tenant_active').on(table.tenantId),
  sourceIdx: index('idx_kc_source').on(table.tenantId, table.sourceType, table.sourceId),
  updatedIdx: index('idx_kc_updated').on(table.tenantId, table.lastUpdated),
  productIdx: index('idx_kc_product').on(table.tenantId, table.productId),
  // Note: IVFFlat index for vector search must be created via raw SQL migration
  // CREATE INDEX idx_kc_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
}))

// Knowledge base articles (structured, editable by admins)
export const kbArticles = pgTable('kb_articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  content: text('content').notNull(),
  language: text('language').default('en'),
  // Translations
  titleHi: text('title_hi'),
  contentHi: text('content_hi'),
  titleHinglish: text('title_hinglish'),
  contentHinglish: text('content_hinglish'),
  // Categorization
  category: text('category'),
  tags: text('tags').array().default([]),
  // Status
  isPublished: boolean('is_published').default(false),
  isAiGenerated: boolean('is_ai_generated').default(false),
  // Meta
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tenantSlugIdx: uniqueIndex('idx_ka_tenant_slug').on(table.tenantId, table.slug),
  tenantPublishedIdx: index('idx_ka_tenant_published').on(table.tenantId, table.isPublished),
}))

export type KnowledgeChunkRecord = typeof knowledgeChunks.$inferSelect
export type NewKnowledgeChunk = typeof knowledgeChunks.$inferInsert
export type KBArticleRecord = typeof kbArticles.$inferSelect
export type NewKBArticle = typeof kbArticles.$inferInsert
