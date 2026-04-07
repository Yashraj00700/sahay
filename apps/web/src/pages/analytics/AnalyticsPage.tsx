import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  MessageSquare, Bot, Clock, Star,
  TrendingUp, TrendingDown, RefreshCw,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsOverview {
  totalConversations: number
  aiResolutionRate: number
  avgFirstResponseSeconds: number
  csatScore: number
  totalConversationsDelta: number
  aiResolutionRateDelta: number
  avgFirstResponseDelta: number
  csatDelta: number
}

interface TimeSeriesPoint { label: string; conversations: number; aiResolved: number }
interface ChannelBreakdown { channel: string; count: number; pct: number }

// ─── Mock data (replace with real API when endpoints are live) ────────────────

function getMockOverview(period: string): AnalyticsOverview {
  const base = period === '1d'
    ? { total: 47, air: 74, afr: 38, csat: 4.6 }
    : period === '7d'
    ? { total: 312, air: 71, afr: 42, csat: 4.5 }
    : { total: 1240, air: 68, afr: 45, csat: 4.4 }
  return {
    totalConversations: base.total,
    aiResolutionRate: base.air,
    avgFirstResponseSeconds: base.afr,
    csatScore: base.csat,
    totalConversationsDelta: 12,
    aiResolutionRateDelta: 3,
    avgFirstResponseDelta: -8,
    csatDelta: 0.1,
  }
}

function getMockTimeSeries(period: string): TimeSeriesPoint[] {
  if (period === '1d') {
    return Array.from({ length: 12 }, (_, i) => ({
      label: `${(i * 2).toString().padStart(2, '0')}:00`,
      conversations: Math.floor(Math.random() * 8 + 2),
      aiResolved: Math.floor(Math.random() * 6 + 1),
    }))
  }
  if (period === '7d') {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return days.map(d => ({
      label: d,
      conversations: Math.floor(Math.random() * 60 + 30),
      aiResolved: Math.floor(Math.random() * 45 + 20),
    }))
  }
  return Array.from({ length: 30 }, (_, i) => ({
    label: `Apr ${i + 1}`,
    conversations: Math.floor(Math.random() * 60 + 20),
    aiResolved: Math.floor(Math.random() * 45 + 14),
  }))
}

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  instagram: '#E1306C',
  webchat: '#4F46E5',
}

function getMockChannels(): ChannelBreakdown[] {
  return [
    { channel: 'whatsapp', count: 680, pct: 55 },
    { channel: 'instagram', count: 370, pct: 30 },
    { channel: 'webchat', count: 190, pct: 15 },
  ]
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  deltaLabel,
  format = 'number',
}: {
  icon: React.ElementType
  label: string
  value: number
  delta: number
  deltaLabel: string
  format?: 'number' | 'percent' | 'time' | 'decimal'
}) {
  const formatted =
    format === 'percent' ? `${value}%`
    : format === 'time' ? `${value}s`
    : format === 'decimal' ? value.toFixed(1)
    : value.toLocaleString()

  const positive = delta >= 0
  const isGoodDelta =
    label.includes('Response') ? delta <= 0   // lower = better
    : delta >= 0

  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div className="text-3xl font-bold text-text-primary">{formatted}</div>
      <div className={cn(
        'flex items-center gap-1 text-xs font-medium',
        isGoodDelta ? 'text-success' : 'text-error',
      )}>
        {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        <span>{positive ? '+' : ''}{format === 'decimal' ? delta.toFixed(1) : format === 'percent' ? `${delta}%` : delta}</span>
        <span className="text-text-secondary font-normal">{deltaLabel}</span>
      </div>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
    </div>
  )
}

