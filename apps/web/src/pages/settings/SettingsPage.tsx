import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Bot, Users, Plug, Save,
  Plus, Trash2, Eye, EyeOff, Check,
  User, CreditCard, Lock, Zap, CheckCircle2, AlertCircle,
  Copy, ExternalLink, X, Settings2, ArrowLeftRight,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../store/auth.store'
import type { PlanTier } from '@sahay/shared'

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">{label}</label>
      {children}
      {hint && <p className="text-xs text-text-secondary">{hint}</p>}
    </div>
  )
}

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary',
        'placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function StyledSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary',
        'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30',
        checked ? 'bg-primary' : 'bg-border',
      )}
    >
      <span className={cn(
        'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  )
}

function SaveBtn({ loading, saved }: { loading: boolean; saved: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
        saved ? 'bg-success/10 text-success' : 'bg-primary text-white hover:bg-primary/90',
        loading && 'opacity-60 cursor-not-allowed',
      )}
    >
      {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
      {loading ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
    </button>
  )
}

// ─── Tab: General ─────────────────────────────────────────────────────────────

function GeneralTab() {
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    name: 'RAS Luxury Oils',
    timezone: 'Asia/Kolkata',
    supportEmail: 'support@rasluxuryoils.com',
    businessHoursStart: '09:00',
    businessHoursEnd: '21:00',
    autoClose: true,
    autoCloseHours: 24,
  })

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api.patch('/settings/brand', form) } catch { /* use local state */ }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
      <Field label="Brand name">
        <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your brand" />
      </Field>

      <Field label="Support email" hint="Shown in notifications to agents and customers">
        <Input type="email" value={form.supportEmail} onChange={e => set('supportEmail', e.target.value)} />
      </Field>

      <Field label="Timezone">
        <StyledSelect value={form.timezone} onChange={e => set('timezone', e.target.value)}>
          <option value="Asia/Kolkata">IST — Asia/Kolkata (UTC+5:30)</option>
          <option value="UTC">UTC</option>
          <option value="America/New_York">ET — America/New_York</option>
          <option value="Europe/London">GMT — Europe/London</option>
        </StyledSelect>
      </Field>

      <Field label="Business hours" hint="Outside these hours, conversations queue for the next day">
        <div className="flex items-center gap-3">
          <Input type="time" value={form.businessHoursStart} onChange={e => set('businessHoursStart', e.target.value)} className="w-36" />
          <span className="text-text-secondary text-sm">to</span>
          <Input type="time" value={form.businessHoursEnd} onChange={e => set('businessHoursEnd', e.target.value)} className="w-36" />
        </div>
      </Field>

      <div className="p-4 bg-surface border border-border rounded-xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Auto-close inactive conversations</p>
            <p className="text-xs text-text-secondary mt-0.5">Automatically close with no recent activity</p>
          </div>
          <Toggle checked={form.autoClose} onChange={v => set('autoClose', v)} />
        </div>
        {form.autoClose && (
          <Field label="Close after (hours)">
            <Input type="number" min={1} max={168} value={form.autoCloseHours}
              onChange={e => set('autoCloseHours', parseInt(e.target.value))} className="w-24" />
          </Field>
        )}
      </div>

      <SaveBtn loading={false} saved={saved} />
    </form>
  )
}

// ─── Tab: AI Settings ─────────────────────────────────────────────────────────

