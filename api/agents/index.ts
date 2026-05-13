// ─── Agents: List (Vercel Function) ───────────────────────────────────────────
// GET /api/agents — list every agent in the caller's tenant.
//
// Allowed roles: super_admin, admin. Lower roles see only themselves elsewhere
// in the app (this endpoint is for team management).

import { agents } from "@sahay/db";
import { eq, desc } from "drizzle-orm";
import {
  defineAuthedHandler,
  requireRole,
} from "../../apps/api/src/lib/handler";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";

interface AgentSummary {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
  invitePending: boolean;
  inviteSentAt: string | null;
  createdAt: string | null;
}

export default defineAuthedHandler(
  async (_req, res, ctx) => {
    requireRole(ctx, ["super_admin", "admin"]);
    await enforce(limits.perTenant(), ctx.tenant.id);

    const rows = await ctx.withTenant((tx) =>
      tx
        .select({
          id: agents.id,
          email: agents.email,
          name: agents.name,
          avatarUrl: agents.avatarUrl,
          role: agents.role,
          isActive: agents.isActive,
          isOnline: agents.isOnline,
          lastSeenAt: agents.lastSeenAt,
          inviteToken: agents.inviteToken,
          inviteAcceptedAt: agents.inviteAcceptedAt,
          createdAt: agents.createdAt,
        })
        .from(agents)
        .where(eq(agents.tenantId, ctx.tenant.id))
        .orderBy(desc(agents.createdAt)),
    );

    const data: AgentSummary[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      avatarUrl: r.avatarUrl,
      role: r.role,
      isActive: r.isActive ?? false,
      isOnline: r.isOnline ?? false,
      lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
      invitePending: r.inviteToken !== null && r.inviteAcceptedAt === null,
      inviteSentAt: r.createdAt ? r.createdAt.toISOString() : null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    }));

    res.status(200).json({ agents: data });
  },
  { methods: ["GET"] },
);
