// Vercel Serverless — analytics/overview
// Matches AnalyticsOverview type from @sahay/shared exactly

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const period = req.query?.period ?? '7d'
  const m = period === '1d' ? 1 : period === '7d' ? 7 : 30

  return res.status(200).json({
    period,
    totalConversations: 47 * m,
    newConversations: 31 * m,
    resolvedConversations: 38 * m,
    aiResolved: 35 * m,
    aiResolutionRate: 73.4,
    avgFirstResponseSeconds: 34,
    avgResolutionSeconds: 420,
    avgCsat: 4.6,
    csatResponses: 18 * m,
    codConversions: 4 * m,
    codConversionRevenue: 12800 * m,
    channelBreakdown: {
      whatsapp: Math.round(0.55 * 47 * m),
      instagram: Math.round(0.30 * 47 * m),
      webchat: Math.round(0.15 * 47 * m),
      email: 0,
    },
    trends: {
      conversationsDelta: 12,
      aiResolutionDelta: 3.1,
      csatDelta: 0.1,
    },
  })
}
