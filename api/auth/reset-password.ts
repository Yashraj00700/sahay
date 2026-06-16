import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, agents } from "@sahay/db";
import { eq } from "drizzle-orm";
import { defineHandler, parseBody } from "../../apps/api/src/lib/handler";
import { ValidationError } from "../../apps/api/src/lib/errors";
import { auditAction } from "../../apps/api/src/services/audit";

const Schema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(100)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a number"),
});

export default defineHandler(
  async (req, res, ctx) => {
    const { token, password } = parseBody(Schema, req.body);

    const agent = await db.query.agents.findFirst({
      where: eq(agents.resetToken, token),
    });

    if (
      !agent ||
      !agent.resetTokenExpiresAt ||
      agent.resetTokenExpiresAt < new Date()
    ) {
      throw new ValidationError("Invalid or expired reset token");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db
      .update(agents)
      .set({
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id));

    await auditAction({
      tenantId: agent.tenantId,
      actorType: "agent",
      actorId: agent.id,
      actorEmail: agent.email,
      action: "auth.password_reset",
      resourceType: "agent",
      resourceId: agent.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    res
      .status(200)
      .json({ success: true, message: "Password updated. Please log in." });
  },
  { methods: ["POST"] },
);
