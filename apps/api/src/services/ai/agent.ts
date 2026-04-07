// ─── AI Agent Pipeline Orchestrator ──────────────────────────────────────────
// THE HEART — runs the full AI pipeline for an incoming customer message.
//
// Steps:
//   1.  Load conversation + last 10 messages + customer + tenant profiles
//   2.  Extract the latest customer message
//   3.  Detect language (detectLanguage)
//   4.  Classify intent (classifyIntent)
//   5.  Analyse sentiment (analyzeSentiment)
//   6.  Fetch Shopify order data if intent is order-related
//   7.  Retrieve relevant knowledge chunks (retrieveContext)
//   8.  Decide routing (decideRouting)
//   9a. If auto_respond / draft_for_review:
//       - Build rich system prompt with brand voice + Hinglish examples + RAG + Shopify data
//       - Call Claude 3.5 Sonnet (or claude-3-haiku for simple queries)
//       - Post-process: extract citations, scrub medical claims, check PII
//       - Persist AI message to DB
//       - If auto_respond:    emit message:new via Socket.io
//       - If draft_for_review: emit ai:suggestion via Socket.io
//   9b. If route_to_human / route_to_senior:
//       - Update conversation routing fields
//       - Notify agent via socket

import Anthropic from '@anthropic-ai/sdk'
import { db, conversations, messages, customers, tenants } from '@sahay/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { detectLanguage } from './language'
import { classifyIntent, type IntentResult } from './intent'
import { analyzeSentiment, type SentimentResult } from './sentiment'
import { retrieveContext, type RAGChunk } from './rag'
import { decideRouting, type EscalationSignals } from './router'
import type { IntentCategory, SentimentLevel } from '@sahay/shared'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIResult {
  conversationId: string
  decision: 'auto_respond' | 'draft_for_review' | 'route_to_human' | 'route_to_senior'
  /** Set when a response was generated */
  responseText?: string
  /** DB message UUID for the generated message */
  messageId?: string
  intent: IntentCategory
  sentiment: SentimentLevel
  language: string
  confidence: number
  citations: CitationRef[]
  escalationReason?: string
  processingMs: number
}

interface CitationRef {
  chunkId: string
  title: string | null
  sourceType: string
  similarity: number
}

interface ShopifyOrder {
  id: string
  name: string
  fulfillmentStatus: string | null
  financialStatus: string
  totalPrice: string
  currency: string
  trackingNumber?: string
  trackingUrl?: string
  lineItems: Array<{ title: string; quantity: number; price: string }>
  createdAt: string
}

// ─── Intent categories that trigger Shopify data fetch ───────────────────────

const ORDER_INTENTS = new Set<IntentCategory>([
  'order_status', 'order_tracking', 'order_modify', 'order_cancel',
  'order_return', 'order_exchange', 'refund_status', 'missing_item',
  'damaged_item', 'wrong_item', 'cod_to_prepaid', 'delivery_delay',
])

// Simple intents served by the cheaper haiku model
const SIMPLE_INTENTS = new Set<IntentCategory>([
  'greeting', 'thanks', 'pincode_check', 'shipping_cost', 'payment_methods',
  'cod_available', 'store_locations', 'brand_about',
])

// ─── 15 Hinglish Example Pairs ───────────────────────────────────────────────

