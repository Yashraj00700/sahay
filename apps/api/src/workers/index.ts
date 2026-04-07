import { Worker } from 'bullmq'
import type { IncomingWhatsAppJob, AIRespondJob, ShopifySyncJob } from '../lib/queues'

function getRedisConnection() {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  }
}

const conn = getRedisConnection()

export async function startWorkers(): Promise<void> {
  console.log('🔧 Starting BullMQ workers...')

  // ─── Incoming WhatsApp Worker ─────────────────────────────
  const waWorker = new Worker<IncomingWhatsAppJob>(
    'incoming-whatsapp',
    async (job) => {
      const { processIncomingWhatsApp } = await import('./incoming-message.worker')
      return processIncomingWhatsApp(job.data)
    },
    {
      connection: conn,
      concurrency: 20, // process 20 messages simultaneously
      limiter: {
        max: 100,
        duration: 1000, // max 100 messages/second globally
      },
    }
  )

  waWorker.on('completed', (job) => {
    console.debug(`WhatsApp message processed: ${job.id}`)
  })

  waWorker.on('failed', (job, err) => {
    console.error(`WhatsApp message failed: ${job?.id}`, err)
  })

  // ─── AI Respond Worker ────────────────────────────────────
  const aiWorker = new Worker<AIRespondJob>(
    'ai-respond',
    async (job) => {
      const { processAIRespond } = await import('./ai-respond.worker')
      return processAIRespond(job.data)
    },
    {
      connection: conn,
      concurrency: 10, // Limited by LLM API rate limits
    }
  )

  aiWorker.on('failed', (job, err) => {
    console.error(`AI respond failed: ${job?.id}`, err)
  })

  // ─── Shopify Sync Worker ──────────────────────────────────
  const shopifyWorker = new Worker<ShopifySyncJob>(
    'shopify-sync',
    async (job) => {
      const { processShopifySync } = await import('./shopify-sync.worker')
      return processShopifySync(job.data)
    },
    {
      connection: conn,
      concurrency: 5,
      limiter: {
        max: 2,    // max 2 Shopify API calls/second per worker
        duration: 1000,
      },
    }
  )

  shopifyWorker.on('failed', (job, err) => {
    console.error(`Shopify sync failed: ${job?.id}`, err)
  })

  console.log('✅ BullMQ workers started: whatsapp, ai, shopify')
}
