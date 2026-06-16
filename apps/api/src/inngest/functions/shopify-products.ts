import { eq, sql } from "drizzle-orm";
import { knowledgeChunks, withTenant } from "@sahay/db";
import { inngest } from "../client";

/**
 * shopify-products (created / updated / deleted)
 *
 * On create+update: upsert a knowledge chunk for this product, set the
 * shopifyUpdatedAt clock, and fan out an `ai/embed.requested` so the
 * vector index stays current.
 *
 * On delete: deactivate the chunk (soft-delete via isActive=false) so
 * the RAG search still has historical context but won't surface it as a
 * recommendation.
 *
 * NOTE: this is a coarse-grained chunker — one chunk per product. The
 * dedicated re-chunker that splits a product into identity / benefits /
 * ingredients / usage chunks lives in a separate worker (P0.13).
 */

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function upsertProductChunk(
  tenantId: string,
  raw: Record<string, unknown>,
): Promise<string | null> {
  const sourceId = String(raw["id"] ?? "");
  if (!sourceId) return null;
  const title = (raw["title"] as string | null) ?? null;
  const bodyHtml = (raw["body_html"] as string | null) ?? null;
  const productType = (raw["product_type"] as string | null) ?? null;
  const updatedAt = raw["updated_at"]
    ? new Date(String(raw["updated_at"]))
    : null;

  const content = stripHtml(bodyHtml ?? "") || (title ?? "");
  if (!content.trim()) return null;

  return withTenant(tenantId, async (tx) => {
    const existing = await tx.query.knowledgeChunks.findFirst({
      where: sql`${knowledgeChunks.tenantId} = ${tenantId}
        AND ${knowledgeChunks.sourceType} = 'product'
        AND ${knowledgeChunks.sourceId} = ${sourceId}`,
    });

    if (existing) {
      await tx
        .update(knowledgeChunks)
        .set({
          title,
          content,
          productName: title,
          category: productType,
          shopifyUpdatedAt: updatedAt,
          lastUpdated: new Date(),
          isActive: true,
        })
        .where(eq(knowledgeChunks.id, existing.id));
      return existing.id;
    }

    const [created] = await tx
      .insert(knowledgeChunks)
      .values({
        tenantId,
        sourceType: "product",
        sourceId,
        title,
        content,
        productId: sourceId,
        productName: title,
        category: productType,
        shopifyUpdatedAt: updatedAt,
      })
      .returning({ id: knowledgeChunks.id });

    return created?.id ?? null;
  });
}

async function deactivateProductChunks(
  tenantId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const sourceId = String(raw["id"] ?? "");
  if (!sourceId) return;
  await withTenant(tenantId, (tx) =>
    tx
      .update(knowledgeChunks)
      .set({ isActive: false, lastUpdated: new Date() })
      .where(
        sql`${knowledgeChunks.tenantId} = ${tenantId}
          AND ${knowledgeChunks.sourceType} = 'product'
          AND ${knowledgeChunks.sourceId} = ${sourceId}`,
      ),
  );
}

export const shopifyProductsCreated = inngest.createFunction(
  {
    id: "shopify-products-created",
    retries: 5,
    concurrency: { limit: 25, key: "event.data.tenantId" },
  },
  { event: "shopify/products.created" },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data;
    const chunkId = await step.run("upsert", async () =>
      upsertProductChunk(tenantId, payload),
    );
    if (chunkId) {
      await step.sendEvent("queue-embed", {
        name: "ai/embed.requested",
        data: { tenantId, kbChunkId: chunkId },
      });
    }
    return { chunkId };
  },
);

export const shopifyProductsUpdated = inngest.createFunction(
  {
    id: "shopify-products-updated",
    retries: 5,
    concurrency: { limit: 25, key: "event.data.tenantId" },
  },
  { event: "shopify/products.updated" },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data;
    const chunkId = await step.run("upsert", async () =>
      upsertProductChunk(tenantId, payload),
    );
    if (chunkId) {
      await step.sendEvent("queue-embed", {
        name: "ai/embed.requested",
        data: { tenantId, kbChunkId: chunkId },
      });
    }
    return { chunkId };
  },
);

export const shopifyProductsDeleted = inngest.createFunction(
  {
    id: "shopify-products-deleted",
    retries: 5,
    concurrency: { limit: 25, key: "event.data.tenantId" },
  },
  { event: "shopify/products.deleted" },
  async ({ event, step }) => {
    const { tenantId, payload } = event.data;
    await step.run("deactivate", async () =>
      deactivateProductChunks(tenantId, payload),
    );
    return { ok: true };
  },
);
