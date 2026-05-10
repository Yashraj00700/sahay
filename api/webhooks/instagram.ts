// ─── Instagram Messaging Webhook (Vercel Function) ───────────────────────────
// Replaces the 9-line stub at apps/api/src/routes/webhooks/instagram.ts.
//
//  GET  → Meta verification handshake. Compares hub.verify_token against
//         env.IG_VERIFY_TOKEN (Meta uses one verify token per app subscription
//         for Instagram, unlike WhatsApp which lets us scope per-tenant via
//         the WABA verify token).
//  POST → Incoming messaging events from Instagram Graph API. The handler
//         verifies the x-hub-signature-256 HMAC against IG_APP_SECRET, looks
//         up the tenant by instagramPageId (entry.id == FB Page ID), and fans
//         message/postback events out to Inngest. Read/delivery receipts are
//         logged and skipped. ALWAYS responds 200 quickly so Meta does not
//         retry. All real processing happens in Inngest functions.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db, tenants } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { env } from '../../apps/api/src/lib/env'
import { verifyHmacSha256 } from '../../apps/api/src/lib/crypto'
import { readRawBody } from '../../apps/api/src/lib/raw-body'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'
import { logger } from '../../apps/api/src/lib/logger'
import { sendEvent } from '../../apps/api/src/inngest/client'

// Required so we can compute HMAC over the exact bytes Meta signed.
export const config = { api: { bodyParser: false } }

// ─── Webhook payload shape (subset we care about) ────────────────────────────

interface IGMessageAttachment {
  type: string
  payload?: { url?: string; sticker_id?: number; [key: string]: unknown }
}

interface IGMessage {
  mid?: string
  text?: string
  attachments?: IGMessageAttachment[]
  quick_reply?: { payload: string }
  reply_to?: { mid: string }
  is_echo?: boolean
  is_deleted?: boolean
  is_unsupported?: boolean
}

interface IGPostback {
  mid?: string
  title?: string
  payload?: string
}

interface IGRead {
  mid?: string
  watermark?: number
}

interface IGDelivery {
  mids?: string[]
  watermark?: number
}

interface IGMessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: IGMessage
  postback?: IGPostback
  read?: IGRead
  delivery?: IGDelivery
  [key: string]: unknown
}

interface IGEntry {
  id: string
  time?: number
  messaging?: IGMessagingEvent[]
  changes?: Array<{ field: string; value: Record<string, unknown> }>
}

interface IGPayload {
  object?: string
  entry?: IGEntry[]
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const log = logger.child({ webhook: 'instagram', method: req.method })

  if (req.method === 'GET') {
    handleVerification(req, res, log)
    return
  }

  if (req.method === 'POST') {
    let rawBody: Buffer
    try {
      rawBody = await readRawBody(req)
    } catch (err) {
      log.error({ err }, 'Failed to read Instagram webhook body')
      // Still respond 200 so Meta doesn't retry on transport errors.
      res.status(200).send('EVENT_RECEIVED')
      return
    }

    const signature = req.headers['x-hub-signature-256']
    const sigHeader = Array.isArray(signature) ? signature[0] : signature

    // Acknowledge immediately. Per Meta docs: respond 200 fast or they retry.
    res.status(200).send('EVENT_RECEIVED')

    try {
      await processInstagramPost(rawBody, sigHeader)
    } catch (err) {
      log.error({ err }, 'Error processing Instagram webhook')
    }
    return
  }

  res.setHeader('Allow', 'GET,POST')
  res.status(405).json({ error: 'Method not allowed' })
}

// ─── GET: Meta verification handshake ────────────────────────────────────────

