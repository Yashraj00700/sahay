// Vercel Serverless Function — demo auth
// Signs a real HS256 JWT using Node crypto (no dependencies)

import crypto from 'crypto'

const DEMO_CREDENTIALS = {
  'admin@rasluxuryoils.com': { password: 'sahay@123', role: 'admin', name: 'Priya Sharma' },
  'agent@rasluxuryoils.com': { password: 'sahay@123', role: 'agent', name: 'Rahul Verma' },
}

const JWT_SECRET = 'sahay-demo-secret-2026'

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function signJWT(payload, expiresIn = 3600) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresIn }))
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${header}.${body}.${sig}`
}

export default function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, password } = req.body ?? {}

  const user = DEMO_CREDENTIALS[email?.toLowerCase()]
  if (!user || user.password !== password) {
    return res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' })
  }

  const agentId = `agent-${email.split('@')[0]}`
  const tenantId = 'tenant-ras-luxury-oils'

  const token = signJWT({ agentId, tenantId, email, role: user.role })
  const refreshToken = signJWT({ agentId, tenantId, type: 'refresh' }, 7 * 24 * 3600)

  return res.status(200).json({
    token,
    refreshToken,
    agent: {
      id: agentId,
      name: user.name,
      email,
      role: user.role,
      tenantId,
      avatarUrl: null,
      isOnline: true,
    },
    tenant: {
      id: tenantId,
      shopName: 'RAS Luxury Oils',
      shopifyDomain: 'ras-luxury-oils.myshopify.com',
      aiPersonaName: 'Sahay',
      aiLanguage: 'hinglish',
      plan: 'growth',
    },
  })
}
