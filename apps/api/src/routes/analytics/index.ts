import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware'
export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)
  app.get('/overview', async () => ({ totalConversations: 0 }))
}