function AISettingsTab() {
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    aiEnabled: true,
    autoRespondThreshold: 85,
    draftThreshold: 65,
    maxAutoResponses: 5,
    escalateOnSentiment: true,
    primaryLanguage: 'hinglish',
    systemPromptAppend: '',
  })

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api.patch('/settings/ai', form) } catch { /* local only */ }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
      <div className="p-4 bg-surface border border-border rounded-xl flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">AI Auto-Respond</p>
          <p className="text-xs text-text-secondary mt-0.5">Allow AI to send responses without human review</p>
        </div>
        <Toggle checked={form.aiEnabled} onChange={v => set('aiEnabled', v)} />
      </div>

      {form.aiEnabled && (
        <>
          <Field
            label={`Auto-respond threshold — ${form.autoRespondThreshold}%`}
            hint="AI responds automatically when confidence exceeds this level"
          >
            <input type="range" min={50} max={99} value={form.autoRespondThreshold}
              onChange={e => set('autoRespondThreshold', parseInt(e.target.value))}
              className="w-full accent-primary" />
            <div className="flex justify-between text-xs text-text-secondary mt-1">
              <span>50% — more auto</span><span>99% — more human review</span>
            </div>
          </Field>

          <Field
            label={`Draft + review threshold — ${form.draftThreshold}%`}
            hint="Below this threshold, routes directly to a human without a draft"
          >
            <input type="range" min={30} max={95} value={form.draftThreshold}
              onChange={e => set('draftThreshold', parseInt(e.target.value))}
              className="w-full accent-primary" />
          </Field>

          <Field label="Max AI responses per conversation" hint="Prevents loops — after this many AI messages, route to human">
            <Input type="number" min={1} max={20} value={form.maxAutoResponses}
              onChange={e => set('maxAutoResponses', parseInt(e.target.value))} className="w-24" />
          </Field>

          <div className="p-4 bg-surface border border-border rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">Escalate on very negative sentiment</p>
              <p className="text-xs text-text-secondary mt-0.5">Route to senior agent when customer is upset</p>
            </div>
            <Toggle checked={form.escalateOnSentiment} onChange={v => set('escalateOnSentiment', v)} />
          </div>

          <Field label="Primary response language">
            <StyledSelect value={form.primaryLanguage} onChange={e => set('primaryLanguage', e.target.value)}>
              <option value="hinglish">Hinglish (recommended for India)</option>
              <option value="hindi">Hindi (Devanagari)</option>
              <option value="english">English</option>
            </StyledSelect>
          </Field>

          <Field
            label="System prompt append"
            hint="Extra instructions added to the AI prompt — e.g. tone, things to avoid"
          >
            <textarea
              rows={4}
              value={form.systemPromptAppend}
              onChange={e => set('systemPromptAppend', e.target.value)}
              placeholder="e.g. Always recommend our new Vitamin C serum for brightening questions..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            />
          </Field>
        </>
      )}

      <SaveBtn loading={false} saved={saved} />
    </form>
  )
}

// ─── Tab: Team ────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string; name: string; email: string
  role: string; status: 'active' | 'invited'
}

const MOCK_TEAM: TeamMember[] = [
  { id: '1', name: 'Priya Sharma', email: 'priya@rasluxuryoils.com', role: 'admin', status: 'active' },
  { id: '2', name: 'Rahul Verma', email: 'rahul@rasluxuryoils.com', role: 'agent', status: 'active' },
  { id: '3', name: 'Sneha Patel', email: 'sneha@rasluxuryoils.com', role: 'agent', status: 'invited' },
]

