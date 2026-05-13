-- =============================================================================
-- Row-Level Security (RLS) for Sahay multi-tenant tables
-- =============================================================================
--
-- WHY:
--   Defense-in-depth. Even if app code forgets a `WHERE tenant_id = $1` filter,
--   Postgres will refuse to leak rows across tenants.
--
-- HOW IT WORKS:
--   RLS is enforced via the `app.tenant_id` session variable.
--   Set it via:
--     SELECT set_config('app.tenant_id', '<uuid>', true)
--   before any query in a tenant-scoped request. The `true` third arg makes the
--   setting transaction-local, so it is automatically cleared at COMMIT/ROLLBACK.
--
--   In application code, use `withTenant(tenantId, fn)` from
--   `@sahay/db/with-tenant`, which wraps queries in a transaction with the
--   session variable set.
--
-- BYPASS:
--   The `sahay_app_bypass` role has BYPASSRLS for cross-tenant system jobs
--   (Inngest aggregation crons, Shopify uninstall, GDPR shop redact).
--   The app's MAIN connection role does NOT bypass RLS.
--
-- IDEMPOTENCY:
--   This migration uses IF EXISTS / DROP POLICY IF EXISTS guards so it is safe
--   to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Bypass role for system jobs (Inngest crons, Shopify uninstall, GDPR redact)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sahay_app_bypass') THEN
    CREATE ROLE sahay_app_bypass NOLOGIN BYPASSRLS;
  ELSE
    ALTER ROLE sahay_app_bypass BYPASSRLS;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2) Helper: enable + force RLS, then (re)create the tenant-isolation policy
-- -----------------------------------------------------------------------------
-- Pattern repeated per table:
--   ALTER TABLE <t> ENABLE  ROW LEVEL SECURITY;
--   ALTER TABLE <t> FORCE   ROW LEVEL SECURITY;       -- restricts even table owner
--   DROP POLICY IF EXISTS <t>_tenant_isolation ON <t>;
--   CREATE POLICY <t>_tenant_isolation ON <t>
--     USING      (tenant_id::text = current_setting('app.tenant_id', true))
--     WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
-- -----------------------------------------------------------------------------

-- agents -----------------------------------------------------------------------
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agents" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agents_tenant_isolation" ON "agents";
CREATE POLICY "agents_tenant_isolation" ON "agents"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- customers --------------------------------------------------------------------
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_tenant_isolation" ON "customers";
CREATE POLICY "customers_tenant_isolation" ON "customers"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- conversations ----------------------------------------------------------------
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversations_tenant_isolation" ON "conversations";
CREATE POLICY "conversations_tenant_isolation" ON "conversations"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- messages ---------------------------------------------------------------------
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_tenant_isolation" ON "messages";
CREATE POLICY "messages_tenant_isolation" ON "messages"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- knowledge_chunks -------------------------------------------------------------
ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_chunks" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "knowledge_chunks_tenant_isolation" ON "knowledge_chunks";
CREATE POLICY "knowledge_chunks_tenant_isolation" ON "knowledge_chunks"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- kb_articles ------------------------------------------------------------------
ALTER TABLE "kb_articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_articles" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kb_articles_tenant_isolation" ON "kb_articles";
CREATE POLICY "kb_articles_tenant_isolation" ON "kb_articles"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- orders -----------------------------------------------------------------------
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_tenant_isolation" ON "orders";
CREATE POLICY "orders_tenant_isolation" ON "orders"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- audit_logs -------------------------------------------------------------------
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_tenant_isolation" ON "audit_logs";
CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- analytics_daily --------------------------------------------------------------
ALTER TABLE "analytics_daily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_daily" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "analytics_daily_tenant_isolation" ON "analytics_daily";
CREATE POLICY "analytics_daily_tenant_isolation" ON "analytics_daily"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- canned_responses -------------------------------------------------------------
ALTER TABLE "canned_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "canned_responses" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "canned_responses_tenant_isolation" ON "canned_responses";
CREATE POLICY "canned_responses_tenant_isolation" ON "canned_responses"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- wa_templates -----------------------------------------------------------------
ALTER TABLE "wa_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wa_templates" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_templates_tenant_isolation" ON "wa_templates";
CREATE POLICY "wa_templates_tenant_isolation" ON "wa_templates"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- consent_records --------------------------------------------------------------
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_records" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consent_records_tenant_isolation" ON "consent_records";
CREATE POLICY "consent_records_tenant_isolation" ON "consent_records"
  USING      (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 3) tenants table itself: row's `id` must match app.tenant_id
-- -----------------------------------------------------------------------------
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenants_tenant_isolation" ON "tenants";
CREATE POLICY "tenants_tenant_isolation" ON "tenants"
  USING      (id::text = current_setting('app.tenant_id', true))
  WITH CHECK (id::text = current_setting('app.tenant_id', true));
