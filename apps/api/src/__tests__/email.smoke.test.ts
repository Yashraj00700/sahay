import { beforeEach, describe, expect, it } from 'vitest'

import {
  __resetTestInbox,
  __testInbox,
  sendAgentInvite,
  sendPasswordReset,
} from '../services/email'

describe('email smoke (test inbox)', () => {
  beforeEach(() => {
    __resetTestInbox()
  })

  it('sendPasswordReset captures one email with subject + reset URL embedded', async () => {
    const resetUrl = 'https://app.sahay.example.com/reset?token=abc123'
    const result = await sendPasswordReset({
      to: 'agent@example.com',
      agentName: 'Priya',
      resetUrl,
      expiresInMinutes: 30,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.id).toMatch(/^test_password_reset_\d+$/)
    }
    expect(__testInbox).toHaveLength(1)

    const captured = __testInbox[0]!
    expect(captured.to).toBe('agent@example.com')
    expect(captured.category).toBe('password_reset')
    expect(captured.subject.toLowerCase()).toContain('password')
    expect(captured.html).toContain(resetUrl)
    expect(captured.text).toContain(resetUrl)
  })

  it('sendAgentInvite captures one email with the invite URL', async () => {
    const inviteUrl = 'https://app.sahay.example.com/invite?token=xyz789'
    const result = await sendAgentInvite({
      to: 'newhire@example.com',
      inviterName: 'Rohan',
      tenantName: 'Acme Stores',
      inviteUrl,
      expiresInHours: 48,
    })

    expect(result.ok).toBe(true)
    expect(__testInbox).toHaveLength(1)

    const captured = __testInbox[0]!
    expect(captured.to).toBe('newhire@example.com')
    expect(captured.category).toBe('agent_invite')
    expect(captured.subject).toContain('Acme Stores')
    expect(captured.subject).toContain('Rohan')
    expect(captured.html).toContain(inviteUrl)
    expect(captured.text).toContain(inviteUrl)
  })

  it('returns { ok: false } on a malformed email address', async () => {
    const result = await sendPasswordReset({
      to: 'definitely-not-an-email',
      agentName: 'Priya',
      resetUrl: 'https://app.sahay.example.com/reset?token=abc',
      expiresInMinutes: 30,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/email|valid/i)
    }
    // Nothing should have been queued for delivery on validation failure.
    expect(__testInbox).toHaveLength(0)
  })

  it('returns { ok: false } on a malformed reset URL', async () => {
    const result = await sendPasswordReset({
      to: 'agent@example.com',
      agentName: 'Priya',
      resetUrl: 'not-a-url',
      expiresInMinutes: 30,
    })
    expect(result.ok).toBe(false)
    expect(__testInbox).toHaveLength(0)
  })

  it('isolates inbox between tests via __resetTestInbox', async () => {
    // The beforeEach hook should have already wiped the inbox.
    expect(__testInbox).toHaveLength(0)
    await sendPasswordReset({
      to: 'agent@example.com',
      agentName: 'Priya',
      resetUrl: 'https://app.sahay.example.com/r/1',
      expiresInMinutes: 30,
    })
    expect(__testInbox).toHaveLength(1)
  })
})
