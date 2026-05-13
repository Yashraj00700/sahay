/**
 * Resend transactional-email service.
 *
 * Framework-agnostic (no Fastify / Express imports) so this module can be
 * called from Vercel Functions, Fastify routes, BullMQ workers, Inngest jobs,
 * or unit tests. The `Resend` SDK client is lazy-initialized as a singleton
 * so cold starts only pay the cost on the first send.
 *
 * Test mode (`NODE_ENV === 'test'`) routes every send to an in-memory inbox
 * exported as `__testInbox`, so test code can assert against captured emails
 * without monkey-patching anything.
 */

import { Resend } from "resend";
import { z } from "zod";

import { env } from "../../lib/env";
import {
  agentInviteTemplate,
  escalationAlertTemplate,
  onboardingWelcomeTemplate,
  passwordResetTemplate,
  type AgentInviteArgs,
  type EscalationAlertArgs,
  type OnboardingWelcomeArgs,
  type PasswordResetArgs,
} from "./templates";
import type {
  CapturedEmail,
  EmailCategory,
  EmailResult,
  RenderedEmail,
  SendEmailOptions,
} from "./types";

// ─── Test inbox ───────────────────────────────────────────────

/**
 * In-memory capture of every email sent under `NODE_ENV=test`. Tests should
 * `expect(__testInbox).toHaveLength(1)` etc. and call `__resetTestInbox()` in
 * `beforeEach` to keep cases isolated.
 */
export const __testInbox: CapturedEmail[] = [];

/** Reset the test inbox. No-op outside `NODE_ENV=test`. */
export function __resetTestInbox(): void {
  __testInbox.length = 0;
}

// ─── Singleton ────────────────────────────────────────────────

let cachedClient: Resend | null = null;

/**
 * Lazy-initialize and return the Resend client singleton. Returns `null` in
 * test mode so callers know to route to the in-memory inbox instead.
 */
function getClient(): Resend | null {
  if (env.NODE_ENV === "test") return null;
  if (cachedClient) return cachedClient;
  cachedClient = new Resend(env.RESEND_API_KEY);
  return cachedClient;
}

// ─── Validation schemas ───────────────────────────────────────

const emailString = z.string().email("must be a valid email address");

const recipientSchema = z.union([
  emailString,
  z.array(emailString).min(1, "at least one recipient is required"),
]);

const passwordResetSchema = z.object({
  to: emailString,
  agentName: z.string().min(1, "agentName is required"),
  resetUrl: z.string().url("resetUrl must be a valid URL"),
  expiresInMinutes: z.number().int().positive("expiresInMinutes must be > 0"),
});

const agentInviteSchema = z.object({
  to: emailString,
  inviterName: z.string().min(1, "inviterName is required"),
  tenantName: z.string().min(1, "tenantName is required"),
  inviteUrl: z.string().url("inviteUrl must be a valid URL"),
  expiresInHours: z.number().int().positive("expiresInHours must be > 0"),
});

const escalationAlertSchema = z.object({
  to: emailString,
  agentName: z.string().min(1, "agentName is required"),
  conversationUrl: z.string().url("conversationUrl must be a valid URL"),
  customerName: z.string().min(1, "customerName is required"),
  reason: z.string().min(1, "reason is required"),
  urgencyScore: z.number().min(0).max(100),
});

const onboardingWelcomeSchema = z.object({
  to: emailString,
  agentName: z.string().min(1, "agentName is required"),
  tenantName: z.string().min(1, "tenantName is required"),
  dashboardUrl: z.string().url("dashboardUrl must be a valid URL"),
});

const sendEmailSchema = z.object({
  to: recipientSchema,
  subject: z.string().min(1, "subject is required"),
  html: z.string().min(1, "html is required"),
  text: z.string().min(1, "text is required"),
  category: z
    .enum([
      "password_reset",
      "agent_invite",
      "escalation_alert",
      "onboarding_welcome",
      "generic",
    ])
    .optional(),
  replyTo: recipientSchema.optional(),
  cc: recipientSchema.optional(),
  bcc: recipientSchema.optional(),
});

// ─── Internal send helper ─────────────────────────────────────

interface DispatchArgs {
  to: string | string[];
  rendered: RenderedEmail;
  category: EmailCategory;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}

