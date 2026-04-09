// ─── Tenant ───────────────────────────────────────────────────
export type PlanTier = 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise'

export interface Tenant {
  id: string
  shopifyDomain: string
  shopName: string
  shopEmail?: string
  plan: PlanTier
  trialEndsAt?: string
  aiPersonaName: string
  aiLanguage: 'en' | 'hi' | 'hinglish' | 'auto'
  aiTone: 'formal' | 'warm' | 'casual'
  aiConfidenceThreshold: number
  timezone: string
  isActive: boolean
  createdAt: string
}

// ─── Agent (support team member) ──────────────────────────────
export type AgentRole = 'super_admin' | 'admin' | 'agent' | 'viewer'

export interface Agent {
  id: string
  tenantId: string
  email: string
  name: string
  avatarUrl?: string
  role: AgentRole
  isActive: boolean
  isOnline: boolean
  lastSeenAt?: string
  createdAt: string
}

// ─── Customer (end customer of D2C brand) ─────────────────────
export type CustomerTier = 'new' | 'loyal' | 'vip'
export type ChurnRisk = 'low' | 'medium' | 'high'

export interface Customer {
  id: string
  tenantId: string
  phone?: string
  email?: string
  name?: string
  shopifyCustomerId?: string
  whatsappId?: string
  instagramId?: string
  city?: string
  state?: string
  languagePref: 'en' | 'hi' | 'hinglish' | 'auto'
  // Shopify cache
  totalOrders: number
  totalSpent: number
  lastOrderAt?: string
  // AI insights
  clvScore?: number
  churnRisk: ChurnRisk
  tier: CustomerTier
  sentiment7d?: number
  // Meta
  tags: string[]
  isOptout: boolean
  createdAt: string
}

// ─── Conversation ──────────────────────────────────────────────
export type Channel = 'whatsapp' | 'instagram' | 'webchat' | 'email'
export type ConversationStatus = 'open' | 'pending' | 'snoozed' | 'resolved' | 'closed'
export type SentimentLevel = 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive'
export type EmotionTag = 'frustrated' | 'confused' | 'delighted' | 'urgent' | 'grief' | 'skeptical'
export type RoutingDecision = 'auto_respond' | 'draft_for_review' | 'route_to_human' | 'route_to_senior'

export interface Conversation {
  id: string
  tenantId: string
  customerId: string
  customer?: Customer
  channel: Channel
  status: ConversationStatus
  assignedTo?: string
  assignedAgent?: Agent
  // AI analysis
  primaryIntent?: string
  sentiment: SentimentLevel
  sentimentScore?: number
  urgencyScore: number
  // Routing
  aiHandled: boolean
  aiResolutionRate?: number
  humanTouched: boolean
  escalationReason?: string
  // Timing
  firstReplyAt?: string
  resolvedAt?: string
  snoozeUntil?: string
  sessionExpiresAt?: string
  // Quality
  csatScore?: number
  resolutionTimeSeconds?: number
  turnCount: number
  // Meta
  tags: string[]
  lastMessage?: Message
  unreadCount?: number
  createdAt: string
  updatedAt: string
}

// ─── Message ───────────────────────────────────────────────────
export type MessageSenderType = 'customer' | 'ai' | 'agent' | 'system'
export type MessageContentType =
  | 'text' | 'image' | 'audio' | 'video' | 'document'
  | 'template' | 'interactive' | 'note' | 'system_event'
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'

export interface MessageCitation {
  chunkId: string
  sourceType: string
  title: string
  similarity: number
}

export interface Message {
  id: string
  conversationId: string
  tenantId: string
  senderType: MessageSenderType
  senderId?: string
  senderAgent?: Pick<Agent, 'id' | 'name' | 'avatarUrl'>
  contentType: MessageContentType
  content?: string
  mediaUrl?: string
  mediaMimeType?: string
  // Voice note
  transcription?: string
  transcriptionConfidence?: number
  voiceDurationSeconds?: number
  // AI metadata
  isAiDraft: boolean
  aiConfidence?: number
  aiIntent?: string
  aiCitedSources: MessageCitation[]
  // Status
  channelMessageId?: string
  channelStatus: MessageStatus
  channelError?: string
  // Timestamps
  sentAt: string
  deliveredAt?: string
  readAt?: string
  editedAt?: string
}

