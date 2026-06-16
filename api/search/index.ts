// ─── Global Search (Vercel Function) ─────────────────────────────────────────
// GET /api/search?q=...&type=...&status=...&channel=...&dateFrom=...&dateTo=...
//
// Searches across:
//   - Conversations (matched via FTS on messages.content + transcription, plus
//     conversations.escalation_reason / primary_intent / tags).
//   - Customers (matched via pg_trgm ILIKE on name / phone / email).
//
// Auth: Bearer token + tenant scoping via ctx.withTenant + explicit tenant_id
// filters in every WHERE clause (defense-in-depth — RLS would catch it anyway).
//
// Returns: { results: { conversations, customers }, pagination, tookMs }.

import { z } from "zod";
import { sql } from "drizzle-orm";
import type {
  MessageSearchResult,
  CustomerSearchResult,
  SearchResponse,
} from "@sahay/shared";
import {
  defineAuthedHandler,
  parseQuery,
} from "../../apps/api/src/lib/handler";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";
import { auditAction } from "../../apps/api/src/services/audit";

const STATUS_VALUES = [
  "open",
  "pending",
  "snoozed",
  "resolved",
  "closed",
  "all",
] as const;
const CHANNEL_VALUES = [
  "whatsapp",
  "instagram",
  "webchat",
  "email",
  "all",
] as const;

