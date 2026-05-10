import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth.store'
import { useRealtime } from './hooks/useRealtime'
import { SentryErrorBoundary } from './lib/sentry'

// Auth
import { LoginPage } from './pages/auth/LoginPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage'

// Onboarding
import { OnboardingPage } from './pages/onboarding/OnboardingPage'

// Main app
import { AppLayout } from './components/shared/AppLayout'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { InboxPage } from './pages/inbox/InboxPage'
import { AnalyticsPage } from './pages/analytics/AnalyticsPage'
import { KnowledgeBasePage } from './pages/knowledge-base/KnowledgeBasePage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { ComingSoonPage } from './pages/ComingSoonPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  if (isAuthenticated) return <Navigate to="/inbox" replace />
  return <>{children}</>
}

// Initialize realtime (Pusher) connection for authenticated users.
// Mounted once at the App root so the singleton survives route changes.
function RealtimeInitializer() {
  useRealtime()
  return null
}

// Minimal fallback shown when an unhandled render error reaches the boundary.
// Never renders the underlying error message in production to avoid leaking
// stack traces to end users.
function FallbackUI() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        fontFamily: '"Plus Jakarta Sans", sans-serif',
        background: '#0D0B1A',
        color: '#FFFFFF',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '20px', fontWeight: 600 }}>Something went wrong</h1>
      <p style={{ fontSize: '14px', opacity: 0.8 }}>
        Please refresh the page to continue.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: '8px',
          padding: '10px 20px',
          borderRadius: '10px',
          border: 'none',
          background: '#7C3AED',
          color: '#FFFFFF',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Refresh
      </button>
    </div>
  )
}

export default function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <SentryErrorBoundary fallback={<FallbackUI />}>
      {isAuthenticated && <RealtimeInitializer />}
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
        <Route path="/forgot-password" element={<AuthRoute><ForgotPasswordPage /></AuthRoute>} />
        <Route path="/reset-password" element={<AuthRoute><ResetPasswordPage /></AuthRoute>} />
        <Route path="/auth/accept-invite" element={<AcceptInvitePage />} />

        {/* Onboarding — authenticated but separate layout */}
        <Route path="/onboarding/*" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />

        {/* Main app — protected routes with sidebar layout */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/inbox" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/inbox/:conversationId" element={<InboxPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
          <Route path="/settings/*" element={<SettingsPage />} />

          {/* ── New sidebar routes (stub pages) ── */}
          <Route path="/customers" element={<ComingSoonPage />} />
          <Route path="/cod-prepaid" element={<ComingSoonPage />} />
          <Route path="/campaigns" element={<ComingSoonPage />} />
          <Route path="/routines" element={<ComingSoonPage />} />
          <Route path="/skincare-routine" element={<ComingSoonPage />} />
          <Route path="/notifications" element={<ComingSoonPage />} />
          <Route path="/integrations" element={<ComingSoonPage />} />
          <Route path="/ai-performance" element={<ComingSoonPage />} />
          <Route path="/cod-manager" element={<ComingSoonPage />} />
          <Route path="/order-tracking" element={<ComingSoonPage />} />
          <Route path="/csat" element={<ComingSoonPage />} />
          <Route path="/return-prevention" element={<ComingSoonPage />} />
          <Route path="/returns" element={<ComingSoonPage />} />
          <Route path="/billing" element={<ComingSoonPage />} />
          <Route path="/team" element={<ComingSoonPage />} />
          <Route path="/audit-log" element={<ComingSoonPage />} />
          <Route path="/demo" element={<ComingSoonPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </SentryErrorBoundary>
  )
}
