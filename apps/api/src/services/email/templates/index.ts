/**
 * Pure email template renderers.
 *
 * Each function takes a typed `args` object and returns `{ subject, html, text }`.
 * Templates are intentionally dependency-light (no react-email yet) and use
 * inline-styled <table> layouts for maximum email-client compatibility.
 *
 * Branding: "Sahay" header, sky-500 (#0EA5E9) brand color, 600px max width.
 * Locale: EN only for now (i18n later).
 */

import type { RenderedEmail } from "../types";

// ─── Branding constants ───────────────────────────────────────
const BRAND_NAME = "Sahay";
const BRAND_COLOR = "#0EA5E9";
const TEXT_COLOR = "#0F172A";
const MUTED_COLOR = "#64748B";
const BG_COLOR = "#F8FAFC";
const BORDER_COLOR = "#E2E8F0";
const MAX_WIDTH = 600;

// TODO: replace with real CAN-SPAM compliant unsubscribe URL + physical address
const UNSUBSCRIBE_URL_PLACEHOLDER = "{{unsubscribe_url}}";
const PHYSICAL_ADDRESS_PLACEHOLDER = "[Sahay HQ — physical address TBD]";

// ─── Internal helpers ─────────────────────────────────────────

/** Escape characters that have special meaning in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wrap a template body in the standard Sahay shell (header + footer). */
function shell(args: { previewText: string; bodyHtml: string }): string {
  const { previewText, bodyHtml } = args;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${BRAND_NAME}</title>
</head>
<body style="margin:0;padding:0;background-color:${BG_COLOR};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT_COLOR};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;">${escapeHtml(previewText)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG_COLOR};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="${MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="max-width:${MAX_WIDTH}px;width:100%;background-color:#FFFFFF;border:1px solid ${BORDER_COLOR};border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background-color:${BRAND_COLOR};padding:20px 24px;">
            <h1 style="margin:0;font-size:20px;line-height:1.2;color:#FFFFFF;font-weight:600;">${BRAND_NAME}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 24px;font-size:15px;line-height:1.6;color:${TEXT_COLOR};">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px;border-top:1px solid ${BORDER_COLOR};font-size:12px;line-height:1.5;color:${MUTED_COLOR};text-align:center;">
            <p style="margin:0 0 8px 0;">You received this email from ${BRAND_NAME}.</p>
            <p style="margin:0 0 8px 0;">${escapeHtml(PHYSICAL_ADDRESS_PLACEHOLDER)}</p>
            <p style="margin:0;"><a href="${UNSUBSCRIBE_URL_PLACEHOLDER}" style="color:${MUTED_COLOR};text-decoration:underline;">Unsubscribe</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Standard CTA button rendered as a bullet-proof inline-styled anchor. */
function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td style="border-radius:6px;background-color:${BRAND_COLOR};">
      <a href="${href}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

// ─── Template arg types ───────────────────────────────────────

export interface PasswordResetArgs {
  agentName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface AgentInviteArgs {
  inviterName: string;
  tenantName: string;
  inviteUrl: string;
  expiresInHours: number;
}

export interface EscalationAlertArgs {
  agentName: string;
  conversationUrl: string;
  customerName: string;
  reason: string;
  urgencyScore: number;
}

export interface OnboardingWelcomeArgs {
  agentName: string;
  tenantName: string;
  dashboardUrl: string;
}

// ─── Template renderers ───────────────────────────────────────

/** Password reset email — single CTA, expiry callout, security note. */
export function passwordResetTemplate(args: PasswordResetArgs): RenderedEmail {
  const subject = `Reset your ${BRAND_NAME} password`;
  const previewText = `Click the link to reset your ${BRAND_NAME} password. Expires in ${args.expiresInMinutes} minutes.`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(args.agentName)},</p>
    <p style="margin:0 0 16px 0;">We received a request to reset the password for your ${BRAND_NAME} account. Click the button below to choose a new password.</p>
    ${ctaButton("Reset password", args.resetUrl)}
    <p style="margin:0 0 16px 0;color:${MUTED_COLOR};">This link expires in <strong style="color:${TEXT_COLOR};">${args.expiresInMinutes} minutes</strong>. If it expires, you can request a new one from the sign-in page.</p>
    <p style="margin:0 0 16px 0;color:${MUTED_COLOR};">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${MUTED_COLOR};word-break:break-all;">If the button doesn't work, paste this URL into your browser:<br /><a href="${args.resetUrl}" style="color:${BRAND_COLOR};">${escapeHtml(args.resetUrl)}</a></p>
  `;

  const text = [
    `Hi ${args.agentName},`,
    "",
    `We received a request to reset the password for your ${BRAND_NAME} account.`,
    "",
    `Reset your password: ${args.resetUrl}`,
    "",
    `This link expires in ${args.expiresInMinutes} minutes.`,
    "",
    `If you didn't request a password reset, you can safely ignore this email.`,
    "",
    `— The ${BRAND_NAME} team`,
  ].join("\n");

  return { subject, html: shell({ previewText, bodyHtml }), text };
}

