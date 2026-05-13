import { z } from "zod";
import { kbArticles } from "@sahay/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  defineAuthedHandler,
  parseQuery,
} from "../../../apps/api/src/lib/handler";
import { enforce, limits } from "../../../apps/api/src/lib/rate-limit";

const QuerySchema = z.object({
  language: z.enum(["en", "hi", "hinglish", "all"]).default("all"),
  category: z.string().optional(),
  published: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id);
    const q = parseQuery(QuerySchema, req.query);

    const conditions = [eq(kbArticles.tenantId, ctx.tenant.id)];
    if (q.language !== "all")
      conditions.push(eq(kbArticles.language, q.language));
    if (q.category) conditions.push(eq(kbArticles.category, q.category));
    if (q.published !== undefined)
      conditions.push(eq(kbArticles.isPublished, q.published));

    const offset = (q.page - 1) * q.pageSize;

    const [rows, countResult] = await ctx.withTenant(async (tx) => {
      return Promise.all([
        tx
          .select({
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
        tx
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(kbArticles)
          .where(and(...conditions)),
      ]);
    });

    const total = countResult[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / q.pageSize));

    res.status(200).json({
      data: rows,
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages,
        hasNextPage: q.page < totalPages,
        hasPreviousPage: q.page > 1,
      },
    });
  },
  { methods: ["GET"] },
);
