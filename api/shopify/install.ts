// ─── Shopify OAuth: Install (Vercel Function) ─────────────────────────────────
// GET /api/shopify/install?shop=<name>.myshopify.com
//
// Step 1 of the OAuth dance. We:
//   - validate the shop domain matches Shopify's hostname pattern
//   - mint a one-time state nonce (stored in Upstash with a 10-minute TTL)
//   - redirect the merchant to Shopify's authorize URL
//
// The state is verified — and consumed — in /api/shopify/callback.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { env } from '../../apps/api/src/lib/env'
import { randomToken } from '../../apps/api/src/lib/crypto'
import { upstash } from '../../apps/api/src/lib/upstash'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'
import { logger } from '../../apps/api/src/lib/logger'

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i

const INSTALL_STATE_TTL_SECONDS = 600 // 10 minutes
const stateKey = (state: string): string => `shopify:install:state:${state}`

interface InstallStateValue {
  shop: string
  createdAt: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const log = logger.child({ route: 'shopify/install' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Cheap per-IP throttle so this endpoint can't be used to spam Upstash
  // with state nonces.
  const ip = clientIp(req)
  try {
    await enforce(limits.perIpAuth(), ip || 'unknown')
  } catch {
    res.status(429).json({ error: 'Too many install attempts. Try again shortly.' })
    return
  }

  const shopRaw = pickQuery(req.query.shop)
  if (!shopRaw) {
    res.status(400).json({ error: 'Missing required ?shop parameter' })
    return
  }

  const shop = shopRaw.toLowerCase()
  if (!SHOP_DOMAIN_RE.test(shop)) {
    log.warn({ shop }, 'install rejected: invalid shop domain')
    res.status(400).json({ error: 'Invalid shop domain' })
    return
  }

  const state = randomToken(32)
  const value: InstallStateValue = { shop, createdAt: new Date().toISOString() }

  try {
    await upstash.set(stateKey(state), value, { ex: INSTALL_STATE_TTL_SECONDS })
  } catch (err) {
    log.error({ err }, 'failed to store install state')
    res.status(500).json({ error: 'Could not start install' })
    return
  }

  const redirectUri = `${env.SHOPIFY_APP_URL.replace(/\/$/, '')}/api/shopify/callback`
  const params = new URLSearchParams({
    client_id: env.SHOPIFY_API_KEY,
    scope: env.SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
    // Empty `grant_options[]=` = online access tokens are NOT requested,
    // i.e. we want a long-lived offline token. Per Shopify OAuth docs.
    'grant_options[]': '',
  })

  const authorizeUrl = `https://${shop}/admin/oauth/authorize?${params.toString()}`

  log.info({ shop, requestId: req.headers['x-request-id'] }, 'redirecting to Shopify authorize')

  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(302, { Location: authorizeUrl })
  res.end()
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function pickQuery(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0].trim()
  if (Array.isArray(fwd) && fwd.length) return fwd[0]
  return (req.socket?.remoteAddress as string | undefined) ?? ''
}
