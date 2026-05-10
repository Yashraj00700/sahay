// ─── Onboarding wizard ────────────────────────────────────────────────────────
// 7-step wizard merchants land on after Shopify OAuth callback. Each step
// persists its own slice — there is no "Save All at the end" — so partial
// progress survives a refresh. Step 1 (Shopify) auto-completes when the
// callback redirect carries `?installed=1`.
//
// Steps:
//   0 Welcome — tells them what to expect
//   1 Connect Shopify — only if tenant.shopifyDomain isn't already set
//   2 First admin agent — invite a teammate or skip; merchant is already in
//   3 Connect WhatsApp — paste credentials → /api/settings/channels (PATCH)
//   4 Connect Instagram — paste credentials → /api/settings/channels (PATCH)
//   5 AI persona — name / tone / language → /api/settings/ai (PATCH)
//   6 Done — link to /inbox

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Bot,
  Sparkles,
  Store,
  MessageCircle,
  Instagram,
  UserPlus,
  PartyPopper,
  Loader2,
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'
import { cn } from '../../lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

interface WhatsAppCreds {
  phoneNumberId: string
  accessToken: string
  verifyToken: string
  appSecret: string
}

interface InstagramCreds {
  pageId: string
  accessToken: string
  verifyToken: string
}

interface PersonaForm {
  aiPersonaName: string
  aiTone: 'formal' | 'warm' | 'casual'
  aiLanguage: 'en' | 'hi' | 'hinglish' | 'auto'
}

interface InviteForm {
  name: string
  email: string
  role: 'admin' | 'agent'
}

type StepId =
  | 'welcome'
  | 'shopify'
  | 'agent'
  | 'whatsapp'
  | 'instagram'
  | 'persona'
  | 'done'

interface StepDef {
  id: StepId
  label: string
  icon: typeof Bot
}

const STEPS: StepDef[] = [
  { id: 'welcome', label: 'Welcome', icon: Sparkles },
  { id: 'shopify', label: 'Shopify', icon: Store },
  { id: 'agent', label: 'Team', icon: UserPlus },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'instagram', label: 'Instagram', icon: Instagram },
  { id: 'persona', label: 'AI Persona', icon: Bot },
  { id: 'done', label: 'Done', icon: PartyPopper },
]

// ─── Reusable inputs ────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-text-primary block">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-text-secondary">{hint}</p>}
    </div>
  )
}

function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-surface',
        'text-text-primary placeholder:text-text-secondary',
        'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function StyledSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-surface text-text-primary',
        'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

// ─── Step bodies ────────────────────────────────────────────────────────────

