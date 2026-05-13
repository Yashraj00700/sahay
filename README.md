# Sahay

AI customer-support platform for Indian D2C brands. Handles WhatsApp,
Instagram, and web chat with a Claude-powered agent that speaks Hinglish,
syncs orders/customers with Shopify, and escalates the ambiguous cases to
human agents in a live inbox.

**Architecture:** Vercel-only deploy. Vercel Functions for HTTP, Inngest for
queues + cron, Pusher for realtime, Neon (Postgres + pgvector) for storage,
Upstash Redis for rate limits + cache, R2 for media, Resend for email,
Sentry for errors.

## Quick start (local dev)

```bash
npm install --legacy-peer-deps
cp .env.example .env   # then fill in real values
npm run infra:up       # local Postgres only (Redis/Pusher/Inngest are SaaS)
npm run db:migrate --workspace=@sahay/db
npm run db:seed --workspace=@sahay/db
npm run build --workspace=@sahay/web   # builds the SPA
vercel dev             # serves /api/* functions + the SPA together
```

## Repo layout

```
api/                       Vercel Functions (HTTP entry points)
apps/web/                  React + Vite SPA
apps/api/src/              Shared TS modules used by /api/* and Inngest
  inngest/functions/       25 background functions + 3 crons
  lib/                     env, jwt, handler, crypto, pusher, rate-limit, ...
  services/                ai/, channels/, storage/, email/, shopify/, push
  __tests__/               vitest smoke suite (40 tests)
  lib/openapi/             Spec registry + builder (served at /api/openapi.json)
packages/db/               Drizzle ORM + migrations + seed
  drizzle/                 0000_init → 0003_experiments + 9999_pgvector
  RLS.md, AUDIT.md, EXPERIMENTS.md, RUNBOOK.md
packages/shared/           Cross-package types + utilities
packages/config/           Shared TypeScript config
.github/workflows/         CI + preview deploys + prod deploys
scripts/check-secrets.sh   Pre-commit / CI secret scanner
infrastructure/            Local docker-compose (Postgres only)
```

## Docs

- [`DEPLOY.md`](./DEPLOY.md) — end-to-end production deployment runbook
- [`SECRETS.md`](./SECRETS.md) — secret generation + rotation procedures
- [`packages/db/RUNBOOK.md`](./packages/db/RUNBOOK.md) — migrations
- [`packages/db/RLS.md`](./packages/db/RLS.md) — row-level security model
- [`packages/db/AUDIT.md`](./packages/db/AUDIT.md) — audit-log schema + DPDP
- [`packages/db/EXPERIMENTS.md`](./packages/db/EXPERIMENTS.md) — A/B harness
- OpenAPI spec served at `/api/openapi.json`; Swagger UI at `/api/docs`

## Common scripts

| Command                 | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Turbo: starts the SPA dev server              |
| `npm run build`         | Builds the web SPA (Vercel auto-handles /api) |
| `npm run type-check`    | Strict TypeScript across every workspace      |
| `npm run lint`          | ESLint flat config (only web has rules)       |
| `npm run test`          | Vitest smoke suite (40 tests, <2s)            |
| `npm run format`        | Prettier write                                |
| `npm run format:check`  | Prettier check (CI gate)                      |
| `npm run secrets:check` | Scan repo for committed secrets               |
| `npm run db:migrate`    | Drizzle migrate against `DATABASE_URL`        |
| `npm run db:seed`       | Seed dev data                                 |
| `npm run db:studio`     | Drizzle Studio (web UI)                       |
| `npm run infra:up`      | Start local Postgres via docker-compose       |

## Production status

| Phase                  | Done | Highlights                                                                                                                                                                  |
| ---------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** Launch blockers | ✅   | Vercel migration, Shopify OAuth+webhooks (incl. GDPR redact), Instagram+WhatsApp webhooks, BullMQ→Inngest, Socket.io→Pusher, Sentry, Resend, CI/CD, smoke tests, migrations |
| **P1** Hardening       | ✅   | Postgres RLS, OpenAPI + Swagger UI, R2 media pipeline, Web Push (VAPID+SW), agent invite/onboarding, CSP/HSTS, login lockout, SECRETS runbook                               |
| **P2** Scale & ops     | ✅   | RLS migration of all routes + Inngest functions, full-text search (tsvector + pg_trgm), read-audit logging, per-agent analytics, AI prompt A/B testing                      |

## License

Proprietary. © 2026 Sahay.
