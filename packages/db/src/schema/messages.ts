import {
  pgTable, uuid, text, boolean, timestamp, decimal, integer,
  jsonb, index,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { conversations } from './conversations'
import { agents } from './agents'

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Sender
  senderType: text('sender_type').notNull(), // customer|ai|agent|system
  senderId: uuid('sender_id').references(() => agents.id),
  // Content
  contentType: text('content_type').notNull().default('text'),
  // text|image|audio|video|document|template|interactive|note|system_event
  content: text('content'),
  contentRichtext: jsonb('content_richtext'),    // for rich text notes
  mediaUrl: text('media_url'),
  mediaSize: integer('media_size'),
  mediaMimeType: text('media_mime_type'),
  mediaFilename: text('media_filename'),
  // Voice note
  transcription: text('transcription'),
  transcriptionConfidence: decimal('transcription_confidence', { precision: 3, scale: 2 }),
  voiceDurationSeconds: integer('voice_duration_seconds'),
  // AI metadata
  isAiDraft: boolean('is_ai_draft').default(false),    // drafted by AI, sent by human
  aiConfidence: decimal('ai_confidence', { precision: 3, scale: 2 }),
  aiIntent: text('ai_intent'),
  aiCitedSources: jsonb('ai_cited_sources').default([]),
  aiModel: text('ai_model'),  // claude-3-5-sonnet|gpt-4o-mini etc.
  // Channel metadata
  channelMessageId: text('channel_message_id'),  // WA message ID, IG message ID
  channelStatus: text('channel_status').default('sent'), // sending|sent|delivered|read|failed
  channelError: text('channel_error'),
  channelRawPayload: jsonb('channel_raw_payload'), // store original webhook payload
  // WhatsApp template
  templateName: text('template_name'),
  templateParams: jsonb('template_params'),
  // Instagram story context
  igStoryId: text('ig_story_id'),
  igStoryMediaUrl: text('ig_story_media_url'),
  // Interactive message
  interactiveType: text('interactive_type'),  // buttons|list|catalog
  interactivePayload: jsonb('interactive_payload'),
  // Timestamps
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  conversationIdx: index('idx_messages_conversation').on(table.conversationId, table.createdAt),
  tenantIdx: index('idx_messages_tenant').on(table.tenantId, table.createdAt),
  channelMsgIdx: index('idx_messages_channel_id').on(table.channelMessageId),
}))

export type MessageRecord = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
