# Sahay — Production Deployment Runbook

This runbook is the canonical procedure for taking Sahay from a fresh
Vercel/Neon/Upstash account to a working production deployment. Follow it
in order — every step assumes the previous step succeeded.

The architecture is **Vercel-only**: all HTTP traffic (web SPA + Vercel
Functions for the API + webhooks) runs on Vercel. Persistent processes
(Postgres, queues, realtime, push) are delegated to managed services.

---

## 1. External services

Provision these accounts and capture credentials before touching code.

| Service                 | What it does                                       | Plan                                                       |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| **Vercel**              | Hosts the web app + API functions                  | Pro for production (>10s function timeouts, log retention) |
| **Neon**                | Postgres + pgvector                                | Launch ($19/mo) — autoscaling is fine                      |
| **Upstash Redis**       | Rate limits + install nonces + embedding cache     | Pay-as-you-go (free tier covers MVP)                       |
| **Pusher Channels**     | Realtime fanout to agent inboxes                   | Sandbox while testing; Startup ($49/mo) for prod traffic   |
| **Inngest**             | Queues + cron + retries                            | Free tier ≤ 50k events/mo                                  |
| **Anthropic**           | Claude (AI agent)                                  | Console workspace + production rate-limit increase         |
| **OpenAI**              | text-embedding-3-small                             | Standard org + small rate limit increase                   |
| **Resend**              | Transactional email (password reset, agent invite) | Free tier (3000/mo) for MVP                                |
| **Sentry**              | Error monitoring                                   | Team plan ($26/mo) for source maps + replays               |
| **Cloudflare R2**       | Media storage (WhatsApp images, voice notes)       | Pay-as-you-go                                              |
| **Meta for Developers** | WhatsApp Cloud API + Instagram Messaging           | App in production mode                                     |
| **Shopify Partners**    | Public app + OAuth                                 | Production app listing                                     |

---

## 2. Database (Neon)

1. Create a Neon project. Note the connection string (it'll look like
   `postgres://USER:PWD@ep-...pooler.region.aws.neon.tech/DB?sslmode=require`).
2. Run migrations from your laptop:
   ```bash
   export DATABASE_URL=...
   npm install --legacy-peer-deps
   npm run db:migrate:prod --workspace=@sahay/db
   ```
3. Apply the pgvector + RLS migrations (they're already in
   `packages/db/drizzle/`). The migrate-prod script picks them up
   automatically.
4. Provision two roles:
   - The default user Neon gave you has `BYPASSRLS` by default. **Change
     this.** Run:
     ```sql
     ALTER ROLE <neon_user> NOBYPASSRLS;
     ```
     so that the application connection respects RLS.
   - For Inngest cron / GDPR redaction tasks that need cross-tenant
     reads, the migration created `sahay_app_bypass`. Set a password and
     create a separate connection string for system tasks. Save it as
     `DATABASE_URL_BYPASS` in Vercel env (only Inngest functions read
     this; routes never do).

---

## 3. Redis (Upstash)

1. Create a Redis database in Upstash. Pick the region closest to your
   Vercel deployment (typically `ap-south-1` for India, `us-east-1` for
   global).
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. These
   are HTTP, not TCP — they work from serverless Functions without a
   connection pool.

---

## 4. Realtime (Pusher Channels)

1. Create a Pusher Channels app. Choose `ap2` cluster (Mumbai) for
   India-first traffic.
2. Capture: `app_id`, `key`, `secret`, `cluster`. The `key` and
   `cluster` are also exposed to the web client as
   `VITE_PUSHER_KEY` / `VITE_PUSHER_CLUSTER`.
3. In Pusher dashboard, set the **client event** rate limit and enable
   **client events** if agents need to send typing indicators directly.

---

## 5. Queues + cron (Inngest)

