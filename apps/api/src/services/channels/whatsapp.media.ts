/**
 * WhatsApp Cloud API → Cloudflare R2 media re-host adapter.
 *
 * Inbound WhatsApp webhooks only carry a media ID. To actually render the
 * attachment in the agent dashboard (and to keep it after Meta's 30-day
 * retention window), we have to:
 *
 *   1. GET https://graph.facebook.com/v19.0/<mediaId>  (bearer token)
 *      → { url, mime_type, sha256, file_size, id }
 *   2. GET that `url` with the same bearer
 *      → raw bytes (≤ 16 MiB by WA policy)
 *   3. Upload bytes to R2 under our deterministic per-tenant key
 *   4. Return the canonical public URL + metadata
 *
 * Failure modes:
 *   - missing R2 config (dev): caller should detect via `isR2Configured()`
 *     and fall back to a placeholder URL — we throw IntegrationError here.
 *   - oversize, network, auth: throw IntegrationError with `whatsapp_media`
 *     prefix so the inngest pipeline can wrap the step and continue.
 *
 * All requests are wrapped in an AbortController so a stuck Meta endpoint
 * cannot wedge an Inngest worker.
 */

import { IntegrationError } from '../../lib/errors'
import { logger } from '../../lib/logger'
import {
  isR2Configured,
  keyFor,
  putObject,
  MAX_FILE_SIZE_BYTES,
} from '../storage/r2'

// ─── Constants ────────────────────────────────────────────────────────────────

const WA_GRAPH_BASE = 'https://graph.facebook.com/v19.0'

/**
 * Hard ceiling on the entire fetch+upload round-trip. Inngest steps already
 * have their own timeout, but we want to surface a clean error before the
 * platform kills the worker mid-flight.
 */
const MEDIA_FETCH_TIMEOUT_MS = 30_000

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FetchAndStoreWhatsAppMediaArgs {
  /** Media ID from the inbound webhook (msg.image.id, msg.audio.id, …). */
  mediaId: string
  /** WhatsApp access token for the tenant's WABA (already decrypted). */
  accessToken: string
  /** Tenant the media belongs to — used for the R2 key. */
  tenantId: string
  /** DB messages.id we're attaching this media to — used for the R2 key. */
  messageId: string
}

export interface FetchAndStoreWhatsAppMediaResult {
  /** Public R2 URL to be persisted on the message row. */
  url: string
  /** R2 object key (relative to bucket). */
  key: string
  /** MIME type as reported by Meta. */
  mimeType: string
  /** Final byte size of the stored object. */
  size: number
  /** Optional sha256 from Meta (hex). Useful for dedupe / integrity checks. */
  sha256?: string
}

interface WAMediaMetadata {
  url: string
  mime_type: string
  sha256?: string
  file_size?: number
  id?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a MIME type to a sane file extension. We can't trust the original
 * filename (it's not always present and can contain attacker-controlled
 * characters) so we always derive the extension server-side.
 */
function extFromMime(mime: string): string {
  const lower = mime.toLowerCase().split(';')[0].trim()
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
    'text/plain': 'txt',
  }
  return map[lower] ?? 'bin'
}

/**
 * Wraps `fetch` with an AbortController-backed timeout. The returned response
 * will reject with an IntegrationError if the request exceeds `timeoutMs`.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  context: string,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new IntegrationError(
        'whatsapp_media',
        `${context}: request timed out after ${timeoutMs}ms`,
      )
    }
    throw new IntegrationError(
      'whatsapp_media',
      `${context}: ${(err as Error).message}`,
      err,
    )
  } finally {
    clearTimeout(timer)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function fetchAndStoreWhatsAppMedia(
  args: FetchAndStoreWhatsAppMediaArgs,
): Promise<FetchAndStoreWhatsAppMediaResult> {
  const { mediaId, accessToken, tenantId, messageId } = args

  if (!mediaId) {
    throw new IntegrationError('whatsapp_media', 'mediaId is required')
  }
  if (!accessToken) {
    throw new IntegrationError('whatsapp_media', 'accessToken is required')
  }
  if (!isR2Configured()) {
    throw new IntegrationError('whatsapp_media', 'R2 not configured')
  }

  // 1. Fetch media metadata from Meta (URL is short-lived — minutes).
  const metaUrl = `${WA_GRAPH_BASE}/${encodeURIComponent(mediaId)}`
  const metaRes = await fetchWithTimeout(
    metaUrl,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    MEDIA_FETCH_TIMEOUT_MS,
    'metadata',
  )

  if (!metaRes.ok) {
    const text = await metaRes.text().catch(() => '')
    throw new IntegrationError(
      'whatsapp_media',
      `metadata HTTP ${metaRes.status}: ${text.slice(0, 200)}`,
    )
  }

  const meta = (await metaRes.json().catch(() => null)) as WAMediaMetadata | null
  if (!meta || typeof meta.url !== 'string' || typeof meta.mime_type !== 'string') {
    throw new IntegrationError(
      'whatsapp_media',
      'metadata response missing url/mime_type',
    )
  }

  if (typeof meta.file_size === 'number' && meta.file_size > MAX_FILE_SIZE_BYTES) {
    throw new IntegrationError(
      'whatsapp_media',
      `media exceeds ${MAX_FILE_SIZE_BYTES} bytes (reported ${meta.file_size})`,
    )
  }

  // 2. Download bytes. Meta's CDN also requires the bearer token.
  const binRes = await fetchWithTimeout(
    meta.url,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    MEDIA_FETCH_TIMEOUT_MS,
    'download',
  )

  if (!binRes.ok) {
    throw new IntegrationError(
      'whatsapp_media',
      `download HTTP ${binRes.status}`,
    )
  }

  const arrayBuf = await binRes.arrayBuffer()
  const body = new Uint8Array(arrayBuf)
  if (body.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new IntegrationError(
      'whatsapp_media',
      `downloaded media exceeds ${MAX_FILE_SIZE_BYTES} bytes`,
    )
  }

  // 3. Upload to R2.
  const ext = extFromMime(meta.mime_type)
  const key = keyFor({ tenantId, channel: 'whatsapp', messageId, ext })
  const stored = await putObject({
    key,
    body,
    contentType: meta.mime_type,
  })

  logger.info(
    {
      mediaId,
      tenantId,
      messageId,
      key: stored.key,
      size: stored.size,
      mimeType: meta.mime_type,
    },
    'whatsapp_media: stored',
  )

  return {
    url: stored.url,
    key: stored.key,
    mimeType: meta.mime_type,
    size: stored.size,
    sha256: meta.sha256,
  }
}
