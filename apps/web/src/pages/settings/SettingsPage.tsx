import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Bot, Users, Plug, Save,
  Plus, Trash2, Eye, EyeOff, Check,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

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

// ─── Tab: Channels ────────────────────────────────────────────────────────────

function ChannelsTab() {
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({})
  const toggleShow = (key: string) => setShowTokens(s => ({ ...s, [key]: !s[key] }))

  const channels = [
    {
      id: 'whatsapp', name: 'WhatsApp Business', icon: '💬',
      description: 'Receive & send messages via WhatsApp Cloud API',
      connected: true,
      fields: [
        { key: 'phoneId', label: 'Phone Number ID', value: '123456789012345', secret: false },
        { key: 'token', label: 'Access Token', value: 'EAABsbCS1234...', secret: true },
        { key: 'verify', label: 'Webhook Verify Token', value: 'sahay-wa-verify-2026', secret: false },
      ],
    },
    {
      id: 'instagram', name: 'Instagram DM', icon: '📸',
      description: 'Respond to DMs and story replies',
      connected: false,
      fields: [
        { key: 'igToken', label: 'Page Access Token', value: '', secret: true },
        { key: 'igId', label: 'Instagram Business Account ID', value: '', secret: false },
      ],
    },
    {
      id: 'webchat', name: 'Web Chat Widget', icon: '🌐',
      description: 'Embed a chat widget on your website',
      connected: true,
      fields: [
        { key: 'widgetId', label: 'Widget ID', value: 'wgt_ras_prod_abc123', secret: false },
        { key: 'domains', label: 'Allowed domains', value: 'rasluxuryoils.com', secret: false },
      ],
    },
    {
      id: 'shopify', name: 'Shopify', icon: '🛍️',
      description: 'Sync products, orders, and customers in real-time',
      connected: true,
      fields: [
        { key: 'shopDomain', label: 'Shop domain', value: 'ras-luxury-oils.myshopify.com', secret: false },
        { key: 'shopToken', label: 'Access Token', value: 'shpat_1234...', secret: true },
      ],
    },
  ]

  return (
    <div className="max-w-2xl space-y-4">
      {channels.map(ch => (
        <div key={ch.id} className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{ch.icon}</span>
              <div>
                <p className="text-sm font-semibold text-text-primary">{ch.name}</p>
                <p className="text-xs text-text-secondary">{ch.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
                ch.connected ? 'bg-success/10 text-success' : 'bg-border text-text-secondary',
              )}>
                <span className={cn('w-1.5 h-1.5 rounded-full', ch.connected ? 'bg-success' : 'bg-text-secondary')} />
                {ch.connected ? 'Connected' : 'Not connected'}
              </span>
              {!ch.connected && (
                <button className="text-xs px-3 py-1 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
                  Connect
                </button>
              )}
            </div>
          </div>

          {ch.connected && (
            <div className="p-4 space-y-3">
              {ch.fields.map(f => {
                const showKey = `${ch.id}-${f.key}`
                return (
                  <div key={f.key} className="flex items-center gap-3">
                    <label className="text-xs text-text-secondary w-44 flex-shrink-0">{f.label}</label>
                    <div className="flex-1 relative">
                      <Input
                        type={f.secret && !showTokens[showKey] ? 'password' : 'text'}
                        defaultValue={f.value}
                        className="text-xs font-mono"
                      />
                      {f.secret && (
                        <button type="button" onClick={() => toggleShow(showKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary">
                          {showTokens[showKey] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="flex gap-2 pt-1">
                <button className="text-xs px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 flex items-center gap-1.5">
                  <Save className="w-3 h-3" /> Save
                </button>
                <button className="text-xs px-3 py-1.5 border border-border text-text-secondary rounded-lg hover:text-error hover:border-error flex items-center gap-1.5">
                  <Trash2 className="w-3 h-3" /> Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'general', label: 'General', icon: Building2, component: GeneralTab },
  { id: 'ai', label: 'AI Settings', icon: Bot, component: AISettingsTab },
  { id: 'team', label: 'Team', icon: Users, component: TeamTab },
  { id: 'channels', label: 'Channels', icon: Plug, component: ChannelsTab },
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
