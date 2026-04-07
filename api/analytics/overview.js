// Vercel Serverless Function — demo analytics overview

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const period = req.query?.period ?? '7d'
  const multiplier = period === '1d' ? 1 : period === '7d' ? 7 : 30

  return res.status(200).json({
    totalConversations: 47 * multiplier,
    aiResolutionRate: 73.4,
    avgFirstResponseSeconds: 34,
    csatScore: 4.6,
    totalConversationsDelta: 12,
    aiResolutionRateDelta: 3,
    avgFirstResponseDelta: -8,
    csatDelta: 0.1,
  })
}
