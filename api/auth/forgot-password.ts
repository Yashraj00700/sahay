import { z } from "zod";
import { db, agents } from "@sahay/db";
import { eq } from "drizzle-orm";
import { defineHandler, parseBody } from "../../apps/api/src/lib/handler";
import { randomToken } from "../../apps/api/src/lib/crypto";
import { sendPasswordReset } from "../../apps/api/src/services/email";
import { env } from "../../apps/api/src/lib/env";
import { logger } from "../../apps/api/src/lib/logger";
import { limits, enforce } from "../../apps/api/src/lib/rate-limit";

const Schema = z.object({ email: z.string().email() });

const RESET_TTL_MS = 60 * 60 * 1000;

export default defineHandler(
  async (req, res, ctx) => {
    await enforce(limits.perIpAuth(), ctx.ip || "unknown");
    const { email } = parseBody(Schema, req.body);

    const agent = await db.query.agents.findFirst({
      where: eq(agents.email, email.toLowerCase()),
    });

    if (agent) {
      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + RESET_TTL_MS);
      await db
        .update(agents)
        .set({
          resetToken: token,
          resetTokenExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));

      const resetUrl = `${env.WEB_URL}/auth/reset-password?token=${token}`;
      const result = await sendPasswordReset({
        to: agent.email,
        agentName: agent.name,
        resetUrl,
        expiresInMinutes: Math.floor(RESET_TTL_MS / 60000),
      });
      if (!result.ok) {
        logger.warn(
          { agentId: agent.id, error: result.error },
          "Password reset email failed",
        );
      }
    }

    res.status(200).json({
      success: true,
      message:
        "If an account exists with this email, a reset link has been sent.",
    });
  },
  { methods: ["POST"] },
);