function handleVerification(
  req: VercelRequest,
  res: VercelResponse,
  log: import('pino').Logger,
): void {
  const q = req.query as Record<string, string | string[] | undefined>
  const mode = pickQuery(q['hub.mode'])
  const token = pickQuery(q['hub.verify_token'])
  const challenge = pickQuery(q['hub.challenge'])

  if (mode !== 'subscribe' || !token) {
    res.status(400).send('Invalid mode')
    return
  }

  // Instagram uses a single app-level verify token (env.IG_VERIFY_TOKEN);
  // unlike WhatsApp there is no per-tenant verify token column on tenants.
  if (token !== env.IG_VERIFY_TOKEN) {
    log.warn('Instagram verify token mismatch')
    res.status(403).send('Verification token mismatch')
    return
  }

  res.status(200).send(challenge ?? '')
}

// ─── POST: HMAC-verified async fan-out ───────────────────────────────────────

async function processInstagramPost(
  rawBody: Buffer,
  sigHeader: string | undefined,
): Promise<void> {
  const log = logger.child({ webhook: 'instagram' })

  if (!sigHeader || !sigHeader.startsWith('sha256=')) {
    log.warn('Instagram webhook missing/invalid signature header')
    return
  }

  const sigHex = sigHeader.slice('sha256='.length)
  const valid = verifyHmacSha256(rawBody, sigHex, env.IG_APP_SECRET, 'hex')
  if (!valid) {
    log.warn('Instagram webhook HMAC verification failed')
    return
  }

  let body: IGPayload
  try {
    body = JSON.parse(rawBody.toString('utf8')) as IGPayload
  } catch (err) {
    log.error({ err }, 'Instagram webhook JSON parse failed')
    return
  }

  const sends: Array<Promise<unknown>> = []

  for (const entry of body.entry ?? []) {
    const pageId = entry.id
    if (!pageId) continue

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.instagramPageId, pageId),
    })
    if (!tenant) {
      log.warn({ pageId }, 'No tenant found for Instagram page ID')
      continue
    }

    try {
      await enforce(limits.perWebhookSource(), `ig:${tenant.id}`)
    } catch (err) {
      log.warn({ tenantId: tenant.id, err }, 'Instagram webhook rate limited')
      continue
    }

    // Inbox messages / postbacks come via entry.messaging[]
    for (const ev of entry.messaging ?? []) {
      // Skip echoes — these are messages the page itself sent (we already
      // know about those because we sent them).
      if (ev.message?.is_echo) {
        log.debug({ mid: ev.message?.mid }, 'Instagram message echo, skipping')
        continue
      }

      // Read / delivery receipts: log and skip (no Inngest event for them).
      if (ev.read || ev.delivery) {
        log.debug(
          {
            tenantId: tenant.id,
            kind: ev.read ? 'read' : 'delivery',
            sender: ev.sender?.id,
          },
          'Instagram receipt event (skipped)',
        )
        continue
      }

      const hasMessage =
        ev.message != null &&
        (typeof ev.message.text === 'string' ||
          (Array.isArray(ev.message.attachments) && ev.message.attachments.length > 0))
      const hasPostback = ev.postback != null

      if (!hasMessage && !hasPostback) {
        log.debug({ ev }, 'Instagram messaging event with no message/postback, skipping')
        continue
      }

      sends.push(
        sendEvent({
          name: 'instagram/message.received',
          data: {
            tenantId: tenant.id,
            raw: { ...ev, _pageId: pageId } as Record<string, unknown>,
          },
        }),
      )
    }

    // entry.changes[] is used for story replies / mentions / comments. Forward
    // them through the same Inngest event so downstream functions can branch.
    for (const change of entry.changes ?? []) {
      sends.push(
        sendEvent({
          name: 'instagram/message.received',
          data: {
            tenantId: tenant.id,
            raw: {
              _pageId: pageId,
              _kind: 'change',
              field: change.field,
              value: change.value,
            } as Record<string, unknown>,
          },
        }),
      )
    }
  }

  // Fire all Inngest sends in parallel; failures shouldn't block Meta retries
  // but we do want them in the logs.
  const results = await Promise.allSettled(sends)
  for (const r of results) {
    if (r.status === 'rejected') {
      log.error({ reason: r.reason }, 'Failed to enqueue Instagram Inngest event')
    }
  }
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function pickQuery(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}
