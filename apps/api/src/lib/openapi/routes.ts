// ─── OpenAPI Route Registrations ──────────────────────────────────────────────
// Each endpoint declares its request/response shape against the registry.
// Schemas are mirrored from the route files (see `impl:` comments) — when a
// route's Zod changes, the matching block here must be updated. See
// `build-spec.ts` for context on why we don't auto-discover.

import { z } from 'zod'
import { registerRoute } from './registry'
import {
  AuthAgent,
  AuthTenant,
  ConversationDetail,
  ConversationIdParam,
  ConversationListItem,
  ErrorResponse,
  Message,
  PaginationMeta,
} from './schemas'

const BEARER = [{ bearerAuth: [] }]

// Common error responses each authed JSON endpoint can produce.
const commonErrors = {
  400: { description: 'Validation error.', schema: ErrorResponse },
  401: { description: 'Missing or invalid bearer token.', schema: ErrorResponse },
  429: { description: 'Rate limit exceeded.', schema: ErrorResponse },
  500: { description: 'Unexpected server error.', schema: ErrorResponse },
} as const

// ─── System ──────────────────────────────────────────────────────────────────

/* impl: api/health.ts */
registerRoute({
  method: 'get',
  path: '/api/health',
  summary: 'Liveness probe',
  description: 'Returns 200 if the function process is running. No dependencies checked.',
  tags: ['system'],
  responses: {
    200: {
      description: 'Service is alive.',
      schema: z
        .object({
          status: z.literal('ok'),
          timestamp: z.string().datetime(),
        })
        .openapi('HealthResponse'),
    },
  },
})

/* impl: api/ready.ts */
registerRoute({
  method: 'get',
  path: '/api/ready',
  summary: 'Readiness probe',
  description: 'Probes Postgres, Redis, and the Anthropic API. 503 if any probe fails.',
  tags: ['system'],
  responses: {
    200: {
      description: 'All dependencies healthy.',
      schema: z
        .object({
          ok: z.boolean(),
          probes: z.array(
            z.object({
              name: z.string(),
              ok: z.boolean(),
              latencyMs: z.number().int(),
              error: z.string().optional(),
            }),
          ),
          timestamp: z.string().datetime(),
        })
        .openapi('ReadyResponse'),
    },
    503: { description: 'One or more dependencies unhealthy.', schema: ErrorResponse },
  },
})

/* impl: api/inngest.ts */
registerRoute({
  method: 'post',
  path: '/api/inngest',
  summary: 'Inngest function runner',
  description:
    'Inngest-served handler exposing all background functions. Authentication is via Inngest signing-key, not bearer tokens. Not intended for direct human use.',
  tags: ['system'],
  responses: {
    200: { description: 'Function dispatched / introspected.' },
    401: { description: 'Bad signing key.', schema: ErrorResponse },
  },
})

// ─── Auth ────────────────────────────────────────────────────────────────────

/* impl: api/auth/login.ts */
registerRoute({
  method: 'post',
  path: '/api/auth/login',
  summary: 'Sign in with email + password',
  description: 'Returns access + refresh tokens and the agent/tenant principal.',
  tags: ['auth'],
  request: {
    body: z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
      })
      .openapi('LoginRequest'),
  },
  responses: {
    200: {
      description: 'Credentials accepted.',
      schema: z
        .object({
          token: z.string().openapi({ description: 'Short-lived JWT access token.' }),
          refreshToken: z.string(),
          expiresIn: z.number().int().openapi({ description: 'Access token TTL in seconds.' }),
          agent: AuthAgent,
          tenant: AuthTenant,
        })
        .openapi('LoginResponse'),
    },
    400: commonErrors[400],
    401: { description: 'Invalid email or password.', schema: ErrorResponse },
    429: commonErrors[429],
  },
})

/* impl: api/auth/refresh.ts */
registerRoute({
  method: 'post',
  path: '/api/auth/refresh',
  summary: 'Mint a new access token from a refresh token',
  tags: ['auth'],
  request: {
    body: z
      .object({ refreshToken: z.string().min(1) })
      .openapi('RefreshRequest'),
  },
  responses: {
    200: {
      description: 'New access token issued.',
      schema: z
        .object({ token: z.string(), expiresIn: z.number().int() })
        .openapi('RefreshResponse'),
    },
    400: commonErrors[400],
    401: { description: 'Refresh token invalid or expired.', schema: ErrorResponse },
  },
})

