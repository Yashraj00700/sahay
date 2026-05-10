import type { VercelRequest, VercelResponse } from '@vercel/node'
import { defineHandler } from '../apps/api/src/lib/handler'

export default defineHandler(async (_req: VercelRequest, res: VercelResponse) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
}, { methods: ['GET'] })
