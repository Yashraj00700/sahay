# Row-Level Security (RLS)

Defense-in-depth tenant isolation for Sahay's multi-tenant Postgres tables.

## Why it matters

Every tenant-scoped table has a `tenant_id` column. Application code is
expected to add `WHERE tenant_id = $1` to every query — but humans forget.
RLS makes Postgres refuse to return (or modify) rows whose `tenant_id` does
not match the current session's tenant, so even a missing filter cannot leak
or corrupt data across tenants.

## How tenants are scoped

A single Postgres session variable, `app.tenant_id`, drives all policies:

```sql
SELECT set_config('app.tenant_id', '<tenant-uuid>', true);  -- transaction-local
```

Each tenant table has a policy of the form:

```sql
CREATE POLICY <table>_tenant_isolation ON <table>
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
```

If `app.tenant_id` is unset, `current_setting('app.tenant_id', true)` returns
`''`, no rows match, and the table appears empty. Fail-closed.

The `tenants` table itself uses `id::text = current_setting(...)` instead of
`tenant_id::text`.

`ALTER TABLE ... FORCE ROW LEVEL SECURITY` is set so even the table owner is
restricted unless they hold a role with `BYPASSRLS`.

## When to use what

### `withTenant(tenantId, fn)`

Use for **all** tenant-scoped DB access. Opens a transaction, sets
`app.tenant_id`, then runs your callback with a transaction handle.

```ts
import { withTenant } from "@sahay/db";

const conversations = await withTenant(ctx.tenant.id, (tx) =>
  tx.query.conversations.findMany({ where: eq(conversations.status, "open") }),
);
```

In an authed HTTP handler, prefer the pre-bound helper on the context:

```ts
const conversations = await ctx.withTenant((tx) =>
  tx.query.conversations.findMany({ where: eq(conversations.status, "open") }),
);
```

### `withSystemBypass(fn)`

Use **only** for genuinely cross-tenant work that runs outside a request:

- Inngest aggregation crons (e.g. nightly analytics rollups)
- Shopify `app/uninstalled` cleanup
- GDPR `shop/redact`, `customers/redact`, `customers/data_request`
- Admin/maintenance scripts

The helper logs a warning if called from what looks like an HTTP request
scope. Set `SAHAY_SYSTEM_JOB=1` to silence it for legitimate uses.

The connection role used by the production app should NOT have `BYPASSRLS`.
The `sahay_app_bypass` role created in `0001_rls.sql` is reserved for jobs
that explicitly need it — wire it up via a separate connection string when
needed.

## Migration TODOs

### Migrated to `ctx.withTenant` / `withTenant` / `withSystemBypass`

Vercel Function routes (authed):

- [x] `api/auth/logout.ts`
- [x] `api/agents/index.ts`
- [x] `api/agents/[id]/index.ts`
- [x] `api/agents/invite.ts`
- [x] `api/conversations/index.ts`
- [x] `api/conversations/[id].ts`
- [x] `api/conversations/[id]/messages.ts`
- [x] `api/conversations/[id]/assign.ts`
- [x] `api/conversations/[id]/notes.ts`
- [x] `api/conversations/[id]/resolve.ts`
- [x] `api/conversations/[id]/reopen.ts`
- [x] `api/messages/upload.ts`
- [x] `api/notifications/subscribe.ts`
- [x] `api/notifications/unsubscribe.ts`
- [x] `api/settings/channels.ts`
- [x] `api/settings/ai.ts`

Inngest functions — per-tenant (wrapped in `withTenant(event.data.tenantId, ...)`):

- [x] `whatsapp-incoming` / `whatsapp-outgoing`
- [x] `instagram-incoming` / `instagram-outgoing`
- [x] `webchat-incoming`
- [x] `ai-respond` / `ai-embed`
- [x] `proactive-message`
- [x] `notifications-push`
- [x] `shopify-orders-created` / `shopify-orders-updated` / `shopify-orders-fulfilled`
- [x] `shopify-products-created` / `shopify-products-updated` / `shopify-products-deleted`
- [x] `shopify-customers-created` / `shopify-customers-updated`
- [x] `shopify-customers-redact` (per-tenant, hard-delete one customer)
- [x] `shopify-customers-data-request`
- [x] `shopify-app-uninstalled`
- [x] `shopify-sync` (products / orders / customers backfill)

Inngest functions — cross-tenant (wrapped in `withSystemBypass`):

- [x] `cron/analytics-rollup` — `list-active-tenants` step
- [x] `cron/kb-refresh` — `list-tenants` step
- [x] `cron/wa-session-expiry` — global scan + batched UPDATE
- [x] `shopify-shop-redact` — wipes every table for the tenant including
      the `tenants` row itself

### Still bypassing RLS (intentional / out of scope here)

- [ ] `api/auth/login.ts`, `refresh.ts`, `forgot-password.ts`,
      `reset-password.ts`, `accept-invite.ts` — pre-auth, no
      `ctx.withTenant` available; use `db` directly with explicit
      `WHERE tenant_id = …` filters.
- [ ] `api/shopify/install.ts`, `api/shopify/callback.ts` — pre-tenant /
      tenant-creating; cross-tenant lookups via `withSystemBypass` where
      applicable.
- [ ] `api/webhooks/*` — no auth: they look up tenant by phoneNumberId /
      pageId / shopDomain (cross-tenant lookup) then forward to Inngest.
      The Inngest function is the per-tenant boundary.
- [ ] Onboarding probes / shop-info reads in `services/shopify/*` —
      pre-tenant or cross-shop tooling.
- [ ] `defineAuthedHandler` itself still hits `db.query.agents` /
      `db.query.tenants` to authenticate the bearer token. RLS would
      require a chicken-and-egg `set_config` before we know the tenant id,
      so this stays unscoped (and is bounded to two specific lookups).

Once every route is migrated, deploy with a non-BYPASSRLS DB role and remove
the plain `db` export everywhere except the small set of legitimate
`withSystemBypass` callers.

## Testing RLS locally

After running `0001_rls.sql`, prove it works:

```sql
-- Pretend to be a tenant that does not own any data:
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true);
SELECT count(*) FROM conversations;  -- expect 0

-- Now use a real tenant id:
SELECT set_config('app.tenant_id', '<real-tenant-uuid>', true);
SELECT count(*) FROM conversations;  -- expect that tenant's row count

-- INSERT with the wrong tenant_id is blocked by WITH CHECK:
INSERT INTO conversations (tenant_id, channel, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'whatsapp', 'open');
-- ERROR:  new row violates row-level security policy for table "conversations"
```

To bypass RLS for ad-hoc admin work, connect as a role with `BYPASSRLS`
(e.g. `sahay_app_bypass`) or as the Postgres superuser without `FORCE` —
remember that `FORCE ROW LEVEL SECURITY` restricts even the table owner.