/** Agent invite email — invites a teammate to join a tenant workspace. */
export function agentInviteTemplate(args: AgentInviteArgs): RenderedEmail {
  const subject = `${args.inviterName} invited you to join ${args.tenantName} on ${BRAND_NAME}`;
  const previewText = `Accept your invitation to ${args.tenantName} on ${BRAND_NAME}.`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi there,</p>
    <p style="margin:0 0 16px 0;"><strong>${escapeHtml(args.inviterName)}</strong> has invited you to join <strong>${escapeHtml(args.tenantName)}</strong> on ${BRAND_NAME}, the customer-conversation platform for support teams.</p>
    ${ctaButton("Accept invitation", args.inviteUrl)}
    <p style="margin:0 0 16px 0;color:${MUTED_COLOR};">This invitation expires in <strong style="color:${TEXT_COLOR};">${args.expiresInHours} hours</strong>.</p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${MUTED_COLOR};word-break:break-all;">Or paste this URL into your browser:<br /><a href="${args.inviteUrl}" style="color:${BRAND_COLOR};">${escapeHtml(args.inviteUrl)}</a></p>
  `;

  const text = [
    `Hi there,`,
    "",
    `${args.inviterName} has invited you to join ${args.tenantName} on ${BRAND_NAME}.`,
    "",
    `Accept invitation: ${args.inviteUrl}`,
    "",
    `This invitation expires in ${args.expiresInHours} hours.`,
    "",
    `— The ${BRAND_NAME} team`,
  ].join("\n");

  return { subject, html: shell({ previewText, bodyHtml }), text };
}

/** Escalation alert — pings an agent that an AI conversation needs human help. */
export function escalationAlertTemplate(
  args: EscalationAlertArgs,
): RenderedEmail {
  const score = Math.max(0, Math.min(100, Math.round(args.urgencyScore)));
  const subject = `[Urgent ${score}] Escalation from ${args.customerName} needs your attention`;
  const previewText = `${args.customerName} needs human support — ${args.reason}`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(args.agentName)},</p>
    <p style="margin:0 0 16px 0;">A conversation has been escalated to you and needs human attention.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;border:1px solid ${BORDER_COLOR};border-radius:6px;">
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid ${BORDER_COLOR};font-size:13px;color:${MUTED_COLOR};">Customer</td>
        <td style="padding:12px 16px;border-bottom:1px solid ${BORDER_COLOR};font-size:14px;font-weight:600;text-align:right;">${escapeHtml(args.customerName)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid ${BORDER_COLOR};font-size:13px;color:${MUTED_COLOR};">Reason</td>
        <td style="padding:12px 16px;border-bottom:1px solid ${BORDER_COLOR};font-size:14px;text-align:right;">${escapeHtml(args.reason)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:${MUTED_COLOR};">Urgency</td>
        <td style="padding:12px 16px;font-size:14px;font-weight:600;text-align:right;color:${BRAND_COLOR};">${score} / 100</td>
      </tr>
    </table>
    ${ctaButton("Open conversation", args.conversationUrl)}
    <p style="margin:24px 0 0 0;font-size:12px;color:${MUTED_COLOR};word-break:break-all;">Direct link: <a href="${args.conversationUrl}" style="color:${BRAND_COLOR};">${escapeHtml(args.conversationUrl)}</a></p>
  `;

  const text = [
    `Hi ${args.agentName},`,
    "",
    `A conversation has been escalated to you and needs human attention.`,
    "",
    `Customer: ${args.customerName}`,
    `Reason: ${args.reason}`,
    `Urgency: ${score}/100`,
    "",
    `Open conversation: ${args.conversationUrl}`,
    "",
    `— ${BRAND_NAME}`,
  ].join("\n");

  return { subject, html: shell({ previewText, bodyHtml }), text };
}

/** Onboarding welcome — first email a new agent receives after signup. */
export function onboardingWelcomeTemplate(
  args: OnboardingWelcomeArgs,
): RenderedEmail {
  const subject = `Welcome to ${BRAND_NAME}, ${args.agentName}!`;
  const previewText = `Your ${args.tenantName} workspace is ready. Let's get started.`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(args.agentName)},</p>
    <p style="margin:0 0 16px 0;">Welcome to ${BRAND_NAME}! Your <strong>${escapeHtml(args.tenantName)}</strong> workspace is ready and waiting.</p>
    <p style="margin:0 0 16px 0;">Here's what you can do next:</p>
    <ul style="margin:0 0 16px 20px;padding:0;color:${TEXT_COLOR};">
      <li style="margin:0 0 6px 0;">Connect your first channel (WhatsApp, email, web chat).</li>
      <li style="margin:0 0 6px 0;">Invite teammates to collaborate on conversations.</li>
      <li style="margin:0 0 6px 0;">Set up your AI assistant to handle Tier-1 questions.</li>
    </ul>
    ${ctaButton("Open your dashboard", args.dashboardUrl)}
    <p style="margin:24px 0 0 0;color:${MUTED_COLOR};">Need a hand? Just reply to this email — a real human will get back to you.</p>
  `;

  const text = [
    `Hi ${args.agentName},`,
    "",
    `Welcome to ${BRAND_NAME}! Your ${args.tenantName} workspace is ready.`,
    "",
    `Here's what you can do next:`,
    `  - Connect your first channel (WhatsApp, email, web chat).`,
    `  - Invite teammates to collaborate on conversations.`,
    `  - Set up your AI assistant to handle Tier-1 questions.`,
    "",
    `Open your dashboard: ${args.dashboardUrl}`,
    "",
    `Need a hand? Just reply to this email.`,
    "",
    `— The ${BRAND_NAME} team`,
  ].join("\n");

  return { subject, html: shell({ previewText, bodyHtml }), text };
}
