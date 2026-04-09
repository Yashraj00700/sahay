import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware'
export const kbRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)
  app.get('/articles', async () => ({ data: [] }))
}
