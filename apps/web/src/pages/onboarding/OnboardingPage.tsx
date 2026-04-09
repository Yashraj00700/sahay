import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Check, ChevronRight, Store, Bot, Plug, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandSetupData {
  brandName: string
  shopifyDomain: string
  supportEmail: string
  timezone: string
  primaryLanguage: string
}

interface AIConfigData {
  aiEnabled: boolean
  autoRespondThreshold: number
  escalateOnNegativeSentiment: boolean
}

interface ChannelData {
  whatsappPhoneId: string
  whatsappToken: string
  instagramToken: string
}

// ─── Shared input ─────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-text-primary block">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-text-secondary">{hint}</p>}
      {error && <p className="text-xs text-error">{error}</p>}
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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      className="flex items-center justify-between p-4 bg-surface border border-border rounded-xl cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => onChange(!checked)}
    >
      <span className="text-sm text-text-primary">{label}</span>
      <div className={cn('relative w-10 h-5 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-border')}>
        <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0')} />
      </div>
    </div>
  )
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function StepBrandSetup({
  data,
  onChange,
}: {
  data: BrandSetupData
  onChange: (d: Partial<BrandSetupData>) => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Set up your brand</h2>
        <p className="text-sm text-text-secondary mt-1">
          Basic information to personalise Sahay for your team and customers
        </p>
      </div>

      <div className="space-y-4">
        <Field label="Brand name" hint="This appears in AI responses and notifications">
          <Input
            value={data.brandName}
            onChange={e => onChange({ brandName: e.target.value })}
            placeholder="RAS Luxury Oils"
          />
        </Field>

        <Field
          label="Shopify store domain"
          hint="Your myshopify.com domain — used for order and product sync"
        >
          <div className="flex">
            <Input
              value={data.shopifyDomain}
              onChange={e => onChange({ shopifyDomain: e.target.value })}
              placeholder="your-store"
              className="rounded-r-none"
            />
            <span className="flex items-center px-3 bg-border/30 border border-l-0 border-border rounded-r-lg text-sm text-text-secondary">
              .myshopify.com
            </span>
          </div>
        </Field>

        <Field label="Support email" hint="Shown in agent notifications and customer replies">
          <Input
            type="email"
            value={data.supportEmail}
            onChange={e => onChange({ supportEmail: e.target.value })}
            placeholder="support@yourbrand.com"
          />
        </Field>

        <Field label="Primary language" hint="The default language AI will use to respond">
          <select
            value={data.primaryLanguage}
            onChange={e => onChange({ primaryLanguage: e.target.value })}
            className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            <option value="hinglish">Hinglish (recommended for India)</option>
            <option value="hindi">Hindi (Devanagari)</option>
            <option value="english">English</option>
          </select>
        </Field>

        <Field label="Timezone">
          <select
            value={data.timezone}
            onChange={e => onChange({ timezone: e.target.value })}
            className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            <option value="Asia/Kolkata">IST — India Standard Time (UTC+5:30)</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">ET — Eastern Time</option>
          </select>
        </Field>
      </div>
    </div>
  )
}

