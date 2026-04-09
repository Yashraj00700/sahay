import { Queue, Worker, QueueEvents } from 'bullmq'
import { redis } from './redis'

const connection = { host: 'localhost', port: 6379 }
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'

// Parse redis URL for BullMQ
function getRedisConnection() {
  const url = new URL(redisUrl)
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
  }
}

const conn = getRedisConnection()

// ─── Queue Definitions ────────────────────────────────────────
// NOTE: BullMQ v5+ does not allow colons in queue names — use hyphens

// Dead Letter Queue — jobs land here after exhausting all retry attempts.
// removeOnFail: false on critical queues ensures failed jobs are visible and
// forwarded here rather than silently dropped.
export const dlqQueue = new Queue('dlq', {
  connection: conn,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  },
})

// Incoming messages from channels
export const incomingWhatsAppQueue = new Queue('incoming-whatsapp', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

export const incomingInstagramQueue = new Queue('incoming-instagram', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

export const incomingWebchatQueue = new Queue('incoming-webchat', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

// AI processing
export const aiRespondQueue = new Queue('ai-respond', {
  connection: conn,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 200 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

export const aiEmbedQueue = new Queue('ai-embed', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

// Outgoing messages
export const outgoingWhatsAppQueue = new Queue('outgoing-whatsapp', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

export const outgoingInstagramQueue = new Queue('outgoing-instagram', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

// Shopify sync
export const shopifySyncQueue = new Queue('shopify-sync', {
  connection: conn,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

// Notifications
export const notificationsQueue = new Queue('notifications-push', {
  connection: conn,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

// CSAT survey dispatch (triggered when a conversation is resolved)
export const csatQueue = new Queue('csat-survey', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: false,
  },
})

// Proactive messages (scheduled)
export const proactiveQueue = new Queue('proactive-messages', {
  connection: conn,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnFail: false, // keep for DLQ forwarding
  },
})

// ─── Job Types ────────────────────────────────────────────────

export interface IncomingWhatsAppJob {
  tenantId: string
  phoneNumberId: string
  from: string          // customer phone
  messageId: string     // WA message ID
  timestamp: string
  type: string          // text|image|audio|video|document|interactive|order
  text?: { body: string }
  image?: { id: string; mime_type: string; sha256?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  video?: { id: string; mime_type: string }
  document?: { id: string; mime_type: string; filename?: string }
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }
  rawPayload: object
}

export interface AIRespondJob {
  tenantId: string
  conversationId: string
  messageId: string
  forceHuman?: boolean
}

export interface ShopifySyncJob {
  tenantId: string
  type: 'full' | 'product' | 'order' | 'customer' | 'fulfillment'
  resourceId?: string        // shopify ID for polling-style incremental syncs
  shopifyDomain?: string     // used for polling syncs
  accessToken?: string       // used for polling syncs
  // Webhook-push fields (set when enqueued from webhook handler)
  data?: Record<string, unknown>  // raw Shopify webhook payload
}

export interface EmbedJob {
  tenantId: string
  chunkIds: string[]    // knowledge_chunks.id[]
  operation: 'embed' | 're-embed' | 'delete'
}

export interface OutgoingWhatsAppJob {
  tenantId: string
  phoneNumberId: string
  to: string            // customer phone
  message: object       // WhatsApp message object
  conversationId: string
  messageId: string
}

export interface OutgoingInstagramJob {
  tenantId: string
  recipientIgId: string // Instagram-scoped user ID
  message: object       // { text: string } or { attachment: {...} }
  conversationId: string
  messageId: string
}

export interface NotificationsJob {
  tenantId: string
  agentId: string
  type: 'new_conversation' | 'escalation' | 'mention'
  conversationId: string
}

export interface ProactiveJob {
  tenantId: string
  to: string            // recipient phone in E.164
  templateName: string  // approved WA template name
  languageCode?: string // e.g. 'en' | 'en_IN' | 'hi' — defaults to 'en'
  components?: object[] // WhatsApp template parameter components
  customerId?: string   // customers.id for conversation linking
  conversationId?: string
}

export interface IncomingInstagramJob {
  tenantId: string
  igUserId: string      // Instagram-scoped user ID of the sender
  messageId: string     // Instagram message ID from webhook
  timestamp: string     // unix timestamp string
  type: string          // text|image|video|audio|sticker|story_mention
  text?: { body: string }
  attachments?: Array<{ type: string; url: string }>
  rawPayload: object
}

export interface CsatJob {
  tenantId:       string
  conversationId: string
  customerId:     string
  customerPhone:  string   // E.164 — the WhatsApp number to send the survey to
  customerName:   string
}

export interface IncomingWebchatJob {
  tenantId: string
  sessionId: string     // browser session / visitor ID
  visitorId?: string    // optional visitor identifier
  customerId?: string   // customers.id if already identified
  messageId: string     // client-generated idempotency ID
  type: string          // text|image|file
  text?: { body: string }
  mediaUrl?: string
  mediaMimeType?: string
  timestamp: string     // unix timestamp string
  rawPayload: object
}
