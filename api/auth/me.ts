import { defineAuthedHandler } from "../../apps/api/src/lib/handler";

export default defineAuthedHandler(
  async (_req, res, ctx) => {
    res.status(200).json({ agent: ctx.agent, tenant: ctx.tenant });
  },
  { methods: ["GET"] },
);