function StepWelcome() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-text-primary">
          Welcome to Sahay
        </h2>
        <p className="text-sm text-text-secondary mt-1">
          A few minutes to plug in your channels and tune your AI agent. You can
          skip any step now and come back later from Settings.
        </p>
      </div>

      <ul className="space-y-2 pt-2">
        {[
          'Connect Shopify so the AI can read orders and products',
          'Connect WhatsApp + Instagram for inbound messages',
          'Set the AI persona (name, tone, language)',
          'Invite teammates to handle escalations',
        ].map((line) => (
          <li
            key={line}
            className="flex items-start gap-2 text-sm text-text-primary"
          >
            <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StepShopify({
  shopifyDomain,
  onShopify,
}: {
  shopifyDomain: string | null
  onShopify: (shop: string) => void
}) {
  const [shop, setShop] = useState('')

  if (shopifyDomain) {
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-bold text-text-primary">
          Shopify connected
        </h2>
        <p className="text-sm text-text-secondary">
          Linked to <code className="px-1.5 py-0.5 rounded bg-border/30 text-text-primary text-xs">{shopifyDomain}</code>.
        </p>
        <div className="p-3 rounded-lg bg-success/10 border border-success/20 flex items-center gap-2 text-sm text-success">
          <Check className="w-4 h-4" /> All set — products and orders will sync automatically.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary">
          Connect your Shopify store
        </h2>
        <p className="text-sm text-text-secondary mt-1">
          We need read access to your products, orders, and customers.
        </p>
      </div>

      <Field
        label="Shopify domain"
        hint="The myshopify.com subdomain — e.g. your-store"
      >
        <div className="flex">
          <Input
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            placeholder="your-store"
            className="rounded-r-none"
          />
          <span className="flex items-center px-3 bg-border/30 border border-l-0 border-border rounded-r-lg text-sm text-text-secondary">
            .myshopify.com
          </span>
        </div>
      </Field>

      <button
        type="button"
        disabled={shop.trim().length < 1}
        onClick={() => onShopify(shop.trim().toLowerCase())}
        className="w-full px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
      >
        Install Sahay on Shopify
      </button>
    </div>
  )
}

function StepInviteAgent({
  data,
  onChange,
  onSubmit,
  pending,
}: {
  data: InviteForm
  onChange: (d: Partial<InviteForm>) => void
  onSubmit: () => void
  pending: boolean
}) {
  const valid = data.email.includes('@') && data.name.trim().length > 0

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Invite a teammate</h2>
        <p className="text-sm text-text-secondary mt-1">
          You're already in. Want a colleague to help handle escalations? Invite
          them now or skip and add later.
        </p>
      </div>

      <Field label="Name">
        <Input
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Jane Doe"
        />
      </Field>

      <Field label="Email">
        <Input
          type="email"
          value={data.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="jane@yourbrand.com"
        />
      </Field>

      <Field label="Role">
        <StyledSelect
          value={data.role}
          onChange={(e) => onChange({ role: e.target.value as 'admin' | 'agent' })}
        >
          <option value="agent">Agent — handles conversations</option>
          <option value="admin">Admin — full access including settings</option>
        </StyledSelect>
      </Field>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!valid || pending}
        className="w-full px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending && <Loader2 className="w-4 h-4 animate-spin" />}
        Send invite
      </button>
    </div>
  )
}

function StepWhatsApp({
  data,
  onChange,
  onSubmit,
  pending,
}: {
  data: WhatsAppCreds
  onChange: (d: Partial<WhatsAppCreds>) => void
  onSubmit: () => void
  pending: boolean
}) {
  const valid =
    data.phoneNumberId.trim().length > 0 && data.accessToken.trim().length > 0

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Connect WhatsApp</h2>
        <p className="text-sm text-text-secondary mt-1">
          Paste your WhatsApp Cloud API credentials from Meta Business Manager.
        </p>
      </div>

      <Field
        label="Phone Number ID"
        hint="Found in Meta Business Manager → WhatsApp → Phone numbers"
      >
        <Input
          value={data.phoneNumberId}
          onChange={(e) => onChange({ phoneNumberId: e.target.value })}
          placeholder="123456789012345"
        />
      </Field>

      <Field label="Permanent Access Token">
        <Input
          type="password"
          value={data.accessToken}
          onChange={(e) => onChange({ accessToken: e.target.value })}
          placeholder="EAABsbCS..."
        />
      </Field>

      <Field
        label="Webhook Verify Token"
        hint="A string you pick. We'll send it back during the webhook handshake."
      >
        <Input
          value={data.verifyToken}
          onChange={(e) => onChange({ verifyToken: e.target.value })}
          placeholder="my-secret-verify-token"
        />
      </Field>

      <Field
        label="App Secret"
        hint="Used to verify webhook signatures."
      >
        <Input
          type="password"
          value={data.appSecret}
          onChange={(e) => onChange({ appSecret: e.target.value })}
          placeholder="••••••••"
        />
      </Field>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!valid || pending}
        className="w-full px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending && <Loader2 className="w-4 h-4 animate-spin" />}
        Save WhatsApp credentials
      </button>
    </div>
  )
}

function StepInstagram({
  data,
  onChange,
  onSubmit,
  pending,
}: {
  data: InstagramCreds
  onChange: (d: Partial<InstagramCreds>) => void
  onSubmit: () => void
  pending: boolean
}) {
  const valid =
    data.pageId.trim().length > 0 && data.accessToken.trim().length > 0

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Connect Instagram</h2>
        <p className="text-sm text-text-secondary mt-1">
          Paste your Instagram credentials from Meta Business Manager.
        </p>
      </div>

      <Field label="Instagram Page ID">
        <Input
          value={data.pageId}
          onChange={(e) => onChange({ pageId: e.target.value })}
          placeholder="17841405..."
        />
      </Field>

      <Field label="Page Access Token">
        <Input
          type="password"
          value={data.accessToken}
          onChange={(e) => onChange({ accessToken: e.target.value })}
          placeholder="EAAG..."
        />
      </Field>

      <Field label="Webhook Verify Token">
        <Input
          value={data.verifyToken}
          onChange={(e) => onChange({ verifyToken: e.target.value })}
          placeholder="my-secret-verify-token"
        />
      </Field>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!valid || pending}
        className="w-full px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending && <Loader2 className="w-4 h-4 animate-spin" />}
        Save Instagram credentials
      </button>
    </div>
  )
}

