// ─── WhatsApp Cloud API Adapter ───────────────────────────────────────────────
// Wraps all outgoing calls to the WhatsApp Cloud API (graph.facebook.com/v18.0).
//
// Usage:
//   const wa = new WhatsAppAdapter(phoneNumberId, accessToken)
//   await wa.sendText(to, 'Your order is on the way!')
//   await wa.sendTemplate(to, 'order_dispatched', 'en_US', [{ type: 'text', text: 'RAS-2024-8847' }])

import axios from 'axios'
import { db } from '@sahay/db'
import { messages } from '@sahay/db'
import { eq } from 'drizzle-orm'

const WA_API_BASE = 'https://graph.facebook.com/v18.0'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WASendResult {
  waMessageId: string
  to: string
}

export interface WATemplateComponent {
  type: 'header' | 'body' | 'button'
  parameters: Array<{
    type: 'text' | 'currency' | 'date_time' | 'image' | 'document'
    text?: string
    currency?: { fallback_value: string; code: string; amount_1000: number }
    image?: { link: string }
    document?: { link: string; filename: string }
  }>
  sub_type?: 'quick_reply' | 'url'
  index?: number
}

// ─── Adapter Class ────────────────────────────────────────────────────────────

export class WhatsAppAdapter {
  private readonly baseUrl: string

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {
    this.baseUrl = `${WA_API_BASE}/${phoneNumberId}/messages`
  }

  // ─── Send plain text message ────────────────────────────────────────────

  async sendText(to: string, text: string): Promise<WASendResult> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    }
    return this.send(body, to)
  }

  // ─── Send text with quick reply buttons (max 3 buttons) ────────────────

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    headerText?: string,
    footerText?: string,
  ): Promise<WASendResult> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(headerText && { header: { type: 'text', text: headerText } }),
        body: { text: bodyText },
        ...(footerText && { footer: { text: footerText } }),
        action: {
          buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } }))
        },
      },
    }
    return this.send(body, to)
  }

  // ─── Send list message (up to 10 items) ────────────────────────────────

  async sendList(
    to: string,
    bodyText: string,
    buttonLabel: string,
    sections: Array<{
      title: string
      rows: Array<{ id: string; title: string; description?: string }>
    }>,
  ): Promise<WASendResult> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: { button: buttonLabel, sections },
      },
    }
    return this.send(body, to)
  }

  // ─── Send pre-approved template ─────────────────────────────────────────

  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components: WATemplateComponent[] = [],
  ): Promise<WASendResult> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 && { components }),
      },
    }
    return this.send(body, to)
  }

  // ─── Send image ─────────────────────────────────────────────────────────

  async sendImage(to: string, imageUrl: string, caption?: string): Promise<WASendResult> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { link: imageUrl, ...(caption && { caption }) },
    }
    return this.send(body, to)
  }

  // ─── Mark message as read (sends read receipt to customer) ──────────────

  async markAsRead(waMessageId: string): Promise<void> {
    await axios.post(
      this.baseUrl,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
      },
      { headers: this.headers(), timeout: 10_000 }
    )
  }

  // ─── Core send method ───────────────────────────────────────────────────

  private async send(body: object, to: string): Promise<WASendResult> {
    try {
      const response = await axios.post(this.baseUrl, body, {
        headers: this.headers(),
        timeout: 15_000,
      })

      const waMessageId: string = response.data?.messages?.[0]?.id ?? 'unknown'
      return { waMessageId, to }
    } catch (err: any) {
      const waError = err?.response?.data?.error
      const errorMsg = waError
        ? `WhatsApp API error ${waError.code}: ${waError.message} (fbtrace: ${waError.fbtrace_id})`
        : `HTTP error: ${err.message}`
      throw new Error(errorMsg)
    }
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    }
  }
}

// ─── Factory helper — creates adapter from tenant config ─────────────────────

export function createWhatsAppAdapter(tenant: {
  whatsappPhoneNumberId: string | null
  whatsappAccessToken?: string | null
  shopifyAccessToken: string
}): WhatsAppAdapter | null {
  if (!tenant.whatsappPhoneNumberId) return null
  const token = tenant.whatsappAccessToken ?? process.env.WA_SYSTEM_ACCESS_TOKEN
  if (!token) return null
  return new WhatsAppAdapter(tenant.whatsappPhoneNumberId, token)
}

// ─── Outgoing job processor ───────────────────────────────────────────────────
// Called by the outgoing:whatsapp BullMQ worker.
// Updates message status in DB after send.

export async function processOutgoingWhatsApp(job: {
  tenantId: string
  phoneNumberId: string
  to: string
  message: {
    type: 'text' | 'template' | 'interactive' | 'image'
    text?: string
    templateName?: string
    templateLanguage?: string
    templateComponents?: WATemplateComponent[]
    imageUrl?: string
    imageCaption?: string
    interactiveBody?: string
    buttons?: Array<{ id: string; title: string }>
  }
  conversationId: string
  messageId: string    // DB messages.id
}): Promise<void> {
  const { phoneNumberId, to, message, messageId } = job
  const accessToken = process.env.WA_SYSTEM_ACCESS_TOKEN ?? ''
  const adapter = new WhatsAppAdapter(phoneNumberId, accessToken)

  try {
    let result: WASendResult

    switch (message.type) {
      case 'text':
        result = await adapter.sendText(to, message.text!)
        break
      case 'template':
        result = await adapter.sendTemplate(
          to,
          message.templateName!,
          message.templateLanguage ?? 'en_US',
          message.templateComponents ?? [],
        )
        break
      case 'interactive':
        result = await adapter.sendButtons(
          to,
          message.interactiveBody!,
          message.buttons ?? [],
        )
        break
      case 'image':
        result = await adapter.sendImage(to, message.imageUrl!, message.imageCaption)
        break
      default:
        throw new Error(`Unsupported outgoing message type: ${message.type}`)
    }

    // Update message with WA message ID + sent status
    await db.update(messages)
      .set({
        channelMessageId: result.waMessageId,
        channelStatus: 'sent',
      })
      .where(eq(messages.id, messageId))

    console.log(`[WAOut] ✅ Sent to ${to} — WA ID: ${result.waMessageId}`)

  } catch (err: any) {
    console.error(`[WAOut] ❌ Failed to send to ${to}:`, err.message)

    await db.update(messages)
      .set({
        channelStatus: 'failed',
        channelError: err.message,
      })
      .where(eq(messages.id, messageId))

    throw err
  }
}
