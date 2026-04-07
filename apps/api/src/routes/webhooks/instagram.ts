import type { FastifyPluginAsync } from 'fastify'
export const instagramWebhook: FastifyPluginAsync = async (app) => {
  app.get('/instagram', async (req, reply) => {
    const query = req.query as any
    if (query['hub.mode'] === 'subscribe') return reply.send(query['hub.challenge'])
    return reply.status(400).send('Invalid')
  })
  app.post('/instagram', async (_req, reply) => { reply.send('EVENT_RECEIVED') })
}
