# `@sahay/db` Migrations Runbook

This package owns the Postgres schema for Sahay. Migrations are managed by
[Drizzle Kit](https://orm.drizzle.team/kit-docs/overview) and live in
`packages/db/drizzle/`. Every SQL file in that directory is applied in
lexicographic order by Drizzle's migrator; the migrator records applied
migrations in `__drizzle_migrations` so re-runs are idempotent.

Files of interest:

- `src/schema/*.ts` — TypeScript schema (source of truth)
- `drizzle/0000_init.sql` — generated DDL for the initial tables
- `drizzle/9999_pgvector.sql` — hand-written: `CREATE EXTENSION vector` +
  IVFFlat index on `knowledge_chunks.embedding`
- `drizzle/meta/_journal.json` — Drizzle's manifest (do not edit by hand)
- `scripts/migrate-prod.ts` — node script for prod migrations
- `drizzle.config.ts` — Drizzle Kit config (schema glob + DB URL)

---

## How to apply migrations

### Local development

```bash
# Make sure DATABASE_URL points at your local Postgres (e.g. postgresql://sahay:sahaydev123@localhost:5432/sahay_dev)
cd packages/db
npm run db:migrate
```

`db:migrate` runs Drizzle Kit's interactive migrator against the URL in your
`.env`. Use `npm run db:push` instead if you want to skip the migration files
and sync your schema directly during early prototyping (never use this in
production — it bypasses version control).

### Production / staging

```bash
# In CI, Vercel build, or an SSH session against the server
DATABASE_URL=postgres://… npm run db:migrate:prod
```

`db:migrate:prod` invokes `scripts/migrate-prod.ts`, which:

1. Loads `dotenv/config` (so a `.env` file is honored when present).
2. Opens a single `postgres-js` connection with `max: 1`.
3. Runs `migrate(db, { migrationsFolder: './drizzle' })`.
4. Exits `0` on success or `1` on any failure (full error to stderr).

The script is framework-free — it has no Vercel handler and no Inngest
dependency, so it can run from any node 20+ environment that can reach the
database. Recommended: wire it as a Vercel Build Step or a one-off GitHub
Action gated behind a manual approval.

---

## How to roll back

**Drizzle has no down-migrations.** This is by design: forward-only schemas
are easier to reason about in production and side-effecting data migrations
can't always be reversed safely. Our rollback strategy is database-level,
not migration-level.

### Neon point-in-time restore (recommended)

We host Postgres on Neon, which keeps a continuous WAL archive. To roll back:

1. Open the Neon console for the affected project.
2. Pick a target timestamp **before** the bad migration ran.
3. Use [Neon Point-in-Time Restore](https://neon.tech/docs/manage/branches#restore-a-branch-to-its-own-history)
   to create a new branch at that timestamp, or restore the existing branch
   in-place (destructive — see Neon docs for the consequences).
4. Update `DATABASE_URL` in Vercel / `.env` to point at the restored branch.
5. Re-deploy the application code that matches that schema state.
6. After verifying, fix the broken migration and re-deploy forward.

### Manual SQL workaround (when PITR is overkill)

If the bad migration is a single additive change (e.g. a stray index or
unused column), it is often safer to write a follow-up forward migration
that drops the offending object than to attempt a restore. Generate a new
migration with `db:generate -- --name revert_<thing>` and ship it.

---

## How to add a new migration

1. **Edit the schema.** Modify the relevant file under
   `packages/db/src/schema/*.ts`. Add columns / tables / indexes using
   Drizzle's column builders. For features Drizzle can't model directly
   (e.g. pgvector indexes, custom triggers), add a new hand-written
   `9xxx_<verb>.sql` file under `drizzle/` instead — see
   `9999_pgvector.sql` for the pattern.

2. **Generate the migration.**

   ```bash
   cd packages/db
   npm run db:generate -- --name <verb_what>
   # e.g. --name add_csat_index, --name drop_legacy_columns
   ```

   Drizzle compares the schema TS to its snapshot in
   `drizzle/meta/<n>_snapshot.json` and writes a new
   `drizzle/<NNNN>_<verb_what>.sql`.

3. **Review the generated SQL.** Open it and confirm:

   - Column types match what you intended (esp. timestamps with timezone,
     numeric precision/scale, jsonb defaults).
   - Drops / renames are intentional. Drizzle sometimes asks you to choose
     between "rename" and "drop+create" interactively — read its prompts
     carefully.
   - No surprise `DROP TABLE` for tables you only meant to refactor.
   - For destructive changes, manually edit the SQL to be safer (e.g.
     `ALTER TABLE … DROP COLUMN IF EXISTS …`, or split into a multi-step
     deploy).

4. **Test locally.**

   ```bash
   npm run db:migrate
   npm run type-check
   ```

5. **Commit the schema TS file, the generated SQL file, and the updated
   `drizzle/meta/*` snapshot/journal together.** Do not commit them in
   separate PRs — the snapshot is the durable record of what the database
   thinks the schema is, and a mismatch will silently corrupt future
   `db:generate` runs.

6. **Deploy.** The `db:migrate:prod` step applies the new migration to
   each environment.

---

## Troubleshooting

- **`drizzle-kit generate` says "No schema changes, nothing to migrate":**
  the snapshot already matches your TypeScript. Either you forgot to save
  a file, or the change is purely cosmetic to Drizzle (e.g. comment-only).
- **`drizzle-kit generate` errors about `DATABASE_URL`:** the kit tries to
  read it even though `generate` doesn't connect. Workaround:
  `DATABASE_URL=postgres://noop@localhost:5432/noop npm run db:generate`.
- **`migrate-prod.ts` fails on `relation "__drizzle_migrations" does not
  exist`:** that's just the first run and is benign — the migrator
  creates the table before applying anything.
- **pgvector errors (`extension "vector" does not exist`):** Neon supports
  `vector` natively — make sure you haven't switched to a database that
  doesn't (e.g. RDS without the extension installed). The
  `9999_pgvector.sql` file uses `CREATE EXTENSION IF NOT EXISTS` so it is
  safe to re-apply.
