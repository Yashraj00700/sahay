/**
 * Production migration runner.
 *
 * Apply every SQL file in `./drizzle` against `DATABASE_URL` in lexicographic
 * order. Drizzle's `migrate()` tracks applied migrations in a `__drizzle_migrations`
 * table, so re-running this script is idempotent.
 *
 * Usage (CI / Vercel build / SSH session):
 *   DATABASE_URL=postgres://... npm run db:migrate:prod
 *
 * This script is intentionally framework-free (no Vercel handler, no Inngest):
 * it should run from any node environment that can reach the database.
 *
 * Exit codes:
 *   0  all migrations applied (or already applied)
 *   1  any failure — full error printed to stderr
 */

import 'dotenv/config'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('[migrate-prod] DATABASE_URL is not set')
    process.exit(1)
  }

  // Single connection — drizzle's migrator is single-threaded by design.
  const client = postgres(connectionString, { max: 1 })
  const db = drizzle(client)

  const startedAt = Date.now()
  console.log('[migrate-prod] applying migrations from ./drizzle …')

  try {
    await migrate(db, { migrationsFolder: './drizzle' })
    const elapsedMs = Date.now() - startedAt
    console.log(`[migrate-prod] ✓ done in ${elapsedMs}ms`)
  } catch (err) {
    console.error('[migrate-prod] ✗ migration failed:', err)
    process.exit(1)
  } finally {
    await client.end({ timeout: 5 })
  }
}

void main()
