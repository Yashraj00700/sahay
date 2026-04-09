import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { Eye, EyeOff, ArrowRight, Loader2, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react'
import { api } from '../../lib/api'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [countdown, setCountdown] = useState(3)

  // Auto-redirect countdown after success
  useEffect(() => {
    if (!success) return
    if (countdown <= 0) {
      navigate('/login')
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [success, countdown, navigate])

  const resetMutation = useMutation({
    mutationFn: async (data: { token: string; newPassword: string }) => {
      const response = await api.post('/auth/reset-password', data)
      return response.data
    },
    onSuccess: () => {
      setSuccess(true)
      toast.success('Password changed successfully!', {
        style: { background: '#1a1628', color: '#fff', border: '1px solid #10B98140' },
      })
    },
    onError: (error: any) => {
      const message = error.response?.data?.message ?? 'Failed to reset password. The link may have expired.'
      toast.error(message, {
        style: { background: '#1a1628', color: '#fff', border: '1px solid #ef444440' },
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)

    if (newPassword.length < 8) {
      setValidationError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setValidationError('Passwords do not match.')
      return
    }

    resetMutation.mutate({ token: token!, newPassword })
  }

  return (
    <div className="min-h-screen flex" style={{ fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>

      {/* ── Left Panel ── */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col">
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(135deg, #0a0718 0%, #0d0b1a 40%, #110828 100%)',
        }} />

        {/* Aurora mesh */}
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

          {/* Centered illustration area */}
          <div className="flex-1 flex flex-col items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className="text-center"
            >
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{ background: 'rgba(107,78,255,0.15)', border: '1px solid rgba(107,78,255,0.3)' }}>
                {/* Lock icon via SVG to avoid extra import */}
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#8669FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 className="text-3xl font-black text-white leading-tight mb-4">
                Set a new
                <br />
                <span style={{
                  backgroundImage: 'linear-gradient(90deg, #6B4EFF, #F59E0B)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  password
                </span>
              </h2>
              <p className="text-white/40 text-sm leading-relaxed max-w-xs mx-auto">
                Choose a strong password with at least 8 characters to secure your account.
              </p>
            </motion.div>
          </div>

          {/* Bottom badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex items-center gap-2"
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

          <AnimatePresence mode="wait">
            {/* ── No token: invalid link ── */}
            {!token ? (
              <motion.div
                key="invalid"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="text-center"
              >
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  <AlertTriangle size={32} style={{ color: '#ef4444' }} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Invalid or expired link</h2>
                <p className="text-sm mb-8" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  This password reset link is invalid or has expired. Please request a new one.
                </p>
                <Link
                  to="/forgot-password"
                  className="inline-flex items-center justify-center gap-2 w-full font-bold text-sm"
                  style={{
                    padding: '13px 24px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #6B4EFF 0%, #8669FF 100%)',
                    color: '#fff',
                    textDecoration: 'none',
                    fontSize: '14px',
                    boxShadow: '0 4px 20px rgba(107,78,255,0.4), 0 1px 3px rgba(0,0,0,0.3)',
                  }}
                >
                  Request new link
                  <ArrowRight size={15} />
                </Link>
                <div className="mt-4">
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
                    style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)'}
                  >
                    <ArrowLeft size={13} />
                    Back to login
                  </Link>
                </div>
              </motion.div>

            ) : success ? (
              /* ── Success State ── */
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="text-center"
              >
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
                  style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)' }}>
                  <CheckCircle2 size={32} style={{ color: '#10B981' }} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Password changed!</h2>
                <p className="text-sm mb-8" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Your password has been updated successfully.
                  <br />
                  Redirecting to login in{' '}
                  <span style={{ color: '#8669FF', fontWeight: 600 }}>{countdown}s</span>…
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 w-full font-bold text-sm"
                  style={{
                    padding: '13px 24px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #6B4EFF 0%, #8669FF 100%)',
                    color: '#fff',
                    textDecoration: 'none',
                    fontSize: '14px',
                    boxShadow: '0 4px 20px rgba(107,78,255,0.4), 0 1px 3px rgba(0,0,0,0.3)',
                  }}
                >
                  Go to login
                  <ArrowRight size={15} />
                </Link>
              </motion.div>

            ) : (
              /* ── Reset Form ── */
              <motion.div
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {/* Heading */}
                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-white mb-1.5">Set new password</h2>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Choose a strong password for your account
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">

                  {/* New password field */}
                  <div>
                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                      style={{ color: focused === 'newPassword' ? '#8669FF' : 'rgba(255,255,255,0.45)' }}>
                      New password
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => { setNewPassword(e.target.value); setValidationError(null) }}
                        onFocus={() => setFocused('newPassword')}
                        onBlur={() => setFocused(null)}
                        placeholder="Min. 8 characters"
                        required
                        autoComplete="new-password"
                        autoFocus
                        style={{
                          width: '100%',
                          padding: '12px 44px 12px 16px',
                          borderRadius: '12px',
                          border: `1px solid ${focused === 'newPassword' ? 'rgba(107,78,255,0.6)' : 'rgba(255,255,255,0.1)'}`,
                          background: 'rgba(255,255,255,0.05)',
                          color: '#fff',
                          fontSize: '14px',
                          outline: 'none',
                          transition: 'border-color 0.2s, box-shadow 0.2s',
                          boxShadow: focused === 'newPassword'
                            ? '0 0 0 3px rgba(107,78,255,0.15), inset 0 1px 2px rgba(0,0,0,0.2)'
                            : 'inset 0 1px 2px rgba(0,0,0,0.2)',
                          boxSizing: 'border-box',
                        }}
                      />
                      <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                        style={{ color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm password field */}
                  <div>
                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                      style={{ color: focused === 'confirmPassword' ? '#8669FF' : 'rgba(255,255,255,0.45)' }}>
                      Confirm password
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); setValidationError(null) }}
                        onFocus={() => setFocused('confirmPassword')}
                        onBlur={() => setFocused(null)}
                        placeholder="Repeat your password"
                        required
                        autoComplete="new-password"
                        style={{
                          width: '100%',
                          padding: '12px 44px 12px 16px',
                          borderRadius: '12px',
                          border: `1px solid ${
                            validationError && validationError.includes('match')
                              ? 'rgba(239,68,68,0.5)'
                              : focused === 'confirmPassword'
                              ? 'rgba(107,78,255,0.6)'
                              : 'rgba(255,255,255,0.1)'
                          }`,
                          background: 'rgba(255,255,255,0.05)',
                          color: '#fff',
                          fontSize: '14px',
                          outline: 'none',
                          transition: 'border-color 0.2s, box-shadow 0.2s',
                          boxShadow: focused === 'confirmPassword'
                            ? '0 0 0 3px rgba(107,78,255,0.15), inset 0 1px 2px rgba(0,0,0,0.2)'
                            : 'inset 0 1px 2px rgba(0,0,0,0.2)',
                          boxSizing: 'border-box',
                        }}
                      />
                      <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                        style={{ color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Validation error */}
                  <AnimatePresence>
                    {validationError && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
                      >
                        <AlertTriangle size={12} />
                        {validationError}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Submit button */}
                  <motion.button
                    type="submit"
                    disabled={resetMutation.isPending || !newPassword || !confirmPassword}
                    whileTap={{ scale: 0.98 }}
                    className="w-full flex items-center justify-center gap-2 font-bold text-sm"
                    style={{
                      padding: '13px 24px',
                      borderRadius: '12px',
                      border: 'none',
                      cursor: resetMutation.isPending || !newPassword || !confirmPassword ? 'not-allowed' : 'pointer',
                      background: resetMutation.isPending || !newPassword || !confirmPassword
                        ? 'rgba(107,78,255,0.3)'
                        : 'linear-gradient(135deg, #6B4EFF 0%, #8669FF 100%)',
                      color: '#fff',
                      fontSize: '14px',
                      marginTop: '8px',
                      transition: 'all 0.2s',
                      boxShadow: !resetMutation.isPending && newPassword && confirmPassword
                        ? '0 4px 20px rgba(107,78,255,0.4), 0 1px 3px rgba(0,0,0,0.3)'
                        : 'none',
                    }}
                  >
                    {resetMutation.isPending ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        Updating password…
                      </>
                    ) : (
                      <>
                        Update password
                        <ArrowRight size={15} />
                      </>
                    )}
                  </motion.button>
                </form>

                {/* Back to login */}
                <div className="mt-6 text-center">
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
                    style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)'}
                  >
                    <ArrowLeft size={13} />
                    Back to login
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

    </div>
  )
}
