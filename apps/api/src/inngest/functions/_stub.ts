import { inngest } from '../client'
import type { SahayEventName } from '../client'

/**
 * Stub functions for the 9 events that haven't been ported off
 * BullMQ yet. Each is a no-op that logs and returns null. Keeping
 * them registered means the serve() endpoint advertises every
 * event slot to Inngest's dashboard from day one — when we port
 * a queue we just swap the stub for a real implementation, no
 * route changes needed.
 *
 * Add real impls to this folder, drop them from `stubFunctions`,
 * and re-export the real one from `index.ts`.
 */

type StubSpec = {
  /** Function id (kebab-case, mirrors event name where reasonable). */
  id: string
  /** Event the stub listens to. */
  event: Exclude<SahayEventName, 'whatsapp/message.received'>
}

const STUBS: ReadonlyArray<StubSpec> = [
  { id: 'instagram-incoming', event: 'instagram/message.received' },
  { id: 'webchat-incoming', event: 'webchat/message.received' },
  { id: 'ai-respond', event: 'ai/respond.requested' },
  { id: 'ai-embed', event: 'ai/embed.requested' },
  { id: 'whatsapp-outgoing', event: 'whatsapp/message.send' },
  { id: 'instagram-outgoing', event: 'instagram/message.send' },
  { id: 'shopify-sync', event: 'shopify/sync.requested' },
  { id: 'notifications-push', event: 'notifications/push.requested' },
  { id: 'proactive-message', event: 'proactive/message.scheduled' },
]

export const stubFunctions = STUBS.map((spec) =>
  inngest.createFunction(
    { id: spec.id, retries: 1 },
    { event: spec.event },
    async ({ event, step, logger }) => {
      return step.run('todo-port', () => {
        logger.info({ name: event.name, id: spec.id }, 'TODO port — stub function invoked')
        return null
      })
    },
  ),
)
