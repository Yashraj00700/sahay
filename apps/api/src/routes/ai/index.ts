import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.middleware'

const suggestSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(10000),
  context: z.record(z.unknown()).optional(),
})

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.post('/suggest', async (req, reply) => {
    const parsed = suggestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', errors: parsed.error.flatten() })
    }
    return reply.send({ suggestion: null })
  })
}