const HINGLISH_EXAMPLES = `
## Hinglish Response Style Examples

Q: "Mera order kab aayega?"
A: "Aapka order dispatch ho chuka hai! Kal tak deliver ho jayega. Tracking link: [link] 🙏"

Q: "Product return karna hai"
A: "Bilkul! Return process simple hai — order number share karein, main process karta/karti hoon."

Q: "Kya yeh oil dry skin ke liye theek hai?"
A: "Haan! Hamara Kumkumadi Oil dry skin ke liye perfect hai — deeply moisturising aur glowing skin ke liye."

Q: "Payment fail ho gayi but paise kat gaye"
A: "Pareshani ke liye maafi chahta/chahti hoon! Refund 5-7 business days mein automatically aa jayega."

Q: "COD available hai?"
A: "Haan ji! Cash on Delivery sabhi pin codes pe available hai. Order pe COD select karein."

Q: "Discount code chahiye"
A: "Pehli order ke liye WELCOME10 use karein — 10% off! 🎉"

Q: "Ingredients kya hain?"
A: "Hamare Hair Serum mein Bhringraj, Amla, Argan Oil aur Vitamin E hai — sab 100% natural."

Q: "Ek baar use kiya, result nahi aaya"
A: "Samajh sakta/sakti hoon. Skincare products 4-6 weeks mein results dikhate hain — koi specific concern?"

Q: "Order cancel karna hai"
A: "Haan cancel ho sakta hai agar dispatch nahi hua. Order number share karein — check karta/karti hoon."

Q: "Free shipping kab milti hai?"
A: "Rs 499 se upar ke orders pe FREE delivery! Aapka cart total kitna hai?"

Q: "Skin irritation ho rahi hai"
A: "Oh no! Please use band karein aur mujhe batayein — main urgently review karta/karti hoon."

Q: "Wrong product aaya"
A: "Bilkul theek nahi — maafi chahta/chahti hoon! Photo share karein, replacement immediately process hoga."

Q: "Loyalty points kaise use karein?"
A: "Checkout pe 'Use Points' option milega — aapke points se directly discount milegi!"

Q: "Delivery kab tak hogi?"
A: "Aapke area mein 2-3 days mein delivery hogi! Exact date confirm karta/karti hoon."

Q: "Bahut achha product hai!"
A: "Itne pyaare feedback ke liye shukriya! 🙏 Koi aur help chahiye?"
`.trim()

// ─── Medical Claim Scrubber ───────────────────────────────────────────────────

const MEDICAL_CLAIM_PATTERNS: RegExp[] = [
  /\b(cures?|treats?|heals?)\s+(disease|condition|disorder|acne|eczema|psoriasis|rosacea|cancer|infection)\b/gi,
  /\b(clinically proven|medically approved|FDA approved|CDSCO approved)\b/gi,
  /guarantees?\s+(cure|healing|treatment)/gi,
]

const COSMETIC_REWRITES: Array<[RegExp, string]> = [
  [/\bcures?\b/gi, 'may help with'],
  [/\btreats?\b/gi, 'helps address'],
  [/\bheals?\b/gi, 'supports the appearance of'],
  [/\beliminates?\b/gi, 'visibly reduces'],
]

function scrubMedicalClaims(text: string): { text: string; hadViolation: boolean } {
  let hadViolation = false
  let result = text

  for (const pattern of MEDICAL_CLAIM_PATTERNS) {
    if (pattern.test(result)) hadViolation = true
  }

  for (const [pattern, replacement] of COSMETIC_REWRITES) {
    result = result.replace(pattern, replacement)
  }

  return { text: result, hadViolation }
}

// ─── PII Detector ─────────────────────────────────────────────────────────────

const PII_PATTERNS: RegExp[] = [
  /\+91\s?\d{10}/g,
  /\b[6-9]\d{9}\b/g,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
]

function containsPII(text: string): boolean {
  return PII_PATTERNS.some(p => p.test(text))
}

// ─── Citation Extractor ───────────────────────────────────────────────────────

function extractCitations(
  responseText: string,
  ragChunks: RAGChunk[],
): CitationRef[] {
  const citationRegex = /\[SOURCE:([a-f0-9-]{36})\]/g
  const cited = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = citationRegex.exec(responseText)) !== null) {
    cited.add(match[1]!)
  }

  // Also include highest-scoring chunks as implicit citations
  for (const chunk of ragChunks) {
    if (chunk.score > 0.8) cited.add(chunk.id)
  }

  return ragChunks
    .filter(c => cited.has(c.id))
    .map(c => ({
      chunkId: c.id,
      title: c.title,
      sourceType: c.sourceType,
      similarity: c.score,
    }))
}

// ─── Shopify Order Fetcher ────────────────────────────────────────────────────

