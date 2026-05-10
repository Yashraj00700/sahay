/**
 * Centralized environment-variable validation.
 *
 * Every Vercel Function (and the legacy Fastify entrypoint) MUST import this
 * module as its very first line. On cold start we parse `process.env` exactly
 * once. If anything is missing or malformed we print one actionable block of
 * errors and `process.exit(1)` so the failure surfaces cleanly in Vercel logs.
 *
 * Framework-agnostic: this file imports nothing from outside apps/api/src and
 * only depends on `zod` and `dotenv/config`.
 */

import 'dotenv/config';
import { z } from 'zod';

/**
 * Builds a string schema that enforces a minimum length only when running in
 * production. Local dev / test can use shorter placeholders so contributors
 * aren't blocked. The check runs in `superRefine` so all errors are collected
 * in a single pass instead of short-circuiting on the first failure.
 */
const productionSecret = (minLength: number) =>
  z
    .string()
    .min(1, 'is required')
    .superRefine((value, ctx) => {
      if (process.env.NODE_ENV === 'production' && value.length < minLength) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be at least ${minLength} characters in production`,
        });
      }
    });

const envSchema = z.object({
  // ─── RUNTIME ────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // ─── DATABASE ───────────────────────────────────────────
  DATABASE_URL: z.string().url('must be a valid Postgres connection URL'),

  // ─── REDIS (legacy / local BullMQ) ──────────────────────
  REDIS_URL: z.string().url('must be a valid redis:// URL'),

  // ─── UPSTASH REDIS (serverless) ─────────────────────────
  UPSTASH_REDIS_REST_URL: z.string().url('must be a valid HTTPS URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'is required'),

  // ─── JWT AUTH ───────────────────────────────────────────
  JWT_SECRET: productionSecret(32),
  JWT_REFRESH_SECRET: productionSecret(32),
  JWT_EXPIRES_IN: z.string().min(1, 'is required'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1, 'is required'),

  // ─── ENCRYPTION (column-level for OAuth tokens, PII) ────
  ENCRYPTION_KEY: productionSecret(32),

  // ─── SHOPIFY ────────────────────────────────────────────
  SHOPIFY_API_KEY: z.string().min(1, 'is required'),
  SHOPIFY_API_SECRET: z.string().min(1, 'is required'),
  SHOPIFY_APP_URL: z.string().url('must be a valid URL'),
  SHOPIFY_SCOPES: z.string().min(1, 'is required'),
  // Webhook HMAC secret. In practice equals SHOPIFY_API_SECRET, but we read it
  // through its own env var so it can be rotated independently and so webhook
  // handlers don't have to know about the auth secret.
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1, 'is required'),

  // ─── WHATSAPP CLOUD API (Meta) ──────────────────────────
  WA_PHONE_NUMBER_ID: z.string().min(1, 'is required'),
  WA_ACCESS_TOKEN: z.string().min(1, 'is required'),
  WA_VERIFY_TOKEN: z.string().min(1, 'is required'),
  WA_APP_SECRET: productionSecret(32),

  // ─── INSTAGRAM (Meta) ───────────────────────────────────
  IG_APP_ID: z.string().min(1, 'is required'),
  IG_APP_SECRET: productionSecret(32),
  IG_VERIFY_TOKEN: z.string().min(1, 'is required'),

  // ─── AI PROVIDERS ───────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().min(1, 'is required'),
  OPENAI_API_KEY: z.string().min(1, 'is required'),

  // ─── STORAGE (Cloudflare R2 / S3) ───────────────────────
  // Optional in dev/test (the media adapter no-ops with a placeholder), but
  // strictly required in production via the superRefine block below — any
  // tenant on production WhatsApp/Instagram traffic will need these to
  // download and re-host media uploads.
  R2_ACCOUNT_ID: z.string().min(1, 'is required').optional(),
  R2_ACCESS_KEY_ID: z.string().min(1, 'is required').optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'is required').optional(),
  R2_BUCKET_NAME: z.string().min(1, 'is required').optional(),
  R2_PUBLIC_URL: z.string().url('must be a valid URL').optional(),

  // ─── EMAIL (Resend) ─────────────────────────────────────
  RESEND_API_KEY: z.string().min(1, 'is required'),
  EMAIL_FROM: z.string().email('must be a valid email address'),

  // ─── PUSHER (realtime) ──────────────────────────────────
  PUSHER_APP_ID: z.string().min(1, 'is required'),
  PUSHER_KEY: z.string().min(1, 'is required'),
  PUSHER_SECRET: productionSecret(16),
  PUSHER_CLUSTER: z.string().min(1, 'is required'),

  // ─── INNGEST (background jobs) ──────────────────────────
  // Both keys are optional locally — Inngest dev server doesn't require them.
  // In production CI we set them, but we don't want to hard-fail dev startup.
  INNGEST_EVENT_KEY: z.string().min(1, 'is required').optional(),
  INNGEST_SIGNING_KEY: z.string().min(1, 'is required').optional(),

  // ─── WEB PUSH (VAPID) ───────────────────────────────────
  // Optional in dev — without keys, the push pipeline degrades gracefully:
  // /vapid-key returns null, the browser never tries to subscribe, and the
  // inngest push function logs+returns instead of dispatching.
  // Generate with: `npx web-push generate-vapid-keys`.
  VAPID_PUBLIC_KEY: z.string().min(1, 'is required').optional(),
  VAPID_PRIVATE_KEY: z.string().min(1, 'is required').optional(),
  VAPID_SUBJECT: z.string().min(1, 'is required').default('mailto:noreply@sahay.ai'),

  // ─── MONITORING ─────────────────────────────────────────
  SENTRY_DSN: z.string().url('must be a valid Sentry DSN URL').optional(),
  // Build-time only: used by @sentry/cli to upload sourcemaps. Never read at
  // runtime; declared here so Vercel build env validation passes.
  SENTRY_AUTH_TOKEN: z.string().min(1, 'is required').optional(),

  // ─── APP URLs ───────────────────────────────────────────
  API_URL: z.string().url('must be a valid URL'),
  WEB_URL: z.string().url('must be a valid URL'),
  SHOPIFY_APP_HOST: z.string().min(1, 'is required'),

  // ─── CORS ───────────────────────────────────────────────
  CORS_ORIGINS: z.string().min(1, 'is required'),
}).superRefine((cfg, ctx) => {
  // R2 / Cloudflare object storage is required in production. We collect a
  // separate issue per missing variable so all are surfaced in one go.
  if (cfg.NODE_ENV !== 'production') return;
  const r2Required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_URL',
  ] as const;
  for (const key of r2Required) {
    if (!cfg[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'is required in production (set Cloudflare R2 credentials)',
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues;
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════════════════',
    '  Sahay environment validation FAILED',
    '═══════════════════════════════════════════════════════════════',
    '',
    `  ${issues.length} variable${issues.length === 1 ? '' : 's'} failed validation:`,
    '',
  ];

  for (const issue of issues) {
    const varName = issue.path.length > 0 ? String(issue.path[0]) : '<root>';
    lines.push(`    • ${varName}: ${issue.message}`);
  }

  lines.push(
    '',
    '  Fix the variables above (see .env.example for reference) and retry.',
    '═══════════════════════════════════════════════════════════════',
    '',
  );

  // Use process.stderr.write directly so we don't tangle with any logger that
  // might have monkey-patched console. One write = one clean Vercel log entry.
  process.stderr.write(lines.join('\n'));
  process.exit(1);
}

export const env: Env = parsed.data;
export default env;
