import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'
import type { AuthResponse } from '@sahay/shared'

// ─── Floating message bubbles for the left panel ─────────────────────────────

const BUBBLES = [
  { text: 'मेरा ऑर्डर कब आएगा?', lang: 'hi', delay: 0, x: '8%', y: '22%' },
  { text: 'My face oil delivered in 1 day! 🌸', lang: 'en', delay: 0.4, x: '55%', y: '15%' },
  { text: 'Kya COD available hai?', lang: 'hinglish', delay: 0.8, x: '12%', y: '52%' },
  { text: 'Refund processed ✓', lang: 'en', delay: 1.2, x: '52%', y: '62%' },
  { text: 'Vitamin C serum suits dry skin?', lang: 'en', delay: 1.6, x: '5%', y: '76%' },
  { text: 'Order #4821 shipped! 📦', lang: 'en', delay: 2.0, x: '50%', y: '80%' },
]

function FloatingBubble({ text, delay, x, y, lang }: typeof BUBBLES[0]) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="absolute pointer-events-none"
      style={{ left: x, top: y }}
    >
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 4 + delay, repeat: Infinity, ease: 'easeInOut', delay: delay * 0.5 }}
        className={`
          px-3 py-1.5 rounded-2xl text-xs font-medium shadow-lg backdrop-blur-sm whitespace-nowrap
          ${lang === 'hi'
            ? 'bg-amber-400/20 text-amber-200 border border-amber-400/30'
            : lang === 'hinglish'
            ? 'bg-violet-500/25 text-violet-200 border border-violet-400/30'
            : 'bg-white/10 text-white/80 border border-white/20'
          }
        `}
      >
        {text}
      </motion.div>
    </motion.div>
  )
}

// ─── Animated metric counter ──────────────────────────────────────────────────

function AnimatedStat({ value, label, delay }: { value: string; label: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="text-center"
    >
      <div className="text-3xl font-black text-white tracking-tight mb-0.5">{value}</div>
      <div className="text-xs text-white/50 font-medium uppercase tracking-widest">{label}</div>
    </motion.div>
  )
}

// ─── Main Login Page ──────────────────────────────────────────────────────────

