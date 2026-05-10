# Secrets Runbook

Operational reference for every secret consumed by Sahay. For each entry:
**purpose**, **how to generate**, **how to rotate**, and the **Vercel env var
name(s)** to set in Project Settings → Environment Variables.

> Never commit a real value of any secret on this page. Use this runbook to
> regenerate one when needed. The CI job `npm run secrets:check` scans for
> patterns that look like leaked secrets and will fail the build.

---

## Rotation cadence

| Class | Cadence | Notes |
| --- | --- | --- |
| JWT signing keys (`JWT_SECRET`, `JWT_REFRESH_SECRET`) | every 90 days | Rotate during a low-traffic window; existing access tokens become invalid. |
| `ENCRYPTION_KEY` | every 90 days | Requires a dual-write migration if you have ciphertext at rest — see "Encryption key rotation" below. |
| Third-party API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`) | every 180 days | Or immediately on suspected leak / employee offboarding. |
| OAuth tokens issued to tenants (`shopify_access_token`, `wa_*`, `ig_*` per row in DB) | revoke on tenant uninstall + on suspected compromise | Stored encrypted at rest; not in env. |
| Webhook secrets (`SHOPIFY_WEBHOOK_SECRET`, `WA_APP_SECRET`, `IG_APP_SECRET`) | only when the upstream provider rotates | Coordinate the cutover with the provider's signing key change. |

After rotating in Vercel, redeploy production and remove the previous value
from "Preview" / "Development" environments to avoid drift.

---

## Auth & crypto

### `JWT_SECRET`
- **Purpose:** HMAC secret for signing short-lived access tokens.
- **Generate:** `openssl rand -base64 48`
- **Rotate:** Generate a new value, set in Vercel (Production), redeploy. All
  active sessions are invalidated; users must log in again. Optionally
  support a key-id grace window by deploying a verifier that accepts both
  old and new values for one rotation cycle.
- **Vercel env var:** `JWT_SECRET`

### `JWT_REFRESH_SECRET`
- **Purpose:** HMAC secret for long-lived refresh tokens (different from
  `JWT_SECRET` so a leaked access secret can't mint refreshes).
- **Generate:** `openssl rand -base64 48`
- **Rotate:** Same procedure as `JWT_SECRET`; refresh tokens issued under the
  old secret will fail on next refresh, forcing re-login.
- **Vercel env var:** `JWT_REFRESH_SECRET`

### `ENCRYPTION_KEY`
- **Purpose:** AES-GCM key wrapping all column-level secrets at rest (OAuth
  access tokens, Shopify session tokens, integration credentials).
- **Generate:** `openssl rand -base64 48`
- **Rotate (single-key):** Direct replacement only works if no ciphertext
  exists yet. Otherwise:
  1. Add the new key as `ENCRYPTION_KEY_NEXT`, deploy a release that decrypts
     with the old key and re-encrypts under the new one.
  2. Run a backfill job to walk every encrypted column.
  3. Promote `ENCRYPTION_KEY_NEXT` to `ENCRYPTION_KEY`, remove the old.
- **Vercel env var:** `ENCRYPTION_KEY`

---

## Storage

### `DATABASE_URL`
- **Purpose:** Postgres connection string (Neon / RDS / etc.). Includes the
  password.
- **Generate:** Provisioned by your Postgres provider; rotate the role's
  password through the provider's console.
- **Rotate:** Create a new role/password in the provider, update the env
  var, redeploy, then revoke the old role. For zero-downtime, dual-credential
  by deploying with the new URL while the old one still works, then drop
  the old role.
- **Vercel env var:** `DATABASE_URL`

### `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- **Purpose:** Upstash Redis — used by rate limiting, login lockout,
  install-state nonces, idempotency markers.
- **Generate:** Created by Upstash when you provision the database.
- **Rotate:** In the Upstash console click "Reset Token" for the database;
  copy the new token into Vercel and redeploy. The URL stays the same.
- **Vercel env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

### `R2_*` (Cloudflare R2 object storage)
- **Purpose:** S3-compatible storage for attachments, AI-generated assets.
- **Generate:** Cloudflare dashboard → R2 → "Manage R2 API Tokens" → create
  token with read/write to the bucket.
- **Rotate:** Create a new token, deploy with the new value, then delete the
  old token from the Cloudflare dashboard.
