import { z } from "zod";
import { defineAuthedHandler, parseBody } from "../../apps/api/src/lib/handler";
import {
  authorizeChannel,
  canAccessChannel,
} from "../../apps/api/src/lib/pusher";
import { ForbiddenError } from "../../apps/api/src/lib/errors";

const Schema = z.object({
  socket_id: z.string().min(1),
  channel_name: z.string().min(1),
});

export default defineAuthedHandler(
  async (req, res, ctx) => {
    const { socket_id, channel_name } = parseBody(Schema, req.body);
    if (!canAccessChannel(channel_name, ctx.tenant.id, ctx.agent.id)) {
      throw new ForbiddenError("Cannot subscribe to this channel");
    }
    const auth = authorizeChannel(socket_id, channel_name, {
      user_id: ctx.agent.id,
      user_info: { name: ctx.agent.name, role: ctx.agent.role },
    });
    res.status(200).json(auth);
  },
  { methods: ["POST"] },
);
