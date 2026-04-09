import { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth.store'
import { useSocket } from './hooks/useSocket'
import NotFoundPage from './pages/NotFoundPage'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { PageLoader } from './components/shared/PageLoader'

// Auth
import { LoginPage } from './pages/auth/LoginPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'

// CSAT Survey (public)
import { CSATPage } from './pages/csat/CSATPage'

// Onboarding
import { OnboardingPage } from './pages/onboarding/OnboardingPage'

// Main app
import { AppLayout } from './components/shared/AppLayout'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { InboxPage } from './pages/inbox/InboxPage'
import { AnalyticsPage } from './pages/analytics/AnalyticsPage'
import { KnowledgeBasePage } from './pages/knowledge-base/KnowledgeBasePage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { ReturnsPage } from './pages/returns/ReturnsPage'

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
        {/* Public routes — no auth required */}
        <Route path="/csat/:conversationId" element={<CSATPage />} />

        {/* Auth routes — redirect to inbox if already logged in */}
        <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
        <Route path="/forgot-password" element={<AuthRoute><ForgotPasswordPage /></AuthRoute>} />
        <Route path="/reset-password" element={<AuthRoute><ResetPasswordPage /></AuthRoute>} />

        {/* Onboarding — authenticated but separate layout */}
        <Route path="/onboarding/*" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />

        {/* Main app — protected routes with sidebar layout */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/inbox" replace />} />
          <Route
            path="/dashboard"
            element={
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <DashboardPage />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/inbox"
            element={
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <InboxPage />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/inbox/:conversationId"
            element={
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <InboxPage />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/analytics"
            element={
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <AnalyticsPage />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/knowledge-base"
            element={
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <KnowledgeBasePage />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/returns"
            element={
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <ReturnsPage />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/settings/*"
            element={
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <SettingsPage />
                </Suspense>
              </ErrorBoundary>
            }
          />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}
