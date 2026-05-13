// ─── Reusable OpenAPI Schemas ─────────────────────────────────────────────────
// Common Zod schemas that appear across many routes. Each calls `.openapi(name)`
// so it shows up as a named `#/components/schemas/<Name>` in the generated spec
// — that keeps the rendered doc small and the SDKs idiomatic.

import { z } from "zod";
// IMPORTANT: importing `./registry` first ensures `extendZodWithOpenApi(z)` ran
// before any of these schemas attach `.openapi(...)` metadata.
import "./registry";

// ─── Errors ──────────────────────────────────────────────────────────────────

export const ErrorBody = z
  .object({
    code: z.string().openapi({
      example: "VALIDATION_ERROR",
      description: "Stable machine-readable error code.",
    }),
    message: z.string().openapi({
      example: "Invalid input",
      description: "Human-readable explanation.",
    }),
    requestId: z.string().openapi({
      example: "7c1b2c3d-…",
      description: "Echoed X-Request-Id for support.",
    }),
    details: z.unknown().optional(),
  })
  .openapi("ErrorBody", { description: "Body of any non-2xx response." });

export const ErrorResponse = z
  .object({ error: ErrorBody })
  .openapi("ErrorResponse", {
    description:
      "Standard error envelope used by every endpoint on non-2xx responses.",
  });

// ─── Pagination ──────────────────────────────────────────────────────────────

export const PaginationMeta = z
  .object({
    page: z.number().int().min(1).openapi({ example: 1 }),
    pageSize: z.number().int().min(1).max(100).openapi({ example: 25 }),
    total: z.number().int().min(0).openapi({ example: 137 }),
    totalPages: z.number().int().min(0).openapi({ example: 6 }),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  })
  .openapi("PaginationMeta", {
    description: "Page-based pagination metadata returned by list endpoints.",
  });

// ─── Auth principals ─────────────────────────────────────────────────────────

export const AuthAgent = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    avatarUrl: z.string().url().nullable().optional(),
    role: z.string().openapi({
      example: "admin",
      description: "One of: owner, admin, agent, viewer.",
    }),
  })
  .openapi("AuthAgent", {
    description: "The signed-in agent associated with a token.",
  });

export const AuthTenant = z
  .object({
    id: z.string().uuid(),
    shopifyDomain: z.string().openapi({ example: "acme-store.myshopify.com" }),
    shopName: z.string().nullable().optional(),
    plan: z.string().openapi({ example: "trial" }),
    aiPersonaName: z.string().nullable().optional(),
    aiLanguage: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
  })
  .openapi("AuthTenant", {
    description: "Tenant (merchant store) the agent belongs to.",
  });

// ─── Domain enums (kept narrow — match the route-level Zod) ──────────────────

export const ConversationStatus = z
  .enum(["open", "pending", "snoozed", "resolved", "closed"])
  .openapi("ConversationStatus");

export const ConversationChannel = z
  .enum(["whatsapp", "instagram", "webchat", "email"])
  .openapi("ConversationChannel");

// ─── Conversation list-row (subset returned by GET /api/conversations) ───────

export const ConversationListItem = z
  .object({
    id: z.string().uuid(),
    channel: ConversationChannel,
    status: ConversationStatus,
    primaryIntent: z.string().nullable(),
    sentiment: z.string().nullable(),
    urgencyScore: z.number().int().nullable(),
    aiHandled: z.boolean().nullable(),
    humanTouched: z.boolean().nullable(),
    assignedTo: z.string().uuid().nullable(),
    tags: z.array(z.string()).nullable(),
    turnCount: z.number().int().nullable(),
    createdAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime().nullable(),
    resolvedAt: z.string().datetime().nullable(),
    customerId: z.string().uuid().nullable(),
    customerName: z.string().nullable(),
    customerPhone: z.string().nullable(),
    customerTier: z.string().nullable(),
    agentName: z.string().nullable(),
  })
  .openapi("ConversationListItem");

// Detail view returns a strict superset; for docs, model the extras we expose.
export const ConversationDetail = ConversationListItem.extend({
  tenantId: z.string().uuid(),
  sentimentScore: z.number().nullable(),
  escalationReason: z.string().nullable(),
  routingDecision: z.string().nullable(),
  firstReplyAt: z.string().datetime().nullable(),
  sessionExpiresAt: z.string().datetime().nullable(),
  csatScore: z.number().nullable(),
  resolutionTimeSeconds: z.number().int().nullable(),
  shopifyOrderId: z.string().nullable(),
  codConversionOffered: z.boolean().nullable(),
  codConversionAccepted: z.boolean().nullable(),
  customerEmail: z.string().nullable(),
  customerWhatsappId: z.string().nullable(),
  customerLanguagePref: z.string().nullable(),
  agentEmail: z.string().nullable(),
}).openapi("ConversationDetail");

// ─── Message (returned by /messages and /notes) ──────────────────────────────

export const Message = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    tenantId: z.string().uuid(),
    senderType: z.enum(["agent", "customer", "system", "ai"]),
    senderId: z.string().uuid().nullable(),
    contentType: z
      .enum(["text", "note", "image", "audio", "video", "file"])
      .or(z.string()),
    content: z.string().nullable(),
    sentAt: z.string().datetime().nullable(),
  })
  .openapi("Message", {
    description: "A single message or internal note within a conversation.",
  });

// ─── Common path / id schemas ────────────────────────────────────────────────

export const ConversationIdParam = z
  .object({
    id: z
      .string()
      .uuid()
      .openapi({
        param: { name: "id", in: "path" },
        example: "00000000-0000-0000-0000-000000000000",
        description: "Conversation UUID.",
      }),
  })
  .openapi("ConversationIdParam");
