import Pusher from 'pusher'
import { env } from './env'

let client: Pusher | null = null

const getClient = (): Pusher => {
  if (!client) {
    client = new Pusher({
      appId: env.PUSHER_APP_ID,
      key: env.PUSHER_KEY,
      secret: env.PUSHER_SECRET,
      cluster: env.PUSHER_CLUSTER,
      useTLS: true,
    })
  }
  return client
}

export type RealtimeEvent =
  | 'message:new'
  | 'message:updated'
  | 'conversation:updated'
  | 'conversation:assigned'
  | 'agent:typing'
  | 'agent:viewing'
  | 'agent:presence'
  | 'ai:suggestion'
  | 'notification'

const tenantChannel = (tenantId: string): string => `private-tenant-${tenantId}`
const conversationChannel = (conversationId: string): string =>
  `private-conversation-${conversationId}`

export async function triggerToTenant(
  tenantId: string,
  event: RealtimeEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  await getClient().trigger(tenantChannel(tenantId), event, payload)
}

export async function triggerToConversation(
  conversationId: string,
  event: RealtimeEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  await getClient().trigger(conversationChannel(conversationId), event, payload)
}

/** Sign the auth response for a private channel after verifying JWT. */
export function authorizeChannel(
  socketId: string,
  channel: string,
  presenceData?: { user_id: string; user_info?: Record<string, unknown> },
): { auth: string; channel_data?: string } {
  if (presenceData) {
    return getClient().authorizeChannel(socketId, channel, presenceData)
  }
  return getClient().authorizeChannel(socketId, channel)
}

export function canAccessChannel(channel: string, tenantId: string, _agentId: string): boolean {
  if (channel === tenantChannel(tenantId)) return true
  if (channel.startsWith('private-conversation-')) return true
  return false
}