const searchQuerySchema = z.object({
  q: z.string().default(""),
  type: z.enum(["all", "conversations", "customers"]).default("all"),
  status: z.enum(STATUS_VALUES).default("all"),
  channel: z.enum(CHANNEL_VALUES).default("all"),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

interface ConversationHitRow {
  conversation_id: string;
  channel: string;
  status: string | null;
  primary_intent: string | null;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_tier: string | null;
  snippet: string | null;
  matched_at: Date | null;
  rank: number;
}

interface CustomerHitRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  tier: string | null;
  total_orders: number | null;
}

interface CountRow {
  count: number;
}

const empty = (
  page: number,
  pageSize: number,
  tookMs: number,
): SearchResponse => ({
  results: { conversations: [], customers: [] },
  pagination: {
    page,
    pageSize,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  tookMs,
});

export default defineAuthedHandler(
  async (req, res, ctx) => {
    const startedAt = Date.now();
    await enforce(limits.perTenant(), ctx.tenant.id);

    const q = parseQuery(searchQuerySchema, req.query);
    const trimmed = q.q.trim();
    const tenantId = ctx.tenant.id;

    // UX rule: too-short queries return an empty result set, NOT a 400.
    // The Command Palette types as the user types, so we don't want to
    // flash error toasts before they finish their first word.
    if (trimmed.length < 2) {
      res.status(200).json(empty(q.page, q.pageSize, Date.now() - startedAt));
      return;
    }

    const offset = (q.page - 1) * q.pageSize;
    const wantConversations = q.type === "all" || q.type === "conversations";
    const wantCustomers = q.type === "all" || q.type === "customers";

    // websearch_to_tsquery is friendlier than plainto_tsquery: it supports
    // quoted phrases ("free returns"), -negation, and OR. Critically it
    // never throws on bad input — plainto_tsquery() can raise syntax errors.
    const tsq = sql`websearch_to_tsquery('simple', ${trimmed})`;
    const ilikePattern = `%${trimmed}%`;

    let conversationHits: MessageSearchResult[] = [];
    let customerHits: CustomerSearchResult[] = [];
    let total = 0;

    await ctx.withTenant(async (tx) => {
      if (wantConversations) {
        // Optional channel/status filters scope the matching conversations.
        const channelFilter =
          q.channel === "all" ? sql`true` : sql`c.channel = ${q.channel}`;
        const statusFilter =
          q.status === "all" ? sql`true` : sql`c.status = ${q.status}`;
        const dateFromFilter = q.dateFrom
          ? sql`m.created_at >= ${q.dateFrom}`
          : sql`true`;
        const dateToFilter = q.dateTo
          ? sql`m.created_at <= ${q.dateTo}`
          : sql`true`;

        // The CTE picks the single best message hit per conversation
        // (ROW_NUMBER ranks within conversation_id). We then join to
        // conversations + customers and additionally OR-match the
        // conversations.search_tsv so a conversation tagged "refund" with
        // no matching message body still surfaces.
        const hitsSql = sql`
          WITH msg_hits AS (
            SELECT
              m.conversation_id,
              m.content,
              m.transcription,
              m.created_at,
              ts_rank_cd(m.search_tsv, ${tsq}) AS rank,
              ROW_NUMBER() OVER (
                PARTITION BY m.conversation_id
                ORDER BY ts_rank_cd(m.search_tsv, ${tsq}) DESC, m.created_at DESC
              ) AS rn
            FROM messages m
            WHERE m.tenant_id = ${tenantId}
              AND m.search_tsv @@ ${tsq}
              AND ${dateFromFilter}
              AND ${dateToFilter}
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
            c.id                             AS conversation_id,
            c.channel                        AS channel,
            c.status                         AS status,
            c.primary_intent                 AS primary_intent,
            cust.id                          AS customer_id,
            cust.name                        AS customer_name,
            cust.phone                       AS customer_phone,
            cust.tier                        AS customer_tier,
            mh.content                       AS snippet,
            mh.created_at                    AS matched_at,
            combined.rank                    AS rank
          FROM combined
          JOIN conversations c   ON c.id = combined.conversation_id AND c.tenant_id = ${tenantId}
          JOIN customers     cust ON cust.id = c.customer_id        AND cust.tenant_id = ${tenantId}
          LEFT JOIN msg_hits mh  ON mh.conversation_id = combined.conversation_id AND mh.rn = 1
          WHERE ${channelFilter}
            AND ${statusFilter}
          ORDER BY combined.rank DESC, c.updated_at DESC
          LIMIT ${q.pageSize}
          OFFSET ${offset}
        `;

        // Total count uses the same UNION shape (without per-message ranking)
        // so pagination is honest. DISTINCT ensures no double-count when a
        // conversation matches both via message and via its own tsvector.
        const countSql = sql`
          SELECT CAST(COUNT(*) AS integer) AS count FROM (
            SELECT DISTINCT conversation_id FROM (
              SELECT m.conversation_id
              FROM messages m
              JOIN conversations c ON c.id = m.conversation_id
              WHERE m.tenant_id = ${tenantId}
                AND m.search_tsv @@ ${tsq}
                AND ${dateFromFilter}
                AND ${dateToFilter}
                AND ${channelFilter}
                AND ${statusFilter}
              UNION
              SELECT c.id AS conversation_id
              FROM conversations c
              WHERE c.tenant_id = ${tenantId}
                AND c.search_tsv @@ ${tsq}
                AND ${channelFilter}
                AND ${statusFilter}
            ) ids
          ) distinct_ids
        `;

        const [hitsResult, countResult] = await Promise.all([
          tx.execute(hitsSql),
          tx.execute(countSql),
        ]);

        const hitsRows = hitsResult as unknown as ConversationHitRow[];
        const countRows = countResult as unknown as CountRow[];

        conversationHits = hitsRows.map(
          (r): MessageSearchResult => ({
            conversationId: r.conversation_id,
            channel: r.channel as MessageSearchResult["channel"],
            status: (r.status ?? "open") as MessageSearchResult["status"],
            primaryIntent: r.primary_intent ?? undefined,
            customerId: r.customer_id,
            customerName: r.customer_name ?? undefined,
            customerPhone: r.customer_phone ?? undefined,
            customerTier: (r.customer_tier ??
              "new") as MessageSearchResult["customerTier"],
            snippet: r.snippet?.slice(0, 240) ?? undefined,
            matchedAt: r.matched_at
              ? new Date(r.matched_at).toISOString()
              : undefined,
            rank: typeof r.rank === "number" ? r.rank : Number(r.rank),
          }),
        );

        total = countRows[0]?.count ?? 0;
      }

      if (wantCustomers) {
        // pg_trgm-backed ILIKE on indexed columns. Cap at pageSize so the
        // customers section can't dominate the response.
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
            CASE WHEN name  ILIKE ${ilikePattern} THEN 0 ELSE 1 END,
            COALESCE(total_orders, 0) DESC
          LIMIT ${q.pageSize}
        `;
        const custResult = await tx.execute(custSql);
        const custRows = custResult as unknown as CustomerHitRow[];
        customerHits = custRows.map(
          (r): CustomerSearchResult => ({
            id: r.id,
            name: r.name ?? undefined,
            phone: r.phone ?? undefined,
            email: r.email ?? undefined,
            city: r.city ?? undefined,
            tier: (r.tier ?? "new") as CustomerSearchResult["tier"],
            totalOrders: r.total_orders ?? 0,
          }),
        );
      }
    });

    const totalPages = Math.ceil(total / q.pageSize);
    const tookMs = Date.now() - startedAt;

    const response: SearchResponse = {
      results: { conversations: conversationHits, customers: customerHits },
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages,
        hasNextPage: q.page < totalPages,
        hasPreviousPage: q.page > 1,
      },
      tookMs,
    };

    // Audit asynchronously after the response is built but before sending —
    // auditAction swallows its own errors, so it can't affect the response.
    await auditAction({
      tenantId: ctx.tenant.id,
      actorType: "agent",
      actorId: ctx.agent.id,
      actorEmail: ctx.agent.email,
      action: "search.executed",
      resourceType: "search",
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        query: trimmed,
        type: q.type,
        status: q.status,
        channel: q.channel,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        resultCount: conversationHits.length + customerHits.length,
        tookMs,
      },
    });

    res.status(200).json(response);
  },
  { methods: ["GET"] },
);
