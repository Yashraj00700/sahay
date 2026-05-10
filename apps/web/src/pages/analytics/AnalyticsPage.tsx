import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  MessageSquare, Bot, Clock, Star, TrendingUp, TrendingDown,
  RefreshCw, Mail, CheckCircle2,
} from 'lucide-react'
import { format } from 'date-fns'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import type {
  AgentMetric,
  AnalyticsOverview,
  TimeseriesInterval,
  TimeseriesMetric,
  TimeseriesResponse,
} from '@sahay/shared'
import { AgentLeaderboard } from '../../components/analytics/AgentLeaderboard'

// ─── Date range presets ─────────────────────────────────────────────────────

type RangePreset = 'today' | '7d' | '30d' | '90d' | 'custom'

interface DateRange {
  preset: RangePreset
  from: Date
  to: Date
}

const PRESETS: ReadonlyArray<{ key: RangePreset; label: string; days: number }> = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
]

function rangeFromPreset(preset: Exclude<RangePreset, 'custom'>): DateRange {
  const days = PRESETS.find((p) => p.key === preset)?.days ?? 30
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { preset, from, to }
}

// ─── Query keys / fetchers ──────────────────────────────────────────────────

function rangeParams(range: DateRange) {
  return {
    dateFrom: range.from.toISOString(),
    dateTo: range.to.toISOString(),
  }
}

async function fetchOverview(range: DateRange): Promise<AnalyticsOverview> {
  const r = await api.get<AnalyticsOverview>('/analytics/overview', {
    params: rangeParams(range),
  })
  return r.data
}

async function fetchTimeseries(
  range: DateRange,
  metric: TimeseriesMetric,
  interval: TimeseriesInterval,
): Promise<TimeseriesResponse> {
  const r = await api.get<TimeseriesResponse>('/analytics/timeseries', {
    params: { ...rangeParams(range), metric, interval },
  })
  return r.data
}

async function fetchAgents(range: DateRange): Promise<{ data: AgentMetric[] }> {
  const r = await api.get<{ data: AgentMetric[] }>('/analytics/agents', {
    params: rangeParams(range),
  })
  return r.data
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

type KpiFormat = 'number' | 'percent' | 'time' | 'decimal'

function formatValue(value: number | null, kind: KpiFormat): string {
  if (value === null) return '—'
  if (kind === 'percent') return `${value.toFixed(1)}%`
  if (kind === 'time') {
    if (value <= 0) return '0s'
    return value >= 60
      ? `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`
      : `${Math.round(value)}s`
  }
  if (kind === 'decimal') return value.toFixed(1)
  return value.toLocaleString('en-IN')
}

interface KpiCardProps {
  icon: React.ElementType
  label: string
  value: number | null
  delta: number | null
  deltaLabel?: string
  format?: KpiFormat
  lowerIsBetter?: boolean
}

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  deltaLabel = 'vs prev period',
  format: kind = 'number',
  lowerIsBetter = false,
}: KpiCardProps) {
  const formatted = formatValue(value, kind)
  const positive = (delta ?? 0) >= 0
  const isGood = lowerIsBetter ? !positive : positive
  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-3 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide leading-none">
          {label}
        </span>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div className="text-3xl font-bold text-text-primary tabular-nums">{formatted}</div>
      {delta !== null ? (
        <div
          className={cn(
            'flex items-center gap-1 text-xs font-medium',
            isGood ? 'text-emerald-600' : 'text-rose-500',
          )}
        >
          {positive ? (
            <TrendingUp className="w-3 h-3 flex-shrink-0" />
          ) : (
            <TrendingDown className="w-3 h-3 flex-shrink-0" />
          )}
          <span>
            {positive ? '+' : ''}
            {kind === 'decimal' || kind === 'percent' ? delta.toFixed(1) : delta}
            {kind === 'percent' ? '%' : ''}
          </span>
          <span className="text-text-secondary font-normal">{deltaLabel}</span>
        </div>
      ) : (
        <span className="text-xs text-text-secondary">No comparison</span>
      )}
    </div>
  )
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ─── Date Range Picker ──────────────────────────────────────────────────────

