// ─── OpenAPI Registry ─────────────────────────────────────────────────────────
// Thin singleton wrapper around @asteasolutions/zod-to-openapi's
// `OpenAPIRegistry`. Routes call `registerRoute(...)` to declare themselves;
// `build-spec.ts` then walks the registry to produce a 3.1 spec.

import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z, type ZodTypeAny } from "zod";

// Mutates `z` to add the `.openapi()` chainable. Must be called exactly once,
// before any schema files import `z`. Importing this module from
// `lib/openapi/schemas.ts` (and transitively from every route registration)
// guarantees that ordering.
extendZodWithOpenApi(z);

// ─── Singleton registry ──────────────────────────────────────────────────────
// All routes + schemas register against this single instance.
export const registry = new OpenAPIRegistry();

// Bearer-auth security scheme is registered up-front so individual routes can
// just reference it by name in their `security: [{ bearerAuth: [] }]` block.
registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description:
    "Agent-issued JWT access token. Obtain via POST /api/auth/login.",
});

// ─── registerRoute helper ────────────────────────────────────────────────────
// Mirrors the subset of the registry path-item shape we actually use, so
// route files don't have to import the upstream types.

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteRequest {
  body?: ZodTypeAny;
  bodyContentType?: string;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  headers?: ZodTypeAny;
}

export interface RouteResponses {
  [statusCode: number]: {
    description: string;
    schema?: ZodTypeAny;
  };
}

export interface RegisterRouteInput {
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  request?: RouteRequest;
  responses: RouteResponses;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
}

export function registerRoute(input: RegisterRouteInput): void {
  const request: Record<string, unknown> = {};
  if (input.request?.query) request.query = input.request.query;
  if (input.request?.params) request.params = input.request.params;
  if (input.request?.headers) request.headers = input.request.headers;
  if (input.request?.body) {
    request.body = {
      content: {
        [input.request.bodyContentType ?? "application/json"]: {
          schema: input.request.body,
        },
      },
    };
  }

  const responses: Record<
    string,
    {
      description: string;
      content?: { "application/json": { schema: unknown } };
    }
  > = {};
  for (const [code, r] of Object.entries(input.responses)) {
    responses[code] = r.schema
      ? {
          description: r.description,
          content: { "application/json": { schema: r.schema } },
        }
      : { description: r.description };
  }

  registry.registerPath({
    method: input.method,
    path: input.path,
    summary: input.summary,
    description: input.description,
    tags: input.tags,
    request: Object.keys(request).length ? request : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    responses: responses as any,
    security: input.security,
    deprecated: input.deprecated,
  });
}
