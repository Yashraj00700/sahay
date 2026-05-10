import { defineAuthedHandler } from '../../apps/api/src/lib/handler'
import { enforce, limits } from '../../apps/api/src/lib/rate-limit'
import { auditCustomerListRead } from '../../apps/api/src/lib/audit-helpers'

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)

    // DPDP/GDPR read audit — fire-and-forget. The query payload is redacted
    // (free-text search reduced to a `hasSearch` boolean) inside the helper
    // so we never persist the agent's PII filter terms.
    void auditCustomerListRead(ctx, req.query)

    res.status(200).json({ data: [] })
  },
  { methods: ['GET'] },
)
