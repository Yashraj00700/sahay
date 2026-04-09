// ─── Intent Classification Service ───────────────────────────────────────────
// Uses Claude API with a rich system prompt + few-shot examples to classify
// customer intent across 40+ categories spanning order, product, shipping,
// payment, account, and brand queries.

import Anthropic from '@anthropic-ai/sdk'
import type { IntentCategory } from '@sahay/shared'
import { logger } from '../../lib/logger'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntentEntity {
  type:
    | 'order_id'
    | 'product_name'
    | 'phone_number'
    | 'email'
    | 'pincode'
    | 'amount'
    | 'skin_type'
    | 'ingredient'
    | 'date'
    | 'quantity'
  value: string
  raw: string
}

export interface IntentResult {
  intent: IntentCategory
  confidence: number
  subIntent?: string
  entities: IntentEntity[]
  /** True when the message contains a human escalation request */
  humanRequested: boolean
  /** True when legal threat language is detected */
  legalThreat: boolean
  /** True when a STOP/opt-out keyword is present */
  stopKeyword: boolean
  /** Raw model reasoning (for audit logging) */
  reasoning?: string
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const INTENT_SYSTEM_PROMPT = `You are an AI assistant for an Indian D2C e-commerce customer support platform called Sahay.
Your task is to classify the customer's message into exactly ONE intent category.

## Intent Categories

### Order Management
- order_status       : Customer asking about current order status
- order_tracking     : Asking for tracking link / courier status
- order_modify       : Wants to change address, quantity, or items BEFORE dispatch
- order_cancel       : Wants to cancel an order
- order_return       : Wants to return a delivered product
- order_exchange     : Wants to exchange for different variant/product
- refund_status      : Asking about refund processing time or status
- missing_item       : Item missing from delivered package
- damaged_item       : Product arrived damaged or broken
- wrong_item         : Received incorrect product
- cod_to_prepaid     : Wants to switch COD order to prepaid for discount

### Product Information
- product_info          : General product details, description
- product_ingredients   : Asking about specific ingredients (INCI list, formulation)
- product_recommendation: Wants a product recommended for their concern/skin type
- product_comparison    : Comparing two or more products
- product_availability  : Is a product in stock / when will it restock
- product_price         : Price of a product or price match query
- product_usage         : How to use a product, application method
- routine_building      : Building a skincare/haircare routine
- compatibility_check   : Can two products be used together
- allergy_check         : Asking about allergens / sensitivity concerns (SAFETY — escalate)

### Shipping & Delivery
- shipping_time        : Estimated delivery date
- shipping_cost        : Delivery charges, free shipping threshold
- pincode_check        : Does the brand deliver to their location
- international_shipping: Queries about shipping outside India
- delivery_delay       : Order is late, expected date passed

### Payment & Offers
- payment_methods  : Accepted payment modes (UPI, card, COD, etc.)
- payment_failed   : Payment was deducted but order not placed / payment error
- discount_code    : Asking for a coupon, promo code, or referral discount
- cod_available    : Is Cash on Delivery available for their order/location
- emi_options      : EMI / Buy Now Pay Later queries

### Account & Loyalty
- loyalty_points  : Balance, earning rate, expiry
- loyalty_redeem  : How to use / redeem loyalty points
- login_help      : Can't log in, forgot password, OTP issues
- address_update  : Update saved address
- order_history   : View past orders

### Brand & General
- brand_about      : Company story, founder, certifications, awards
- store_locations  : Physical retail stores
- wholesale        : Bulk / B2B / distributor queries
- collaboration    : Influencer, PR, or brand partnership
- greeting         : Hello, hi, or conversation opener with no specific query
- thanks           : Customer expressing gratitude
- complaint_general: General dissatisfaction not fitting another category
- human_request    : Explicitly asking to speak with a human agent
- off_topic        : Not related to the brand at all
- suspicious       : Spam, abuse, or suspicious content

## Entity Extraction
Extract these entities when present:
- order_id     : e.g. "#1234", "order 9876", "RAS1234"
- product_name : e.g. "Kumkumadi oil", "hair serum"
- phone_number : 10-digit Indian mobile or +91 format
- email        : email address
- pincode      : 6-digit Indian postal code
- amount       : monetary value with or without ₹/Rs
- skin_type    : oily, dry, combination, sensitive, normal
- ingredient   : specific ingredient name
- date         : any date reference
- quantity     : number of items

## Special Flags
- humanRequested : true if customer says "talk to human", "agent please", "transfer me", "baat karo", "insaan chahiye", etc.
- legalThreat    : true if customer mentions "legal", "consumer court", "police", "FIR", "sue", "advocate", etc.
- stopKeyword    : true if message contains "STOP", "UNSUBSCRIBE", "opt out", "band karo" as a consent revocation

## Output Format
Respond ONLY with valid JSON in this exact shape:
{
  "intent": "<one of the categories above>",
  "confidence": <0.0 to 1.0>,
  "subIntent": "<optional more specific classification>",
  "entities": [
    { "type": "<entity_type>", "value": "<normalised value>", "raw": "<original text>" }
  ],
  "humanRequested": <true|false>,
  "legalThreat": <true|false>,
  "stopKeyword": <true|false>,
  "reasoning": "<one sentence explanation>"
}

## Few-shot Examples

User: "Mera order kab aayega? Order #1045"
Context: ""
Language: hinglish
{
  "intent": "order_tracking",
  "confidence": 0.96,
  "subIntent": "estimated_delivery",
  "entities": [{ "type": "order_id", "value": "#1045", "raw": "#1045" }],
  "humanRequested": false,
  "legalThreat": false,
  "stopKeyword": false,
  "reasoning": "Customer asking when order will arrive with a specific order ID."
}

---

User: "Kumkumadi oil dry skin ke liye sahi hai kya?"
Context: ""
Language: hinglish
{
  "intent": "product_recommendation",
  "confidence": 0.88,
  "subIntent": "skin_type_suitability",
  "entities": [
    { "type": "product_name", "value": "Kumkumadi oil", "raw": "Kumkumadi oil" },
    { "type": "skin_type", "value": "dry", "raw": "dry skin" }
  ],
  "humanRequested": false,
  "legalThreat": false,
  "stopKeyword": false,
  "reasoning": "Customer asking if a product is suitable for their skin type."
}

---

User: "My payment was deducted twice but only one order was placed please help"
Context: ""
Language: en
{
  "intent": "payment_failed",
  "confidence": 0.93,
  "subIntent": "double_charge",
  "entities": [],
  "humanRequested": false,
  "legalThreat": false,
  "stopKeyword": false,
  "reasoning": "Double deduction without corresponding order — payment failure variant."
}

---

User: "Refund nahi aaya 15 din ho gaye, ab main consumer court jaaunga"
Context: ""
Language: hinglish
{
  "intent": "refund_status",
  "confidence": 0.91,
  "subIntent": "overdue_refund",
  "entities": [],
  "humanRequested": false,
  "legalThreat": true,
  "stopKeyword": false,
  "reasoning": "Refund inquiry with explicit consumer court legal threat."
}

---

User: "Please mujhe kisi se baat karni hai"
Context: ""
Language: hinglish
{
  "intent": "human_request",
  "confidence": 0.97,
  "subIntent": null,
  "entities": [],
  "humanRequested": true,
  "legalThreat": false,
  "stopKeyword": false,
  "reasoning": "Direct request to speak with a human."
}

---

User: "STOP"
Context: ""
Language: en
{
  "intent": "off_topic",
  "confidence": 0.99,
  "subIntent": "opt_out",
  "entities": [],
  "humanRequested": false,
  "legalThreat": false,
  "stopKeyword": true,
  "reasoning": "STOP keyword — consent revocation signal."
}

---

User: "Kya aap mere area mein deliver karte ho? 400001"
Context: ""
Language: hinglish
{
  "intent": "pincode_check",
  "confidence": 0.95,
  "subIntent": null,
  "entities": [{ "type": "pincode", "value": "400001", "raw": "400001" }],
  "humanRequested": false,
  "legalThreat": false,
  "stopKeyword": false,
  "reasoning": "Serviceability check with explicit pincode."
}

---

User: "Hello! Mujhe aapke hair oil ke baare mein kuch jaanna tha"
Context: ""
Language: hinglish
{
  "intent": "greeting",
  "confidence": 0.72,
  "subIntent": "product_inquiry_opener",
  "entities": [{ "type": "product_name", "value": "hair oil", "raw": "hair oil" }],
  "humanRequested": false,
  "legalThreat": false,
  "stopKeyword": false,
  "reasoning": "Greeting with a product category mention but no specific question yet."
}
`

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Classify the intent of a customer message.
 *
 * @param text        - The customer's message text
 * @param context     - Conversation history summary or last few messages (stringified)
 * @param language    - Detected language ('en' | 'hi' | 'hinglish' | 'other')
 */
export async function classifyIntent(
  text: string,
  context: string,
  language: string,
): Promise<IntentResult> {
  const userPrompt = `User: "${text}"
Context: "${context}"
Language: ${language}

Classify the intent and return JSON only.`

  let raw: string

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 512,
      temperature: 0,
      system: INTENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const block = response.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
    raw = block.text.trim()
  } catch (err) {
    logger.error({ err }, '[intent] Claude API error')
    // Fallback: return low-confidence default rather than crashing the pipeline
    return {
      intent: 'off_topic',
      confidence: 0.1,
      entities: [],
      humanRequested: false,
      legalThreat: false,
      stopKeyword: false,
    }
  }

  // Strip possible markdown code fences
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()

  let parsed: IntentResult

  try {
    parsed = JSON.parse(jsonStr) as IntentResult
  } catch (err) {
    logger.error({ err, raw }, '[intent] JSON parse error')
    return {
      intent: 'off_topic',
      confidence: 0.1,
      entities: [],
      humanRequested: false,
      legalThreat: false,
      stopKeyword: false,
    }
  }

  // Validate required fields
  const validIntent = parsed.intent as IntentCategory
  const confidence = typeof parsed.confidence === 'number'
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.5

  return {
    intent: validIntent,
    confidence,
    subIntent: parsed.subIntent ?? undefined,
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    humanRequested: Boolean(parsed.humanRequested),
    legalThreat: Boolean(parsed.legalThreat),
    stopKeyword: Boolean(parsed.stopKeyword),
    reasoning: parsed.reasoning,
  }
}