function StepAIConfig({
  data,
  onChange,
}: {
  data: AIConfigData
  onChange: (d: Partial<AIConfigData>) => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Configure your AI agent</h2>
        <p className="text-sm text-text-secondary mt-1">
          Set how aggressively the AI auto-responds and when it hands off to humans
        </p>
      </div>

      <Toggle
        checked={data.aiEnabled}
        onChange={v => onChange({ aiEnabled: v })}
        label="Enable AI auto-responses"
      />

      {data.aiEnabled && (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-primary">Auto-respond confidence threshold</label>
              <span className="text-sm font-bold text-primary">{data.autoRespondThreshold}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={99}
              value={data.autoRespondThreshold}
              onChange={e => onChange({ autoRespondThreshold: parseInt(e.target.value) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-text-secondary">
              <span>More auto-responses (50%)</span>
              <span>More human review (99%)</span>
            </div>
            <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs text-text-secondary">
              💡 At {data.autoRespondThreshold}%, we estimate ~{
                data.autoRespondThreshold >= 90 ? '60–70' :
                data.autoRespondThreshold >= 80 ? '70–80' : '75–85'
              }% of conversations will be fully AI-resolved
            </div>
          </div>

          <Toggle
            checked={data.escalateOnNegativeSentiment}
            onChange={v => onChange({ escalateOnNegativeSentiment: v })}
            label="Escalate to senior agent when customer is very unhappy"
          />
        </div>
      )}
    </div>
  )
}

function StepConnectChannels({
  data,
  onChange,
}: {
  data: ChannelData
  onChange: (d: Partial<ChannelData>) => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Connect your channels</h2>
        <p className="text-sm text-text-secondary mt-1">
          Link WhatsApp and Instagram to start receiving messages. You can skip and add these later in Settings.
        </p>
      </div>

      {/* WhatsApp */}
      <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">💬</span>
          <p className="text-sm font-semibold text-text-primary">WhatsApp Business API</p>
          <span className="ml-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Recommended</span>
        </div>

        <Field label="Phone Number ID" hint="Found in Meta Business Manager → WhatsApp → Phone Numbers">
          <Input
            value={data.whatsappPhoneId}
            onChange={e => onChange({ whatsappPhoneId: e.target.value })}
            placeholder="123456789012345"
          />
        </Field>

        <Field label="Permanent Access Token">
          <Input
            type="password"
            value={data.whatsappToken}
            onChange={e => onChange({ whatsappToken: e.target.value })}
            placeholder="EAABsbCS..."
          />
        </Field>
      </div>

      {/* Instagram */}
      <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">📸</span>
          <p className="text-sm font-semibold text-text-primary">Instagram DM</p>
          <span className="ml-auto text-xs bg-border text-text-secondary px-2 py-0.5 rounded-full">Optional</span>
        </div>

        <Field label="Page Access Token" hint="From Meta Business Manager → Instagram → Advanced Access">
          <Input
            type="password"
            value={data.instagramToken}
            onChange={e => onChange({ instagramToken: e.target.value })}
            placeholder="EAAG..."
          />
        </Field>
      </div>

      <p className="text-xs text-text-secondary text-center">
        Your webhook URL is <code className="bg-surface px-1.5 py-0.5 rounded text-text-primary">
          {window.location.origin.replace(':4000', ':3001')}/webhooks/whatsapp
        </code>
      </p>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'brand', label: 'Brand Setup', icon: Store },
  { id: 'ai', label: 'AI Config', icon: Bot },
  { id: 'channels', label: 'Channels', icon: Plug },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  const [brand, setBrand] = useState<BrandSetupData>({
    brandName: '',
    shopifyDomain: '',
    supportEmail: '',
    timezone: 'Asia/Kolkata',
    primaryLanguage: 'hinglish',
  })

  const [ai, setAI] = useState<AIConfigData>({
    aiEnabled: true,
    autoRespondThreshold: 80,
    escalateOnNegativeSentiment: true,
  })

  const [channels, setChannels] = useState<ChannelData>({
    whatsappPhoneId: '',
    whatsappToken: '',
    instagramToken: '',
  })

  const completeMutation = useMutation({
    mutationFn: () =>
      api.post('/settings/onboarding', { brand, ai, channels }).catch(() => ({})),
    onSuccess: () => navigate('/'),
  })

  const canProceed = step === 0
    ? brand.brandName.trim().length > 0
    : true // ai + channels steps are optional config

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-text-primary">Sahay</span>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            const StepIcon = s.icon
            return (
              <div key={s.id} className="flex items-center">
                <div className="flex flex-col items-center gap-1">
                  <div className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors',
                    done ? 'bg-primary border-primary' :
                    active ? 'border-primary bg-primary/10' :
                    'border-border bg-surface',
                  )}>
                    {done
                      ? <Check className="w-4 h-4 text-white" />
                      : <StepIcon className={cn('w-4 h-4', active ? 'text-primary' : 'text-text-secondary')} />
                    }
                  </div>
                  <span className={cn('text-xs font-medium', active ? 'text-primary' : 'text-text-secondary')}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn('w-16 h-0.5 mx-2 mb-5 transition-colors', i < step ? 'bg-primary' : 'bg-border')} />
                )}
              </div>
            )
          })}
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm p-6">
          {step === 0 && (
            <StepBrandSetup data={brand} onChange={d => setBrand(p => ({ ...p, ...d }))} />
          )}
          {step === 1 && (
            <StepAIConfig data={ai} onChange={d => setAI(p => ({ ...p, ...d }))} />
          )}
          {step === 2 && (
            <StepConnectChannels data={channels} onChange={d => setChannels(p => ({ ...p, ...d }))} />
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            {step > 0 ? (
              <button
                onClick={() => setStep(s => s - 1)}
                className="text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                ← Back
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              {step === STEPS.length - 1 ? (
                <>
                  <button
                    onClick={() => navigate('/')}
                    className="text-sm text-text-secondary hover:text-text-primary transition-colors px-3 py-2"
                  >
                    Skip for now
                  </button>
                  <button
                    onClick={() => completeMutation.mutate()}
                    disabled={completeMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
                  >
                    {completeMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Complete setup
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setStep(s => s + 1)}
                  disabled={!canProceed}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Skip link */}
        {step === 0 && (
          <p className="text-center text-xs text-text-secondary mt-4">
            Already set up?{' '}
            <button onClick={() => navigate('/')} className="text-primary hover:underline">
              Go to dashboard
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
