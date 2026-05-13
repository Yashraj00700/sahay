// ─── GET /api/openapi.json ───────────────────────────────────────────────────
// Serves the generated OpenAPI 3.1 spec for the Sahay API. Public — no auth.
// Cached at the edge for 5 minutes; the spec is content-stable across a deploy
// so this is plenty.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { defineHandler } from "../apps/api/src/lib/handler";
import { buildSpec } from "../apps/api/src/lib/openapi/build-spec";

export default defineHandler(
  async (_req: VercelRequest, res: VercelResponse) => {
    const spec = buildSpec();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).send(JSON.stringify(spec));
  },
  { methods: ["GET"] },
);
