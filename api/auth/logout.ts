import { db, agents } from '@sahay/db'
import { eq } from 'drizzle-orm'
import { defineAuthedHandler } from '../../apps/api/src/lib/handler'

export default defineAuthedHandler(
  async (_req, res, ctx) => {
    await db
      .update(agents)
      .set({ isOnline: false, updatedAt: new Date() })
      .where(eq(agents.id, ctx.agent.id))
    res.status(200).json({ success: true })
  },
  { methods: ['POST'] },
)
