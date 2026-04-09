// ─── Returns Management Page ──────────────────────────────────────────────────
// Displays all return/exchange requests for the tenant.
// Intercept status "prevented" means the AI salvaged the return.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  RotateCcw, ShieldCheck, Clock, CheckCircle, XCircle,
  RefreshCw, TrendingUp, IndianRupee, Filter,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { format } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

type ReturnStatus = 'pending' | 'approved' | 'rejected' | 'refunded' | 'prevented'

interface ReturnCustomFields {
  returnStatus?: ReturnStatus
  returnReason?: string
  returnIntercepted?: boolean
  returnInterceptedAt?: string
  returnNotes?: string
  returnUpdatedAt?: string
}

interface ReturnRow {
  id: string
  customerId: string
  channel: string
  status: string
  sentiment: string | null
  urgencyScore: number | null
  aiHandled: boolean
  humanTouched: boolean
  shopifyOrderId: string | null
  customFields: ReturnCustomFields | null
  tags: string[]
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

interface ReturnListResponse {
  data: ReturnRow[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}

interface ReturnOverview {
  totalRequests: number
  prevented: number
  refunded: number
  approved: number
  pending: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_FILTERS: Array<{ value: ReturnStatus | 'all'; label: string }> = [
  { value: 'all',       label: 'All' },
  { value: 'pending',   label: 'Pending' },
  { value: 'approved',  label: 'Approved' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'refunded',  label: 'Refunded' },
  { value: 'prevented', label: 'Saved (AI Prevented)' },
]

const STATUS_BADGE: Record<ReturnStatus, { label: string; className: string }> = {
  pending:   { label: 'Pending',       className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  approved:  { label: 'Approved',      className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  rejected:  { label: 'Rejected',      className: 'bg-red-50 text-red-700 border border-red-200' },
  refunded:  { label: 'Refunded',      className: 'bg-purple-50 text-purple-700 border border-purple-200' },
  prevented: { label: 'Saved by AI',   className: 'bg-green-50 text-green-700 border border-green-200' },
}

const ACTION_OPTIONS: Array<{ value: ReturnStatus; label: string }> = [
  { value: 'approved',  label: 'Approve Return' },
  { value: 'rejected',  label: 'Reject Return' },
  { value: 'refunded',  label: 'Mark Refunded' },
  { value: 'prevented', label: 'Mark as Saved' },
]

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  className,
  sub,
}: {
  label: string
  value: number
  icon: React.ElementType
  className?: string
  sub?: string
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-white p-4 flex items-start gap-3', className)}>
      <div className="rounded-lg bg-violet-50 p-2 flex-shrink-0">
        <Icon size={18} className="text-violet-600" />
      </div>
      <div>
        <p className="text-2xl font-bold text-text-primary">{value}</p>
        <p className="text-xs text-text-muted mt-0.5">{label}</p>
        {sub && <p className="text-xs text-green-600 font-medium mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ReturnStatus | undefined }) {
  const s = status ?? 'pending'
  const cfg = STATUS_BADGE[s]
  return (
    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', cfg.className)}>
      {cfg.label}
    </span>
  )
}

// ─── Action Select ────────────────────────────────────────────────────────────

function ActionSelect({
  rowId,
  current,
  onSuccess,
}: {
  rowId: string
  current: ReturnStatus | undefined
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: (newStatus: ReturnStatus) =>
      api.patch(`/returns/${rowId}/status`, { returnStatus: newStatus }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['returns'] })
      onSuccess()
      setOpen(false)
    },
  })

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs px-2 py-1 rounded-lg border border-border bg-background
                   hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700
                   transition-colors duration-150"
      >
        Update
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-border bg-white shadow-lg overflow-hidden">
            {ACTION_OPTIONS.filter(o => o.value !== current).map(opt => (
              <button
                key={opt.value}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(opt.value)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50
                           hover:text-violet-700 transition-colors disabled:opacity-50"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ReturnsPage() {
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | 'all'>('all')
  const [page, setPage] = useState(1)

  const qc = useQueryClient()

  const overviewQuery = useQuery<ReturnOverview>({
    queryKey: ['returns', 'overview'],
    queryFn: () => api.get<ReturnOverview>('/returns/overview').then(r => r.data),
    staleTime: 30_000,
  })

  const listQuery = useQuery<ReturnListResponse>({
    queryKey: ['returns', 'list', statusFilter, page],
    queryFn: () =>
      api.get<ReturnListResponse>('/returns', {
        params: {
          page,
          pageSize: 25,
          ...(statusFilter !== 'all' ? { returnStatus: statusFilter } : {}),
        },
      }).then(r => r.data),
    staleTime: 15_000,
    placeholderData: prev => prev,
  })

  const stats = overviewQuery.data
  const rows  = listQuery.data?.data ?? []
  const pag   = listQuery.data?.pagination

  // Prevention rate
  const preventionRate = stats && stats.totalRequests > 0
    ? Math.round((stats.prevented / stats.totalRequests) * 100)
    : 0

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ─── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <RotateCcw size={18} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-text-primary">Return Prevention</h1>
              <p className="text-xs text-text-muted">AI-intercepted return & exchange requests</p>
            </div>
          </div>
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['returns'] })
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center
                       text-text-muted hover:text-text-secondary hover:bg-white
                       border border-transparent hover:border-border transition-all"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {/* ─── Overview Stats ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Requests"
            value={stats?.totalRequests ?? 0}
            icon={RotateCcw}
          />
          <StatCard
            label="Saved by AI"
            value={stats?.prevented ?? 0}
            icon={ShieldCheck}
            sub={preventionRate > 0 ? `${preventionRate}% prevention rate` : undefined}
          />
          <StatCard
            label="Pending Review"
            value={stats?.pending ?? 0}
            icon={Clock}
          />
          <StatCard
            label="Fully Refunded"
            value={stats?.refunded ?? 0}
            icon={IndianRupee}
          />
        </div>

        {/* Prevention rate banner */}
        {preventionRate >= 15 && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-3">
            <TrendingUp size={16} className="text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-800">
              <span className="font-semibold">{preventionRate}% return prevention rate</span>
              {' '}— AI is saving returns above the 15% target. Great signal for Tier 3 moat metrics.
            </p>
          </div>
        )}

