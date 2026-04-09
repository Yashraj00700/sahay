import 'dotenv/config'
import { db } from '../index'
import { tenants, agents, customers, conversations, messages } from '../schema'
import bcrypt from 'bcryptjs'

/**
 * Seed script: creates a RAS Luxury Oils test tenant with demo data
 * Run with: npm run db:seed (from packages/db)
 */
async function seed() {
  console.log('🌱 Seeding database with RAS Luxury Oils demo data...')

  // ─── 1. Create Tenant: RAS Luxury Oils ───────────────────
  const [tenant] = await db.insert(tenants).values({
    shopifyDomain: 'ras-luxury-oils.myshopify.com',
    shopifyAccessToken: 'shpat_demo_token_replace_with_real',
    shopName: 'RAS Luxury Oils',
    shopEmail: 'support@rasluxuryoils.com',
    shopCurrency: 'INR',
    plan: 'growth',
    aiPersonaName: 'Priti',
    aiLanguage: 'hinglish',
    aiTone: 'warm',
    aiConfidenceThreshold: 0.75,
    timezone: 'Asia/Kolkata',
    isActive: true,
  }).returning()

  console.log('✅ Tenant created:', tenant?.shopName)

  if (!tenant) throw new Error('Failed to create tenant')

  // ─── 2. Create Agents ─────────────────────────────────────
  const passwordHash = await bcrypt.hash('sahay@123', 12)

  const [adminAgent, supportAgent] = await db.insert(agents).values([
    {
      tenantId: tenant.id,
      email: 'admin@rasluxuryoils.com',
      name: 'Shubhika Jain',
      role: 'admin',
      passwordHash,
      isActive: true,
    },
    {
      tenantId: tenant.id,
      email: 'support@rasluxuryoils.com',
      name: 'Meera Sharma',
      role: 'agent',
      passwordHash,
      isActive: true,
    },
  ]).returning()

  console.log('✅ Agents created:', adminAgent?.name, supportAgent?.name)

  // ─── 3. Create Demo Customers ─────────────────────────────
  const [customer1, customer2, customer3] = await db.insert(customers).values([
    {
      tenantId: tenant.id,
      phone: '+919876543210',
      whatsappId: '919876543210',
      name: 'Priya Sharma',
      email: 'priya.sharma@gmail.com',
      city: 'Mumbai',
      state: 'Maharashtra',
      languagePref: 'hinglish',
      totalOrders: 12,
      totalSpent: '34800',
      tier: 'vip',
      churnRisk: 'low',
      tags: ['vip', 'loyal-customer', 'skincare-enthusiast'],
      waSupportConsent: true,
      waMarketingConsent: true,
    },
    {
      tenantId: tenant.id,
      phone: '+917654321098',
      whatsappId: '917654321098',
      name: 'Anita Patel',
      email: 'anita.p@yahoo.in',
      city: 'Ahmedabad',
      state: 'Gujarat',
      languagePref: 'hinglish',
      totalOrders: 3,
      totalSpent: '6200',
      tier: 'loyal',
      churnRisk: 'medium',
      tags: ['loyal'],
      waSupportConsent: true,
      waMarketingConsent: false,
    },
    {
      tenantId: tenant.id,
      phone: '+919988776655',
      whatsappId: '919988776655',
      name: 'Rohit Verma',
      email: 'rohit.v@gmail.com',
      city: 'Delhi',
      state: 'Delhi',
      languagePref: 'hi',
      totalOrders: 1,
      totalSpent: '2400',
      tier: 'new',
      churnRisk: 'high',
      waSupportConsent: true,
      waMarketingConsent: false,
    },
  ]).returning()

  console.log('✅ Customers created:', customer1?.name, customer2?.name, customer3?.name)

  if (!customer1 || !customer2 || !customer3) throw new Error('Failed to create customers')
  if (!adminAgent || !supportAgent) throw new Error('Failed to create agents')

  // ─── 4. Create Demo Conversations ─────────────────────────
  const [conv1, conv2, conv3] = await db.insert(conversations).values([
    {
      tenantId: tenant.id,
      customerId: customer1.id,
      channel: 'whatsapp',
      status: 'open',
      primaryIntent: 'order_tracking',
      sentiment: 'neutral',
      sentimentScore: '0.1',
      urgencyScore: 2,
      aiHandled: false,
      humanTouched: false,
      turnCount: 2,
      sessionExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000), // 20h from now
      tags: ['order-query'],
    },
    {
      tenantId: tenant.id,
      customerId: customer2.id,
      channel: 'instagram',
      status: 'open',
      primaryIntent: 'product_recommendation',
      sentiment: 'positive',
      sentimentScore: '0.6',
      urgencyScore: 1,
      aiHandled: true,
      humanTouched: false,
      turnCount: 4,
      tags: ['product-query'],
    },
    {
      tenantId: tenant.id,
      customerId: customer3.id,
      channel: 'whatsapp',
      status: 'resolved',
      primaryIntent: 'order_return',
      sentiment: 'negative',
      sentimentScore: '-0.4',
      urgencyScore: 3,
      aiHandled: false,
      humanTouched: true,
      assignedTo: supportAgent.id,
      csatScore: 4,
      turnCount: 8,
      resolvedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      resolutionTimeSeconds: 720,
      tags: ['return', 'resolved'],
    },
  ]).returning()

  console.log('✅ Conversations created')

  if (!conv1 || !conv2 || !conv3) throw new Error('Failed to create conversations')

  // ─── 5. Create Demo Messages ──────────────────────────────
  await db.insert(messages).values([
    // Conv 1: Priya tracking her Kumkumadi Elixir order
    {
      conversationId: conv1.id,
      tenantId: tenant.id,
      senderType: 'customer',
      contentType: 'text',
      content: 'Hii, mera order kab aayega? Order #RAS-2024-8847 — Kumkumadi Elixir',
      channelStatus: 'delivered',
      channelMessageId: 'wa_msg_demo_001',
      sentAt: new Date(Date.now() - 5 * 60 * 1000),
    },
    {
      conversationId: conv1.id,
      tenantId: tenant.id,
      senderType: 'ai',
      contentType: 'text',
      content: 'Hi Priya! 🙏 Maine aapka order check kiya — Order #RAS-2024-8847 (Kumkumadi Elixir Oil) aaj evening 6 PM tak deliver ho jaayega. \n\nTracking: BlueDart AWB 3421567890 → Currently in Delhi hub, out for delivery. Koi aur help chahiye? 😊',
      aiConfidence: '0.92',
      aiIntent: 'order_tracking',
      aiCitedSources: [{ chunkId: 'demo-chunk-1', sourceType: 'product', title: 'Kumkumadi Elixir', similarity: 0.89 }],
      isAiDraft: false,
      channelStatus: 'read',
      channelMessageId: 'wa_msg_demo_002',
      sentAt: new Date(Date.now() - 4 * 60 * 1000 - 47 * 1000), // 47 second response!
    },
    // Conv 2: Anita asking for product recommendation
    {
      conversationId: conv2.id,
      tenantId: tenant.id,
      senderType: 'customer',
      contentType: 'text',
      content: 'Hi! I have oily skin with pigmentation issues. Which of your products would you recommend? Budget around ₹2000',
      channelStatus: 'delivered',
      sentAt: new Date(Date.now() - 30 * 60 * 1000),
    },
    {
      conversationId: conv2.id,
      tenantId: tenant.id,
      senderType: 'ai',
      contentType: 'text',
      content: 'Great question, Anita! For oily skin with pigmentation, I\'d recommend our *Kumkumadi Elixir* (₹2,200) — it\'s our bestseller for exactly this concern! ✨\n\nKey benefits:\n• Saffron + Kumkumadi oils — natural brightening\n• Lightweight, non-comedogenic (won\'t clog pores!)\n• 28-day visible result on dark spots\n\nAlternatively, the *Vitamin C Brightening Serum* (₹1,800) is great for pigmentation on a tighter budget.\n\nWant me to send product details? 🛍️',
      aiConfidence: '0.88',
      aiIntent: 'product_recommendation',
      isAiDraft: false,
      channelStatus: 'read',
      sentAt: new Date(Date.now() - 29 * 60 * 1000),
    },
  ])

  console.log('✅ Messages created')

  console.log('\n🎉 Seed complete! Login credentials:')
  console.log('Admin: admin@rasluxuryoils.com / sahay@123')
  console.log('Agent: support@rasluxuryoils.com / sahay@123')
  console.log(`Tenant ID: ${tenant.id}`)
}

seed()
  .then(() => {
    console.log('\n✅ Database seeded successfully')
    process.exit(0)
  })
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
