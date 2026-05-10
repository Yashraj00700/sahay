import { z } from 'zod'
import { conversations, messages } from '@sahay/db'
import { and, eq } from 'drizzle-orm'
import { defineAuthedHandler, parseBody } from '../../../apps/api/src/lib/handler'
import { enforce, limits } from '../../../apps/api/src/lib/rate-limit'
import { NotFoundError } from '../../../apps/api/src/lib/errors'
import { triggerToTenant } from '../../../apps/api/src/lib/pusher'

const addNoteSchema = z.object({
  content: z.string().min(1).max(4000),
})

export default defineAuthedHandler(
  async (req, res, ctx) => {
    await enforce(limits.perTenant(), ctx.tenant.id)
    const id = req.query.id as string
    const tenantId = ctx.tenant.id

    const body = parseBody(addNoteSchema, req.body)

    const note = await ctx.withTenant(async (tx) => {
      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)),
        )
      if (!conv) throw new NotFoundError('Not found')

      const [note] = await tx
        .insert(messages)
        .values({
          conversationId: id,
          tenantId,
          senderType: 'agent',
          senderId: ctx.agent.id,
          contentType: 'note',
          content: body.content,
        })
        .returning()

      return note
    })

    await triggerToTenant(
      tenantId,
      'message:new',
      note as unknown as Record<string, unknown>,
    )

    res.status(201).json(note)
  },
  { methods: ['POST'] },
)
