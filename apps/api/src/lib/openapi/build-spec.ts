// ─── OpenAPI Spec Builder ─────────────────────────────────────────────────────
// Walks the registry populated by `./routes` (and the schemas in `./schemas`)
// and renders a 3.1 spec. Pure function — no network, no filesystem. Safe to
// call from a Vercel Function on every request, but `/api/openapi.json.ts`
// caches the response with `Cache-Control: public, max-age=300` anyway.
//
// We intentionally do NOT auto-discover routes from `api/**/*.ts`. That would
// require either (a) running each route file at build-time, which is awkward
// inside a Vercel Function cold start, or (b) AST parsing, which is brittle.
// Instead, every endpoint is registered explicitly in `./routes.ts`. The
// tradeoff (manual mirroring) is documented there.

import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry";

// Side-effect import: triggers all `registerRoute(...)` calls. Must come after
// the registry import so the singleton is initialised first.
import "./routes";

type ServerConfig = { url: string; description?: string };

export interface BuildSpecOptions {
  /** Override the default servers list — useful for previews. */
  servers?: ReadonlyArray<ServerConfig>;
}

export function buildSpec(
  options: BuildSpecOptions = {},
): ReturnType<OpenApiGeneratorV31["generateDocument"]> {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Sahay API",
      version: "0.1.0",
      description:
        "AI-powered customer-support platform for Indian D2C brands. Authentication is via JWT bearer tokens issued by `POST /api/auth/login`. Webhooks are HMAC-signed by external providers (Meta, Shopify) and are not intended for human callers.",
      contact: { name: "Sahay Engineering", url: "https://sahay.dev" },
      license: { name: "Proprietary" },
    },
    servers: options.servers
      ? [...options.servers]
      : [
          { url: "https://api.sahay.dev", description: "Production" },
          { url: "https://staging.api.sahay.dev", description: "Staging" },
          { url: "http://localhost:3000", description: "Local dev" },
        ],
    tags: [
      {
        name: "system",
        description: "Health, readiness, and Inngest plumbing.",
      },
      { name: "auth", description: "Login, refresh, password reset." },
      {
        name: "conversations",
        description: "Inbox, messages, assignments, lifecycle.",
      },
      { name: "customers", description: "Customer directory." },
      { name: "ai", description: "AI suggestions and assist endpoints." },
      { name: "kb", description: "Knowledge base articles." },
      { name: "analytics", description: "Tenant-scoped reporting." },
      { name: "settings", description: "Tenant configuration." },
      { name: "realtime", description: "Pusher channel authorization." },
      { name: "shopify", description: "Shopify OAuth install/callback." },
      {
        name: "webhooks",
        description: "External provider event ingest (Meta, Shopify).",
      },
    ],
  });
}
