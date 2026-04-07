import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware'
export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)
  app.get('/', async () => ({ data: [] }))
}