async function fetchShopifyOrder(
  orderId: string,
  shopifyDomain: string,
  accessToken: string,
): Promise<ShopifyOrder | null> {
  try {
    const url = `https://${shopifyDomain}/admin/api/2024-10/orders/${orderId}.json`
    const resp = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    })

    if (!resp.ok) return null

    const data = await resp.json() as { order: Record<string, unknown> }
    const o = data.order

    const fulfillments = (o.fulfillments as Array<Record<string, unknown>> | undefined) ?? []
    const trackingNumbers = fulfillments[0]?.tracking_numbers as string[] | undefined
    const trackingUrls = fulfillments[0]?.tracking_urls as string[] | undefined

    return {
      id: String(o.id),
      name: String(o.name),
      fulfillmentStatus: o.fulfillment_status ? String(o.fulfillment_status) : null,
      financialStatus: String(o.financial_status),
      totalPrice: String(o.total_price),
      currency: String(o.currency),
      trackingNumber: trackingNumbers?.[0],
      trackingUrl: trackingUrls?.[0],
      lineItems: ((o.line_items as Array<Record<string, unknown>>) ?? []).map(li => ({
        title: String(li.title),
        quantity: Number(li.quantity),
        price: String(li.price),
      })),
      createdAt: String(o.created_at),
    }
  } catch (err) {
    console.warn('[agent] Shopify order fetch failed:', err)
    return null
  }
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

interface SystemPromptContext {
  personaName: string
  brandName: string
  language: string
  aiTone: string
  brandVoice: string | null
  prohibitedPhrases: string[]
  preferredPhrases: string[]
  ragChunks: RAGChunk[]
  shopifyOrder: ShopifyOrder | null
  customerName: string | null
  customerTier: string
  totalOrders: number
  totalSpent: string
}

function buildSystemPrompt(ctx: SystemPromptContext): string {
  const toneDescriptions: Record<string, string> = {
    formal: 'professional, respectful, precise — avoid slang',
    warm: 'friendly, empathetic, caring — like a helpful friend at the brand',
    casual: 'relaxed and conversational — light humour is welcome',
  }

  const langInstruction =
    ctx.language === 'hi'
      ? 'Always respond in Hindi (Devanagari script).'
      : ctx.language === 'hinglish'
        ? 'Always respond in Hinglish — casual but professional Hindi-English mix in Latin script. Mirror the customer language style.'
        : 'Always respond in English.'

  const ragXml = ctx.ragChunks.length > 0
    ? ctx.ragChunks.map(c =>
        `<knowledge_chunk id="${c.id}" source="${c.sourceType}" score="${c.score.toFixed(3)}">` +
        `<title>${c.title ?? 'Untitled'}</title>` +
        `<content>${c.content}</content>` +
        `</knowledge_chunk>`,
      ).join('\n')
    : '<knowledge_chunk>No relevant knowledge found.</knowledge_chunk>'

  const shopifyJson = ctx.shopifyOrder
    ? JSON.stringify(ctx.shopifyOrder, null, 2)
    : 'null'

  const prohibited = ctx.prohibitedPhrases.length > 0
    ? `\n## NEVER use these phrases\n${ctx.prohibitedPhrases.map(p => `- "${p}"`).join('\n')}`
    : ''

  const preferred = ctx.preferredPhrases.length > 0
    ? `\n## PREFER these phrases\n${ctx.preferredPhrases.map(p => `- "${p}"`).join('\n')}`
    : ''

  return `You are ${ctx.personaName}, a customer support specialist for ${ctx.brandName}.

## Language
${langInstruction}

## Brand Voice & Tone
Tone: ${toneDescriptions[ctx.aiTone] ?? toneDescriptions['warm']}
${ctx.brandVoice ? `Brand Voice Notes: ${ctx.brandVoice}` : ''}
${prohibited}
${preferred}

${HINGLISH_EXAMPLES}

## MANDATORY Compliance Rules
- NEVER make medical claims. Use cosmetic language only:
  - "may help with" not "cures"
  - "supports the appearance of" not "heals"
  - "visibly reduces" not "eliminates"
- NEVER reveal PII (email, phone, address) of other customers.
- NEVER speak disparagingly about competitor products.
- If customer sends "STOP" or asks to opt out — acknowledge consent revocation immediately.
- Do NOT invent product information not found in the knowledge base.
- If unsure, say you will confirm and set needsHumanReview: true.

## Customer Profile
<customer_profile>
  name: ${ctx.customerName ?? 'Unknown'}
  tier: ${ctx.customerTier}
  total_orders: ${ctx.totalOrders}
  total_spent_inr: ${ctx.totalSpent}
</customer_profile>

## Knowledge Base
<knowledge_base>
${ragXml}
</knowledge_base>

## Shopify Order Data
<shopify_order>
${shopifyJson}
</shopify_order>

## Response Format
Return ONLY a valid JSON object:
{
  "response": "<customer-facing reply — this is sent verbatim>",
  "language": "${ctx.language}",
  "citations": ["<chunk_id>", ...],
  "confidence": <0.0 to 1.0>,
  "needsHumanReview": <true|false>
}

Keep responses concise (under 300 words for chat channels).
Use line breaks rather than bullet points for WhatsApp/Instagram messages.`
}

