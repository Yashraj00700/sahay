import type { FastifyPluginAsync } from 'fastify'
export const shopifyWebhook: FastifyPluginAsync = async (app) => {
  app.post('/shopify', async (_req, reply) => { reply.status(200).send('OK') })
}