function StepPersona({
  data,
  onChange,
  onSubmit,
  pending,
}: {
  data: PersonaForm
  onChange: (d: Partial<PersonaForm>) => void
  onSubmit: () => void
  pending: boolean
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Set your AI persona</h2>
        <p className="text-sm text-text-secondary mt-1">
          What should the assistant call itself, and how should it sound?
        </p>
      </div>

      <Field label="Persona name">
        <Input
          value={data.aiPersonaName}
          onChange={(e) => onChange({ aiPersonaName: e.target.value })}
          placeholder="Sahay"
        />
      </Field>

      <Field label="Tone">
        <StyledSelect
          value={data.aiTone}
          onChange={(e) =>
            onChange({ aiTone: e.target.value as PersonaForm['aiTone'] })
          }
        >
          <option value="warm">Warm — friendly & empathetic (recommended)</option>
          <option value="formal">Formal — businesslike</option>
          <option value="casual">Casual — relaxed & playful</option>
        </StyledSelect>
      </Field>

      <Field label="Default language">
        <StyledSelect
          value={data.aiLanguage}
          onChange={(e) =>
            onChange({ aiLanguage: e.target.value as PersonaForm['aiLanguage'] })
          }
        >
          <option value="hinglish">Hinglish (recommended for India)</option>
          <option value="hi">Hindi (Devanagari)</option>
          <option value="en">English</option>
          <option value="auto">Auto-detect from customer</option>
        </StyledSelect>
      </Field>

      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || data.aiPersonaName.trim().length < 1}
        className="w-full px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending && <Loader2 className="w-4 h-4 animate-spin" />}
        Save persona
      </button>
    </div>
  )
}