export function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)

  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const response = await api.post<AuthResponse>('/auth/login', data)
      return response.data
    },
    onSuccess: (data) => {
      setAuth({ token: data.token, refreshToken: data.refreshToken, agent: data.agent, tenant: data.tenant })
      toast.success(`Welcome back, ${data.agent.name}! 🙏`, {
        style: { background: '#1a1628', color: '#fff', border: '1px solid #6B4EFF40' },
      })
      navigate('/inbox')
    },
    onError: (error: any) => {
      const message = error.response?.data?.message ?? 'Invalid credentials'
      toast.error(message, {
        style: { background: '#1a1628', color: '#fff', border: '1px solid #ef444440' },
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    loginMutation.mutate({ email, password })
  }

  return (
    <div className="min-h-screen flex" style={{ fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>

      {/* ── Left Panel ── */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col">
        {/* Deep dark background */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(135deg, #0a0718 0%, #0d0b1a 40%, #110828 100%)',
        }} />

        {/* Aurora mesh — animated gradient orbs */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            animate={{ scale: [1, 1.15, 1], x: [0, 30, 0], opacity: [0.4, 0.6, 0.4] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute rounded-full"
            style={{
              width: 500, height: 500,
              top: '-100px', left: '-80px',
              background: 'radial-gradient(circle, #6B4EFF40 0%, transparent 70%)',
              filter: 'blur(40px)',
            }}
          />
          <motion.div
            animate={{ scale: [1, 1.2, 1], x: [0, -20, 0], y: [0, 30, 0], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
            className="absolute rounded-full"
            style={{
              width: 400, height: 400,
              bottom: '50px', right: '-50px',
              background: 'radial-gradient(circle, #F59E0B30 0%, transparent 70%)',
              filter: 'blur(50px)',
            }}
          />
          <motion.div
            animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.35, 0.2] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
            className="absolute rounded-full"
            style={{
              width: 300, height: 300,
              top: '40%', left: '30%',
              background: 'radial-gradient(circle, #8669FF25 0%, transparent 70%)',
              filter: 'blur(30px)',
            }}
          />
        </div>

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full p-12">

          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6B4EFF, #8669FF)', boxShadow: '0 0 20px #6B4EFF50' }}>
              <span className="text-white font-black text-base leading-none" style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>स</span>
            </div>
            <span className="text-white text-lg font-bold tracking-tight">sahay</span>
          </motion.div>

          {/* Hero headline */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="mt-auto mb-0"
          >
            <div className="mb-4">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-widest"
                style={{ background: '#F59E0B18', color: '#F59E0B', border: '1px solid #F59E0B30' }}>
                🇮🇳 Built for Indian D2C brands
              </span>
            </div>

            <h1 className="text-5xl font-black text-white leading-[1.05] tracking-tight mb-6"
              style={{ textShadow: '0 2px 30px rgba(107,78,255,0.3)' }}>
              The AI that speaks
              <br />
              <span style={{
                backgroundImage: 'linear-gradient(90deg, #6B4EFF, #F59E0B)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                your customer's
              </span>
              <br />
              language.
            </h1>

            <p className="text-white/50 text-base leading-relaxed max-w-xs">
              Resolve 70% of queries across WhatsApp, Instagram & web
              — in Hindi, Hinglish, English. Automatically.
            </p>
          </motion.div>

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-10 mb-auto"
          >
            <div className="flex items-center gap-8 pt-6"
              style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <AnimatedStat value="70%+" label="AI Resolution" delay={0.6} />
              <div className="w-px h-8 bg-white/10" />
              <AnimatedStat value="&lt;60s" label="Response Time" delay={0.7} />
              <div className="w-px h-8 bg-white/10" />
              <AnimatedStat value="3" label="Languages" delay={0.8} />
              <div className="w-px h-8 bg-white/10" />
              <AnimatedStat value="10x" label="Cheaper" delay={0.9} />
            </div>
          </motion.div>

          {/* Floating chat bubbles */}
          <div className="relative mt-8 h-56 mb-2">
            {BUBBLES.map((b) => (
              <FloatingBubble key={b.text} {...b} />
            ))}

            {/* AI reply indicator */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 2.5, duration: 0.5 }}
              className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: 'rgba(107,78,255,0.2)', border: '1px solid rgba(107,78,255,0.35)' }}
            >
              <div className="flex gap-1">
                {[0, 0.2, 0.4].map((d) => (
                  <motion.div key={d} animate={{ y: [0, -3, 0] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: d }}
                    className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                ))}
              </div>
              <span className="text-xs text-violet-300 font-medium">Sahay AI is replying…</span>
            </motion.div>
          </div>

          {/* Bottom badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
            className="flex items-center gap-2 mt-4"
          >
            <div className="flex -space-x-1.5">
              {['RAS', 'MNS', 'FRG'].map((brand, i) => (
                <div key={brand} className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white border border-white/10"
                  style={{ background: ['#6B4EFF', '#F59E0B', '#10B981'][i], zIndex: 3 - i }}>
                  {brand[0]}
                </div>
              ))}
            </div>
            <span className="text-xs text-white/40">Trusted by India's fastest-growing D2C brands</span>
          </motion.div>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 flex items-center justify-center p-8 relative"
        style={{ background: 'linear-gradient(160deg, #0f0d1e 0%, #0d0b1a 100%)' }}>

        {/* Subtle right panel glow */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute" style={{
            width: 400, height: 400,
            top: '10%', right: '-100px',
            background: 'radial-gradient(circle, #6B4EFF0D 0%, transparent 60%)',
            filter: 'blur(60px)',
          }} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm relative z-10"
        >
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6B4EFF, #8669FF)' }}>
              <span className="text-white font-black text-sm" style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>स</span>
            </div>
            <span className="text-white text-lg font-bold">sahay</span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-1.5">Welcome back</h2>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Sign in to your support dashboard</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email field */}
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                style={{ color: focused === 'email' ? '#8669FF' : 'rgba(255,255,255,0.45)' }}>
                Email address
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                  placeholder="you@yourbrand.com"
                  required
                  autoComplete="email"
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: `1px solid ${focused === 'email' ? 'rgba(107,78,255,0.6)' : 'rgba(255,255,255,0.1)'}`,
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    boxShadow: focused === 'email' ? '0 0 0 3px rgba(107,78,255,0.15), inset 0 1px 2px rgba(0,0,0,0.2)' : 'inset 0 1px 2px rgba(0,0,0,0.2)',
                  }}
                />
              </div>
            </div>

            {/* Password field */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: focused === 'password' ? '#8669FF' : 'rgba(255,255,255,0.45)' }}>
                  Password
                </label>
                <Link to="/forgot-password" className="text-xs font-medium"
                  style={{ color: 'rgba(107,78,255,0.8)' }}
                  onMouseEnter={e => (e.target as HTMLElement).style.color = '#8669FF'}
                  onMouseLeave={e => (e.target as HTMLElement).style.color = 'rgba(107,78,255,0.8)'}
                >
                  Forgot?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 16px',
                    borderRadius: '12px',
                    border: `1px solid ${focused === 'password' ? 'rgba(107,78,255,0.6)' : 'rgba(255,255,255,0.1)'}`,
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    boxShadow: focused === 'password' ? '0 0 0 3px rgba(107,78,255,0.15), inset 0 1px 2px rgba(0,0,0,0.2)' : 'inset 0 1px 2px rgba(0,0,0,0.2)',
                  }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'rgba(255,255,255,0.3)' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <motion.button
              type="submit"
              disabled={loginMutation.isPending || !email || !password}
              whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 font-bold text-sm"
              style={{
                padding: '13px 24px',
                borderRadius: '12px',
                border: 'none',
                cursor: loginMutation.isPending || !email || !password ? 'not-allowed' : 'pointer',
                background: loginMutation.isPending || !email || !password
                  ? 'rgba(107,78,255,0.3)'
                  : 'linear-gradient(135deg, #6B4EFF 0%, #8669FF 100%)',
                color: '#fff',
                fontSize: '14px',
                marginTop: '8px',
                transition: 'all 0.2s',
                boxShadow: !loginMutation.isPending && email && password
                  ? '0 4px 20px rgba(107,78,255,0.4), 0 1px 3px rgba(0,0,0,0.3)'
                  : 'none',
              }}
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight size={15} />
                </>
              )}
            </motion.button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>or</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
          </div>

          {/* Demo login hint */}
          <button
            type="button"
            onClick={() => {
              setEmail('admin@rasluxuryoils.com')
              setPassword('sahay@123')
            }}
            className="w-full text-center text-xs py-2 rounded-lg transition-all"
            style={{
              color: 'rgba(255,255,255,0.35)',
              border: '1px solid rgba(255,255,255,0.07)',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget
              el.style.borderColor = 'rgba(107,78,255,0.3)'
              el.style.color = 'rgba(107,78,255,0.8)'
              el.style.background = 'rgba(107,78,255,0.05)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget
              el.style.borderColor = 'rgba(255,255,255,0.07)'
              el.style.color = 'rgba(255,255,255,0.35)'
              el.style.background = 'transparent'
            }}
          >
            Fill demo credentials
          </button>

          {/* Footer */}
          <p className="text-center text-xs mt-8" style={{ color: 'rgba(255,255,255,0.2)' }}>
            New to Sahay?{' '}
            <a href="https://sahay.ai/demo" className="transition-colors"
              style={{ color: 'rgba(107,78,255,0.7)' }}
              onMouseEnter={e => (e.target as HTMLElement).style.color = '#8669FF'}
              onMouseLeave={e => (e.target as HTMLElement).style.color = 'rgba(107,78,255,0.7)'}
            >
              Book a demo →
            </a>
          </p>
        </motion.div>
      </div>

    </div>
  )
}
