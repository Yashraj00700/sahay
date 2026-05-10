import { eq } from 'drizzle-orm'
import { conversations, customers, withTenant } from '@sahay/db'
import { inngest } from '../client'
import { runAIPipeline } from '../../services/ai/agent'
import { auditAction } from '../../services/audit'
import { triggerToTenant } from '../../lib/pusher'

/**
 * ai-respond
 *
 * Consumer of `ai/respond.requested`. Runs the full AI pipeline
 * (language → intent → sentiment → RAG → Claude) via the existing
 * `runAIPipeline` orchestrator and then fans the result out:
 *
 *   - auto_respond     → enqueue an outgoing send event (channel-aware)
 *   - draft_for_review → realtime ai:suggestion (the agent UI lets a human
 *                        approve/edit before sending). The agent module
 *                        already broadcast that event itself, so we only
 *                        record the audit log here.
 *   - route_to_human / route_to_senior → conversation routing already
 *                        updated by the pipeline; we publish a
 *                        `conversation:updated` realtime event so the
 *                        agent inbox refreshes.
 *
 * Concurrency: 20 in-flight per tenant (Anthropic rate limits dominate).
 * Retries: 2 — the pipeline is expensive and retrying a faulty prompt
 * rarely succeeds. On terminal failure we route to a human so the
 * customer isn't left in silence.
 */
export const aiRespond = inngest.createFunction(
  {
    id: 'ai-respond',
    retries: 2,
    concurrency: { limit: 20, key: 'event.data.tenantId' },
  },
  { event: 'ai/respond.requested' },
  async ({ event, step, logger }) => {
    const { tenantId, conversationId, messageId } = event.data

    let result: Awaited<ReturnType<typeof runAIPipeline>>

    try {
      result = await step.run('run-pipeline', async () =>
        runAIPipeline(conversationId, tenantId),
      )
    } catch (err) {
      logger.error({ err, tenantId, conversationId }, 'ai-respond: pipeline failure — falling back to human')

      await step.run('fallback-route-human', async () => {
        await withTenant(tenantId, (tx) =>
          tx
            .update(conversations)
            .set({
              routingDecision: 'route_to_human',
              escalationReason: 'ai_pipeline_error',
              humanTouched: true,
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, conversationId)),
        )

        await auditAction({
          tenantId,
          actorType: 'ai',
          action: 'ai.error_fallback_to_human',
          resourceType: 'conversation',
          resourceId: conversationId,
          metadata: { error: String(err), messageId },
        })
      })

      await step.run('fallback-realtime', async () => {
        await triggerToTenant(tenantId, 'conversation:updated', {
          conversation: {
            id: conversationId,
            routingDecision: 'route_to_human',
            escalationReason: 'ai_pipeline_error',
          },
        })
      })

      throw err
    }

    // Audit every AI decision (DPDP compliance — AI decisions must be logged).
    await step.run('audit-decision', async () => {
      await auditAction({
        tenantId,
        actorType: 'ai',
        action: `ai.${result.decision}`,
        resourceType: 'conversation',
        resourceId: conversationId,
        metadata: {
          intent: result.intent,
          sentiment: result.sentiment,
          confidence: result.confidence,
          language: result.language,
          messageId,
          escalationReason: result.escalationReason ?? null,
          citationCount: result.citations.length,
        },
      })
    })

    // Decision-specific fan-out.
    if (result.decision === 'auto_respond' && result.responseText) {
      await step.run('dispatch-outgoing', async () => {
        // We need the channel + recipient for the outbound send. Look it
        // up once here so we can route to the right channel queue.
        const { conv, customer } = await withTenant(tenantId, async (tx) => {
          const conv = await tx.query.conversations.findFirst({
            where: eq(conversations.id, conversationId),
          })
          if (!conv) throw new Error('ai-respond: conversation not found for dispatch')
          const customer = await tx.query.customers.findFirst({
            where: eq(customers.id, conv.customerId),
          })
          if (!customer) throw new Error('ai-respond: customer not found for dispatch')
          return { conv, customer }
        })

        if (conv.channel === 'whatsapp' && customer.whatsappId) {
          await inngest.send({
            name: 'whatsapp/message.send',
            data: {
              tenantId,
              to: customer.whatsappId,
              content: result.responseText!,
            },
          })
        } else if (conv.channel === 'instagram' && customer.instagramId) {
          await inngest.send({
            name: 'instagram/message.send',
            data: {
              tenantId,
              to: customer.instagramId,
              content: result.responseText!,
            },
          })
        } else {
          // webchat / email / unknown — broadcast realtime only; the agent
          // surface or web widget delivers from the message row directly.
          logger.info(
            { tenantId, conversationId, channel: conv.channel },
            'ai-respond: no outgoing dispatch for channel — relying on realtime/agent surface',
          )
        }
      })
    } else if (
      result.decision === 'route_to_human' ||
      result.decision === 'route_to_senior'
    ) {
      await step.run('publish-routing-update', async () => {
        await triggerToTenant(tenantId, 'conversation:updated', {
          conversation: {
            id: conversationId,
            routingDecision: result.decision,
            escalationReason: result.escalationReason,
            primaryIntent: result.intent,
            sentiment: result.sentiment,
          },
        })
      })
    }
    // draft_for_review is already broadcast inside agent.ts via
    // triggerToConversation('ai:suggestion'); nothing extra to do here.

    return {
      decision: result.decision,
      messageId: result.messageId,
      conversationId,
    }
  },
)