function StepDone({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="space-y-4 text-center">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
        <PartyPopper className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-2xl font-bold text-text-primary">You're all set!</h2>
      <p className="text-sm text-text-secondary">
        Sahay will start handling new conversations as they arrive. Open the
        inbox to see them roll in.
      </p>
      <button
        onClick={onFinish}
        className="px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90"
      >
        Go to inbox
      </button>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

interface ChannelError {
  response?: { data?: { error?: { message?: string } } }
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tenant = useAuthStore((s) => s.tenant)
  const me = useAuthStore((s) => s.agent)

  const initialStep: number = useMemo(() => {
    if (params.get('installed') === '1' || tenant?.shopifyDomain) {
      // Skip past the Shopify step.
      return 2
    }
    return 0
  }, [params, tenant?.shopifyDomain])

  const [step, setStep] = useState<number>(initialStep)
  const [completed, setCompleted] = useState<Set<StepId>>(() => {
    const s = new Set<StepId>()
    if (tenant?.shopifyDomain) s.add('shopify')
    if (params.get('installed') === '1') s.add('shopify')
    return s
  })

  // Show error toast on ?error=...
  useEffect(() => {
    const err = params.get('error')
    if (err) {
      toast.error(`Setup error: ${err.replace(/_/g, ' ')}`)
      const next = new URLSearchParams(params)
      next.delete('error')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  const [invite, setInvite] = useState<InviteForm>({
    name: '',
    email: '',
    role: 'agent',
  })

  const [whatsapp, setWhatsapp] = useState<WhatsAppCreds>({
    phoneNumberId: '',
    accessToken: '',
    verifyToken: '',
    appSecret: '',
  })

  const [instagram, setInstagram] = useState<InstagramCreds>({
    pageId: '',
    accessToken: '',
    verifyToken: '',
  })

  const [persona, setPersona] = useState<PersonaForm>({
    aiPersonaName: tenant?.aiPersonaName ?? 'Sahay',
    aiTone: (tenant?.aiTone ?? 'warm') as PersonaForm['aiTone'],
    aiLanguage: (tenant?.aiLanguage ?? 'hinglish') as PersonaForm['aiLanguage'],
  })

  const totalSteps = STEPS.length
  const currentStep = STEPS[step]

  const markComplete = (id: StepId) => {
    setCompleted((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const goNext = () => setStep((s) => Math.min(s + 1, totalSteps - 1))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  const inviteMutation = useMutation({
    mutationFn: async () => {
      await api.post('/agents/invite', invite)
    },
    onSuccess: () => {
      toast.success(`Invite sent to ${invite.email}`)
      markComplete('agent')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      goNext()
    },
    onError: (err: ChannelError) =>
      toast.error(err?.response?.data?.error?.message ?? 'Invite failed'),
  })

  const whatsappMutation = useMutation({
    mutationFn: async () => {
      await api.patch('/settings/channels', { whatsapp })
    },
    onSuccess: () => {
      toast.success('WhatsApp connected')
      markComplete('whatsapp')
      goNext()
    },
    onError: (err: ChannelError) =>
      toast.error(err?.response?.data?.error?.message ?? 'WhatsApp failed'),
  })

  const instagramMutation = useMutation({
    mutationFn: async () => {
      await api.patch('/settings/channels', { instagram })
    },
    onSuccess: () => {
      toast.success('Instagram connected')
      markComplete('instagram')
      goNext()
    },
    onError: (err: ChannelError) =>
      toast.error(err?.response?.data?.error?.message ?? 'Instagram failed'),
  })

  const personaMutation = useMutation({
    mutationFn: async () => {
      await api.patch('/settings/ai', persona)
    },
    onSuccess: () => {
      toast.success('AI persona saved')
      markComplete('persona')
      goNext()
    },
    onError: (err: ChannelError) =>
      toast.error(err?.response?.data?.error?.message ?? 'Could not save persona'),
  })

  const handleShopifyInstall = (shop: string) => {
    if (!shop) return
    const url = `/api/shopify/install?shop=${encodeURIComponent(`${shop}.myshopify.com`)}`
    window.location.href = url
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6 justify-center">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-text-primary">Sahay</span>
        </div>

        {/* Progress indicator */}
        <div className="mb-6 space-y-3">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>
              Step {step + 1} of {totalSteps} · {currentStep.label}
            </span>
            <span>{Math.round(((step + 1) / totalSteps) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-border/40 overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {STEPS.map((s, i) => {
              const StepIcon = s.icon
              const done = completed.has(s.id) || i < step
              const active = i === step
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => setStep(i)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors flex-shrink-0',
                    active
                      ? 'bg-primary/10 border-primary text-primary'
                      : done
                        ? 'bg-success/10 border-success/30 text-success'
                        : 'bg-surface border-border text-text-secondary',
                  )}
                >
                  {done ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <StepIcon className="w-3 h-3" />
                  )}
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Step body */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm p-6">
          {currentStep.id === 'welcome' && <StepWelcome />}
          {currentStep.id === 'shopify' && (
            <StepShopify
              shopifyDomain={tenant?.shopifyDomain ?? null}
              onShopify={handleShopifyInstall}
            />
          )}
          {currentStep.id === 'agent' && (
            <StepInviteAgent
              data={invite}
              onChange={(d) => setInvite((p) => ({ ...p, ...d }))}
              onSubmit={() => inviteMutation.mutate()}
              pending={inviteMutation.isPending}
            />
          )}
          {currentStep.id === 'whatsapp' && (
            <StepWhatsApp
              data={whatsapp}
              onChange={(d) => setWhatsapp((p) => ({ ...p, ...d }))}
              onSubmit={() => whatsappMutation.mutate()}
              pending={whatsappMutation.isPending}
            />
          )}
          {currentStep.id === 'instagram' && (
            <StepInstagram
              data={instagram}
              onChange={(d) => setInstagram((p) => ({ ...p, ...d }))}
              onSubmit={() => instagramMutation.mutate()}
              pending={instagramMutation.isPending}
            />
          )}
          {currentStep.id === 'persona' && (
            <StepPersona
              data={persona}
              onChange={(d) => setPersona((p) => ({ ...p, ...d }))}
              onSubmit={() => personaMutation.mutate()}
              pending={personaMutation.isPending}
            />
          )}
          {currentStep.id === 'done' && (
            <StepDone onFinish={() => navigate('/inbox')} />
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0}
              className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>

            <div className="flex items-center gap-2">
              {currentStep.id !== 'done' && (
                <button
                  type="button"
                  onClick={goNext}
                  className="text-sm text-text-secondary hover:text-text-primary transition-colors px-3 py-2"
                >
                  Skip for now
                </button>
              )}
              {currentStep.id !== 'done' && (
                <button
                  type="button"
                  onClick={goNext}
                  className="flex items-center gap-1 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-text-secondary mt-4">
          Signed in as <span className="text-text-primary">{me?.email}</span> ·{' '}
          <button
            type="button"
            onClick={() => navigate('/inbox')}
            className="text-primary hover:underline"
          >
            Skip onboarding
          </button>
        </p>
      </div>
    </div>
  )
}
