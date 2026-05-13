import { z } from "zod";
import { agents } from "@sahay/db";
import { eq } from "drizzle-orm";
import { defineAuthedHandler, parseBody } from "../../apps/api/src/lib/handler";
import { NotFoundError } from "../../apps/api/src/lib/errors";
import { logger } from "../../apps/api/src/lib/logger";

/**
 * POST /api/notifications/subscribe
 *
 * Registers a browser PushSubscription for the authenticated agent.
 *
 * Subscriptions are stored as a JSONB array on the agent row. We dedupe by
 * `endpoint` so re-subscribing on the same browser (e.g. on token refresh
 * or after permission was re-granted) replaces the prior entry rather than
 * appending duplicates that would all fire for the same notification.
 */

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(512).optional(),
});

interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  createdAt: string;
}

export default defineAuthedHandler(
  async (req, res, ctx) => {
    const body = parseBody(SubscribeSchema, req.body);

    const next = await ctx.withTenant(async (tx) => {
      const row = await tx.query.agents.findFirst({
        where: eq(agents.id, ctx.agent.id),
      });
      if (!row) throw new NotFoundError("Agent not found");

      const existing = (row.pushSubscriptions ?? []) as StoredSubscription[];
      // Dedupe by endpoint: the same browser will produce a stable endpoint,
      // so a re-subscribe is an in-place replace, never a duplicate fanout.
      const filtered = existing.filter((s) => s.endpoint !== body.endpoint);
      const next: StoredSubscription[] = [
        ...filtered,
        {
          endpoint: body.endpoint,
          keys: body.keys,
          userAgent: body.userAgent,
          createdAt: new Date().toISOString(),
        },
      ];

      await tx
        .update(agents)
        .set({ pushSubscriptions: next, updatedAt: new Date() })
        .where(eq(agents.id, ctx.agent.id));

      return next;
    });

    logger.info(
      { agentId: ctx.agent.id, total: next.length },
      "push: subscription registered",
    );

    res.status(200).json({ success: true });
  },
  { methods: ["POST"] },
);
