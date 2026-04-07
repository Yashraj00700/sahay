import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Clock, ArrowRight, MessageSquare,
  Users, Zap, CheckCircle, Archive, Bell, X,
  Hash,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import { useAuthStore } from '../../store/auth.store'
import { useInboxStore } from '../../store/inbox.store'
import type { Conversation, Customer } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuickAction {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  shortcut?: string
  action: () => void
}

interface CommandPaletteProps {
  isOpen?: boolean
  onClose?: () => void
  onSelectConversation?: (id: string) => void
}

// ─── Fuzzy match ─────────────────────────────────────────────────────────────

function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (t.includes(q)) return 2
  let score = 0
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { score++; qi++ }
  }
  return qi === q.length ? score / q.length : 0
}

// ─── Result Item ──────────────────────────────────────────────────────────────

function ResultItem({
  icon,
  primary,
  secondary,
  badge,
  kbd,
  isSelected,
  onClick,
}: {
  icon: React.ReactNode
  primary: string
  secondary?: string
  badge?: React.ReactNode
  kbd?: string
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left group',
        isSelected ? 'bg-violet-50' : 'hover:bg-gray-50'
      )}
    >
      <div className={clsx(
        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
        isSelected ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-500'
      )}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <p className={clsx('text-[13px] font-medium truncate', isSelected ? 'text-violet-900' : 'text-gray-800')}>
          {primary}
        </p>
        {secondary && (
          <p className="text-[11px] text-gray-400 truncate">{secondary}</p>
        )}
      </div>

      {badge && <div className="flex-shrink-0">{badge}</div>}
      {kbd && (
        <kbd className="flex-shrink-0 text-[10px] text-gray-300 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded font-mono">
          {kbd}
        </kbd>
      )}

      <ArrowRight className={clsx('w-3.5 h-3.5 flex-shrink-0 transition-colors', isSelected ? 'text-violet-400' : 'text-gray-200 group-hover:text-gray-400')} />
    </button>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  if (count === 0) return null
  return (
    <div className="px-3 py-1.5 flex items-center gap-2">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="text-[10px] text-gray-300">{count}</span>
    </div>
  )
}

// ─── Recent Searches ──────────────────────────────────────────────────────────

const RECENT_KEY = 'sahay_cmd_recent'

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch { return [] }
}

