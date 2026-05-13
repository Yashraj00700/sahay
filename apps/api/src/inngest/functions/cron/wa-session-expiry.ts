import { and, eq, lt, sql } from "drizzle-orm";
import { db, conversations, withSystemBypass } from "@sahay/db";
import { inngest } from "../../client";
import { triggerToTenant } from "../../../lib/pusher";

/**
 * cron/wa-session-expiry
 *
 * Runs every 15 minutes. Closes WhatsApp conversations whose Meta 24h
 * session has lapsed and emits a realtime `conversation:updated` so the
 * agent UI removes them from the active inbox without a refresh.
 *
 * Inngest cron syntax — `cron` replaces `event` as the trigger.
 */
export const waSessionExpiry = inngest.createFunction(
  { id: "cron-wa-session-expiry", retries: 1 },
  { cron: "*/15 * * * *" },
  async ({ step, logger }) => {
    const now = new Date();

    const expired = await step.run("find-expired", async () =>
      withSystemBypass(
        () =>
          db
            .select({
              id: conversations.id,
              tenantId: conversations.tenantId,
            })
            .from(conversations)
            .where(
              and(
                eq(conversations.channel, "whatsapp"),
                eq(conversations.status, "open"),
                lt(conversations.sessionExpiresAt, now),
              ),
            )
            .limit(500), // bound batch size for predictable runtime
      ),
    );

    if (expired.length === 0) return { closed: 0 };

    await step.run("close-conversations", async () =>
      withSystemBypass(async () => {
        const ids = expired.map((c) => c.id);
        await db
          .update(conversations)
          .set({ status: "closed", updatedAt: now })
          .where(
            sql`${conversations.id} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
      }),
    );

    // Group by tenant for efficient realtime fan-out.
    const byTenant = new Map<string, string[]>();
    for (const c of expired) {
      const arr = byTenant.get(c.tenantId) ?? [];
      arr.push(c.id);
      byTenant.set(c.tenantId, arr);
    }

    await step.run("broadcast", async () => {
      for (const [tenantId, ids] of byTenant) {
        await triggerToTenant(tenantId, "conversation:updated", {
          closedConversationIds: ids,
          reason: "wa_session_expired",
        });
      }
    });

    logger.info(
      { closed: expired.length },
      "wa-session-expiry: closed expired conversations",
    );
    return { closed: expired.length };
  },
);