/* impl: api/auth/logout.ts */
registerRoute({
  method: 'post',
  path: '/api/auth/logout',
  summary: 'Sign out the current agent',
  description: 'Marks the agent offline. Tokens remain valid until expiry; client should drop them.',
  tags: ['auth'],
  security: BEARER,
  responses: {
    200: {
      description: 'Logged out.',
      schema: z.object({ success: z.literal(true) }).openapi('LogoutResponse'),
    },
    401: commonErrors[401],
  },
})

/* impl: api/auth/me.ts */
registerRoute({
  method: 'get',
  path: '/api/auth/me',
  summary: 'Return the current agent and tenant',
  tags: ['auth'],
  security: BEARER,
  responses: {
    200: {
      description: 'Authenticated principal.',
      schema: z.object({ agent: AuthAgent, tenant: AuthTenant }).openapi('MeResponse'),
    },
    401: commonErrors[401],
  },
})

/* impl: api/auth/forgot-password.ts */
registerRoute({
  method: 'post',
  path: '/api/auth/forgot-password',
  summary: 'Request a password-reset email',
  description:
    'Always returns success regardless of whether the email exists, to avoid account-existence leaks.',
  tags: ['auth'],
  request: {
    body: z.object({ email: z.string().email() }).openapi('ForgotPasswordRequest'),
  },
  responses: {
    200: {
      description: 'Reset email dispatched (or silently dropped).',
      schema: z
        .object({ success: z.literal(true), message: z.string() })
        .openapi('ForgotPasswordResponse'),
    },
    400: commonErrors[400],
    429: commonErrors[429],
  },
})

/* impl: api/auth/reset-password.ts */
registerRoute({
  method: 'post',
  path: '/api/auth/reset-password',
  summary: 'Complete a password reset using the token from the email',
  tags: ['auth'],
  request: {
    body: z
      .object({
        token: z.string().min(1),
        password: z
          .string()
          .min(10)
          .max(100)
          .openapi({ description: 'Must contain upper, lower, and a digit.' }),
      })
      .openapi('ResetPasswordRequest'),
  },
  responses: {
    200: {
      description: 'Password updated.',
      schema: z
        .object({ success: z.literal(true), message: z.string() })
        .openapi('ResetPasswordResponse'),
    },
    400: { description: 'Invalid or expired reset token.', schema: ErrorResponse },
  },
})

// ─── Conversations ───────────────────────────────────────────────────────────

/* impl: api/conversations/index.ts */
registerRoute({
  method: 'get',
  path: '/api/conversations',
  summary: 'List conversations',
  description: 'Tenant-scoped, paginated list with optional status/channel/assignee filters.',
  tags: ['conversations'],
  security: BEARER,
  request: {
    query: z
      .object({
        status: z
          .enum(['open', 'pending', 'snoozed', 'resolved', 'closed', 'all'])
          .default('open'),
        channel: z
          .enum(['whatsapp', 'instagram', 'webchat', 'email', 'all'])
          .default('all'),
        assignedTo: z.string().uuid().optional(),
        unassigned: z.coerce.boolean().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
        sortBy: z.enum(['createdAt', 'updatedAt', 'urgencyScore']).default('updatedAt'),
        sortDir: z.enum(['asc', 'desc']).default('desc'),
      })
      .openapi('ConversationListQuery'),
  },
  responses: {
    200: {
      description: 'Paginated list.',
      schema: z
        .object({
          data: z.array(ConversationListItem),
          pagination: PaginationMeta,
        })
        .openapi('ConversationListResponse'),
    },
    ...commonErrors,
  },
})

/* impl: api/conversations/[id].ts (GET) */
registerRoute({
  method: 'get',
  path: '/api/conversations/{id}',
  summary: 'Get a conversation by ID',
  tags: ['conversations'],
  security: BEARER,
  request: { params: ConversationIdParam },
  responses: {
    200: { description: 'Conversation found.', schema: ConversationDetail },
    401: commonErrors[401],
    404: { description: 'Not found.', schema: ErrorResponse },
    429: commonErrors[429],
  },
})

/* impl: api/conversations/[id].ts (PATCH) */
registerRoute({
  method: 'patch',
  path: '/api/conversations/{id}',
  summary: 'Update conversation status, assignment, or metadata',
  tags: ['conversations'],
  security: BEARER,
  request: {
    params: ConversationIdParam,
    body: z
      .object({
        status: z.enum(['open', 'pending', 'snoozed', 'resolved', 'closed']).optional(),
        assignedTo: z.string().uuid().nullable().optional(),
        snoozeUntil: z.string().datetime().optional(),
        tags: z.array(z.string()).optional(),
        urgencyScore: z.number().int().min(1).max(5).optional(),
      })
      .openapi('ConversationPatch'),
  },
  responses: {
    200: { description: 'Updated conversation row.', schema: ConversationDetail },
    400: commonErrors[400],
    401: commonErrors[401],
    404: { description: 'Not found.', schema: ErrorResponse },
    429: commonErrors[429],
  },
})

