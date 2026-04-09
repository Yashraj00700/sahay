import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, LayoutDashboard, BarChart3, BookOpen, Settings, LogOut,
  Wifi, WifiOff, Bell, Users, CreditCard, FileText, ShieldCheck,
  Package, Truck, Star, RotateCcw, RefreshCw, Megaphone,
  Sparkles, Leaf, Activity, Zap, HeartHandshake, PlayCircle,
} from 'lucide-react'
import { useAuthStore } from '../../store/auth.store'
import { useInboxStore } from '../../store/inbox.store'
import { getInitials, getAvatarColor } from '@sahay/shared'
import { api } from '../../lib/api'

// ─── Navigation Config ────────────────────────────────────────────────────────

const navGroups = [
  {
    label: 'Core',
    items: [
      { path: '/inbox',        icon: MessageSquare, label: 'Inbox' },
      { path: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/analytics',    icon: BarChart3,      label: 'Analytics' },
      { path: '/customers',    icon: Users,          label: 'Customers' },
    ],
  },
  {
    label: 'AI Tools',
    items: [
      { path: '/knowledge-base',      icon: BookOpen,      label: 'Knowledge' },
      { path: '/cod-prepaid',         icon: Zap,           label: 'COD→Prepaid' },
      { path: '/campaigns',           icon: Megaphone,     label: 'Campaigns' },
      { path: '/routines',            icon: RefreshCw,     label: 'Routines' },
      { path: '/skincare-routine',    icon: Leaf,          label: 'Skincare AI' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/notifications',    icon: Bell,         label: 'Notifications' },
      { path: '/integrations',     icon: Sparkles,     label: 'Integrations' },
      { path: '/ai-performance',   icon: Activity,     label: 'AI Health' },
      { path: '/cod-manager',      icon: Package,      label: 'COD Manager' },
      { path: '/order-tracking',   icon: Truck,        label: 'Order Tracking' },
      { path: '/csat',             icon: Star,         label: 'CSAT' },
      { path: '/return-prevention',icon: HeartHandshake,label: 'Return Prevention' },
      { path: '/returns',          icon: RotateCcw,    label: 'Returns' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/billing',    icon: CreditCard,  label: 'Billing' },
      { path: '/team',       icon: Users,       label: 'Team' },
      { path: '/audit-log',  icon: FileText,    label: 'Audit Log' },
      { path: '/demo',       icon: PlayCircle,  label: 'Live Demo' },
      { path: '/settings',   icon: Settings,    label: 'Settings' },
    ],
  },
]

export function AppLayout() {
  const navigate = useNavigate()
  const { agent, logout } = useAuthStore()
  const { isFocusMode } = useInboxStore()

  const handleLogout = async () => {
    try { await api.post('/auth/logout') } catch {}
    logout()
    navigate('/login')
  }

  if (!agent) return null

  const initials  = getInitials(agent.name)
  const avatarColor = getAvatarColor(agent.name)

  return (
    <div className="flex h-screen overflow-hidden bg-background">

      {/* ─── Sidebar ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {!isFocusMode && (
          <motion.nav
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 220, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col bg-white border-r border-border overflow-y-auto overflow-x-hidden flex-shrink-0"
            style={{ minWidth: 220 }}
          >
            {/* Logo + brand */}
            <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border flex-shrink-0">
              <div className="w-8 h-8 bg-violet-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-base">स</span>
              </div>
              <div className="min-w-0">
                <span className="text-[15px] font-bold text-text-primary tracking-tight">Sahay</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                  <span className="text-[10px] text-text-muted">Disconnected</span>
                </div>
              </div>
            </div>

            {/* Nav groups */}
            <div className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
              {navGroups.map((group) => (
                <div key={group.label}>
                  <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted/70">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map(({ path, icon: Icon, label }) => (
                      <NavLink
                        key={path}
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium transition-all duration-150
                           ${isActive
                             ? 'bg-violet-50 text-violet-700'
                             : 'text-text-secondary hover:text-text-primary hover:bg-background'
                           }`
                        }
                      >
                        <Icon size={15} className="flex-shrink-0" />
                        <span className="truncate">{label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom: user + logout */}
            <div className="px-3 py-3 border-t border-border flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
                  style={{ backgroundColor: avatarColor, color: '#0D0B1A' }}
                >
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-text-primary truncate">{agent.name}</p>
                  <p className="text-[10px] text-text-muted truncate capitalize">{agent.role}</p>
                </div>
                <button
                  onClick={handleLogout}
                  title="Logout"
                  className="w-7 h-7 rounded-lg flex items-center justify-center
                             text-text-muted hover:text-red-500 hover:bg-red-50
                             transition-all duration-150 flex-shrink-0"
                >
                  <LogOut size={14} />
                </button>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* ─── Main Content ────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
