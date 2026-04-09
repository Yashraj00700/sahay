import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth.store'
import { useSocket } from './hooks/useSocket'

// Auth
import { LoginPage } from './pages/auth/LoginPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'

// Onboarding
import { OnboardingPage } from './pages/onboarding/OnboardingPage'

// Main app
import { AppLayout } from './components/shared/AppLayout'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { InboxPage } from './pages/inbox/InboxPage'
import { AnalyticsPage } from './pages/analytics/AnalyticsPage'
import { KnowledgeBasePage } from './pages/knowledge-base/KnowledgeBasePage'
import { SettingsPage } from './pages/settings/SettingsPage'

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

// Initialize WebSocket connection for authenticated users
function SocketInitializer() {
  useSocket() // Connects once, persists across routes
  return null
}

export default function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <>
      {isAuthenticated && <SocketInitializer />}
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
        <Route path="/forgot-password" element={<AuthRoute><ForgotPasswordPage /></AuthRoute>} />
        <Route path="/reset-password" element={<AuthRoute><ResetPasswordPage /></AuthRoute>} />

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
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </>
  )
}
