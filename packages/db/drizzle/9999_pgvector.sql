-- pgvector extension + IVFFlat index for cosine similarity search.
-- Runs after generated migrations (9999_ prefix). Drizzle's migrator
-- applies SQL files in lexicographic order, so this file is guaranteed
-- to execute last regardless of how many init/* migrations precede it.
--
-- Why not put this in a Drizzle schema?
--   - Drizzle has no first-class pgvector support; the `vector` column is
--     declared via `customType` and the IVFFlat index requires SQL that
--     drizzle-kit can't introspect.
--   - The `lists = 100` parameter is dataset-dependent and we want it to
--     stay reviewable in version control rather than buried in a generator.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