/* impl: api/conversations/[id]/messages.ts */
registerRoute({
  method: 'get',
  path: '/api/conversations/{id}/messages',
  summary: 'List messages for a conversation (cursor paginated)',
  description: 'Returns messages newest-first internally then reversed; use `nextCursor` (an ISO timestamp) for older pages.',
  tags: ['conversations'],
  security: BEARER,
  request: {
    params: ConversationIdParam,
    query: z
      .object({
        cursor: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .openapi('MessageListQuery'),
  },
  responses: {
    200: {
      description: 'Page of messages.',
      schema: z
        .object({
          messages: z.array(Message),
          nextCursor: z.string().datetime().nullable(),
        })
        .openapi('MessageListResponse'),
    },
    401: commonErrors[401],
    404: { description: 'Conversation not found.', schema: ErrorResponse },
    429: commonErrors[429],
  },
})

/* impl: api/conversations/[id]/notes.ts */
registerRoute({
  method: 'post',
  path: '/api/conversations/{id}/notes',
  summary: 'Add an internal agent note to a conversation',
  tags: ['conversations'],
  security: BEARER,
  request: {
    params: ConversationIdParam,
    body: z
      .object({ content: z.string().min(1).max(4000) })
      .openapi('AddNoteRequest'),
  },
  responses: {
    201: { description: 'Note created.', schema: Message },
    400: commonErrors[400],
    401: commonErrors[401],
    404: { description: 'Conversation not found.', schema: ErrorResponse },
    429: commonErrors[429],
  },
})

/* impl: api/conversations/[id]/assign.ts */
registerRoute({
  method: 'post',
  path: '/api/conversations/{id}/assign',
  summary: 'Assign (or unassign) a conversation to an agent',
  description: 'Pass `agentId: null` to unassign.',
  tags: ['conversations'],
  security: BEARER,
  request: {
    params: ConversationIdParam,
    body: z
      .object({ agentId: z.string().uuid().nullable() })
      .openapi('AssignRequest'),
  },
  responses: {
    200: { description: 'Updated conversation row.', schema: ConversationDetail },
    400: commonErrors[400],
    401: commonErrors[401],
    404: { description: 'Conversation not found.', schema: ErrorResponse },
    429: commonErrors[429],
  },
})

/* impl: api/conversations/[id]/resolve.ts */
registerRoute({
  method: 'post',
  path: '/api/conversations/{id}/resolve',
  summary: 'Mark a conversation resolved',
  description: 'Sets status=resolved, resolvedAt=now, and computes resolutionTimeSeconds.',
  tags: ['conversations'],
  security: BEARER,
  request: { params: ConversationIdParam },
  responses: {
    200: { description: 'Updated conversation row.', schema: ConversationDetail },
    401: commonErrors[401],
    404: { description: 'Conversation not found.', schema: ErrorResponse },
    429: commonErrors[429],
  },
})

/* impl: api/conversations/[id]/reopen.ts */
registerRoute({
  method: 'post',
  path: '/api/conversations/{id}/reopen',
  summary: 'Reopen a resolved/closed conversation',
  tags: ['conversations'],
  security: BEARER,
  request: { params: ConversationIdParam },
  responses: {
    200: { description: 'Updated conversation row.', schema: ConversationDetail },
    401: commonErrors[401],
    404: { description: 'Conversation not found.', schema: ErrorResponse },
    429: commonErrors[429],
  },
})

// ─── Customers ───────────────────────────────────────────────────────────────

/* impl: api/customers/index.ts */
registerRoute({
  method: 'get',
  path: '/api/customers',
  summary: 'List customers (stub)',
  description: 'Currently returns an empty list. Filters and pagination TBD.',
  tags: ['customers'],
  security: BEARER,
  responses: {
    200: {
      description: 'Customer list.',
      schema: z
        .object({ data: z.array(z.unknown()) })
        .openapi('CustomerListResponse'),
    },
    401: commonErrors[401],
    429: commonErrors[429],
  },
})

// ─── AI ──────────────────────────────────────────────────────────────────────

/* impl: api/ai/suggest.ts */
registerRoute({
  method: 'post',
  path: '/api/ai/suggest',
  summary: 'AI reply suggestion (stub)',
  description: 'Currently returns `{ suggestion: null }`. Will produce a Claude-generated draft reply for the active conversation.',
  tags: ['ai'],
  security: BEARER,
  responses: {
    200: {
      description: 'Suggestion result.',
      schema: z
        .object({ suggestion: z.string().nullable() })
        .openapi('AiSuggestResponse'),
    },
    401: commonErrors[401],
    429: commonErrors[429],
  },
})

// ─── Knowledge Base ──────────────────────────────────────────────────────────

/* impl: api/kb/articles/index.ts */
registerRoute({
  method: 'get',
  path: '/api/kb/articles',
  summary: 'List KB articles (stub)',
  description: 'Currently returns an empty list. Will support full-text search and tag filters.',
  tags: ['kb'],
  security: BEARER,
  responses: {
    200: {
      description: 'KB article list.',
      schema: z
        .object({ data: z.array(z.unknown()) })
        .openapi('KbArticleListResponse'),
    },
    401: commonErrors[401],
    429: commonErrors[429],
  },
})

// ─── Analytics ───────────────────────────────────────────────────────────────

/* impl: api/analytics/overview.ts */
registerRoute({
  method: 'get',
  path: '/api/analytics/overview',
  summary: 'Tenant overview metrics (stub)',
  description: 'Skeleton response — will return CSAT, AHT, AI deflection, channel breakdown.',
  tags: ['analytics'],
  security: BEARER,
  responses: {
    200: {
      description: 'Overview metrics.',
      schema: z
        .object({ totalConversations: z.number().int() })
        .openapi('AnalyticsOverviewResponse'),
    },
    401: commonErrors[401],
    429: commonErrors[429],
  },
})

// ─── Settings ────────────────────────────────────────────────────────────────

/* impl: api/settings/channels.ts */
registerRoute({
  method: 'get',
  path: '/api/settings/channels',
  summary: 'Channel configuration (stub)',
  description: 'Returns the per-tenant configuration for WhatsApp / Instagram / webchat / email channels.',
  tags: ['settings'],
  security: BEARER,
  responses: {
    200: {
      description: 'Channel settings.',
      schema: z
        .object({ channels: z.record(z.string(), z.unknown()) })
        .openapi('ChannelsSettingsResponse'),
    },
    401: commonErrors[401],
    429: commonErrors[429],
  },
})

// ─── Realtime ────────────────────────────────────────────────────────────────

/* impl: api/realtime/auth.ts */
registerRoute({
  method: 'post',
  path: '/api/realtime/auth',
  summary: 'Pusher channel authorization',
  description:
    'Authorizes a Pusher subscription for a private/presence channel. Called by the Pusher client; not for direct human use.',
  tags: ['realtime'],
  security: BEARER,
  request: {
    bodyContentType: 'application/x-www-form-urlencoded',
    body: z
      .object({
        socket_id: z.string().min(1),
        channel_name: z.string().min(1),
      })
      .openapi('RealtimeAuthRequest'),
  },
  responses: {
    200: {
      description: 'Pusher auth payload (shape determined by Pusher SDK).',
      schema: z
        .object({ auth: z.string(), channel_data: z.string().optional() })
        .openapi('RealtimeAuthResponse'),
    },
    401: commonErrors[401],
    403: { description: 'Channel access denied.', schema: ErrorResponse },
  },
})

// ─── Shopify OAuth ───────────────────────────────────────────────────────────

/* impl: api/shopify/install.ts */
registerRoute({
  method: 'get',
  path: '/api/shopify/install',
  summary: 'Begin Shopify OAuth install',
  description:
    'Validates the shop domain, mints a one-time state nonce, and 302-redirects the merchant to Shopify\'s authorize URL.',
  tags: ['shopify'],
  request: {
    query: z
      .object({
        shop: z
          .string()
          .openapi({ example: 'acme-store.myshopify.com', description: 'Merchant shop domain.' }),
      })
      .openapi('ShopifyInstallQuery'),
  },
  responses: {
    302: { description: 'Redirect to Shopify authorize URL.' },
    400: { description: 'Missing/invalid shop param.', schema: ErrorResponse },
    405: { description: 'Method not allowed.', schema: ErrorResponse },
    429: commonErrors[429],
    500: commonErrors[500],
  },
})

/* impl: api/shopify/callback.ts */
registerRoute({
  method: 'get',
  path: '/api/shopify/callback',
  summary: 'Shopify OAuth callback',
  description:
    'Verifies HMAC + state, exchanges code for an offline access token, upserts the tenant, registers mandatory webhooks, and redirects into onboarding. On any failure, redirects to onboarding with `?error=<code>`.',
  tags: ['shopify'],
  request: {
    query: z
      .object({
        shop: z.string(),
        code: z.string(),
        state: z.string(),
        hmac: z.string(),
        host: z.string().optional(),
        timestamp: z.string().optional(),
      })
      .openapi('ShopifyCallbackQuery'),
  },
  responses: {
    302: { description: 'Redirect to onboarding (success or error).' },
    405: { description: 'Method not allowed.', schema: ErrorResponse },
  },
})

// ─── Webhooks (external — Meta / Shopify HMAC-signed) ────────────────────────

/* impl: api/webhooks/whatsapp.ts */
registerRoute({
  method: 'get',
  path: '/api/webhooks/whatsapp',
  summary: 'WhatsApp Cloud API verification handshake',
  description:
    'EXTERNAL — called by Meta during webhook subscription. Echoes `hub.challenge` if `hub.verify_token` matches a tenant\'s `whatsappVerifyToken`.',
  tags: ['webhooks'],
  request: {
    query: z
      .object({
        'hub.mode': z.literal('subscribe'),
        'hub.verify_token': z.string(),
        'hub.challenge': z.string(),
      })
      .openapi('WhatsappVerifyQuery'),
  },
  responses: {
    200: { description: 'Echo of `hub.challenge`.' },
    400: { description: 'Bad `hub.mode`.' },
    403: { description: 'Verify token mismatch.' },
  },
})

/* impl: api/webhooks/whatsapp.ts */
registerRoute({
  method: 'post',
  path: '/api/webhooks/whatsapp',
  summary: 'WhatsApp Cloud API event ingest',
  description:
    'EXTERNAL — Meta-signed (`x-hub-signature-256` HMAC over the raw body using `WA_APP_SECRET`). The handler verifies, fans events to Inngest, and ALWAYS returns 200 to prevent Meta retries.',
  tags: ['webhooks'],
  responses: {
    200: { description: 'Always 200 (`EVENT_RECEIVED`).' },
    405: { description: 'Method not allowed.' },
  },
})

/* impl: api/webhooks/instagram.ts */
registerRoute({
  method: 'get',
  path: '/api/webhooks/instagram',
  summary: 'Instagram Messaging verification handshake',
  description:
    'EXTERNAL — called by Meta during webhook subscription. Compares `hub.verify_token` against `IG_VERIFY_TOKEN`.',
  tags: ['webhooks'],
  request: {
    query: z
      .object({
        'hub.mode': z.literal('subscribe'),
        'hub.verify_token': z.string(),
        'hub.challenge': z.string(),
      })
      .openapi('InstagramVerifyQuery'),
  },
  responses: {
    200: { description: 'Echo of `hub.challenge`.' },
    400: { description: 'Bad `hub.mode`.' },
    403: { description: 'Verify token mismatch.' },
  },
})

/* impl: api/webhooks/instagram.ts */
registerRoute({
  method: 'post',
  path: '/api/webhooks/instagram',
  summary: 'Instagram Messaging event ingest',
  description:
    'EXTERNAL — Meta-signed (`x-hub-signature-256` HMAC using `IG_APP_SECRET`). Verifies, dispatches messaging events to Inngest, ALWAYS returns 200.',
  tags: ['webhooks'],
  responses: {
    200: { description: 'Always 200 (`EVENT_RECEIVED`).' },
    405: { description: 'Method not allowed.' },
  },
})

/* impl: api/webhooks/shopify.ts */
registerRoute({
  method: 'post',
  path: '/api/webhooks/shopify',
  summary: 'Shopify webhook receiver',
  description:
    'EXTERNAL — Shopify-signed (`x-shopify-hmac-sha256` base64 HMAC over the raw body using `SHOPIFY_WEBHOOK_SECRET`). Tenant is resolved via `x-shopify-shop-domain`. Returns 401 on bad HMAC, 429 if rate-limited (Shopify will retry), 200 otherwise.',
  tags: ['webhooks'],
  responses: {
    200: { description: 'Event accepted (or unknown topic, intentionally ignored).' },
    400: { description: 'Bad/missing topic header or invalid JSON.', schema: ErrorResponse },
    401: { description: 'Bad/missing HMAC, missing shop, or unknown tenant.', schema: ErrorResponse },
    429: { description: 'Rate limited; Shopify will retry.', schema: ErrorResponse },
    500: { description: 'Body read or enqueue failed; Shopify will retry.', schema: ErrorResponse },
  },
})
