import { Inngest, EventSchemas } from 'inngest'
import { env } from '../lib/env'

// ─── Event Payload Types ─────────────────────────────────────
// Strongly-typed payloads for every Sahay queue event. Each
// corresponds 1:1 with one of the legacy BullMQ queues defined
// in src/lib/queues.ts. As we port queues over, the producer
// side switches from `queue.add(...)` to `inngest.send(...)`.

/**
 * Raw Meta webhook entry shape — this is the `entry[].changes[].value`
 * payload that Meta posts for WhatsApp / Instagram messaging events.
 * We don't try to fully model it here; downstream parsing is the
 * responsibility of each function.
 */
export type MetaWebhookEntry = Record<string, unknown>

export type ShopifyResource = 'orders' | 'customers' | 'products' | 'inventory'

// ─── Event Map ────────────────────────────────────────────────
// Inngest's TypeScript generics expect a map of event-name → { data: ... }.
// Adding a new event = add an entry here; producers + consumers get full
// autocomplete + payload validation at compile time.

type SahayEvents = {
  'whatsapp/message.received': {
    data: {
      tenantId: string
      // The producer (`/api/webhooks/whatsapp`) hands us the parsed
      // `messages[0]` object directly when available. Older callers
      // pass the whole `entry` blob in `raw` for back-compat.
      raw: MetaWebhookEntry
      phoneNumberId?: string
    }
  }
  'whatsapp/status.updated': {
    data: {
      tenantId: string
      raw: Record<string, unknown>
    }
  }
  'instagram/message.received': {
    data: {
      tenantId: string
      raw: MetaWebhookEntry
    }
  }
  'webchat/message.received': {
    data: {
      tenantId: string
      sessionId: string
      message: string
    }
  }
  'ai/respond.requested': {
    data: {
      tenantId: string
      conversationId: string
      messageId: string
    }
  }
  'ai/embed.requested': {
    data: {
      tenantId: string
      kbChunkId: string
    }
  }
  'whatsapp/message.send': {
    data: {
      tenantId: string
      to: string
      content: string
      templateName?: string
      templateParams?: ReadonlyArray<string>
    }
  }
  'instagram/message.send': {
    data: {
      tenantId: string
      to: string
      content: string
    }
  }
  'shopify/sync.requested': {
    data: {
      tenantId: string
      resource: ShopifyResource
      since?: string
    }
  }
  // ─── Shopify webhook fan-out events ─────────────────────────
  // Emitted by /api/webhooks/shopify after HMAC validation. The
  // payload is the raw Shopify body parsed as JSON. Inngest functions
  // own the side-effect logic (DB upserts, fulfillment notifications,
  // etc.); the webhook handler stays cheap so it can ack within Shopify's
  // 5-second timeout.
  'shopify/orders.created': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/orders.updated': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/orders.cancelled': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/orders.fulfilled': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/customers.created': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/customers.updated': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/products.created': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/products.updated': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/products.deleted': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
      eventId: string
    }
  }
  'shopify/app.uninstalled': {
    data: {
      tenantId: string
      shop: string
    }
  }
  'shopify/customers.data_request': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
    }
  }
  'shopify/customers.redact': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
    }
  }
  'shopify/shop.redact': {
    data: {
      tenantId: string
      shop: string
      payload: Record<string, unknown>
    }
  }
  'notifications/push.requested': {
    data: {
      tenantId: string
      agentId: string
      title: string
      body: string
      url?: string
    }
  }
  'proactive/message.scheduled': {
    data: {
      tenantId: string
      customerId: string
      templateKey: string
      scheduleAt: string
    }
  }
}

export type SahayEventName = keyof SahayEvents
export type SahayEventPayload<N extends SahayEventName> = SahayEvents[N]['data']

// ─── Client ───────────────────────────────────────────────────
// Singleton Inngest client. The `id` is the app namespace shown in
// the Inngest dashboard. `eventKey` authenticates event writes.
// Webhook signature verification uses INNGEST_SIGNING_KEY in the
// serve() endpoint, not here.

export const inngest = new Inngest({
  id: 'sahay',
  eventKey: env.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<SahayEvents>(),
})

// Convenience: a typed `send` helper so callers can do
//   import { sendEvent } from '@/inngest/client'
//   await sendEvent({ name: 'whatsapp/message.received', data: {...} })
// without importing the client + binding themselves.
export const sendEvent = inngest.send.bind(inngest)
