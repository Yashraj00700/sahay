// ─── AI Respond Worker ────────────────────────────────────────────────────────
// Consumes jobs from the ai:respond queue.
// Each job triggers the full AI pipeline: language → intent → sentiment → RAG → LLM → send.
//
// After runAIAgent() resolves:
//   auto_respond    → response already persisted + WhatsApp/IG send queued
//   draft_for_review → draft message in DB (is_ai_draft=true) + socket emit ai:suggestion
//   route_to_human  → conversation routing updated + socket notify agent
//   route_to_senior → same as above with escalation flag

import type { AIRespondJob } from '../lib/queues'
import { runAIPipeline } from '../services/ai/agent'
import { auditAction } from '../services/audit'
import { getIO } from '../lib/socket'
import { redis } from '../lib/redis'
import { db } from '@sahay/db'
import { conversations } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { logger } from '../lib/logger'

export async function processAIRespond(job: AIRespondJob): Promise<void> {
  const { tenantId, conversationId, messageId, forceHuman } = job

  logger.info(`[AIWorker] Processing conversation ${conversationId} (message ${messageId})`)

  // ─── Per-conversation distributed lock ──────────────────────────────────────
  // Prevents multiple workers from processing the same conversation in parallel,
  // which would cause out-of-order AI responses reaching the customer.
  const lockKey = `lock:conversation:${conversationId}`
  const lockToken = `${Date.now()}-${Math.random()}`
  const acquired = await redis.set(lockKey, lockToken, 'EX', 30, 'NX')

  if (!acquired) {
    // Another worker already holds the lock for this conversation. Throwing here
    // causes BullMQ to retry the job after its configured backoff delay.
    throw new Error(`Conversation locked — will retry (conversationId: ${conversationId})`)
  }

  try {
    // If operator flagged force-to-human (e.g. VIP opt-in) skip AI
    if (forceHuman) {
      logger.info(`[AIWorker] Force human flag set, skipping AI for ${conversationId}`)
      return
    }

    const result = await runAIPipeline(conversationId, tenantId, getIO() ?? undefined)

    logger.info(
      `[AIWorker] ✅ ${conversationId} — decision: ${result.decision}` +
      ` | intent: ${result.intent} | confidence: ${result.confidence.toFixed(2)}` +
      ` | language: ${result.language}`
    )

    // Audit every AI decision (DPDP compliance — AI decisions must be logged)
    await auditAction({
      tenantId,
      actorId: undefined,
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

  } catch (err) {
    logger.error({ err }, `[AIWorker] ❌ Failed for conversation ${conversationId}`)

    // On error: route to human so customer isn't left hanging
    try {
      await db.update(conversations)
        .set({
          routingDecision: 'route_to_human',
          escalationReason: 'ai_pipeline_error',
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId))

      await auditAction({
        tenantId,
        actorId: undefined,
        actorType: 'ai',
        action: 'ai.error_fallback_to_human',
        resourceType: 'conversation',
        resourceId: conversationId,
        metadata: { error: String(err), messageId },
      })
    } catch (fallbackErr) {
      logger.error({ err: fallbackErr }, '[AIWorker] Even fallback failed')
    }

    // Re-throw so BullMQ records the failure and retries (up to job.opts.attempts)
    throw err
  } finally {
    // Release the lock only if this worker still owns it (guards against
    // the TTL expiring and another worker acquiring it before we finish).
    const currentToken = await redis.get(lockKey)
    if (currentToken === lockToken) {
      await redis.del(lockKey)
    }
  }
}
