-- Create IVFFlat index for vector similarity search
-- This is critical for performance at scale (O(n) without it)
CREATE INDEX IF NOT EXISTS idx_kc_embedding
ON knowledge_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Also create composite index for tenant-filtered vector search
CREATE INDEX IF NOT EXISTS idx_kc_tenant_embedding
ON knowledge_chunks (tenant_id, id);
