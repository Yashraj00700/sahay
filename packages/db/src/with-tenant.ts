import { sql } from 'drizzle-orm'
import { db } from './index'

/**
 * Drizzle transaction type. Inferred from `db.transaction(...)`'s callback
 * argument so we never get out of sync if drizzle's types change.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Run `fn` inside a transaction with `app.tenant_id` set to `tenantId`.
 *
 * Postgres RLS policies on tenant-scoped tables compare `tenant_id` against
 * `current_setting('app.tenant_id', true)`. Setting it locally (third arg
 * `true`) means the value is automatically cleared at COMMIT/ROLLBACK, so
 * the next request starts with an empty value.
 *
 * If RLS is enabled but `app.tenant_id` is unset, queries return zero rows
 * (USING) or fail (WITH CHECK) — fail-closed by design.
 *
 * @example
 *   const rows = await withTenant(ctx.tenant.id, (tx) =>
 *     tx.query.conversations.findMany({ where: eq(conversations.status, 'open') })
 *   )
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('withTenant: tenantId must be a non-empty string')
  }
  return db.transaction(async (tx) => {
    // `set_config(name, value, is_local)` — is_local=true scopes to this tx.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`)
    return fn(tx)
  })
}

/**
 * Run `fn` with the unscoped, BYPASSRLS connection (the `db` export).
 *
 * Use ONLY for genuine cross-tenant work: Inngest aggregation crons, Shopify
 * app-uninstall cleanup, GDPR shop-redact webhooks, admin tooling, migrations.
 *
 * The DB role used by the app should NOT have BYPASSRLS in production; this
 * helper is mainly a marker + warning surface so we can grep/audit usage.
 *
 * NOTE: This wrapper does not switch DB roles by itself — it relies on the
 * connection role configured at deploy time. If the connection role does not
 * have BYPASSRLS, queries against tenant tables WITHOUT `app.tenant_id` set
 * will simply return zero rows. That's fail-closed and acceptable.
 */
export async function withSystemBypass<T>(fn: () => Promise<T>): Promise<T> {
  // Heuristic: warn if we appear to be in an HTTP request scope.
  // Vercel sets VERCEL_REQUEST_ID / x-vercel-id; Inngest sets INNGEST_EVENT_ID.
  // We only warn — never throw — to avoid breaking legitimate uses.
  if (
    typeof process !== 'undefined' &&
    process.env.VERCEL_REGION &&
    !process.env.INNGEST_EVENT_KEY &&
    !process.env.SAHAY_SYSTEM_JOB
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[withSystemBypass] Called outside an Inngest/system context. ' +
        'Cross-tenant access from a request handler is almost always a bug. ' +
        'Set SAHAY_SYSTEM_JOB=1 in the function env if this is intentional.',
    )
  }
  return fn()
}
