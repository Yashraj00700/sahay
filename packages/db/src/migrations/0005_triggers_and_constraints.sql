-- ─── Auto-update updated_at on row changes ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all tables that have updated_at column
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── FK constraints (add IF NOT EXISTS for idempotency) ──────────────────────
-- Messages must reference existing conversations
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS fk_messages_conversation,
  ADD CONSTRAINT fk_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

-- Conversations must reference existing tenants
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS fk_conversations_tenant,
  ADD CONSTRAINT fk_conversations_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Conversations must reference existing customers
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS fk_conversations_customer,
  ADD CONSTRAINT fk_conversations_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- Customers must reference existing tenants
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS fk_customers_tenant,
  ADD CONSTRAINT fk_customers_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Agents must reference existing tenants
ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS fk_agents_tenant,
  ADD CONSTRAINT fk_agents_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Knowledge chunks must reference existing articles
-- (Only add if kb_articles table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'kb_articles') THEN
    ALTER TABLE knowledge_chunks
      DROP CONSTRAINT IF EXISTS fk_knowledge_chunks_article,
      ADD CONSTRAINT fk_knowledge_chunks_article
        FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE;
  END IF;
END $$;