function addRecent(query: string): void {
  try {
    const existing = getRecent().filter(q => q !== query)
    const next = [query, ...existing].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {}
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CommandPalette({ isOpen: isOpenProp, onClose: onCloseProp, onSelectConversation: onSelectProp }: CommandPaletteProps) {
  const tenant = useAuthStore(s => s.tenant)
  const { setFilter, setSort, setActiveConversation } = useInboxStore()
  const [selfOpen, setSelfOpen] = useState(false)
  const isOpen = isOpenProp ?? selfOpen
  const onClose = onCloseProp ?? (() => setSelfOpen(false))
  const onSelectConversation = onSelectProp ?? ((id: string) => { setActiveConversation(id); setSelfOpen(false) })

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSelfOpen(prev => !prev)
      }
      if (e.key === 'Escape' && selfOpen) setSelfOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selfOpen])
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setRecentSearches(getRecent())
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Fetch conversations for search
  const { data: convData } = useQuery({
    queryKey: queryKeys.conversations.list(tenant?.id ?? '', { search: query, limit: 5 }),
    queryFn: async () => {
      const res = await api.get('/conversations', { params: { search: query, limit: 5 } })
      return res.data
    },
    enabled: !!tenant?.id && query.length > 1,
  })

  // Fetch customers for search
  const { data: custData } = useQuery({
    queryKey: queryKeys.customers.all(tenant?.id ?? ''),
    queryFn: async () => {
      const res = await api.get('/customers', { params: { search: query, limit: 5 } })
      return res.data
    },
    enabled: !!tenant?.id && query.length > 1,
  })

  const conversations: Conversation[] = convData?.data ?? []
  const customers: Customer[] = custData?.data ?? []

  // Quick actions
  const quickActions: QuickAction[] = [
    {
      id: 'qa_open',
      label: 'View Open conversations',
      description: 'Filter to open conversations',
      icon: <MessageSquare className="w-4 h-4" />,
      shortcut: 'O',
      action: () => { setFilter('status', 'open'); onClose() },
    },
    {
      id: 'qa_vip',
      label: 'VIP customers first',
      description: 'Sort by VIP tier',
      icon: <Zap className="w-4 h-4" />,
      shortcut: 'V',
      action: () => { setSort('vip_first'); onClose() },
    },
    {
      id: 'qa_urgent',
      label: 'Sort by urgency',
      description: 'Highest urgency first',
      icon: <Bell className="w-4 h-4" />,
      shortcut: 'U',
      action: () => { setSort('urgency_desc'); onClose() },
    },
    {
      id: 'qa_resolved',
      label: 'View Resolved',
      description: 'Show resolved conversations',
      icon: <CheckCircle className="w-4 h-4" />,
      action: () => { setFilter('status', 'resolved'); onClose() },
    },
    {
      id: 'qa_snoozed',
      label: 'View Snoozed',
      description: 'Show snoozed conversations',
      icon: <Archive className="w-4 h-4" />,
      action: () => { setFilter('status', 'snoozed'); onClose() },
    },
  ]

  // Filter quick actions by query
  const filteredActions = query.length > 0
    ? quickActions.filter(a => fuzzyScore(a.label + ' ' + a.description, query) > 0)
    : quickActions.slice(0, 3)

  // Build flat list for keyboard nav
  const allItems = [
    ...conversations.map(c => ({ type: 'conversation' as const, data: c })),
    ...customers.map(c => ({ type: 'customer' as const, data: c })),
    ...filteredActions.map(a => ({ type: 'action' as const, data: a })),
  ]

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = allItems[selectedIndex]
      if (!item) return
      if (item.type === 'conversation') {
        const q = query.trim()
        if (q) addRecent(q)
        onSelectConversation((item.data as Conversation).id)
        onClose()
      } else if (item.type === 'action') {
        (item.data as QuickAction).action()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [allItems, selectedIndex, query, onSelectConversation, onClose])

  // Global Cmd+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) onClose()
        // Parent handles opening
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  let itemIndex = 0

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -16 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="fixed top-[15vh] left-1/2 -translate-x-1/2 w-[560px] max-w-[calc(100vw-32px)] bg-white rounded-2xl shadow-2xl shadow-black/20 border border-gray-200 overflow-hidden z-50"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setSelectedIndex(0) }}
                onKeyDown={handleKeyDown}
                placeholder="Search conversations, customers, actions…"
                className="flex-1 text-[14px] text-gray-900 placeholder:text-gray-400 outline-none bg-transparent"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              )}
              <kbd className="text-[10px] text-gray-300 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded font-mono">
                Esc
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[380px] overflow-y-auto p-2">
              {/* Recent searches (when no query) */}
              {!query && recentSearches.length > 0 && (
                <div className="mb-1">
                  <SectionHeader label="Recent" count={recentSearches.length} />
                  {recentSearches.map((term, i) => (
                    <button
                      key={i}
                      onClick={() => setQuery(term)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
                        <Clock className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[13px] text-gray-600">{term}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Conversations */}
              {conversations.length > 0 && (
                <div className="mb-1">
                  <SectionHeader label="Conversations" count={conversations.length} />
                  {conversations.map(conv => {
                    const idx = itemIndex++
                    return (
                      <ResultItem
                        key={conv.id}
                        isSelected={selectedIndex === idx}
                        icon={<MessageSquare className="w-4 h-4" />}
                        primary={conv.customer?.name ?? 'Unknown'}
                        secondary={conv.lastMessage?.content?.slice(0, 60)}
                        badge={
                          <span className={clsx(
                            'text-[9px] font-semibold px-1.5 py-0.5 rounded-full',
                            conv.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                          )}>
                            {conv.status}
                          </span>
                        }
                        onClick={() => {
                          if (query.trim()) addRecent(query.trim())
                          onSelectConversation(conv.id)
                          onClose()
                        }}
                      />
                    )
                  })}
                </div>
              )}

              {/* Customers */}
              {customers.length > 0 && (
                <div className="mb-1">
                  <SectionHeader label="Customers" count={customers.length} />
                  {customers.map(cust => {
                    const idx = itemIndex++
                    return (
                      <ResultItem
                        key={cust.id}
                        isSelected={selectedIndex === idx}
                        icon={<Users className="w-4 h-4" />}
                        primary={cust.name ?? cust.phone ?? 'Unknown'}
                        secondary={[cust.email, cust.city].filter(Boolean).join(' · ')}
                        badge={
                          cust.tier !== 'new'
                            ? <span className="text-[10px]">{cust.tier === 'vip' ? '👑' : '⭐'}</span>
                            : undefined
                        }
                        onClick={() => {
                          // Navigate to customer — for now open their latest conversation
                          onClose()
                        }}
                      />
                    )
                  })}
                </div>
              )}

              {/* Quick Actions */}
              {filteredActions.length > 0 && (
                <div className="mb-1">
                  <SectionHeader label="Quick Actions" count={filteredActions.length} />
                  {filteredActions.map(action => {
                    const idx = itemIndex++
                    return (
                      <ResultItem
                        key={action.id}
                        isSelected={selectedIndex === idx}
                        icon={action.icon}
                        primary={action.label}
                        secondary={action.description}
                        kbd={action.shortcut}
                        onClick={action.action}
                      />
                    )
                  })}
                </div>
              )}

              {/* Empty state */}
              {query.length > 1 && conversations.length === 0 && customers.length === 0 && filteredActions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Hash className="w-8 h-8 text-gray-200 mb-2" />
                  <p className="text-[13px] text-gray-500">No results for "{query}"</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Try a different search term</p>
                </div>
              )}
            </div>

            {/* Footer shortcuts */}
            <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50/60">
              <div className="flex items-center gap-1">
                <kbd className="text-[9px] text-gray-400 bg-white border border-gray-200 px-1 py-0.5 rounded font-mono">↑↓</kbd>
                <span className="text-[10px] text-gray-400">navigate</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="text-[9px] text-gray-400 bg-white border border-gray-200 px-1 py-0.5 rounded font-mono">↵</kbd>
                <span className="text-[10px] text-gray-400">select</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="text-[9px] text-gray-400 bg-white border border-gray-200 px-1 py-0.5 rounded font-mono">Esc</kbd>
                <span className="text-[10px] text-gray-400">close</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