// ─── AI ───────────────────────────────────────────────────────
export type IntentCategory =
  // Order
  | 'order_status' | 'order_tracking' | 'order_modify' | 'order_cancel'
  | 'order_return' | 'order_exchange' | 'refund_status' | 'missing_item'
  | 'damaged_item' | 'wrong_item' | 'cod_to_prepaid'
  // Product
  | 'product_info' | 'product_ingredients' | 'product_recommendation'
  | 'product_comparison' | 'product_availability' | 'product_price'
  | 'product_usage' | 'routine_building' | 'compatibility_check' | 'allergy_check'
  // Shipping
  | 'shipping_time' | 'shipping_cost' | 'pincode_check' | 'international_shipping' | 'delivery_delay'
  // Payment
  | 'payment_methods' | 'payment_failed' | 'discount_code' | 'cod_available' | 'emi_options'
  // Account
  | 'loyalty_points' | 'loyalty_redeem' | 'login_help' | 'address_update' | 'order_history'
  // Brand/General
  | 'brand_about' | 'store_locations' | 'wholesale' | 'collaboration'
  | 'greeting' | 'thanks' | 'complaint_general' | 'human_request' | 'off_topic' | 'suspicious'

export interface AISuggestion {
  conversationId: string
  suggestion: string
  confidence: number
  language: 'en' | 'hi' | 'hinglish'
  intent: IntentCategory
  citations: MessageCitation[]
  model: string
  generatedAt: string
}

// ─── Knowledge Base ────────────────────────────────────────────
export type KBSourceType = 'product' | 'faq' | 'policy' | 'blog' | 'custom'
export type KBChunkType = 'identity' | 'benefits' | 'ingredients' | 'usage' | 'suitability' | 'certifications'
export type KBLanguage = 'en' | 'hi' | 'hinglish'

export interface KBChunk {
  id: string
  tenantId: string
  sourceType: KBSourceType
  sourceId?: string
  title?: string
  content: string
  language: KBLanguage
  chunkType?: KBChunkType
  productId?: string
  productName?: string
  category?: string
  skinTypes?: string[]
  priceTier?: string
  lastUpdated: string
  isActive: boolean
}

// ─── Agent Performance / Leaderboard ──────────────────────────
export interface AgentPerformanceStat {
  agentId: string
  agentName: string
  agentAvatar: string | null
  conversationsHandled: number
  avgResponseTimeSec: number | null
  csatAvgRating: number | null
  resolutionRate: number
  totalMessages: number
}

export interface AgentPerformanceResponse {
  data: AgentPerformanceStat[]
  period: { startDate: string; endDate: string }
}

// ─── Analytics ────────────────────────────────────────────────
export interface AnalyticsOverview {
  period: '1d' | '7d' | '30d'
  totalConversations: number
  newConversations: number
  resolvedConversations: number
  aiResolved: number
  aiResolutionRate: number
  avgFirstResponseSeconds: number
  avgResolutionSeconds: number
  avgCsat: number | null
  csatResponses: number
  codConversions: number
  codConversionRevenue: number
  channelBreakdown: Record<Channel, number>
  trends: {
    conversationsDelta: number  // % change vs previous period
    aiResolutionDelta: number
    csatDelta: number | null
  }
}

// ─── WebSocket Events ──────────────────────────────────────────
// Server → Client events
export interface ServerToClientEvents {
  'conversation:new': (data: { conversation: Conversation }) => void
  'conversation:updated': (data: Partial<Conversation> & { id: string }) => void
  'conversation:resolved': (data: { conversationId: string; resolvedBy: string }) => void
  'message:new': (data: Message) => void
  'message:status': (data: { messageId: string; status: MessageStatus; timestamp: string }) => void
  'ai:suggestion': (data: { conversationId: string; suggestion: AISuggestion }) => void
  'ai:typing': (data: { conversationId: string; isTyping: boolean }) => void
  'agent:status': (data: { agentId: string; isOnline: boolean }) => void
  'agent:viewing': (data: { agentId: string; agentName: string; conversationId: string }) => void
  'agent:typing': (data: { agentId: string; agentName: string; conversationId: string; isTyping: boolean }) => void
}

// Client → Server events
export interface ClientToServerEvents {
  'agent:typing:start': (data: { conversationId: string }) => void
  'agent:typing:stop': (data: { conversationId: string }) => void
  'agent:viewing': (data: { conversationId: string }) => void
}

// Flat union type for backwards compat
export type SocketEvents = ServerToClientEvents & ClientToServerEvents

// ─── API Responses ─────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}

export interface ApiError {
  statusCode: number
  error: string
  message: string
  details?: Record<string, string[]>
}

export interface AuthTokens {
  token: string
  // refreshToken is no longer returned in the response body — it is set as an httpOnly cookie.
  expiresIn: number
}

export interface AuthResponse extends AuthTokens {
  agent: Agent
  tenant: Tenant
}