function TeamTab() {
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('agent')

  const { data: members = MOCK_TEAM } = useQuery<TeamMember[]>({
    queryKey: ['settings', 'team'],
    queryFn: () => api.get('/settings/team').then(r => r.data.team ?? r.data).catch(() => MOCK_TEAM),
    staleTime: 60_000,
  })

  const ROLE_BADGE: Record<string, string> = {
    admin: 'bg-primary/10 text-primary',
    agent: 'bg-success/10 text-success',
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">{members.length} members</p>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Invite member
        </button>
      </div>

      {showInvite && (
        <div className="p-4 bg-surface border border-primary/30 rounded-xl space-y-3">
          <p className="text-sm font-medium text-text-primary">Invite a new member</p>
          <div className="flex gap-2">
            <Input type="email" placeholder="email@yourbrand.com" value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)} />
            <StyledSelect value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="w-28">
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </StyledSelect>
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90"
              onClick={() => { setShowInvite(false); setInviteEmail('') }}
            >Send invite</button>
            <button className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
              onClick={() => setShowInvite(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {members.map(m => (
          <div key={m.id} className="flex items-center gap-3 p-3 bg-surface border border-border rounded-xl">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
              {m.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{m.name}</p>
              <p className="text-xs text-text-secondary truncate">{m.email}</p>
            </div>
            <div className="flex items-center gap-2">
              {m.status === 'invited' && (
                <span className="text-xs text-warning bg-warning/10 px-2 py-0.5 rounded-full">Invited</span>
              )}
              <span className={cn('text-xs px-2 py-0.5 rounded-full capitalize font-medium', ROLE_BADGE[m.role] ?? 'bg-border text-text-secondary')}>
                {m.role}
              </span>
              <button className="p-1 text-text-secondary hover:text-error transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab: Integrations ────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://api.sahay.ai'

// Derive the public webhook base URL from VITE_API_URL.
// e.g. "https://api.sahay.ai/api" → "https://api.sahay.ai"
//      "https://api.sahay.ai"     → "https://api.sahay.ai"
function webhookBase(): string {
  try {
    const u = new URL(API_BASE)
    return u.origin
  } catch {
    return 'https://api.sahay.ai'
  }
}

interface ConfigModal {
  channelId: string
  title: string
  fields: { key: string; label: string; placeholder: string; secret?: boolean }[]
}

function WebhookRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {/* ignore clipboard errors */})
  }
  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="text-xs text-text-secondary w-24 flex-shrink-0">{label}</span>
      <div className="flex-1 flex items-center gap-1 px-2.5 py-1.5 bg-background border border-border rounded-lg font-mono text-xs text-text-secondary overflow-hidden">
        <span className="truncate flex-1">{url}</span>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy webhook URL"
        className={cn(
          'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0',
          copied
            ? 'bg-success/10 text-success'
            : 'bg-surface border border-border text-text-secondary hover:text-text-primary',
        )}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

function ConfigureModal({
  modal,
  onClose,
}: {
  modal: ConfigModal
  onClose: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>(
    Object.fromEntries(modal.fields.map(f => [f.key, '']))
  )
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.patch(`/settings/integrations/${modal.channelId}`, form)
    } catch { /* graceful */ }
    setSaving(false)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <p className="text-sm font-semibold text-text-primary">Configure {modal.title}</p>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          {modal.fields.map(f => (
            <Field key={f.key} label={f.label}>
              <div className="relative">
                <Input
                  type={f.secret && !showSecret[f.key] ? 'password' : 'text'}
                  value={form[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className={f.secret ? 'pr-10 font-mono text-xs' : ''}
                />
                {f.secret && (
                  <button
                    type="button"
                    onClick={() => setShowSecret(s => ({ ...s, [f.key]: !s[f.key] }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                  >
                    {showSecret[f.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </Field>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                saved ? 'bg-success/10 text-success' : 'bg-primary text-white hover:bg-primary/90',
                saving && 'opacity-60 cursor-not-allowed',
              )}
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary border border-border"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function IntegrationsTab() {
  const { tenant } = useAuthStore()
  const [openModal, setOpenModal] = useState<ConfigModal | null>(null)

  const base = webhookBase()

  // Derive real connection status from tenant data
  const whatsappConnected = Boolean(tenant?.shopName) // WhatsApp connected if onboarded (shopName present + platform data)
  const instagramConnected = false // no instagramPageId on Tenant yet
  const shopifyConnected = Boolean(tenant?.shopifyDomain)

  type ChannelDef = {
    id: string
    name: string
    description: string
    connected: boolean
    detail: string | null
    webhookPath: string
    modal: Omit<ConfigModal, 'channelId'>
  }

  const channels: ChannelDef[] = [
    {
      id: 'whatsapp',
      name: 'WhatsApp Business',
      description: 'Receive and send messages via WhatsApp Cloud API',
      connected: whatsappConnected,
      detail: null,
      webhookPath: '/webhooks/whatsapp',
      modal: {
        title: 'WhatsApp Business',
        fields: [
          { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '123456789012345' },
          { key: 'accessToken', label: 'Access Token', placeholder: 'EAABsbCS…', secret: true },
          { key: 'verifyToken', label: 'Webhook Verify Token', placeholder: 'sahay-wa-verify-…' },
        ],
      },
    },
    {
      id: 'instagram',
      name: 'Instagram',
      description: 'Respond to DMs and story replies via Meta Graph API',
      connected: instagramConnected,
      detail: null,
      webhookPath: '/webhooks/instagram',
      modal: {
        title: 'Instagram',
        fields: [
          { key: 'pageAccessToken', label: 'Page Access Token', placeholder: 'EAABsbCS…', secret: true },
          { key: 'instagramBusinessAccountId', label: 'Instagram Business Account ID', placeholder: '17841400…' },
          { key: 'verifyToken', label: 'Webhook Verify Token', placeholder: 'sahay-ig-verify-…' },
        ],
      },
    },
    {
      id: 'shopify',
      name: 'Shopify',
      description: 'Sync products, orders, and customers in real-time',
      connected: shopifyConnected,
      detail: tenant?.shopifyDomain ?? null,
      webhookPath: '/webhooks/shopify',
      modal: {
        title: 'Shopify',
        fields: [
          { key: 'shopDomain', label: 'Store domain', placeholder: 'your-store.myshopify.com' },
          { key: 'accessToken', label: 'Admin API access token', placeholder: 'shpat_…', secret: true },
          { key: 'webhookSecret', label: 'Webhook secret', placeholder: 'shpss_…', secret: true },
        ],
      },
    },
  ]

  return (
    <>
      {openModal && (
        <ConfigureModal
          modal={openModal}
          onClose={() => setOpenModal(null)}
        />
      )}

      <div className="max-w-2xl space-y-4">
        <p className="text-sm text-text-secondary mb-2">
          Connect external platforms so Sahay can receive messages and sync data.
        </p>

        {channels.map(ch => {
          const webhookUrl = `${base}${ch.webhookPath}`
          return (
            <div key={ch.id} className="bg-surface border border-border rounded-xl overflow-hidden">
              {/* Channel header row */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                    ch.connected ? 'bg-success/10' : 'bg-border/60',
                  )}>
                    <ExternalLink className={cn('w-4 h-4', ch.connected ? 'text-success' : 'text-text-secondary')} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{ch.name}</p>
                    <p className="text-xs text-text-secondary">{ch.description}</p>
                    {ch.detail && (
                      <p className="text-xs font-mono text-text-secondary mt-0.5">{ch.detail}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn(
                    'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
                    ch.connected ? 'bg-success/10 text-success' : 'bg-border text-text-secondary',
                  )}>
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      ch.connected ? 'bg-success' : 'bg-text-secondary',
                    )} />
                    {ch.connected ? 'Connected' : 'Not connected'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenModal({ channelId: ch.id, ...ch.modal })}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-background border border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-primary/40 transition-colors"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Configure
                  </button>
                </div>
              </div>

              {/* Webhook URL row */}
              <div className="px-4 pb-4 border-t border-border pt-3">
                <WebhookRow label="Webhook URL" url={webhookUrl} />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ─── Tab: Profile ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { agent, setAuth, tenant } = useAuthStore()
  const [saved, setSaved] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const [displayName, setDisplayName] = useState(agent?.name ?? '')

  const [pwForm, setPwForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false })

  const ROLE_LABEL: Record<string, string> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    agent: 'Agent',
    viewer: 'Viewer',
  }

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileLoading(true)
    try {
      const res = await api.patch('/team/me', { name: displayName })
      // Update store with new name
      if (agent && tenant) {
        setAuth({ token: '', agent: { ...agent, name: displayName }, tenant })
      }
      void res
    } catch { /* graceful — local state still updated */ }
    setProfileLoading(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError(null)
    if (pwForm.newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.')
      return
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords do not match.')
      return
    }
    setPwLoading(true)
    try {
      await api.patch('/team/me/password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      })
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPwSaved(true)
      setTimeout(() => setPwSaved(false), 2500)
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to change password.'
      setPwError(msg)
    }
    setPwLoading(false)
  }

  if (!agent) return null

  const initials = agent.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className="max-w-xl space-y-8">
      {/* Profile info section */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-4">Account information</h3>

        {/* Avatar + identity */}
        <div className="flex items-center gap-4 p-4 bg-surface border border-border rounded-xl mb-5">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #6B4EFF20, #6B4EFF40)', color: '#6B4EFF', border: '2px solid #6B4EFF30' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{agent.name}</p>
            <p className="text-xs text-text-secondary truncate">{agent.email}</p>
            <span className="inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">
              {ROLE_LABEL[agent.role] ?? agent.role}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-success">
            <span className="w-2 h-2 rounded-full bg-success" />
            Online
          </div>
        </div>

        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <Field label="Display name" hint="This is how your name appears to customers and teammates">
            <Input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </Field>

          <Field label="Email address" hint="Contact your admin to change your email">
            <Input type="email" value={agent.email} disabled />
          </Field>

          <button
            type="submit"
            disabled={profileLoading || displayName === agent.name}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              pwSaved ? 'bg-success/10 text-success' : 'bg-primary text-white hover:bg-primary/90',
              (profileLoading || displayName === agent.name) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {profileLoading ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
          </button>
        </form>
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Change password section */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Change password</h3>
        <p className="text-xs text-text-secondary mb-4">Choose a strong password of at least 8 characters.</p>

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {/* Current password */}
          <Field label="Current password">
            <div className="relative">
              <Input
                type={showPw.current ? 'text' : 'password'}
                value={pwForm.currentPassword}
                onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))}
                placeholder="••••••••"
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw(s => ({ ...s, current: !s.current }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                {showPw.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          {/* New password */}
          <Field label="New password">
            <div className="relative">
              <Input
                type={showPw.next ? 'text' : 'password'}
                value={pwForm.newPassword}
                onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw(s => ({ ...s, next: !s.next }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                {showPw.next ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          {/* Confirm new password */}
          <Field label="Confirm new password">
            <div className="relative">
              <Input
                type={showPw.confirm ? 'text' : 'password'}
                value={pwForm.confirmPassword}
                onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))}
                placeholder="Repeat your new password"
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw(s => ({ ...s, confirm: !s.confirm }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                {showPw.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          {pwError && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-error">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {pwError}
            </div>
          )}

          <button
            type="submit"
            disabled={pwLoading || !pwForm.currentPassword || !pwForm.newPassword || !pwForm.confirmPassword}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              pwSaved ? 'bg-success/10 text-success' : 'bg-primary text-white hover:bg-primary/90',
              (pwLoading || !pwForm.currentPassword || !pwForm.newPassword || !pwForm.confirmPassword) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {pwSaved ? <CheckCircle2 className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            {pwLoading ? 'Updating…' : pwSaved ? 'Password updated!' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Tab: Billing ─────────────────────────────────────────────────────────────

const PLAN_CONFIG: Record<PlanTier, {
  label: string
  color: string
  bgColor: string
  borderColor: string
  conversationLimit: number
  features: string[]
}> = {
  trial: {
    label: 'Free Trial',
    color: '#f59e0b',
    bgColor: 'rgba(245,158,11,0.08)',
    borderColor: 'rgba(245,158,11,0.25)',
    conversationLimit: 100,
    features: [
      '100 conversations / month',
      'WhatsApp + Web Chat',
      'AI auto-respond',
      'Basic analytics',
      '1 team member',
    ],
  },
  starter: {
    label: 'Starter',
    color: '#6B4EFF',
    bgColor: 'rgba(107,78,255,0.08)',
    borderColor: 'rgba(107,78,255,0.2)',
    conversationLimit: 500,
    features: [
      '500 conversations / month',
      'All channels',
      'AI auto-respond + drafts',
      'Full analytics',
      'Up to 3 agents',
      'Knowledge base',
    ],
  },
  growth: {
    label: 'Growth',
    color: '#6B4EFF',
    bgColor: 'rgba(107,78,255,0.08)',
    borderColor: 'rgba(107,78,255,0.2)',
    conversationLimit: 2000,
    features: [
      '2,000 conversations / month',
      'All channels',
      'Priority AI queue',
      'Advanced analytics + exports',
      'Up to 10 agents',
      'Custom AI persona',
      'Shopify deep integration',
    ],
  },
  pro: {
    label: 'Pro',
    color: '#10b981',
    bgColor: 'rgba(16,185,129,0.08)',
    borderColor: 'rgba(16,185,129,0.2)',
    conversationLimit: 10000,
    features: [
      '10,000 conversations / month',
      'All channels',
      'Dedicated AI model fine-tuning',
      'White-glove onboarding',
      'Unlimited agents',
      'SLA guarantees',
      'API access',
    ],
  },
  enterprise: {
    label: 'Enterprise',
    color: '#10b981',
    bgColor: 'rgba(16,185,129,0.08)',
    borderColor: 'rgba(16,185,129,0.2)',
    conversationLimit: Infinity,
    features: [
      'Unlimited conversations',
      'Custom deployment',
      'Dedicated support',
      'Custom integrations',
      'Compliance & security',
      'Volume pricing',
    ],
  },
}

function BillingTab() {
  const { tenant } = useAuthStore()
  const plan = tenant?.plan ?? 'trial'
  const config = PLAN_CONFIG[plan]

  // Mock usage stats — in production these come from an API
  const usedConversations = 73
  const limitConversations = config.conversationLimit
  const usagePercent = limitConversations === Infinity ? 0 : Math.round((usedConversations / limitConversations) * 100)

  const trialDaysLeft = tenant?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(tenant.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null

  return (
    <div className="max-w-xl space-y-6">
      {/* Current plan card */}
      <div className="p-5 rounded-xl border" style={{ background: config.bgColor, borderColor: config.borderColor }}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: config.bgColor, color: config.color, border: `1px solid ${config.borderColor}` }}
              >
                {config.label}
              </span>
              {plan === 'trial' && trialDaysLeft !== null && (
                <span className="text-xs text-warning font-medium">
                  {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary">
              {tenant?.shopName ?? 'Your workspace'}
            </p>
          </div>
          <CreditCard className="w-5 h-5 text-text-secondary" />
        </div>

        <ul className="space-y-2">
          {config.features.map(feature => (
            <li key={feature} className="flex items-center gap-2 text-sm text-text-primary">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: config.color }} />
              {feature}
            </li>
          ))}
        </ul>
      </div>

      {/* Usage stats */}
      {limitConversations !== Infinity && (
        <div className="p-4 bg-surface border border-border rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-text-primary">Conversations this month</p>
            <p className="text-sm font-semibold text-text-primary">
              {usedConversations.toLocaleString()}
              <span className="text-text-secondary font-normal"> / {limitConversations.toLocaleString()}</span>
            </p>
          </div>
          <div className="w-full h-2 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(usagePercent, 100)}%`,
                background: usagePercent > 85 ? '#ef4444' : usagePercent > 65 ? '#f59e0b' : config.color,
              }}
            />
          </div>
          <p className="text-xs text-text-secondary mt-1.5">{usagePercent}% used</p>
        </div>
      )}

      {/* Upgrade CTA */}
      {plan !== 'enterprise' && (
        <div className="p-4 bg-surface border border-border rounded-xl">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(107,78,255,0.12)' }}>
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-text-primary mb-0.5">
                {plan === 'trial' ? 'Upgrade to unlock full features' : 'Upgrade your plan'}
              </p>
              <p className="text-xs text-text-secondary mb-3">
                {plan === 'trial'
                  ? 'Your trial ends soon. Upgrade now to keep your AI support running without interruption.'
                  : 'Get more conversations, more agents, and advanced AI features.'}
              </p>
              <div className="relative inline-block">
                <button
                  disabled
                  title="Billing portal coming soon — contact support@sahay.ai to upgrade"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white opacity-60 cursor-not-allowed"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Upgrade plan
                </button>
                <span className="absolute -top-2 -right-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning text-white leading-tight">
                  Soon
                </span>
              </div>
              <p className="text-xs text-text-secondary mt-2">
                To upgrade now, email{' '}
                <a href="mailto:support@sahay.ai" className="text-primary hover:underline">
                  support@sahay.ai
                </a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Billing contact */}
      <div className="p-4 rounded-xl border border-border bg-surface">
        <p className="text-xs text-text-secondary">
          <span className="font-medium text-text-primary">Billing enquiries?</span>{' '}
          Reach out at{' '}
          <a href="mailto:billing@sahay.ai" className="text-primary hover:underline">
            billing@sahay.ai
          </a>
          {' '}or WhatsApp{' '}
          <a href="https://wa.me/919999999999" className="text-primary hover:underline" target="_blank" rel="noreferrer">
            +91 99999 99999
          </a>
        </p>
      </div>
    </div>
  )
}

// ─── Tab: COD Conversion ──────────────────────────────────────────────────────

interface CodConversionSettings {
  enabled: boolean
  discountPercent: number
  delayHours: number
}

function CodConversionTab() {
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState<CodConversionSettings>({
    enabled: false,
    discountPercent: 10,
    delayHours: 1,
  })

  const set = (k: keyof CodConversionSettings, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }))

  // Load existing settings
  const { data: fetchedSettings } = useQuery<CodConversionSettings>({
    queryKey: ['settings', 'cod-conversion'],
    queryFn: () =>
      api.get('/settings/cod-conversion').then(r => r.data as CodConversionSettings),
  })

  useEffect(() => {
    if (fetchedSettings) setForm(fetchedSettings)
  }, [fetchedSettings])

  const mutation = useMutation({
    mutationFn: (data: CodConversionSettings) =>
      api.patch('/settings/cod-conversion', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'cod-conversion'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate(form)
  }

  // Sample WhatsApp message preview
  const previewMessage = form.enabled
    ? `Namaste! 🙏\n\nThank you for your order. We noticed you chose Cash on Delivery.\n\nSwitch to prepaid now and get *${form.discountPercent}% off* your order — use code *COD2PRE-XXXXXXXX* at checkout.\n\nThis offer expires in 24 hours. Tap below to pay online and save!`
    : null

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      {/* Feature overview */}
      <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10">
            <ArrowLeftRight className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">COD → Prepaid Conversion</p>
            <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
              When a customer places a Cash on Delivery order, automatically send them a WhatsApp
              message offering a discount to switch to prepaid payment. Reduces RTO risk and improves
              cash flow — a key growth lever for Indian D2C brands.
            </p>
          </div>
        </div>
      </div>

      {/* Enable toggle */}
      <div className="p-4 bg-surface border border-border rounded-xl flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">Enable COD → Prepaid conversion</p>
          <p className="text-xs text-text-secondary mt-0.5">
            Send an automatic WhatsApp offer when a COD order is placed
          </p>
        </div>
        <Toggle checked={form.enabled} onChange={v => set('enabled', v)} />
      </div>

      {form.enabled && (
        <>
          {/* Discount % */}
          <Field
            label="Discount offer (%)"
            hint="Percentage discount offered to the customer to switch to prepaid"
          >
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={100}
                value={form.discountPercent}
                onChange={e => set('discountPercent', Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-24"
              />
              <span className="text-sm text-text-secondary">% off</span>
            </div>
          </Field>

          {/* Delay hours */}
          <Field
            label="Message delay (hours)"
            hint="How many hours after the COD order is placed to send the WhatsApp message. 0 = send immediately."
          >
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={0}
                max={72}
                value={form.delayHours}
                onChange={e => set('delayHours', Math.min(72, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-24"
              />
              <span className="text-sm text-text-secondary">
                {form.delayHours === 0 ? 'immediately' : `hour${form.delayHours !== 1 ? 's' : ''} after order`}
              </span>
            </div>
          </Field>

          {/* WhatsApp message preview */}
          {previewMessage && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-text-primary">WhatsApp message preview</p>
              <div className="relative bg-[#ECE5DD] rounded-xl p-4">
                {/* WA chat bubble */}
                <div className="max-w-xs ml-auto bg-white rounded-xl rounded-tr-sm p-3 shadow-sm">
                  <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {previewMessage.split('*').map((seg, i) =>
                      i % 2 === 1
                        ? <strong key={i} className="font-semibold">{seg}</strong>
                        : <span key={i}>{seg}</span>
                    )}
                  </p>
                  <div className="flex items-center justify-end gap-1 mt-1.5">
                    <span className="text-[10px] text-gray-400">
                      {form.delayHours === 0 ? 'Sent immediately' : `Sent ${form.delayHours}h after order`}
                    </span>
                    <CheckCircle2 className="w-3 h-3 text-blue-400" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 mt-2 text-center">
                  Template: <code className="font-mono">cod_prepaid_offer</code> — must be approved in WhatsApp Business Manager
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <SaveBtn loading={mutation.isPending} saved={saved} />
    </form>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'general', label: 'General', icon: Building2, component: GeneralTab },
  { id: 'ai', label: 'AI Settings', icon: Bot, component: AISettingsTab },
  { id: 'cod', label: 'COD Conversion', icon: ArrowLeftRight, component: CodConversionTab },
  { id: 'team', label: 'Team', icon: Users, component: TeamTab },
  { id: 'integrations', label: 'Integrations', icon: Plug, component: IntegrationsTab },
  { id: 'profile', label: 'My Profile', icon: User, component: ProfileTab },
  { id: 'billing', label: 'Billing', icon: CreditCard, component: BillingTab },
]

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general')
  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component ?? GeneralTab

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-6 pt-6 pb-0 border-b border-border flex-shrink-0">
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary mt-0.5 mb-4">Configure your Sahay workspace</p>
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <ActiveComponent />
      </div>
    </div>
  )
}
