import { z } from "zod";
import { customers } from "@sahay/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  defineAuthedHandler,
  parseQuery,
} from "../../apps/api/src/lib/handler";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";
import { auditCustomerListRead } from "../../apps/api/src/lib/audit-helpers";

const QuerySchema = z.object({
  tier: z.enum(["new", "loyal", "vip", "all"]).default("all"),
  churnRisk: z.enum(["low", "medium", "high", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id);
    const q = parseQuery(QuerySchema, req.query);

    const conditions = [eq(customers.tenantId, ctx.tenant.id)];
    if (q.tier !== "all") conditions.push(eq(customers.tier, q.tier));
    if (q.churnRisk !== "all")
      conditions.push(eq(customers.churnRisk, q.churnRisk));

    const offset = (q.page - 1) * q.pageSize;

    const [rows, countResult] = await ctx.withTenant(async (tx) => {
      return Promise.all([
        tx
          .select({
            id: customers.id,
            name: customers.name,
            phone: customers.phone,
            email: customers.email,
            tier: customers.tier,
            churnRisk: customers.churnRisk,
            totalOrders: customers.totalOrders,
            totalSpent: customers.totalSpent,
            clvScore: customers.clvScore,
            lastOrderAt: customers.lastOrderAt,
            tags: customers.tags,
            createdAt: customers.createdAt,
          })
          .from(customers)
          .where(and(...conditions))
          .orderBy(desc(customers.lastOrderAt))
          .limit(q.pageSize)
          .offset(offset),
        tx
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(customers)
          .where(and(...conditions)),
      ]);
    });

    const total = countResult[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / q.pageSize));

    void auditCustomerListRead(ctx, req.query);

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
