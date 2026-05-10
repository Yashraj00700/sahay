import { z } from 'zod'
import { defineHandler, parseBody } from '../../apps/api/src/lib/handler'
import {
  verifyRefreshToken,
  signAccessToken,
  accessTtlSec,
} from '../../apps/api/src/lib/jwt'
import { AuthError } from '../../apps/api/src/lib/errors'

const Schema = z.object({ refreshToken: z.string().min(1) })

export default defineHandler(
  async (req, res) => {
    const { refreshToken } = parseBody(Schema, req.body)
    let payload
    try {
      payload = verifyRefreshToken(refreshToken)
    } catch {
      throw new AuthError('Invalid or expired refresh token')
    }
    const token = signAccessToken({
      agentId: payload.agentId,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
    })
    res.status(200).json({ token, expiresIn: accessTtlSec() })
  },
  { methods: ['POST'] },
)