function DateRangePicker({
  range,
  onChange,
}: {
  range: DateRange
  onChange: (r: DateRange) => void
}) {
  const [showCustom, setShowCustom] = useState(false)

  function selectPreset(key: RangePreset) {
    if (key === 'custom') {
      setShowCustom(true)
      return
    }
    setShowCustom(false)
    onChange(rangeFromPreset(key))
  }

  function applyCustom(fromStr: string, toStr: string) {
    const f = new Date(fromStr)
    const t = new Date(toStr)
    if (isNaN(f.getTime()) || isNaN(t.getTime()) || f > t) return
    onChange({ preset: 'custom', from: f, to: t })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex bg-surface border border-border rounded-lg p-1 gap-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => selectPreset(p.key)}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium transition-colors',
              range.preset === p.key
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => selectPreset('custom')}
          className={cn(
            'px-3 py-1.5 rounded text-xs font-medium transition-colors',
            range.preset === 'custom'
              ? 'bg-primary text-white shadow-sm'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          Custom
        </button>
      </div>
      {(showCustom || range.preset === 'custom') && (
        <div className="flex items-center gap-1 text-xs">
          <input
            type="date"
            value={format(range.from, 'yyyy-MM-dd')}
            onChange={(e) => applyCustom(e.target.value, format(range.to, 'yyyy-MM-dd'))}
            className="bg-surface border border-border rounded px-2 py-1 text-text-primary"
          />
          <span className="text-text-secondary">to</span>
          <input
            type="date"
            value={format(range.to, 'yyyy-MM-dd')}
            onChange={(e) => applyCustom(format(range.from, 'yyyy-MM-dd'), e.target.value)}
            className="bg-surface border border-border rounded px-2 py-1 text-text-primary"
          />
        </div>
      )}
    </div>
  )
}

// ─── Time-series chart ──────────────────────────────────────────────────────

const METRIC_OPTIONS: ReadonlyArray<{ value: TimeseriesMetric; label: string }> = [
  { value: 'conversations', label: 'Conversations' },
  { value: 'resolutions', label: 'Resolutions' },
  { value: 'messages', label: 'Messages' },
  { value: 'csat', label: 'CSAT' },
]

const INTERVAL_OPTIONS: ReadonlyArray<{ value: TimeseriesInterval; label: string }> = [
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
]