        {/* ─── Filters ────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-text-muted flex-shrink-0" />
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value as ReturnStatus | 'all'); setPage(1) }}
              className={cn(
                'text-xs px-3 py-1.5 rounded-full border transition-all duration-150',
                statusFilter === f.value
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-text-secondary border-border hover:border-violet-300 hover:text-violet-700',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* ─── Table ──────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Order ID</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Customer</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Channel</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Reason</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Sentiment</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Date</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading && (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border last:border-0 animate-pulse">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-3 bg-gray-100 rounded w-20" />
                        </td>
                      ))}
                    </tr>
                  ))
                )}

                {!listQuery.isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-text-muted text-sm">
                      <div className="flex flex-col items-center gap-2">
                        <RotateCcw size={24} className="text-gray-300" />
                        <span>No return requests found</span>
                      </div>
                    </td>
                  </tr>
                )}

                {rows.map(row => {
                  const cf = row.customFields ?? {}
                  const currentStatus = cf.returnStatus ?? 'pending'

                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-b border-border last:border-0 hover:bg-background transition-colors',
                        currentStatus === 'prevented' && 'bg-green-50/30',
                      )}
                    >
                      {/* Order ID */}
                      <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                        {row.shopifyOrderId
                          ? <span className="text-violet-600">#{row.shopifyOrderId}</span>
                          : <span className="text-text-muted">—</span>
                        }
                      </td>

                      {/* Customer ID (truncated until customer join added) */}
                      <td className="px-4 py-3 text-xs text-text-secondary font-mono">
                        {row.customerId.slice(0, 8)}…
                      </td>

                      {/* Channel */}
                      <td className="px-4 py-3">
                        <span className="text-xs capitalize text-text-secondary">{row.channel}</span>
                      </td>

                      {/* Return Reason */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-text-secondary capitalize">
                          {cf.returnReason
                            ? cf.returnReason.replace(/_/g, ' ')
                            : '—'
                          }
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={currentStatus} />
                      </td>

                      {/* Sentiment */}
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-xs capitalize',
                          row.sentiment === 'very_negative' || row.sentiment === 'negative'
                            ? 'text-red-600'
                            : row.sentiment === 'positive' || row.sentiment === 'very_positive'
                              ? 'text-green-600'
                              : 'text-text-muted',
                        )}>
                          {row.sentiment?.replace(/_/g, ' ') ?? '—'}
                        </span>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                        {format(new Date(row.createdAt), 'dd MMM, HH:mm')}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3">
                        <ActionSelect
                          rowId={row.id}
                          current={currentStatus}
                          onSuccess={() => qc.invalidateQueries({ queryKey: ['returns'] })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pag && pag.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-background text-xs text-text-muted">
              <span>
                {(pag.page - 1) * pag.pageSize + 1}–{Math.min(pag.page * pag.pageSize, pag.total)} of {pag.total}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={!pag.hasPreviousPage}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 rounded-lg border border-border disabled:opacity-40
                             hover:bg-white hover:border-violet-300 transition-colors"
                >
                  Previous
                </button>
                <button
                  disabled={!pag.hasNextPage}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 rounded-lg border border-border disabled:opacity-40
                             hover:bg-white hover:border-violet-300 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── Legend ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-green-600" />
            <strong className="text-text-secondary">Saved by AI</strong> — return intercepted; customer accepted alternative
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle size={12} className="text-blue-500" />
            <strong className="text-text-secondary">Approved</strong> — return accepted by support agent
          </span>
          <span className="flex items-center gap-1.5">
            <XCircle size={12} className="text-red-500" />
            <strong className="text-text-secondary">Rejected</strong> — return denied (outside policy)
          </span>
        </div>

      </div>
    </div>
  )
}
