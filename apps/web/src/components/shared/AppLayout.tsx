import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, LayoutDashboard, BarChart3,
  BookOpen, Settings, LogOut, Wifi, RotateCcw
} from 'lucide-react'
import { useAuthStore } from '../../store/auth.store'
import { useInboxStore } from '../../store/inbox.store'
import { getInitials, getAvatarColor } from '@sahay/shared'
import { api } from '../../lib/api'

const navItems = [
  { path: '/inbox', icon: MessageSquare, label: 'Inbox' },
  { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/analytics', icon: BarChart3, label: 'Analytics' },
  { path: '/returns', icon: RotateCcw, label: 'Returns' },
  { path: '/knowledge-base', icon: BookOpen, label: 'Knowledge' },
  { path: '/settings', icon: Settings, label: 'Settings' },
]

export function AppLayout() {
  const navigate = useNavigate()
  const { agent, logout } = useAuthStore()
  const { isFocusMode } = useInboxStore()

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {}
    logout()
    navigate('/login')
  }

  if (!agent) return null

  const initials = getInitials(agent.name)
  const avatarColor = getAvatarColor(agent.name)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ─── Navigation Rail ────────────────────────────────── */}
      <AnimatePresence>
        {!isFocusMode && (
          <motion.nav
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 64, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center py-4 bg-white border-r border-border"
          >
            {/* Logo */}
            <div className="w-9 h-9 bg-violet-500 rounded-xl flex items-center justify-center mb-6 flex-shrink-0">
              <span className="text-white font-bold text-base">स</span>
            </div>

            {/* Nav items */}
            <div className="flex flex-col items-center gap-1 flex-1">
              {navItems.map(({ path, icon: Icon, label }) => (
                <NavLink
                  key={path}
                  to={path}
                  title={label}
                  className={({ isActive }) =>
                    `w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150
                     ${isActive
                       ? 'bg-violet-50 text-violet-600'
                       : 'text-text-muted hover:text-text-secondary hover:bg-background'
                     }`
                  }
                >
                  <Icon size={20} />
                </NavLink>
              ))}
            </div>

            {/* Agent avatar + logout */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleLogout}
                title="Logout"
                className="w-10 h-10 rounded-xl flex items-center justify-center
                           text-text-muted hover:text-red-500 hover:bg-red-50
                           transition-all duration-150"
              >
                <LogOut size={18} />
              </button>

              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                style={{ backgroundColor: avatarColor, color: '#0D0B1A' }}
                title={agent.name}
              >
                {initials}
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* ─── Main Content ────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
