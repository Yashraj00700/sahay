// ─── Instagram Messaging API Adapter ─────────────────────────────────────────
// Wraps outgoing calls to the Instagram Messaging API
// (graph.facebook.com/v19.0/me/messages). Mirrors the shape of
// whatsapp.adapter.ts but scoped to Instagram's payload schema.
//
// Auth: Instagram messaging uses a Page Access Token passed as the
// `access_token` query parameter. The caller is responsible for decrypting
// the token (e.g. via crypto.decrypt) before invoking these helpers.
//
// The functions below intentionally do NOT depend on a global SDK — plain
// fetch is sufficient and keeps cold-starts in Vercel Functions snappy.

import { IntegrationError } from '../../lib/errors'

const IG_API_BASE = 'https://graph.facebook.com/v19.0'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IGTextMessage {
  text: string
}

export interface IGAttachmentMessage {
  attachment: {
    type: 'image' | 'video' | 'audio' | 'file' | 'template'
    payload: Record<string, unknown>
  }
}

export type IGOutgoingMessage = IGTextMessage | IGAttachmentMessage

export interface SendInstagramMessageParams {
  /** Tenant whose page is sending — used only for logging context. */
  tenantId: string
  /** Page Access Token (already decrypted). */
  accessToken: string
  /** IG-scoped recipient PSID, taken from webhook ev.sender.id. */
  recipientId: string
  /** Either { text } or { attachment } payload. */
  message: IGOutgoingMessage
  /**
   * Messaging type. 'RESPONSE' is for replies within the 24h window, which
   * is the most common case for inbound-driven flows. Tenants doing outbound
   * outreach should pass 'MESSAGE_TAG' or 'UPDATE' as appropriate.
   */
  messagingType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG'
}

export interface SendInstagramMessageResult {
  ok: boolean
  messageId?: string
  recipientId?: string
  error?: string
}

export interface SendInstagramTypingParams {
  accessToken: string
  recipientId: string
  action: 'typing_on' | 'typing_off' | 'mark_seen'
}

interface IGSendApiSuccess {
  recipient_id?: string
  message_id?: string
}

interface IGSendApiError {
  error: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function igPost(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const url = `${IG_API_BASE}${path}?access_token=${encodeURIComponent(accessToken)}`

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // 15s mirrors the WhatsApp adapter — Meta typically responds in <2s.
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw new IntegrationError(
      'instagram',
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  }

  const text = await resp.text()
  let parsed: unknown
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }

  if (!resp.ok) {
    const errBody = (parsed as IGSendApiError | null)?.error
    const detail = errBody
      ? `${errBody.code ?? '?'}: ${errBody.message ?? 'unknown'} (fbtrace ${errBody.fbtrace_id ?? 'n/a'})`
      : `HTTP ${resp.status}: ${text.slice(0, 500)}`
    throw new IntegrationError('instagram', detail)
  }

  return parsed
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a message to an IG user. Returns a structured result rather than
 * throwing on non-2xx (callers may want to record the failure on the message
 * row before bubbling up). Network / programmer errors still throw via
 * IntegrationError.
 */
export async function sendInstagramMessage(
  params: SendInstagramMessageParams,
): Promise<SendInstagramMessageResult> {
  const {
    accessToken,
    recipientId,
    message,
    messagingType = 'RESPONSE',
  } = params

  const body: Record<string, unknown> = {
    recipient: { id: recipientId },
    message,
    messaging_type: messagingType,
  }

  try {
    const data = (await igPost('/me/messages', accessToken, body)) as IGSendApiSuccess
    return {
      ok: true,
      messageId: data.message_id,
      recipientId: data.recipient_id ?? recipientId,
    }
  } catch (err) {
    if (err instanceof IntegrationError) {
      return { ok: false, error: err.message }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Send a typing indicator (or mark-seen) sender_action.
 * https://developers.facebook.com/docs/messenger-platform/instagram/features/typing-indicator
 */
export async function sendInstagramTypingIndicator(
  params: SendInstagramTypingParams,
): Promise<void> {
  const { accessToken, recipientId, action } = params
  await igPost('/me/messages', accessToken, {
    recipient: { id: recipientId },
    sender_action: action,
  })
}