/**
 * Internal: dispatch a rendered email through Resend (or the test inbox).
 * Centralizes error handling, tagging, and the test/prod branch so each
 * public `send*` function stays a thin wrapper.
 */
async function dispatch(args: DispatchArgs): Promise<EmailResult> {
  const { to, rendered, category, replyTo, cc, bcc } = args;

  // Test mode: capture instead of sending.
  if (env.NODE_ENV === "test") {
    const captured: CapturedEmail = {
      to,
      from: env.EMAIL_FROM,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      category,
      sentAt: new Date(),
    };
    __testInbox.push(captured);
    // Deterministic mock id for assertions.
    return { ok: true, id: `test_${category}_${__testInbox.length}` };
  }

  const client = getClient();
  if (!client) {
    // Should be unreachable: getClient() only returns null in test mode and
    // we already handled that above. Guard anyway for type-narrowing.
    return { ok: false, error: "Resend client not initialized" };
  }

  try {
    const response = await client.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [{ name: "category", value: category }],
      ...(replyTo !== undefined ? { replyTo } : {}),
      ...(cc !== undefined ? { cc } : {}),
      ...(bcc !== undefined ? { bcc } : {}),
    });

    if (response.error) {
      const message = response.error.message ?? "Unknown Resend error";
      if (env.NODE_ENV !== "production") {
        console.error("[email] Resend send failed:", response.error);
      }
      return { ok: false, error: message };
    }

    if (!response.data) {
      return { ok: false, error: "Resend returned no data and no error" };
    }

    return { ok: true, id: response.data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (env.NODE_ENV !== "production") {
      console.error("[email] Resend send threw:", err);
    }
    return { ok: false, error: message };
  }
}

/** Format a Zod error into a single human-readable string. */
function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

// ─── Public send* functions ───────────────────────────────────

export interface SendPasswordResetArgs extends PasswordResetArgs {
  to: string;
}

/** Send a password-reset email to one recipient. */
export async function sendPasswordReset(
  args: SendPasswordResetArgs,
): Promise<EmailResult> {
  const parsed = passwordResetSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  const { to, ...templateArgs } = parsed.data;
  const rendered = passwordResetTemplate(templateArgs);
  return dispatch({ to, rendered, category: "password_reset" });
}

export interface SendAgentInviteArgs extends AgentInviteArgs {
  to: string;
}

/** Send an agent-invite email to a prospective teammate. */
export async function sendAgentInvite(
  args: SendAgentInviteArgs,
): Promise<EmailResult> {
  const parsed = agentInviteSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  const { to, ...templateArgs } = parsed.data;
  const rendered = agentInviteTemplate(templateArgs);
  return dispatch({ to, rendered, category: "agent_invite" });
}

export interface SendEscalationAlertArgs extends EscalationAlertArgs {
  to: string;
}

/** Send an escalation-alert email to a human agent. */
export async function sendEscalationAlert(
  args: SendEscalationAlertArgs,
): Promise<EmailResult> {
  const parsed = escalationAlertSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  const { to, ...templateArgs } = parsed.data;
  const rendered = escalationAlertTemplate(templateArgs);
  return dispatch({ to, rendered, category: "escalation_alert" });
}

export interface SendOnboardingWelcomeArgs extends OnboardingWelcomeArgs {
  to: string;
}

/** Send the welcome email to a freshly-signed-up agent. */
export async function sendOnboardingWelcome(
  args: SendOnboardingWelcomeArgs,
): Promise<EmailResult> {
  const parsed = onboardingWelcomeSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  const { to, ...templateArgs } = parsed.data;
  const rendered = onboardingWelcomeTemplate(templateArgs);
  return dispatch({ to, rendered, category: "onboarding_welcome" });
}

/** Send an arbitrary one-off email; bring-your-own subject + html + text. */
export async function sendEmail(opts: SendEmailOptions): Promise<EmailResult> {
  const parsed = sendEmailSchema.safeParse(opts);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  const { to, subject, html, text, category, replyTo, cc, bcc } = parsed.data;
  return dispatch({
    to,
    rendered: { subject, html, text },
    category: category ?? "generic",
    replyTo,
    cc,
    bcc,
  });
}
