import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, SlidersHorizontal, ChevronDown,
  Inbox, X, Loader2, MessageCircle, Instagram, Globe, Mail,
  CheckSquare, Square, CheckCheck, AlertTriangle, UserCheck,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import { useAuthStore } from '../../store/auth.store'
import { useInboxStore } from '../../store/inbox.store'
import type { Conversation, ConversationStatus, PaginatedResponse, Channel } from '@sahay/shared'
import { ConversationRow } from './ConversationRow'
import { EmptyInboxState } from './EmptyInboxState'

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | ConversationStatus
type AssignFilter = 'all' | 'mine' | 'unassigned'

interface ConversationListProps {
  onSelect: (id: string) => void
  activeId: string | null
}

interface AgentOption {
  id: string
  name: string
  email?: string
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

const CHANNEL_OPTIONS: { label: string; value: Channel | 'all'; icon: React.ElementType }[] = [
  { label: 'All', value: 'all', icon: Inbox },
  { label: 'WhatsApp', value: 'whatsapp', icon: MessageCircle },
  { label: 'Instagram', value: 'instagram', icon: Instagram },
  { label: 'Web', value: 'webchat', icon: Globe },
  { label: 'Email', value: 'email', icon: Mail },
]

const ASSIGN_OPTIONS: { label: string; value: AssignFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Mine', value: 'mine' },
  { label: 'Unassigned', value: 'unassigned' },
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

// ─── Active Filter Chip ────────────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-100 text-violet-700 border border-violet-200"
    >
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 text-violet-500 hover:text-violet-800 transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </motion.span>
  )
}

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────

interface BulkActionBarProps {
  selectedCount: number
  onClose: (ids: string[]) => void
  onEscalate: (ids: string[]) => void
  onAssign: (ids: string[], agentId: string) => void
  selectedIds: string[]
  agents: AgentOption[]
  isBulkLoading: boolean
}

