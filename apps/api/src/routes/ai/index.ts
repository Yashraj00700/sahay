import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware'
export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)
  app.post('/suggest', async () => ({ suggestion: null }))
}
