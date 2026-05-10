// ─── Shopify OAuth: Callback (Vercel Function) ────────────────────────────────
// GET /api/shopify/callback?code=&shop=&state=&hmac=&host=&timestamp=
//
// Step 2 of the OAuth dance:
//   1. validate shop domain pattern
//   2. validate the request HMAC (Shopify signs the redirect query string)
//   3. validate + consume the state nonce minted in /install
//   4. exchange code for an offline access token
//   5. encrypt + persist the token on the tenants row (upsert)
//   6. register mandatory webhooks (idempotent)
//   7. audit the install + redirect into the web onboarding flow

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { db, tenants } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { env } from '../../apps/api/src/lib/env'
import { encrypt } from '../../apps/api/src/lib/crypto'
import { upstash } from '../../apps/api/src/lib/upstash'
import { logger } from '../../apps/api/src/lib/logger'
import { auditAction } from '../../apps/api/src/services/audit'
import { registerMandatoryWebhooks } from '../../apps/api/src/services/shopify/webhooks'

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i
const stateKey = (state: string): string => `shopify:install:state:${state}`

interface InstallStateValue {
  shop: string
  createdAt: string
}

interface AccessTokenResponse {
  access_token: string
  scope: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const log = logger.child({ route: 'shopify/callback' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const q = req.query as Record<string, string | string[] | undefined>
  const shopRaw = pickQuery(q.shop)
  const code = pickQuery(q.code)
  const state = pickQuery(q.state)
  const hmac = pickQuery(q.hmac)

  // ─── 1. Shop domain validation ────────────────────────────────────────────
  if (!shopRaw || !code || !state || !hmac) {
    log.warn('callback missing required params')
    return errorRedirect(res, 'invalid_request')
  }
  const shop = shopRaw.toLowerCase()
  if (!SHOP_DOMAIN_RE.test(shop)) {
    log.warn({ shop }, 'callback rejected: invalid shop domain')
    return errorRedirect(res, 'invalid_shop')
  }

  // ─── 2. HMAC validation ───────────────────────────────────────────────────
  if (!verifyShopifyOAuthHmac(q, hmac, env.SHOPIFY_API_SECRET)) {
    log.warn({ shop }, 'callback HMAC mismatch')
    return errorRedirect(res, 'hmac_mismatch')
  }

  // ─── 3. State nonce — must exist + match shop, then delete (one-time) ─────
  let storedState: InstallStateValue | null
  try {
    // Upstash auto-deserialises JSON when set with an object.
    storedState = await upstash.get<InstallStateValue>(stateKey(state))
  } catch (err) {
    log.error({ err }, 'failed reading install state from Upstash')
    return errorRedirect(res, 'state_read_failed')
  }
  if (!storedState || storedState.shop !== shop) {
    log.warn({ shop }, 'callback state mismatch or expired')
    return errorRedirect(res, 'state_invalid')
  }
  // One-time use — delete immediately so a replay can't reuse it.
  try {
    await upstash.del(stateKey(state))
  } catch (err) {
    // Non-fatal: TTL will expire it shortly anyway.
    log.warn({ err }, 'failed to delete install state (non-fatal)')
  }

  // ─── 4. Exchange code for access token ────────────────────────────────────
  let tokenRes: AccessTokenResponse
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: env.SHOPIFY_API_KEY,
        client_secret: env.SHOPIFY_API_SECRET,
        code,
      }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      log.error({ shop, status: r.status, body: text.slice(0, 256) }, 'token exchange failed')
      return errorRedirect(res, 'token_exchange_failed')
    }
    tokenRes = (await r.json()) as AccessTokenResponse
  } catch (err) {
    log.error({ shop, err }, 'token exchange transport error')
    return errorRedirect(res, 'token_exchange_failed')
  }

  if (!tokenRes.access_token) {
    log.error({ shop }, 'token exchange returned no access_token')
    return errorRedirect(res, 'token_exchange_failed')
  }

  const encryptedToken = encrypt(tokenRes.access_token)

  // ─── 5. Upsert tenant row ─────────────────────────────────────────────────
  let tenantId: string
  let isNewInstall = false
  try {
    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.shopifyDomain, shop),
    })

    if (existing) {
      await db
        .update(tenants)
        .set({
          shopifyAccessToken: encryptedToken,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, existing.id))
      tenantId = existing.id
    } else {
      isNewInstall = true
      const inserted = await db
        .insert(tenants)
        .values({
          shopifyDomain: shop,
          shopifyAccessToken: encryptedToken,
          shopName: shop.replace(/\.myshopify\.com$/i, ''),
          plan: 'trial',
          isActive: true,
          // Default 14-day trial; onboarding flow can extend.
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        })
        .returning({ id: tenants.id })
      tenantId = inserted[0].id
    }
  } catch (err) {
    log.error({ shop, err }, 'tenant upsert failed')
    return errorRedirect(res, 'tenant_persist_failed')
  }

  // ─── 6. Register webhooks (idempotent) ────────────────────────────────────
  try {
    await registerMandatoryWebhooks(shop, tokenRes.access_token)
  } catch (err) {
    // Non-fatal for the install itself: onboarding can retry. Log + continue.
    log.error({ shop, err }, 'webhook registration failed; will need retry from onboarding')
  }

  // ─── 7. Audit + redirect ──────────────────────────────────────────────────
  await auditAction({
    tenantId,
    actorType: 'system',
    action: isNewInstall ? 'shopify.install' : 'shopify.reinstall',
    resourceType: 'tenant',
    resourceId: tenantId,
    metadata: { shop, scope: tokenRes.scope },
    ipAddress: clientIp(req),
    userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
  })

  const onboardingUrl = `${env.WEB_URL.replace(/\/$/, '')}/onboarding?shop=${encodeURIComponent(shop)}&installed=1`
  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(302, { Location: onboardingUrl })
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

function errorRedirect(res: VercelResponse, code: string): void {
  const target = `${env.WEB_URL.replace(/\/$/, '')}/onboarding?error=${encodeURIComponent(code)}`
  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(302, { Location: target })
  res.end()
}

/**
 * Validate Shopify's redirect-query HMAC.
 * Per Shopify docs: take all query params except `hmac` (and `signature`),
 * sort lexicographically, join as `key=value&key2=value2`, then HMAC-SHA256
 * with the API secret. Compare hex.
 */
function verifyShopifyOAuthHmac(
  q: Record<string, string | string[] | undefined>,
  providedHex: string,
  secret: string,
): boolean {
  const entries: Array<[string, string]> = []
  for (const [k, v] of Object.entries(q)) {
    if (k === 'hmac' || k === 'signature') continue
    if (v === undefined) continue
    const value = Array.isArray(v) ? v[0] : v
    if (value === undefined) continue
    entries.push([k, value])
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const message = entries.map(([k, v]) => `${k}=${v}`).join('&')

  const expected = createHmac('sha256', secret).update(message).digest()
  let provided: Buffer
  try {
    provided = Buffer.from(providedHex, 'hex')
  } catch {
    return false
  }
  if (provided.length !== expected.length) return false
  return timingSafeEqual(expected, provided)
}
