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
import { db } from '@sahay/db'
import { conversations } from '@sahay/db'
import { eq } from 'drizzle-orm'

export async function processAIRespond(job: AIRespondJob): Promise<void> {
  const { tenantId, conversationId, messageId, forceHuman } = job

  console.log(`[AIWorker] Processing conversation ${conversationId} (message ${messageId})`)

  try {
    // If operator flagged force-to-human (e.g. VIP opt-in) skip AI
    if (forceHuman) {
      console.log(`[AIWorker] Force human flag set, skipping AI for ${conversationId}`)
      return
    }

    const result = await runAIPipeline(conversationId, tenantId, getIO())

    console.log(
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
    console.error(`[AIWorker] ❌ Failed for conversation ${conversationId}:`, err)

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
      console.error('[AIWorker] Even fallback failed:', fallbackErr)
    }

    // Re-throw so BullMQ records the failure and retries (up to job.opts.attempts)
    throw err
  }
}