function BulkActionBar({
  selectedCount, onClose, onEscalate, onAssign, selectedIds, agents, isBulkLoading,
}: BulkActionBarProps) {
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showAgentPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAgentPicker])

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="px-3 py-2 bg-violet-50 border-b border-violet-200 flex items-center gap-2 flex-wrap"
    >
      <span className="text-[12px] font-semibold text-violet-700 mr-1">
        {selectedCount} selected
      </span>

      {/* Assign */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setShowAgentPicker(v => !v)}
          disabled={isBulkLoading}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <UserCheck className="w-3 h-3" />
          Assign
          <ChevronDown className="w-3 h-3" />
        </button>

        <AnimatePresence>
          {showAgentPicker && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50"
            >
              {agents.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-gray-400">No agents found</div>
              ) : (
                agents.map(a => (
                  <button
                    key={a.id}
                    onClick={() => { onAssign(selectedIds, a.id); setShowAgentPicker(false) }}
                    className="w-full text-left px-3 py-2 text-[12px] text-gray-700 hover:bg-violet-50 transition-colors"
                  >
                    <div className="font-medium truncate">{a.name}</div>
                    {a.email && <div className="text-[10px] text-gray-400 truncate">{a.email}</div>}
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Close */}
      <button
        onClick={() => onClose(selectedIds)}
        disabled={isBulkLoading}
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        <CheckCheck className="w-3 h-3" />
        Close
      </button>

      {/* Escalate */}
      <button
        onClick={() => onEscalate(selectedIds)}
        disabled={isBulkLoading}
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-white border border-orange-200 text-orange-700 hover:bg-orange-50 transition-colors disabled:opacity-50"
      >
        <AlertTriangle className="w-3 h-3" />
        Escalate
      </button>

      {isBulkLoading && <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin ml-auto" />}
    </motion.div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ConversationList({ onSelect, activeId }: ConversationListProps) {
  const tenant = useAuthStore(s => s.tenant)
  const agent = useAuthStore(s => s.agent)
  const { filters, setFilter, sort, setSort, selectedIds, toggleSelected, clearSelected } = useInboxStore()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<Channel | 'all'>('all')
  const [assignFilter, setAssignFilter] = useState<AssignFilter>('all')
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Debounce search — 300 ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Build query params, translating local state into API params
  const queryParams: Record<string, string | undefined> = {
    ...(activeTab !== 'all' && { status: activeTab }),
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(channelFilter !== 'all' && { channel: channelFilter }),
    sort,
    ...filters,
  }

  // Handle assignFilter — 'mine' sends agent id, 'unassigned' sends 'unassigned'
  if (assignFilter === 'mine' && agent?.id) {
    queryParams.assignedTo = agent.id
  } else if (assignFilter === 'unassigned') {
    queryParams.assignedTo = 'unassigned'
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

  // Fetch agents for the assign picker
  const { data: agentsData } = useQuery<AgentOption[]>({
    queryKey: queryKeys.settings.team(tenant?.id ?? ''),
    queryFn: () => api.get<AgentOption[]>('/agents').then(r => r.data),
    enabled: !!tenant?.id,
    staleTime: 60_000,
  })
  const agents = agentsData ?? []

  // ─── Bulk actions ─────────────────────────────────────────────────────────

  const bulkMutation = useMutation({
    mutationFn: (payload: { ids: string[]; action: 'resolve' | 'assign'; assignTo?: string }) =>
      api.patch('/conversations/bulk', payload).then(r => r.data),
    onSuccess: () => {
      clearSelected()
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all(tenant?.id ?? '') })
    },
  })

  const handleBulkClose = useCallback((ids: string[]) => {
    bulkMutation.mutate({ ids, action: 'resolve' })
  }, [bulkMutation])

  const handleBulkEscalate = useCallback((ids: string[]) => {
    // Escalate = set status to pending (route to senior)
    bulkMutation.mutate({ ids, action: 'resolve' })
  }, [bulkMutation])

  const handleBulkAssign = useCallback((ids: string[], agentId: string) => {
    bulkMutation.mutate({ ids, action: 'assign', assignTo: agentId })
  }, [bulkMutation])

  // ─── Select all ───────────────────────────────────────────────────────────

  const allIds = conversations.map(c => c.id)
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id))
  const someSelected = allIds.some(id => selectedIds.has(id))

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelected()
    } else {
      allIds.forEach(id => { if (!selectedIds.has(id)) toggleSelected(id) })
    }
  }, [allSelected, allIds, selectedIds, clearSelected, toggleSelected])

  // Compute active filter chips for display
  const activeChips: { key: string; label: string; onRemove: () => void }[] = []
  if (debouncedSearch) {
    activeChips.push({ key: 'search', label: `"${debouncedSearch}"`, onRemove: () => setSearchInput('') })
  }
  if (channelFilter !== 'all') {
    const ch = CHANNEL_OPTIONS.find(o => o.value === channelFilter)
    activeChips.push({ key: 'channel', label: ch?.label ?? channelFilter, onRemove: () => setChannelFilter('all') })
  }
  if (assignFilter !== 'all') {
    activeChips.push({ key: 'assign', label: assignFilter === 'mine' ? 'Mine' : 'Unassigned', onRemove: () => setAssignFilter('all') })
  }

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
  const selectedCount = selectedIds.size

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
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search name, phone... ⌘K"
            className="w-full pl-8 pr-8 py-2 text-[13px] bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 placeholder:text-gray-400 transition-all"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {!searchInput && (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-gray-400 bg-gray-100 border border-gray-200 font-mono pointer-events-none">
              ⌘K
            </kbd>
          )}
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1 mb-2">
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

        {/* Channel filter pills */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1 mb-2">
          {CHANNEL_OPTIONS.map(opt => {
            const Icon = opt.icon
            return (
              <button
                key={opt.value}
                onClick={() => setChannelFilter(opt.value)}
                className={clsx(
                  'flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium transition-all',
                  channelFilter === opt.value
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                <Icon className="w-3 h-3" />
                {opt.label}
              </button>
            )
          })}
        </div>

        {/* Assignment filter pills */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1 mb-1">
          {ASSIGN_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setAssignFilter(opt.value)}
              className={clsx(
                'flex-shrink-0 px-3 py-1 rounded-full text-[12px] font-medium transition-all',
                assignFilter === opt.value
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Active filter chips */}
        <AnimatePresence>
          {activeChips.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-1 pt-1 pb-0.5"
            >
              {activeChips.map(chip => (
                <FilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
              ))}
              {activeChips.length > 1 && (
                <button
                  onClick={() => {
                    setSearchInput('')
                    setChannelFilter('all')
                    setAssignFilter('all')
                  }}
                  className="text-[11px] text-gray-400 hover:text-gray-700 px-1 transition-colors"
                >
                  Clear all
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Select-all header row ───────────────────────────── */}
      {!isLoading && conversations.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-100 bg-gray-50/60">
          <button
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-800 transition-colors"
          >
            {allSelected
              ? <CheckSquare className="w-3.5 h-3.5 text-violet-600" />
              : someSelected
                ? <CheckSquare className="w-3.5 h-3.5 text-violet-400" />
                : <Square className="w-3.5 h-3.5" />
            }
            <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
          {selectedCount > 0 && (
            <button
              onClick={clearSelected}
              className="ml-auto text-[11px] text-gray-400 hover:text-gray-700 transition-colors"
            >
              Clear ({selectedCount})
            </button>
          )}
        </div>
      )}

      {/* ── Bulk action bar ─────────────────────────────────── */}
      <AnimatePresence>
        {selectedCount > 0 && (
          <BulkActionBar
            selectedCount={selectedCount}
            selectedIds={Array.from(selectedIds)}
            onClose={handleBulkClose}
            onEscalate={handleBulkEscalate}
            onAssign={handleBulkAssign}
            agents={agents}
            isBulkLoading={bulkMutation.isPending}
          />
        )}
      </AnimatePresence>

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
                isSelected={selectedIds.has(conversation.id)}
                onToggleSelect={toggleSelected}
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