// ─── Main Pipeline Export ─────────────────────────────────────────────────────

/**
 * Run the full AI pipeline for a conversation turn.
 *
 * @param conversationId - UUID of the conversation
 * @param tenantId       - UUID of the tenant
 * @param io             - Optional Socket.io Server instance for real-time events
 */
export async function runAIPipeline(
  conversationId: string,
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  io?: any,
): Promise<AIResult> {
  const startTime = Date.now()

  // ── Step 1: Load data ─────────────────────────────────────────────────────

  const [convRows, tenantRows] = await Promise.all([
    db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
      .limit(1),
    db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1),
  ])

  const conversation = convRows[0]
  const tenant = tenantRows[0]

  if (!conversation) throw new Error(`[agent] Conversation not found: ${conversationId}`)
  if (!tenant) throw new Error(`[agent] Tenant not found: ${tenantId}`)

  // Last 10 messages (most recent first, then reversed for chronological context)
  const recentMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sentAt))
    .limit(10)

  recentMessages.reverse()

  const customerRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, conversation.customerId))
    .limit(1)

  const customer = customerRows[0] ?? null

  // ── Step 2: Last customer message ─────────────────────────────────────────

  const lastCustomerMsg = [...recentMessages].reverse().find(m => m.senderType === 'customer')
  if (!lastCustomerMsg?.content) {
    throw new Error(`[agent] No customer message in conversation ${conversationId}`)
  }

  const messageText = lastCustomerMsg.content

  // ── Step 3: Language detection ────────────────────────────────────────────

  const langDetection = detectLanguage(messageText)
  const effectiveLanguage: string =
    tenant.aiLanguage && tenant.aiLanguage !== 'auto'
      ? tenant.aiLanguage
      : langDetection.language

  // ── Step 4: Intent classification ─────────────────────────────────────────

  const conversationContext = recentMessages
    .slice(-6)
    .map(m => `[${m.senderType}]: ${m.content ?? ''}`)
    .join('\n')

  const intentResult: IntentResult = await classifyIntent(
    messageText,
    conversationContext,
    effectiveLanguage,
  )

  // ── Step 5: Sentiment analysis ────────────────────────────────────────────

  const sentimentResult: SentimentResult = await analyzeSentiment(
    messageText,
    effectiveLanguage,
  )

  // ── Step 6: Shopify order fetch ───────────────────────────────────────────

  let shopifyOrder: ShopifyOrder | null = null

  if (ORDER_INTENTS.has(intentResult.intent)) {
    const orderEntity = intentResult.entities.find(e => e.type === 'order_id')
    const orderId = orderEntity?.value ?? conversation.shopifyOrderId ?? null

    if (orderId) {
      shopifyOrder = await fetchShopifyOrder(
        orderId,
        tenant.shopifyDomain,
        tenant.shopifyAccessToken,
      )
    }
  }

  // ── Step 7: RAG retrieval ─────────────────────────────────────────────────

  const skinTypeEntity = intentResult.entities.find(e => e.type === 'skin_type')
  const ragResult = await retrieveContext(messageText, tenantId, {
    skinType: skinTypeEntity?.value,
    language: effectiveLanguage !== 'other' ? effectiveLanguage : undefined,
  })

  // ── Step 8: Routing decision ──────────────────────────────────────────────

  const escalationSignals: EscalationSignals = {
    humanRequested: intentResult.humanRequested,
    legalThreat: intentResult.legalThreat,
    unresolvedTurns: conversation.turnCount ?? 0,
    circularCount: conversation.circularCount ?? 0,
    stopKeyword: intentResult.stopKeyword,
    allergyCheck: intentResult.intent === 'allergy_check',
  }

  const routingResult = decideRouting({
    intent: intentResult.intent,
    sentiment: sentimentResult.sentiment,
    confidence: intentResult.confidence,
    customerTier: (customer?.tier ?? 'new') as 'new' | 'loyal' | 'vip',
    orderValue: shopifyOrder ? parseFloat(shopifyOrder.totalPrice) : undefined,
    escalationSignals,
    confidenceThreshold: tenant.aiConfidenceThreshold
      ? parseFloat(String(tenant.aiConfidenceThreshold))
      : undefined,
  })

  // Persist analysis to conversation record
  await db
    .update(conversations)
    .set({
      primaryIntent: intentResult.intent,
      sentiment: sentimentResult.sentiment,
      sentimentScore: String(sentimentResult.score),
      urgencyScore: routingResult.urgency,
      emotionTags: sentimentResult.emotions,
      routingDecision: routingResult.decision,
      escalationReason: routingResult.decision.startsWith('route_to')
        ? routingResult.reason
        : null,
      turnCount: sql`${conversations.turnCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))

  // ── Handle escalation routing ─────────────────────────────────────────────

  if (
    routingResult.decision === 'route_to_human' ||
    routingResult.decision === 'route_to_senior'
  ) {
    await db
      .update(conversations)
      .set({ humanTouched: true })
      .where(eq(conversations.id, conversationId))

    if (io && routingResult.notifyNow) {
      io.to(`tenant:${tenantId}`).emit('conversation:updated', {
        conversation: {
          id: conversationId,
          routingDecision: routingResult.decision,
          escalationReason: routingResult.reason,
          urgencyScore: routingResult.urgency,
          sentiment: sentimentResult.sentiment,
          primaryIntent: intentResult.intent,
        },
      })
    }

    // Handle STOP / opt-out even in escalation path
    if (intentResult.stopKeyword && customer) {
      await db
        .update(customers)
        .set({ isOptout: true, optoutAt: new Date() })
        .where(eq(customers.id, customer.id))
    }

    return {
      conversationId,
      decision: routingResult.decision,
      intent: intentResult.intent,
      sentiment: sentimentResult.sentiment,
      language: effectiveLanguage,
      confidence: intentResult.confidence,
      citations: [],
      escalationReason: routingResult.reason,
      processingMs: Date.now() - startTime,
    }
  }

  // ── Step 9: Generate AI response ──────────────────────────────────────────

  const systemPrompt = buildSystemPrompt({
    personaName: tenant.aiPersonaName ?? 'Sahay',
    brandName: tenant.shopName,
    language: effectiveLanguage,
    aiTone: tenant.aiTone ?? 'warm',
    brandVoice: tenant.aiBrandVoice ?? null,
    prohibitedPhrases: (tenant.aiProhibitedPhrases ?? []) as string[],
    preferredPhrases: (tenant.aiPreferredPhrases ?? []) as string[],
    ragChunks: ragResult.chunks,
    shopifyOrder,
    customerName: customer?.name ?? null,
    customerTier: customer?.tier ?? 'new',
    totalOrders: customer?.totalOrders ?? 0,
    totalSpent: String(customer?.totalSpent ?? '0'),
  })

  const model = SIMPLE_INTENTS.has(intentResult.intent)
    ? 'claude-3-5-haiku-20241022'
    : 'claude-sonnet-4-5'

  let rawResponse: string

  try {
    if (io) {
      io.to(`tenant:${tenantId}`).emit('ai:typing', { conversationId, isTyping: true })
    }

    const completion = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: messageText }],
    })

    const block = completion.content[0]
    if (block.type !== 'text') throw new Error('[agent] Unexpected Claude response block type')
    rawResponse = block.text.trim()
  } finally {
    if (io) {
      io.to(`tenant:${tenantId}`).emit('ai:typing', { conversationId, isTyping: false })
    }
  }

  // ── Parse structured JSON response ────────────────────────────────────────

  let parsedResponse: {
    response: string
    language: string
    citations: string[]
    confidence: number
    needsHumanReview: boolean
  }

  try {
    const jsonStr = rawResponse
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    parsedResponse = JSON.parse(jsonStr)
  } catch {
    // Graceful fallback: treat raw output as the response
    parsedResponse = {
      response: rawResponse,
      language: effectiveLanguage,
      citations: [],
      confidence: intentResult.confidence * 0.9,
      needsHumanReview: false,
    }
  }

  let responseText = parsedResponse.response

  // ── Post-processing ───────────────────────────────────────────────────────

  // 1. Medical claim scrub
  const scrubResult = scrubMedicalClaims(responseText)
  if (scrubResult.hadViolation) {
    console.warn(`[agent] Medical claim scrubbed — conversation ${conversationId}`)
  }
  responseText = scrubResult.text

  // 2. PII safety check
  if (containsPII(responseText)) {
    console.error(`[agent] PII in AI response — routing to human (conversation ${conversationId})`)

    await db
      .update(conversations)
      .set({
        routingDecision: 'route_to_human',
        escalationReason: 'PII detected in AI-generated response',
        humanTouched: true,
      })
      .where(eq(conversations.id, conversationId))

    return {
      conversationId,
      decision: 'route_to_human',
      intent: intentResult.intent,
      sentiment: sentimentResult.sentiment,
      language: effectiveLanguage,
      confidence: 0,
      citations: [],
      escalationReason: 'PII detected in AI response — routed to human for safety',
      processingMs: Date.now() - startTime,
    }
  }

  // 3. Extract citations and strip SOURCE tags from customer-facing text
  const citations = extractCitations(responseText, ragResult.chunks)
  const cleanResponse = responseText.replace(/\[SOURCE:[a-f0-9-]{36}\]/g, '').trim()

  // ── Persist AI message ────────────────────────────────────────────────────

  const isAiDraft = routingResult.decision === 'draft_for_review'

  const [insertedMsg] = await db
    .insert(messages)
    .values({
      conversationId,
      tenantId,
      senderType: 'ai',
      contentType: 'text',
      content: cleanResponse,
      isAiDraft,
      aiConfidence: String(parsedResponse.confidence ?? intentResult.confidence),
      aiIntent: intentResult.intent,
      aiCitedSources: citations,
      aiModel: model,
      channelStatus: isAiDraft ? 'sending' : 'sent',
    })
    .returning({ id: messages.id })

  const messageId = insertedMsg?.id

  // Mark conversation as AI-handled
  await db
    .update(conversations)
    .set({ aiHandled: true, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))

  // ── STOP keyword: log consent revocation ─────────────────────────────────

  if (intentResult.stopKeyword && customer) {
    await db
      .update(customers)
      .set({ isOptout: true, optoutAt: new Date() })
      .where(eq(customers.id, customer.id))

    console.info(
      `[agent] STOP keyword — customer ${customer.id} opted out at ${new Date().toISOString()}`,
    )
  }

  // ── Socket.io events ──────────────────────────────────────────────────────

  if (io) {
    if (isAiDraft) {
      io.to(`tenant:${tenantId}`).emit('ai:suggestion', {
        conversationId,
        suggestion: {
          conversationId,
          suggestion: cleanResponse,
          confidence: parsedResponse.confidence ?? intentResult.confidence,
          language: effectiveLanguage,
          intent: intentResult.intent,
          citations,
          model,
          generatedAt: new Date().toISOString(),
        },
      })
    } else {
      io.to(`tenant:${tenantId}`).emit('message:new', {
        conversationId,
        message: {
          id: messageId,
          conversationId,
          tenantId,
          senderType: 'ai',
          contentType: 'text',
          content: cleanResponse,
          isAiDraft: false,
          aiConfidence: parsedResponse.confidence,
          aiIntent: intentResult.intent,
          aiCitedSources: citations,
          channelStatus: 'sent',
          sentAt: new Date().toISOString(),
        },
      })
    }
  }

  return {
    conversationId,
    decision: routingResult.decision as AIResult['decision'],
    responseText: cleanResponse,
    messageId,
    intent: intentResult.intent,
    sentiment: sentimentResult.sentiment,
    language: effectiveLanguage,
    confidence: parsedResponse.confidence ?? intentResult.confidence,
    citations,
    processingMs: Date.now() - startTime,
  }
}
