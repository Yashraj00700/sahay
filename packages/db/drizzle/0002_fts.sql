-- =============================================================================
-- Postgres full-text search (FTS) for messages + conversations.
-- =============================================================================
--
-- WHY:
--   The Command Palette and the global "/api/search" endpoint need to find
--   conversations by free-text content (customer messages, agent replies,
--   voice transcriptions, escalation reasons, AI-detected intents, tags).
--   ILIKE doesn't scale once any tenant exceeds a few thousand messages.
--
-- WHY 'simple' AND NOT 'english':
--   Sahay customers write in English, Hindi (Devanagari), and Hinglish
--   (Hindi words in Latin script). The 'english' dictionary stems aggressively
--   ("orders" → "order", "running" → "run") which is fine for English but
--   actively HARMFUL for Hindi/Hinglish — it would mangle "chal raha hai" or
--   strip diacritics from "मेरा" inconsistently. The 'simple' dictionary does
--   case-folding only, no stemming, no stop-word removal. That's the right
--   default for a multilingual support inbox; we trade recall (no stemming)
--   for correctness across all three languages.
--
-- WHY GENERATED ALWAYS .. STORED:
--   Postgres auto-maintains the column on every INSERT/UPDATE. No app code
--   to keep in sync, no triggers to debug, no Inngest job to chase. The
--   STORED keyword materialises the tsvector on disk so the GIN index can
--   point at it directly.
--
-- WEIGHTS:
--   'A' is highest, 'D' is lowest. ts_rank_cd() multiplies matches in
--   higher-weighted lexemes. We give:
--     messages.content        → A  (the actual message; most authoritative)
--     messages.transcription  → B  (voice-to-text; can be wrong, slightly less trust)
--   Conversations:
--     escalation_reason       → A  (human/AI-summarised, dense signal)
--     primary_intent          → B  (a single term, useful but coarse)
--     tags (joined to text)   → B  (operator-curated labels)
--
-- IDEMPOTENCY:
--   Uses ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS so the file
--   is safe to re-run during local dev or partial migration recovery.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) messages.search_tsv — combined content + transcription tsvector
-- -----------------------------------------------------------------------------
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("content", '')), 'A')
    || setweight(to_tsvector('simple', coalesce("transcription", '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS "messages_search_tsv_idx"
  ON "messages" USING gin ("search_tsv");

-- -----------------------------------------------------------------------------
-- 2) conversations.search_tsv — escalation_reason + primary_intent + tags
-- -----------------------------------------------------------------------------
-- `tags` is text[]; array_to_string flattens it for tsvector ingestion.
-- coalesce on the array avoids NULL → "" mismatches.
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("escalation_reason", '')), 'A')
    || setweight(to_tsvector('simple', coalesce("primary_intent", '')), 'B')
    || setweight(to_tsvector('simple', coalesce(array_to_string("tags", ' '), '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS "conversations_search_tsv_idx"
  ON "conversations" USING gin ("search_tsv");

-- -----------------------------------------------------------------------------
-- 3) Trigram indexes on customers for fast ILIKE substring matches
-- -----------------------------------------------------------------------------
-- We deliberately do NOT add a tsvector to customers — name/phone/email are
-- short, atomic, low-cardinality strings where trigram ILIKE outperforms
-- tokenised FTS (FTS would never match "+9198" inside "+919876543210" because
-- it's a single lexeme). pg_trgm supports `name ILIKE '%foo%'` via gin_trgm_ops.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx"
  ON "customers" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "customers_phone_trgm_idx"
  ON "customers" USING gin ("phone" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "customers_email_trgm_idx"
  ON "customers" USING gin ("email" gin_trgm_ops);
