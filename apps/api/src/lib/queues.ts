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

// Incoming messages from channels
export const incomingWhatsAppQueue = new Queue('incoming-whatsapp', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
})

export const incomingInstagramQueue = new Queue('incoming-instagram', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
})

export const incomingWebchatQueue = new Queue('incoming-webchat', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
})

// AI processing
export const aiRespondQueue = new Queue('ai-respond', {
  connection: conn,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: { count: 200 },
  },
})

export const aiEmbedQueue = new Queue('ai-embed', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
  },
})

// Outgoing messages
export const outgoingWhatsAppQueue = new Queue('outgoing-whatsapp', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
})

export const outgoingInstagramQueue = new Queue('outgoing-instagram', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
})

// Shopify sync
export const shopifySyncQueue = new Queue('shopify-sync', {
  connection: conn,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
  },
})

// Notifications
export const notificationsQueue = new Queue('notifications-push', {
  connection: conn,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
  },
})

// Proactive messages (scheduled)
export const proactiveQueue = new Queue('proactive-messages', {
  connection: conn,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
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
  type: 'full' | 'product' | 'order' | 'customer'
  resourceId?: string   // shopify ID for incremental syncs
  shopifyDomain: string
  accessToken: string
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
