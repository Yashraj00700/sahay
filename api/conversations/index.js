// Vercel Serverless Function — demo conversations

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const conversations = [
    {
      id: 'conv-001',
      channel: 'whatsapp',
      status: 'open',
      primaryIntent: 'order_status',
      sentiment: 'neutral',
      urgencyScore: 6,
      aiHandled: true,
      humanTouched: false,
      turnCount: 3,
      createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 60000).toISOString(),
      customer: { id: 'cust-001', name: 'Ananya Sharma', phone: '+919876543210', tier: 'vip' },
      assignedAgent: null,
      lastMessage: 'Mera order kab aayega? 3 din ho gaye hai 😔',
    },
    {
      id: 'conv-002',
      channel: 'instagram',
      status: 'open',
      primaryIntent: 'product_recommendation',
      sentiment: 'positive',
      urgencyScore: 3,
      aiHandled: true,
      humanTouched: false,
      turnCount: 5,
      createdAt: new Date(Date.now() - 45 * 60000).toISOString(),
      updatedAt: new Date(Date.now() - 8 * 60000).toISOString(),
      customer: { id: 'cust-002', name: 'Riya Patel', phone: null, tier: 'regular' },
      assignedAgent: null,
      lastMessage: 'Which face oil is best for dry skin in winters?',
    },
    {
      id: 'conv-003',
      channel: 'whatsapp',
      status: 'open',
      primaryIntent: 'return_request',
      sentiment: 'negative',
      urgencyScore: 9,
      aiHandled: false,
      humanTouched: true,
      turnCount: 7,
      createdAt: new Date(Date.now() - 90 * 60000).toISOString(),
      updatedAt: new Date(Date.now() - 15 * 60000).toISOString(),
      customer: { id: 'cust-003', name: 'Pooja Mehta', phone: '+918765432109', tier: 'regular' },
      assignedAgent: { name: 'Rahul Verma' },
      lastMessage: 'I want a full refund, the product caused a reaction!!',
    },
    {
      id: 'conv-004',
      channel: 'webchat',
      status: 'resolved',
      primaryIntent: 'order_status',
      sentiment: 'positive',
      urgencyScore: 2,
      aiHandled: true,
      humanTouched: false,
      turnCount: 2,
      createdAt: new Date(Date.now() - 3 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 2.5 * 3600000).toISOString(),
      customer: { id: 'cust-004', name: 'Deepika Nair', phone: null, tier: 'vip' },
      assignedAgent: null,
      lastMessage: 'Thanks! Got the tracking link 🙏',
    },
    {
      id: 'conv-005',
      channel: 'whatsapp',
      status: 'open',
      primaryIntent: 'payment_issue',
      sentiment: 'neutral',
      urgencyScore: 7,
      aiHandled: false,
      humanTouched: false,
      turnCount: 1,
      createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
      updatedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      customer: { id: 'cust-005', name: 'Kavya Singh', phone: '+917654321098', tier: 'regular' },
      assignedAgent: null,
      lastMessage: 'COD available hai? Online payment nahi kar sakti',
    },
  ]

  return res.status(200).json({
    conversations,
    pagination: { total: conversations.length, page: 1, limit: 25, hasMore: false },
  })
}
