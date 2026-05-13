import { and, desc, eq } from "drizzle-orm";
import {
  tenants,
  conversations,
  customers,
  messages,
  withTenant,
} from "@sahay/db";
import { inngest } from "../client";
import { sendInstagramMessage } from "../../services/channels/instagram.adapter";

/**
 * instagram-outgoing
 *
 * Sends a text message via Instagram Messaging API. Mirrors the shape of
 * whatsapp-outgoing but uses the Page Access Token from the tenant row.
 * Unlike WA there is no template concept — out-of-window sends require a
 * messaging tag, but tags are tenant-policy decisions we don't make here.
 */
export const instagramOutgoing = inngest.createFunction(
  {
    id: "instagram-outgoing",
    retries: 3,
    concurrency: { limit: 50, key: "event.data.tenantId" },
  },
  { event: "instagram/message.send" },
  async ({ event, step, logger }) => {
    const { tenantId, to, content } = event.data;

    const tenant = await step.run("load-tenant", async () =>
      withTenant(tenantId, async (tx) => {
        const row = await tx.query.tenants.findFirst({
          where: eq(tenants.id, tenantId),
        });
        if (!row)
          throw new Error(`instagram-outgoing: tenant ${tenantId} not found`);
        if (!row.instagramToken) {
          throw new Error(
            `instagram-outgoing: tenant ${tenantId} has no Instagram token`,
          );
        }
        return { accessToken: row.instagramToken };
      }),
    );

    const sendResult = await step.run("send-message", async () =>
      sendInstagramMessage({
        tenantId,
        accessToken: tenant.accessToken,
        recipientId: to,
        message: { text: content },
        messagingType: "RESPONSE",
      }),
    );

    await step.run("record-status", async () =>
      withTenant(tenantId, async (tx) => {
        const customer = await tx.query.customers.findFirst({
          where: and(
            eq(customers.tenantId, tenantId),
            eq(customers.instagramId, to),
          ),
        });
        if (!customer) {
          logger.warn(
            { tenantId, to },
            "instagram-outgoing: no customer match — cannot stamp status",
          );
          return;
        }
        const conv = await tx.query.conversations.findFirst({
          where: and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.customerId, customer.id),
            eq(conversations.channel, "instagram"),
          ),
          orderBy: [desc(conversations.createdAt)],
        });
        if (!conv) return;
        const lastOutbound = await tx.query.messages.findFirst({
          where: and(
            eq(messages.conversationId, conv.id),
            eq(messages.tenantId, tenantId),
          ),
          orderBy: [desc(messages.createdAt)],
        });
        if (!lastOutbound) return;

        if (sendResult.ok) {
          await tx
            .update(messages)
            .set({
              channelMessageId:
                sendResult.messageId ?? lastOutbound.channelMessageId,
              channelStatus: "sent",
              channelError: null,
            })
            .where(eq(messages.id, lastOutbound.id));
        } else {
          await tx
            .update(messages)
            .set({
              channelStatus: "failed",
              channelError: sendResult.error ?? "unknown",
            })
            .where(eq(messages.id, lastOutbound.id));
        }
      }),
    );

    if (!sendResult.ok) {
      throw new Error(
        `instagram-outgoing: send failed — ${sendResult.error ?? "unknown"}`,
      );
    }

    return { messageId: sendResult.messageId };
  },
);
