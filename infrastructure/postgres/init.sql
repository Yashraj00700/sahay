-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Confirm
SELECT 'Extensions loaded: vector, pg_trgm, uuid-ossp' as status;
