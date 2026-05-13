/**
 * Shared types for the email service.
 *
 * Kept framework-agnostic (no Fastify / Express imports) so this module can
 * be invoked from Vercel Functions, Fastify routes, BullMQ workers, or tests.
 */

/** Result returned by every send* function. Discriminated union on `ok`. */
export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** A recipient with an optional display name. */
export interface EmailRecipient {
  email: string;
  name?: string;
}

/** Payload returned by every template function. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Logical category used as the Resend `tag` value (and analytics dimension). */
export type EmailCategory =
  | "password_reset"
  | "agent_invite"
  | "escalation_alert"
  | "onboarding_welcome"
  | "generic";

/** Options accepted by the generic `sendEmail` helper. */
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  category?: EmailCategory;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}

/** A single captured email when running under NODE_ENV=test. */
export interface CapturedEmail {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text: string;
  category: EmailCategory;
  sentAt: Date;
}
