// ─── Search Suggestions (Vercel Function) ────────────────────────────────────
// GET /api/search/suggest?q=...
//
// Lightweight typeahead endpoint for the Command Palette: returns at most 5
// best-matching conversations and 5 customers. Uses the same FTS / pg_trgm
// indexes as /api/search but skips the count query and the audit log because:
//   - It runs on every keystroke (debounced); audit volume would be useless noise.
//   - Counts are unused — the palette only renders the top hits.
//
// Auth + tenant scoping match /api/search.

import { z } from 'zod'
import { sql } from 'drizzle-orm'
import type {
  MessageSearchResult,
  CustomerSearchResult,
  SearchResponse,
} from '@sahay/shared'
import { defineAuthedHandler, parseQuery } from '../../apps/api/src/lib/handler'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'

const SUGGEST_LIMIT = 5

const suggestQuerySchema = z.object({
  q: z.string().default(''),
})

interface ConversationHitRow {
  conversation_id: string
  channel: string
  status: string | null
  primary_intent: string | null
  customer_id: string
  customer_name: string | null
  customer_phone: string | null
  customer_tier: string | null
  snippet: string | null
  matched_at: Date | null
  rank: number
}

interface CustomerHitRow {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  city: string | null
  tier: string | null
  total_orders: number | null
}

const empty = (tookMs: number): SearchResponse => ({
  results: { conversations: [], customers: [] },
  pagination: {
    page: 1, pageSize: SUGGEST_LIMIT, total: 0, totalPages: 0,
    hasNextPage: false, hasPreviousPage: false,
  },
  tookMs,
})

export default defineAuthedHandler(
  async (req, res, ctx) => {
    const startedAt = Date.now()
    await enforce(limits.perTenant(), ctx.tenant.id)

    const { q } = parseQuery(suggestQuerySchema, req.query)
    const trimmed = q.trim()
    const tenantId = ctx.tenant.id

    // Same min-length policy as /api/search: silently empty, never 400.
    if (trimmed.length < 2) {
      res.status(200).json(empty(Date.now() - startedAt))
      return
    }

    const tsq = sql`websearch_to_tsquery('simple', ${trimmed})`
    const ilikePattern = `%${trimmed}%`

    let conversationHits: MessageSearchResult[] = []
    let customerHits: CustomerSearchResult[] = []

    await ctx.withTenant(async (tx) => {
      const hitsSql = sql`
        WITH msg_hits AS (
          SELECT
            m.conversation_id,
            m.content,
            m.created_at,
            ts_rank_cd(m.search_tsv, ${tsq}) AS rank,
            ROW_NUMBER() OVER (
              PARTITION BY m.conversation_id
              ORDER BY ts_rank_cd(m.search_tsv, ${tsq}) DESC, m.created_at DESC
            ) AS rn
          FROM messages m
          WHERE m.tenant_id = ${tenantId}
            AND m.search_tsv @@ ${tsq}
        ),
        conv_hits AS (
          SELECT
            c.id AS conversation_id,
            ts_rank_cd(c.search_tsv, ${tsq}) AS rank
          FROM conversations c
          WHERE c.tenant_id = ${tenantId}
            AND c.search_tsv @@ ${tsq}
        ),
        combined AS (
          SELECT conversation_id, MAX(rank) AS rank FROM (
            SELECT conversation_id, rank FROM msg_hits WHERE rn = 1
            UNION ALL
            SELECT conversation_id, rank FROM conv_hits
          ) u
          GROUP BY conversation_id
        )
        SELECT
          c.id            AS conversation_id,
          c.channel       AS channel,
          c.status        AS status,
          c.primary_intent AS primary_intent,
          cust.id         AS customer_id,
          cust.name       AS customer_name,
          cust.phone      AS customer_phone,
          cust.tier       AS customer_tier,
          mh.content      AS snippet,
          mh.created_at   AS matched_at,
          combined.rank   AS rank
        FROM combined
        JOIN conversations c    ON c.id = combined.conversation_id AND c.tenant_id = ${tenantId}
        JOIN customers     cust ON cust.id = c.customer_id         AND cust.tenant_id = ${tenantId}
        LEFT JOIN msg_hits mh   ON mh.conversation_id = combined.conversation_id AND mh.rn = 1
        ORDER BY combined.rank DESC, c.updated_at DESC
        LIMIT ${SUGGEST_LIMIT}
      `

      const custSql = sql`
        SELECT
          id, name, phone, email, city, tier,
          COALESCE(total_orders, 0) AS total_orders
        FROM customers
        WHERE tenant_id = ${tenantId}
          AND (
            COALESCE(name, '')  ILIKE ${ilikePattern} OR
            COALESCE(phone, '') ILIKE ${ilikePattern} OR
            COALESCE(email, '') ILIKE ${ilikePattern}
          )
        ORDER BY
          CASE WHEN name ILIKE ${ilikePattern} THEN 0 ELSE 1 END,
          COALESCE(total_orders, 0) DESC
        LIMIT ${SUGGEST_LIMIT}
      `

      const [hitsResult, custResult] = await Promise.all([
        tx.execute(hitsSql),
        tx.execute(custSql),
      ])

      const hitsRows = hitsResult as unknown as ConversationHitRow[]
      const custRows = custResult as unknown as CustomerHitRow[]

      conversationHits = hitsRows.map((r): MessageSearchResult => ({
        conversationId: r.conversation_id,
        channel: r.channel as MessageSearchResult['channel'],
        status: (r.status ?? 'open') as MessageSearchResult['status'],
        primaryIntent: r.primary_intent ?? undefined,
        customerId: r.customer_id,
        customerName: r.customer_name ?? undefined,
        customerPhone: r.customer_phone ?? undefined,
        customerTier: (r.customer_tier ?? 'new') as MessageSearchResult['customerTier'],
        snippet: r.snippet?.slice(0, 160) ?? undefined,
        matchedAt: r.matched_at ? new Date(r.matched_at).toISOString() : undefined,
        rank: typeof r.rank === 'number' ? r.rank : Number(r.rank),
      }))

      customerHits = custRows.map((r): CustomerSearchResult => ({
        id: r.id,
        name: r.name ?? undefined,
        phone: r.phone ?? undefined,
        email: r.email ?? undefined,
        city: r.city ?? undefined,
        tier: (r.tier ?? 'new') as CustomerSearchResult['tier'],
        totalOrders: r.total_orders ?? 0,
      }))
    })

    const tookMs = Date.now() - startedAt
    const response: SearchResponse = {
      results: { conversations: conversationHits, customers: customerHits },
      pagination: {
        page: 1,
        pageSize: SUGGEST_LIMIT,
        total: conversationHits.length + customerHits.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      tookMs,
    }

    res.status(200).json(response)
  },
  { methods: ['GET'] },
)
