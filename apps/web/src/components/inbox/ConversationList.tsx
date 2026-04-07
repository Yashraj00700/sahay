import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, SlidersHorizontal, ChevronDown,
  Inbox, X, Loader2,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import { useAuthStore } from '../../store/auth.store'
import { useInboxStore } from '../../store/inbox.store'
import type { Conversation, ConversationStatus, PaginatedResponse } from '@sahay/shared'
import { ConversationRow } from './ConversationRow'
import { EmptyInboxState } from './EmptyInboxState'

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | ConversationStatus

interface ConversationListProps {
  onSelect: (id: string) => void
  activeId: string | null
}

const FILTER_TABS: { label: string; value: FilterTab }[] = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Pending', value: 'pending' },
  { label: 'Snoozed', value: 'snoozed' },
]

const SORT_OPTIONS = [
  { label: 'Newest first', value: 'newest' as const },
  { label: 'Unresolved >4h', value: 'oldest_unresolved' as const },
  { label: 'Urgency', value: 'urgency_desc' as const },
  { label: 'VIP first', value: 'vip_first' as const },
]

// ─── Skeleton Row ─────────────────────────────────────────────────────────────

function SkeletonRow({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-start gap-3 px-4 py-3 border-b border-gray-100"
    >
      <div className="w-9 h-9 rounded-full bg-gray-200 animate-pulse flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex justify-between">
          <div className="h-3.5 bg-gray-200 rounded animate-pulse w-28" />
          <div className="h-3 bg-gray-200 rounded animate-pulse w-10" />
        </div>
        <div className="h-3 bg-gray-200 rounded animate-pulse w-full" />
        <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
      </div>
    </motion.div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ConversationList({ onSelect, activeId }: ConversationListProps) {
  const tenant = useAuthStore(s => s.tenant)
  const { filters, setFilter, sort, setSort } = useInboxStore()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [searchValue, setSearchValue] = useState('')
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Build query params
  const queryParams = {
    ...(activeTab !== 'all' && { status: activeTab }),
    ...(searchValue && { search: searchValue }),
    sort,
    ...filters,
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.conversations.list(tenant?.id ?? '', queryParams),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Conversation>>('/conversations', {
        params: queryParams,
      })
      return res.data
    },
    enabled: !!tenant?.id,
    refetchInterval: 15_000,
  })

  const conversations = data?.data ?? []
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)

  // Cmd+K focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Close sort dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleTabChange = useCallback((tab: FilterTab) => {
    setActiveTab(tab)
    if (tab === 'all') {
      setFilter('status', undefined)
    } else {
      setFilter('status', tab)
    }
  }, [setFilter])

  const currentSortLabel = SORT_OPTIONS.find(o => o.value === sort)?.label ?? 'Sort'

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200 w-[320px] flex-shrink-0">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5 text-violet-600" />
            <span className="text-[15px] font-semibold text-gray-900">Inbox</span>
            {totalUnread > 0 && (
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-violet-600 text-white text-[10px] font-bold leading-none"
              >
                {totalUnread > 99 ? '99+' : totalUnread}
              </motion.span>
            )}
          </div>

          {/* Sort dropdown */}
          <div className="relative" ref={sortRef}>
            <button
              onClick={() => setSortOpen(v => !v)}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 transition-colors px-2 py-1 rounded-md hover:bg-gray-100"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{currentSortLabel}</span>
              <ChevronDown className={clsx('w-3 h-3 transition-transform', sortOpen && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {sortOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50"
                >
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setSort(opt.value); setSortOpen(false) }}
                      className={clsx(
                        'w-full text-left text-[13px] px-3 py-2 hover:bg-violet-50 transition-colors',
                        sort === opt.value ? 'text-violet-700 font-medium bg-violet-50' : 'text-gray-700'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            placeholder="Search... ⌘K"
            className="w-full pl-8 pr-8 py-2 text-[13px] bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 placeholder:text-gray-400 transition-all"
          />
          {searchValue && (
            <button
              onClick={() => setSearchValue('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {!searchValue && (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-gray-400 bg-gray-100 border border-gray-200 font-mono pointer-events-none">
              ⌘K
            </kbd>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value)}
              className={clsx(
                'flex-shrink-0 px-3 py-1 rounded-full text-[12px] font-medium transition-all',
                activeTab === tab.value
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading strip ───────────────────────────────────── */}
      <AnimatePresence>
        {isFetching && !isLoading && (
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            exit={{ opacity: 0 }}
            className="h-0.5 bg-gradient-to-r from-violet-500 to-violet-300 origin-left"
          />
        )}
      </AnimatePresence>

      {/* ── List ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} index={i} />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <EmptyInboxState />
        ) : (
          <AnimatePresence initial={false}>
            {conversations.map(conversation => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === activeId}
                onClick={() => onSelect(conversation.id)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* ── Footer count ───────────────────────────────────── */}
      {!isLoading && conversations.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">
            {data?.pagination.total ?? 0} conversations
          </span>
          {isFetching && (
            <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />
          )}
        </div>
      )}
    </div>
  )
}
