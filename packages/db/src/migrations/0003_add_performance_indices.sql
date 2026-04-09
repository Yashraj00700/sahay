-- Improve message lookup performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_sent
  ON messages(conversation_id, sent_at DESC);

-- Improve customer search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_tenant_phone
  ON customers(tenant_id, phone);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_tenant_email
  ON customers(tenant_id, email);

-- Improve analytics queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_daily_tenant_date
  ON analytics_daily(tenant_id, date DESC);

-- Improve audit log queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_tenant_time
  ON audit_logs(tenant_id, created_at DESC);