const PERIOD_OPTIONS = [
  { value: '1d', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
]

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const [period, setPeriod] = useState('7d')
  const [refreshKey, setRefreshKey] = useState(0)

  const { data: overview, isLoading } = useQuery<AnalyticsOverview>({
    queryKey: ['analytics', 'overview', period, refreshKey],
    queryFn: async () => {
      try {
        const r = await api.get<AnalyticsOverview>(`/analytics/overview`, { params: { period } })
        return r.data
      } catch {
        return getMockOverview(period)
      }
    },
    staleTime: 60_000,
  })

  const timeSeries = getMockTimeSeries(period)
  const channels = getMockChannels()

  const aiTrend = timeSeries.map(p => ({
    label: p.label,
    rate: p.conversations > 0 ? Math.round((p.aiResolved / p.conversations) * 100) : 0,
  }))

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Analytics</h1>
            <p className="text-sm text-text-secondary mt-0.5">Performance overview for your support operations</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Period tabs */}
            <div className="flex bg-surface border border-border rounded-lg p-1">
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className={cn(
                    'px-3 py-1.5 rounded text-xs font-medium transition-colors',
                    period === opt.value
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 h-36 animate-pulse" />
            ))}
          </div>
        ) : overview ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={MessageSquare}
              label="Total Conversations"
              value={overview.totalConversations}
              delta={overview.totalConversationsDelta}
              deltaLabel="vs prev period"
              format="number"
            />
            <KpiCard
              icon={Bot}
              label="AI Resolution Rate"
              value={overview.aiResolutionRate}
              delta={overview.aiResolutionRateDelta}
              deltaLabel="vs prev period"
              format="percent"
            />
            <KpiCard
              icon={Clock}
              label="Avg First Response"
              value={overview.avgFirstResponseSeconds}
              delta={overview.avgFirstResponseDelta}
              deltaLabel="vs prev period"
              format="time"
            />
            <KpiCard
              icon={Star}
              label="CSAT Score"
              value={overview.csatScore}
              delta={overview.csatDelta}
              deltaLabel="vs prev period"
              format="decimal"
            />
          </div>
        ) : null}

        {/* ── Volume Chart + Channel Breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Volume over time */}
          <div className="lg:col-span-2 bg-surface border border-border rounded-xl p-5">
            <SectionHeader title="Conversation Volume" subtitle="Total vs AI-resolved conversations" />
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={timeSeries} barGap={2}>
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
                  width={30}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="conversations" name="Total" fill="var(--color-primary)" opacity={0.3} radius={[3, 3, 0, 0]} />
                <Bar dataKey="aiResolved" name="AI Resolved" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span className="w-3 h-3 rounded-sm bg-primary/30 inline-block" />
                Total conversations
              </div>
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span className="w-3 h-3 rounded-sm bg-primary inline-block" />
                AI resolved
              </div>
            </div>
          </div>

          {/* Channel breakdown */}
          <div className="bg-surface border border-border rounded-xl p-5">
            <SectionHeader title="By Channel" subtitle="Message distribution" />
            <div className="space-y-4 mt-2">
              {channels.map(ch => (
                <div key={ch.channel}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm capitalize text-text-primary font-medium">{ch.channel}</span>
                    <span className="text-xs text-text-secondary">{ch.count.toLocaleString()} ({ch.pct}%)</span>
                  </div>
                  <div className="h-2 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${ch.pct}%`,
                        backgroundColor: CHANNEL_COLORS[ch.channel] ?? '#6366f1',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Donut-style summary */}
            <div className="mt-6 pt-4 border-t border-border space-y-2">
              {channels.map(ch => (
                <div key={ch.channel} className="flex items-center gap-2 text-xs text-text-secondary">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: CHANNEL_COLORS[ch.channel] ?? '#6366f1' }}
                  />
                  <span className="capitalize">{ch.channel}</span>
                  <span className="ml-auto font-medium text-text-primary">{ch.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── AI Resolution Trend ── */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <SectionHeader title="AI Resolution Rate Trend" subtitle="% of conversations resolved without human intervention" />
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={aiTrend}>
              <defs>
                <linearGradient id="aiGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.15} />
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
                domain={[0, 100]}
                tickFormatter={v => `${v}%`}
                tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
                axisLine={false}
                tickLine={false}
                width={38}
              />
              <Tooltip
                formatter={(v: number) => [`${v}%`, 'AI Resolution Rate']}
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Area
                type="monotone"
                dataKey="rate"
                stroke="#4F46E5"
                strokeWidth={2}
                fill="url(#aiGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#4F46E5' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ── Summary Row ── */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Human-touched conversations', value: overview ? `${overview.totalConversations - Math.floor(overview.totalConversations * overview.aiResolutionRate / 100)}` : '—' },
            { label: 'Avg conversations / day', value: overview ? Math.round(overview.totalConversations / (period === '1d' ? 1 : period === '7d' ? 7 : 30)).toString() : '—' },
            { label: 'Response time target (< 60s)', value: overview ? (overview.avgFirstResponseSeconds < 60 ? '✓ Met' : '✗ Missed') : '—' },
          ].map(stat => (
            <div key={stat.label} className="bg-surface border border-border rounded-xl p-4 text-center">
              <div className="text-xl font-bold text-text-primary">{stat.value}</div>
              <div className="text-xs text-text-secondary mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