1. Create an Inngest app at https://app.inngest.com.
2. Capture the **Event Key** (write key) and **Signing Key** (verifies
   the webhook from Inngest's servers to ours).
3. Add the Vercel deployment URL: settings → apps → "Sync new app" →
   point at `https://<your-domain>/api/inngest`. Inngest will fetch the
   function manifest and register all 25 functions + 3 cron jobs
   automatically.

---

## 6. Storage (Cloudflare R2)

1. Create an R2 bucket: `sahay-media-prod`.
2. Generate an API token scoped to this bucket only. Capture
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
3. Configure a public custom domain (e.g.,
   `media.sahay.ai`) so customers receive direct media URLs in
   conversations. Save as `R2_PUBLIC_URL`.

---

## 7. Email (Resend)

1. Create a Resend project.
2. Verify the `sahay.ai` domain (DKIM + SPF + DMARC). Wait for green
   "verified" status.
3. Create an API key with **send-only** scope. Save as `RESEND_API_KEY`.
4. Set `EMAIL_FROM=noreply@sahay.ai`.

---

## 8. Error monitoring (Sentry)

1. Create two Sentry projects: `sahay-api` (Node) and `sahay-web`
   (browser/React).
2. Copy each DSN:
   - Server uses `SENTRY_DSN` (from `sahay-api`)
   - Web uses `VITE_SENTRY_DSN` (from `sahay-web`)
3. Create a Sentry auth token with `project:releases` scope. Save as
   `SENTRY_AUTH_TOKEN` (build-time only — used by CI to upload source
   maps; never read at runtime).

---

## 9. Web Push (VAPID)

```bash
npx web-push generate-vapid-keys
```

Save outputs as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set
`VAPID_SUBJECT=mailto:noreply@sahay.ai`.

---

## 10. AI providers

- `ANTHROPIC_API_KEY` — Workbench → API keys. Request **Tier 4** rate
  limits before launch.
- `OPENAI_API_KEY` — Platform → API keys. Org-scoped; restrict to
  `embeddings` if possible.

---

## 11. Channel integrations

### WhatsApp Cloud API

1. Create a Meta app of type **Business** with the WhatsApp product.
2. Add a phone number, verify, request production access.
3. Capture: `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN` (System User token,
   never the temporary one), `WA_VERIFY_TOKEN` (any random 32+ char
   string), `WA_APP_SECRET` (App Settings → Basic).
4. Configure webhook: `https://<domain>/api/webhooks/whatsapp`,
   verify_token = your random string, subscribe to `messages` field.

### Instagram Messaging

1. Connect an Instagram **Business** account to a Facebook page.
2. In the same Meta app, add the Instagram Messaging product.
3. Capture `IG_APP_ID`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN`.
4. Webhook URL: `https://<domain>/api/webhooks/instagram`. Subscribe to
   `messages`, `messaging_postbacks`, `messaging_seen`.

### Shopify

1. Create a public app at https://partners.shopify.com.
2. App URL: `https://<domain>/onboarding`
3. Allowed redirection URL: `https://<domain>/api/shopify/callback`
4. Required access scopes: `read_orders, write_orders, read_customers,
write_customers, read_products, write_products, read_fulfillments,
read_inventory, write_draft_orders`
5. Capture `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`. The webhook
   handler validates HMAC with the API secret (also exported as
   `SHOPIFY_WEBHOOK_SECRET` in env).

---

## 12. Vercel project setup

1. Connect the GitHub repo to Vercel. Pick the `main` branch.
2. **Framework preset**: leave as "Other" — `vercel.json` controls everything.
3. **Build command**: `npm run build --workspace=@sahay/web` (already in vercel.json).
4. **Output directory**: `apps/web/dist`.
5. **Install command**: `npm install --legacy-peer-deps`.
6. **Environment variables**: copy every value from `.env.example` and
   fill them in. Mark as Production-scoped. See `SECRETS.md` for what
   each variable does and how to rotate it.
7. Create separate **Preview** scope for staging. Use a separate Neon
   branch + separate Upstash DB + separate Pusher app for staging.
8. **Functions**: confirm `vercel.json` `functions` block applied (1024
   MB / 60s for normal routes, 1024 MB / 300s for `/api/inngest`).
9. **Domains**: configure `app.sahay.ai` (web) and ensure all webhook
   URLs above point to it.

---

## 13. CI/CD

The `.github/workflows/` directory is already set up:

- `ci.yml` — runs lint, typecheck, format-check, tests, build,
  no-secrets check, and migrate-check on every PR + push to main.
- `deploy-preview.yml` — on PR open/sync, deploys a Vercel preview and
  comments the URL.
- `deploy-prod.yml` — on push to `main` AFTER ci.yml is green, deploys
  to production and creates a Sentry release.

Required GitHub secrets:

- `VERCEL_TOKEN` (account → tokens)
- `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (project settings → general)
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (optional —
  release step is skipped if missing)

---

## 14. First production deploy

1. Merge the green PR to `main`. CI runs, then `deploy-prod` triggers.
2. Watch the Vercel deploy log. Confirm:
   - Build succeeds
   - Functions deploy (look for `api/auth/login`, `api/inngest`, etc. in
     the function inventory)
3. Hit `/api/health` — should return `{ status: "ok" }`.
4. Hit `/api/ready` — should return `{ ok: true, probes: [...] }` with
   db/redis/anthropic all `ok: true`.
5. In Inngest dashboard, click "Sync app" to register all 25 functions.
6. In Shopify Partners, install the app on a test store. Verify:
   - Redirect to `/api/shopify/install` succeeds
   - Callback creates a tenant row in Neon
   - All 13 mandatory webhooks register (Shopify Partners → app → webhooks)
7. Send a WhatsApp message to your registered phone number. Verify:
   - Webhook arrives (Vercel function log)
   - Inngest event fires (Inngest dashboard → events)
   - AI agent runs the pipeline (Inngest function log)
   - Response is sent (check WhatsApp client)
8. Open the inbox in two browsers, send a test message in one, confirm
   it appears in the other instantly (Pusher).

---

## 15. Post-launch monitoring

- **Sentry**: alert on error rate > 1% per route per 10 minutes.
- **Inngest**: alert on function failure rate > 5%.
- **Vercel**: alert on function p99 > 5s and on edge errors.
- **Neon**: alert on connection-pool saturation and on > 10s queries.
- **Upstash**: alert on > 80% memory.

Operational dashboards:

- Vercel Analytics for traffic
- Inngest dashboard for queue depth + cron health
- Sentry for error trends
- Neon dashboard for query performance

---

## 16. Rollback

There's no `git revert + redeploy` lever for the database. To roll back:

1. Revert the offending commit on `main`. CI will redeploy Vercel
   automatically.
2. If the issue is a bad migration, restore Neon to the last good
   point-in-time (Neon dashboard → branch → restore).
3. Inngest functions are idempotent and re-run safely after rollback —
   no special action needed.

---

## 17. Tear-down (test environments only)

1. Delete the Vercel project.
2. Delete Neon branch (or whole project).
3. Delete Upstash Redis DB.
4. Revoke API keys in Anthropic/OpenAI/Resend/Sentry/R2/Pusher/Inngest
   so they can't be reused if leaked.
5. Uninstall the Shopify app from any test stores.
