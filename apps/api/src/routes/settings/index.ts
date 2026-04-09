import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware'
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)
  app.get('/channels', async () => ({ channels: {} }))
}
