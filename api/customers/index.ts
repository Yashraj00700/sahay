import { defineAuthedHandler } from '../../apps/api/src/lib/handler'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'

export default defineAuthedHandler(
  async (_req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)
    res.status(200).json({ data: [] })
  },
  { methods: ['GET'] },
)