function TimeseriesChart({ range }: { range: DateRange }) {
  const [metric, setMetric] = useState<TimeseriesMetric>('conversations')
  const [interval, setInterval] = useState<TimeseriesInterval>('day')

  const { data, isLoading } = useQuery<TimeseriesResponse>({
    queryKey: [
      'analytics',
      'timeseries',
      range.from.toISOString(),
      range.to.toISOString(),
      metric,
      interval,
    ],
    queryFn: () => fetchTimeseries(range, metric, interval),
    staleTime: 60_000,
  })

  const chartData = useMemo(() => {
    if (!data) return []
    return data.points.map((p) => ({
      label: format(new Date(p.ts), interval === 'hour' ? 'MMM d HH:mm' : 'MMM d'),
      value: p.value,
    }))
  }, [data, interval])

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <SectionHeader
        title="Trend"
        subtitle="Pick a metric and bucket size"
        action={
          <div className="flex items-center gap-2">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as TimeseriesMetric)}
              className="bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary"
            >
              {METRIC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value as TimeseriesInterval)}
              className="bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      {isLoading ? (
        <div className="h-[220px] bg-border/30 rounded animate-pulse" />
      ) : chartData.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-text-secondary">
          No data in this range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="tsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#4F46E5"
              strokeWidth={2}
              fill="url(#tsGrad)"
              dot={false}
              activeDot={{ r: 4, fill: '#4F46E5' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset('30d'))
  const [refreshKey, setRefreshKey] = useState(0)

  const overviewQuery = useQuery<AnalyticsOverview>({
    queryKey: [
      'analytics',
      'overview',
      range.from.toISOString(),
      range.to.toISOString(),
      refreshKey,
    ],
    queryFn: () => fetchOverview(range),
    staleTime: 60_000,
  })

  const agentsQuery = useQuery<{ data: AgentMetric[] }>({
    queryKey: [
      'analytics',
      'agents',
      range.from.toISOString(),
      range.to.toISOString(),
      refreshKey,
    ],
    queryFn: () => fetchAgents(range),
    staleTime: 60_000,
  })

  const overview = overviewQuery.data
  const agents = agentsQuery.data?.data ?? []

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Analytics</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              Performance overview for your support operations
            </p>
          </div>
          <div className="flex items-center gap-3">
            <DateRangePicker range={range} onChange={setRange} />
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* KPI tiles */}
        {overviewQuery.isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface border border-border rounded-xl p-5 h-36 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={MessageSquare}
                label="Total Conversations"
                value={overview?.totalConversations ?? 0}
                delta={overview?.trends.conversationsDelta ?? null}
              />
              <KpiCard
                icon={CheckCircle2}
                label="Resolved %"
                value={overview?.resolvedRate ?? 0}
                delta={null}
                format="percent"
              />
              <KpiCard
                icon={Clock}
                label="Avg First Response"
                value={overview?.avgFirstResponseSeconds ?? 0}
                delta={null}
                format="time"
                lowerIsBetter
              />
              <KpiCard
                icon={Clock}
                label="Avg Resolution"
                value={overview?.avgResolutionSeconds ?? 0}
                delta={null}
                format="time"
                lowerIsBetter
              />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={Star}
                label="Avg CSAT"
                value={overview?.avgCsat ?? null}
                delta={overview?.trends.csatDelta ?? null}
                format="decimal"
              />
              <KpiCard
                icon={Bot}
                label="AI-only Resolution"
                value={overview?.aiResolutionRate ?? 0}
                delta={overview?.trends.aiResolutionDelta ?? null}
                format="percent"
              />
              <KpiCard
                icon={Mail}
                label="Messages Sent"
                value={overview?.totalMessages ?? 0}
                delta={null}
              />
              <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary uppercase tracking-wide leading-none">
                    Top Intent
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <div className="text-xl font-semibold text-text-primary capitalize truncate">
                  {overview?.topIntent ? overview.topIntent.replace(/_/g, ' ') : '—'}
                </div>
                <span className="text-xs text-text-secondary">
                  Most common primary intent
                </span>
              </div>
            </div>
          </>
        )}

        {/* Time-series chart */}
        <TimeseriesChart range={range} />

        {/* Per-channel breakdown */}
        {overview && (
          <div className="bg-surface border border-border rounded-xl p-5">
            <SectionHeader title="By Channel" subtitle="Conversation distribution" />
            {overview.totalConversations === 0 ? (
              <div className="text-xs text-text-secondary py-4">No conversations in this range.</div>
            ) : (
              <div className="space-y-3">
                {(['whatsapp', 'instagram', 'webchat', 'email'] as const).map((ch) => {
                  const count = overview.channelBreakdown[ch] ?? 0
                  const pct =
                    overview.totalConversations > 0
                      ? Math.round((count / overview.totalConversations) * 100)
                      : 0
                  return (
                    <div key={ch}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm capitalize text-text-primary font-medium">
                          {ch}
                        </span>
                        <span className="text-xs text-text-secondary">
                          {count.toLocaleString('en-IN')} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Agent leaderboard */}
        <AgentLeaderboard data={agents} isLoading={agentsQuery.isLoading} />
      </div>
    </div>
  )
}