- **Vercel env vars:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`

---

## AI providers

### `ANTHROPIC_API_KEY`
- **Purpose:** Anthropic Claude API for primary chat / classification.
- **Generate:** Anthropic Console → API Keys → "Create Key".
- **Rotate:** Create a new key, deploy, then revoke the old one. Anthropic
  retains a per-key audit log; preserve before deletion if needed.
- **Vercel env var:** `ANTHROPIC_API_KEY`

### `OPENAI_API_KEY`
- **Purpose:** OpenAI fallback / embeddings.
- **Generate:** OpenAI dashboard → API keys → "Create new secret key".
- **Rotate:** New key, deploy, revoke old. Set per-key spend limits.
- **Vercel env var:** `OPENAI_API_KEY`

---

## Shopify

### `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`
- **Purpose:** OAuth client credentials for the Sahay Shopify app.
- **Generate:** Shopify Partner Dashboard → your app → "API credentials".
- **Rotate:** Use Partner Dashboard → "Rotate API credentials". This forces
  every connected store to re-authorise the app, so coordinate with users.
- **Vercel env vars:** `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`

### `SHOPIFY_WEBHOOK_SECRET`
- **Purpose:** HMAC verification of incoming Shopify webhooks.
- **Generate:** Provided by Shopify per app — same as `SHOPIFY_API_SECRET`
  for app-scoped webhooks.
- **Rotate:** Tied to the API secret rotation above.
- **Vercel env var:** `SHOPIFY_WEBHOOK_SECRET`

---

## WhatsApp Business / Meta

### `WA_ACCESS_TOKEN`
- **Purpose:** System-user permanent access token for sending WhatsApp
  messages and reading status.
- **Generate:** Meta Business Suite → Business Settings → System Users →
  "Generate New Token", scopes: `whatsapp_business_messaging`,
  `whatsapp_business_management`.
- **Rotate:** Generate a new token from the same system user, deploy,
  revoke the old token.
- **Vercel env var:** `WA_ACCESS_TOKEN`

### `WA_APP_SECRET`
- **Purpose:** HMAC verification of incoming WhatsApp webhooks.
- **Generate:** Meta App Dashboard → Settings → Basic → "App Secret".
- **Rotate:** Click "Reset" on the App Secret. Coordinate the deploy
  carefully — webhooks signed under the old secret will fail until rollout
  completes.
- **Vercel env var:** `WA_APP_SECRET`

### `WA_VERIFY_TOKEN`
- **Purpose:** Static string Meta echoes during webhook subscription. Not
  cryptographic, but must match in both places.
- **Generate:** `openssl rand -hex 24`
- **Rotate:** Set the new value in Vercel and in the Meta webhook config
  simultaneously.
- **Vercel env var:** `WA_VERIFY_TOKEN`

---

## Instagram

### `IG_APP_SECRET`
- **Purpose:** HMAC verification of incoming Instagram webhook events.
- **Generate:** Meta App Dashboard → Settings → Basic → "App Secret".
- **Rotate:** Same procedure as `WA_APP_SECRET`.
- **Vercel env var:** `IG_APP_SECRET`

### `IG_VERIFY_TOKEN`
- **Purpose:** Webhook subscription handshake.
- **Generate:** `openssl rand -hex 24`
- **Rotate:** Update in Vercel and Meta webhook config together.
- **Vercel env var:** `IG_VERIFY_TOKEN`

---

## Email (Resend)

### `RESEND_API_KEY`
- **Purpose:** Sends transactional email (login, alerts, digest).
- **Generate:** Resend dashboard → API Keys → "Create API Key" with "Sending
  access" scope.
- **Rotate:** New key, deploy, revoke old.
- **Vercel env var:** `RESEND_API_KEY`

---

## Sentry

### `SENTRY_DSN`
- **Purpose:** Public DSN for client+server error reporting. Not strictly
  secret but environment-specific.
- **Generate:** Sentry → Settings → Projects → Client Keys (DSN).
- **Rotate:** Click "Generate New Key" in Sentry; only required if a DSN is
  being abused for spam.
- **Vercel env var:** `SENTRY_DSN`

### `SENTRY_AUTH_TOKEN`
- **Purpose:** Build-time token for uploading source maps.
- **Generate:** Sentry → Settings → Account → Auth Tokens → "Create New
  Token", scope: `project:releases`.
- **Rotate:** Create new token, update Vercel, revoke old.
- **Vercel env var:** `SENTRY_AUTH_TOKEN`

---

## Pusher

### `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET`
- **Purpose:** Realtime fan-out for the agent inbox.
- **Generate:** Pusher Channels dashboard → your app → "App Keys".
- **Rotate:** Click "Refresh" beside the key/secret pair you want to
  rotate. This invalidates connected clients immediately, so plan a brief
  window or roll out a client-side reconnect first.
- **Vercel env vars:** `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`,
  `PUSHER_CLUSTER` (cluster is not secret, but kept here for completeness).

---

## Inngest

### `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`
- **Purpose:** Event ingestion and webhook signature verification for
  background workflows.
- **Generate:** Inngest dashboard → Manage → Event Keys / Signing Keys →
  "Create Key".
- **Rotate:** Create a new key, deploy, then revoke the old one. The
  signing key supports a brief overlap window (both old and new are valid
  for the rotation grace period).
- **Vercel env vars:** `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`

---

## Web Push (VAPID)

### `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
- **Purpose:** Identifies our backend as the legitimate sender of browser
  push notifications.
- **Generate:** `npx web-push generate-vapid-keys`
- **Rotate:** Rotating invalidates every existing browser subscription;
  clients must re-subscribe on next visit. Only do this on a confirmed
  leak.
- **Vercel env vars:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` (a `mailto:` URL identifying the project owner).

---

## Incident response

If you suspect a secret has leaked:

1. **Rotate immediately** using the procedure above for the specific secret.
   Do not wait for a CI run.
2. **Revoke the old value at the provider** so it cannot be used even if
   pulled from a cache or backup.
3. **Audit access logs** for the affected provider over the leak window.
4. **Run `npm run secrets:check`** locally and in CI to confirm no other
   patterns are leaking.
5. **Open a private postmortem issue** documenting blast radius, timeline,
   and any data potentially exposed.
