/**
 * Vitest global setup.
 *
 * `apps/api/src/lib/env.ts` validates `process.env` at IMPORT TIME and calls
 * `process.exit(1)` on any missing variable. Vitest evaluates this file
 * before any test module is loaded, so we mutate `process.env` here and
 * every test that ends up importing `env` (directly or transitively) sees a
 * complete, valid environment.
 *
 * Values use the dev-friendly shapes the env schema actually accepts:
 *   - URLs are valid URLs
 *   - Email is a valid email
 *   - Secret-like fields are >=32 chars so we exercise the same code paths
 *     as production even though the schema only enforces that length when
 *     `NODE_ENV === 'production'`.
 *
 * Anything that would hit a real network (Anthropic, OpenAI, Pusher, Inngest,
 * Resend, Shopify, Meta) gets a stub value — tests that need those services
 * mocked should mock the SDK directly; nothing here actually dials out.
 */

const TEST_DEFAULTS: Readonly<Record<string, string>> = {
  NODE_ENV: "test",

  // ─── DATABASE / REDIS ───────────────────────────────────
  DATABASE_URL: "postgres://x:x@localhost:5432/sahay_test",
  REDIS_URL: "redis://localhost:6379",
  UPSTASH_REDIS_REST_URL: "https://test.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",

  // ─── JWT / CRYPTO ───────────────────────────────────────
  JWT_SECRET: "test-secret-1234567890-test-secret-1234567890",
  JWT_REFRESH_SECRET: "test-refresh-1234567890-test-refresh-1234567890",
  JWT_EXPIRES_IN: "1h",
  JWT_REFRESH_EXPIRES_IN: "30d",
  ENCRYPTION_KEY: "test-encryption-1234567890-1234567890",

  // ─── SHOPIFY ────────────────────────────────────────────
  SHOPIFY_API_KEY: "test-shopify-api-key",
  SHOPIFY_API_SECRET: "test-shopify-api-secret",
  SHOPIFY_APP_URL: "https://test.example.com",
  SHOPIFY_SCOPES: "read_products,write_products",
  SHOPIFY_WEBHOOK_SECRET: "test-shopify-webhook-secret-1234567890",
  SHOPIFY_APP_HOST: "test.example.com",

  // ─── WHATSAPP ───────────────────────────────────────────
  WA_PHONE_NUMBER_ID: "test-wa-phone-id",
  WA_ACCESS_TOKEN: "test-wa-access-token",
  WA_VERIFY_TOKEN: "test-wa-verify-token",
  WA_APP_SECRET: "test-wa-app-secret-1234567890-1234567890",

  // ─── INSTAGRAM ──────────────────────────────────────────
  IG_APP_ID: "test-ig-app-id",
  IG_APP_SECRET: "test-ig-app-secret-1234567890-1234567890",
  IG_VERIFY_TOKEN: "test-ig-verify-token",

  // ─── AI PROVIDERS ───────────────────────────────────────
  ANTHROPIC_API_KEY: "test-anthropic-api-key",
  OPENAI_API_KEY: "test-openai-api-key",

  // ─── EMAIL ──────────────────────────────────────────────
  RESEND_API_KEY: "test-resend-api-key",
  EMAIL_FROM: "test@sahay.example.com",

  // ─── PUSHER ─────────────────────────────────────────────
  PUSHER_APP_ID: "test-pusher-app-id",
  PUSHER_KEY: "test-pusher-key",
  PUSHER_SECRET: "test-pusher-secret-1234567890",
  PUSHER_CLUSTER: "mt1",

  // ─── INNGEST (optional) ─────────────────────────────────
  INNGEST_EVENT_KEY: "test-inngest-event-key",
  INNGEST_SIGNING_KEY: "test-inngest-signing-key",

  // ─── APP URLs / CORS ────────────────────────────────────
  API_URL: "https://api.test.example.com",
  WEB_URL: "https://app.test.example.com",
  CORS_ORIGINS: "https://app.test.example.com,http://localhost:3000",
};

for (const [key, value] of Object.entries(TEST_DEFAULTS)) {
  // Don't clobber values explicitly provided by CI / a developer's shell.
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value;
  }
}

// `NODE_ENV` is special: setup runs after vitest has already booted, so
// `process.env.NODE_ENV` may already be `'test'`. Force it just in case.
process.env.NODE_ENV = "test";
