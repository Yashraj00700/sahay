/**
 * Public barrel for the Sahay email service.
 *
 * Routes, workers, and Vercel Functions should import from this module
 * rather than reaching into `./resend` or `./templates` directly.
 */

export {
  __resetTestInbox,
  __testInbox,
  sendAgentInvite,
  sendEmail,
  sendEscalationAlert,
  sendOnboardingWelcome,
  sendPasswordReset,
  type SendAgentInviteArgs,
  type SendEscalationAlertArgs,
  type SendOnboardingWelcomeArgs,
  type SendPasswordResetArgs,
} from "./resend";

export {
  agentInviteTemplate,
  escalationAlertTemplate,
  onboardingWelcomeTemplate,
  passwordResetTemplate,
  type AgentInviteArgs,
  type EscalationAlertArgs,
  type OnboardingWelcomeArgs,
  type PasswordResetArgs,
} from "./templates";

export type {
  CapturedEmail,
  EmailCategory,
  EmailRecipient,
  EmailResult,
  RenderedEmail,
  SendEmailOptions,
} from "./types";
