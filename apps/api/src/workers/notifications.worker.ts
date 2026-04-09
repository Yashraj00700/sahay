// ─── Notifications Worker ─────────────────────────────────────────────────────
// Consumes jobs from the notifications-push queue.
// Sends email notifications to agents via Resend when significant events occur.
//
// job.data: NotificationsJob
//   agentId        — agents.id to notify
//   type           — 'new_conversation' | 'escalation' | 'mention'
//   conversationId — referenced conversation (included in email body)
//   tenantId       — used for context (brand name, etc.)

import type { NotificationsJob } from '../lib/queues'
import { db, agents, tenants, conversations } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { logger } from '../lib/logger'

const resend = new Resend(process.env.RESEND_API_KEY)

const EVENT_SUBJECT: Record<NotificationsJob['type'], string> = {
  new_conversation: 'New conversation assigned to you',
  escalation:       'Escalation: conversation needs your attention',
  mention:          'You were mentioned in a conversation',
}

export async function processNotification(job: NotificationsJob): Promise<void> {
  const { agentId, type, conversationId, tenantId } = job

  logger.info(`[NotifWorker] type=${type} agent=${agentId} conv=${conversationId}`)

  // 1. Fetch agent details
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    columns: { email: true, name: true, notificationPrefs: true },
  })

  if (!agent) {
    logger.warn(`[NotifWorker] Agent ${agentId} not found, skipping`)
    return
  }

  // 2. Respect agent notification preferences
  const prefs = (agent.notificationPrefs ?? {}) as Record<string, boolean>
  if (prefs[type] === false) {
    logger.info(`[NotifWorker] Agent ${agentId} has disabled ${type} notifications`)
    return
  }

  // 3. Fetch supporting context
  const [tenant, conversation] = await Promise.all([
    db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { shopName: true },
    }),
    db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
      columns: { channel: true, status: true, primaryIntent: true },
    }),
  ])

  const brandName = tenant?.shopName ?? 'Your store'
  const convUrl = `${process.env.WEB_URL}/conversations/${conversationId}`
  const subject = EVENT_SUBJECT[type] ?? 'Sahay notification'

  const htmlBody = buildEmailHtml({
    agentName: agent.name,
    type,
    brandName,
    conversationId,
    convUrl,
    channel: conversation?.channel ?? 'unknown',
    intent: conversation?.primaryIntent ?? null,
  })

  // 4. Send via Resend
  const { error } = await resend.emails.send({
    from: 'Sahay <notifications@sahay.ai>',
    to: agent.email,
    subject: `[${brandName}] ${subject}`,
    html: htmlBody,
  })

  if (error) {
    throw new Error(`[NotifWorker] Resend error for agent ${agentId}: ${error.message}`)
  }

  logger.info(`[NotifWorker] Email sent to ${agent.email} — ${type}`)
}

// ─── Email HTML builder ───────────────────────────────────────────────────────

function buildEmailHtml(opts: {
  agentName: string
  type: NotificationsJob['type']
  brandName: string
  conversationId: string
  convUrl: string
  channel: string
  intent: string | null
}): string {
  const { agentName, type, brandName, convUrl, channel, intent } = opts

  const typeMessages: Record<NotificationsJob['type'], string> = {
    new_conversation: `A new <strong>${channel}</strong> conversation has been assigned to you.`,
    escalation:       `A <strong>${channel}</strong> conversation has been escalated and needs your immediate attention.`,
    mention:          `You were mentioned in a <strong>${channel}</strong> conversation.`,
  }

  const body = typeMessages[type] ?? 'A conversation needs your attention.'

  return `
<!DOCTYPE html>
<html>
  <body style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 24px;">
    <p>Hi ${agentName},</p>
    <p>${body}</p>
    ${intent ? `<p><strong>Intent:</strong> ${intent}</p>` : ''}
    <p style="margin-top: 24px;">
      <a href="${convUrl}"
         style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
        Open Conversation
      </a>
    </p>
    <p style="margin-top: 32px; font-size: 12px; color: #999;">
      This notification was sent by Sahay on behalf of ${brandName}.<br>
      To change your notification preferences, visit your account settings.
    </p>
  </body>
</html>
  `.trim()
}
