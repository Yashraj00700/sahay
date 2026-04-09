import { Worker } from 'bullmq'
import type {
  IncomingWhatsAppJob,
  AIRespondJob,
  ShopifySyncJob,
  OutgoingWhatsAppJob,
  EmbedJob,
  NotificationsJob,
  OutgoingInstagramJob,
  ProactiveJob,
  IncomingInstagramJob,
  IncomingWebchatJob,
  CsatJob,
} from '../lib/queues'
import { dlqQueue } from '../lib/queues'
import { logger } from '../lib/logger'

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
  logger.info('🔧 Starting BullMQ workers...')

  // ─── Incoming WhatsApp Worker ─────────────────────────────
  const waWorker = new Worker<IncomingWhatsAppJob>(
    'incoming-whatsapp',
    async (job) => {
      const { processIncomingWhatsApp } = await import('./incoming-message.worker')
      return processIncomingWhatsApp(job.data)
    },
    {
      connection: conn,
      concurrency: 5, // process 5 messages simultaneously
      limiter: {
        max: 100,
        duration: 1000, // max 100 messages/second globally
      },
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  waWorker.on('completed', (job) => {
    logger.info(`WhatsApp message processed: ${job.id}`)
  })

  waWorker.on('failed', (job, err) => {
    logger.error({ err }, `WhatsApp message failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('incoming-whatsapp', { ...job.data, _failedJobId: job.id, _queue: 'incoming-whatsapp', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue WhatsApp job'))
    }
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
      concurrency: 3, // Limited by LLM API rate limits
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  aiWorker.on('failed', (job, err) => {
    logger.error({ err }, `AI respond failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('ai-respond', { ...job.data, _failedJobId: job.id, _queue: 'ai-respond', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue AI respond job'))
    }
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
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  shopifyWorker.on('failed', (job, err) => {
    logger.error({ err }, `Shopify sync failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('shopify-sync', { ...job.data, _failedJobId: job.id, _queue: 'shopify-sync', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue Shopify sync job'))
    }
  })

  // ─── Outgoing WhatsApp Worker ─────────────────────────────
  const outgoingWaWorker = new Worker<OutgoingWhatsAppJob>(
    'outgoing-whatsapp',
    async (job) => {
      const { processOutgoingWhatsApp } = await import('./outgoing-whatsapp.worker')
      return processOutgoingWhatsApp(job.data)
    },
    {
      connection: conn,
      concurrency: 20,
      limiter: {
        max: 80,
        duration: 1000, // stay under Meta rate limits
      },
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  outgoingWaWorker.on('failed', (job, err) => {
    logger.error({ err }, `Outgoing WhatsApp failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('outgoing-whatsapp', { ...job.data, _failedJobId: job.id, _queue: 'outgoing-whatsapp', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue outgoing-whatsapp job'))
    }
  })

  // ─── Outgoing Instagram Worker ────────────────────────────
  const outgoingIgWorker = new Worker<OutgoingInstagramJob>(
    'outgoing-instagram',
    async (job) => {
      const { processOutgoingInstagram } = await import('./outgoing-instagram.worker')
      return processOutgoingInstagram(job.data)
    },
    {
      connection: conn,
      concurrency: 10,
      limiter: {
        max: 50,
        duration: 1000,
      },
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  outgoingIgWorker.on('failed', (job, err) => {
    logger.error({ err }, `Outgoing Instagram failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('outgoing-instagram', { ...job.data, _failedJobId: job.id, _queue: 'outgoing-instagram', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue outgoing-instagram job'))
    }
  })

  // ─── AI Embed Worker ──────────────────────────────────────
  const aiEmbedWorker = new Worker<EmbedJob>(
    'ai-embed',
    async (job) => {
      const { processAIEmbed } = await import('./ai-embed.worker')
      return processAIEmbed(job.data)
    },
    {
      connection: conn,
      concurrency: 5,  // OpenAI embedding API rate limit headroom
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  aiEmbedWorker.on('failed', (job, err) => {
    logger.error({ err }, `AI embed failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('ai-embed', { ...job.data, _failedJobId: job.id, _queue: 'ai-embed', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue ai-embed job'))
    }
  })

  // ─── Notifications Worker ─────────────────────────────────
  const notifWorker = new Worker<NotificationsJob>(
    'notifications-push',
    async (job) => {
      const { processNotification } = await import('./notifications.worker')
      return processNotification(job.data)
    },
    {
      connection: conn,
      concurrency: 10,
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  notifWorker.on('failed', (job, err) => {
    logger.error({ err }, `Notification failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('notifications-push', { ...job.data, _failedJobId: job.id, _queue: 'notifications-push', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue notification job'))
    }
  })

  // ─── Proactive Messages Worker ────────────────────────────
  const proactiveWorker = new Worker<ProactiveJob>(
    'proactive-messages',
    async (job) => {
      const { processProactive } = await import('./proactive.worker')
      return processProactive(job.data)
    },
    {
      connection: conn,
      concurrency: 10,
      limiter: {
        max: 30,
        duration: 1000,
      },
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  proactiveWorker.on('failed', (job, err) => {
    logger.error({ err }, `Proactive message failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('proactive-messages', { ...job.data, _failedJobId: job.id, _queue: 'proactive-messages', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue proactive job'))
    }
  })

  // ─── Incoming Instagram Worker ────────────────────────────
  const incomingIgWorker = new Worker<IncomingInstagramJob>(
    'incoming-instagram',
    async (job) => {
      const { processIncomingInstagram } = await import('./incoming-instagram.worker')
      return processIncomingInstagram(job.data)
    },
    {
      connection: conn,
      concurrency: 20,
      limiter: {
        max: 100,
        duration: 1000,
      },
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  incomingIgWorker.on('completed', (job) => {
    logger.info(`Instagram message processed: ${job.id}`)
  })

  incomingIgWorker.on('failed', (job, err) => {
    logger.error({ err }, `Instagram message failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('incoming-instagram', { ...job.data, _failedJobId: job.id, _queue: 'incoming-instagram', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue incoming-instagram job'))
    }
  })

  // ─── Incoming Webchat Worker ──────────────────────────────
  const webchatWorker = new Worker<IncomingWebchatJob>(
    'incoming-webchat',
    async (job) => {
      const { processIncomingWebchat } = await import('./incoming-webchat.worker')
      return processIncomingWebchat(job.data)
    },
    {
      connection: conn,
      concurrency: 50, // webchat is low-latency, allow higher concurrency
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  webchatWorker.on('completed', (job) => {
    logger.info(`Webchat message processed: ${job.id}`)
  })

  webchatWorker.on('failed', (job, err) => {
    logger.error({ err }, `Webchat message failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('incoming-webchat', { ...job.data, _failedJobId: job.id, _queue: 'incoming-webchat', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue incoming-webchat job'))
    }
  })

  // ─── CSAT Survey Worker ───────────────────────────────────────────────────
  const csatWorker = new Worker<CsatJob>(
    'csat-survey',
    async (job) => {
      const { processCsatSurvey } = await import('./csat.worker')
      return processCsatSurvey(job.data)
    },
    {
      connection: conn,
      concurrency: 10,
      limiter: {
        max: 20,
        duration: 1000,
      },
      stalledInterval: 30000,
      lockDuration: 60000,
      maxStalledCount: 2,
    }
  )

  csatWorker.on('failed', (job, err) => {
    logger.error({ err }, `CSAT survey failed: ${job?.id}`)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      dlqQueue.add('csat-survey', { ...job.data, _failedJobId: job.id, _queue: 'csat-survey', _error: String(err) })
        .catch((dlqErr) => logger.error({ err: dlqErr }, '[DLQ] Failed to enqueue csat-survey job'))
    }
  })

  logger.info('✅ BullMQ workers started: whatsapp, ai, shopify, outgoing-whatsapp, outgoing-instagram, ai-embed, notifications, proactive, incoming-instagram, incoming-webchat, csat-survey')
}
