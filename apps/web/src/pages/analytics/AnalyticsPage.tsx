import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  MessageSquare, Bot, Clock, Star,
  TrendingUp, TrendingDown, RefreshCw,
  IndianRupee, Zap,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import type { AnalyticsOverview } from '@sahay/shared'

// ─── Mock fallback (matches AnalyticsOverview from @sahay/shared exactly) ───

function getMockOverview(period: string): AnalyticsOverview {
  const m = period === '1d' ? 1 : period === '7d' ? 7 : 30
  return {
    period: period as '1d' | '7d' | '30d',
    totalConversations: 47 * m,
    newConversations: 31 * m,
    resolvedConversations: 38 * m,
    aiResolved: 35 * m,
    aiResolutionRate: 73.4,
    avgFirstResponseSeconds: 34,
    avgResolutionSeconds: 420,
    avgCsat: 4.6,
    csatResponses: 18 * m,
    codConversions: 4 * m,
    codConversionRevenue: 12800 * m,
    channelBreakdown: {
      whatsapp: Math.round(0.55 * 47 * m),
      instagram: Math.round(0.30 * 47 * m),
      webchat: Math.round(0.15 * 47 * m),
      email: 0,
    },
    trends: {
      conversationsDelta: 12,
      aiResolutionDelta: 3.1,
      csatDelta: 0.1,
    },
  }
}

function getMockTimeSeries(period: string) {
  if (period === '1d') {
    return Array.from({ length: 12 }, (_, i) => ({
      label: `${(i * 2).toString().padStart(2, '0')}:00`,
      conversations: Math.floor(Math.random() * 8 + 2),
      aiResolved: Math.floor(Math.random() * 6 + 1),
    }))
  }
  if (period === '7d') {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => ({
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
  email: '#F59E0B',
}

const PERIOD_OPTIONS = [
  { value: '1d', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
]

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  deltaLabel,
  format = 'number',
  lowerIsBetter = false,
}: {
  icon: React.ElementType
  label: string
  value: number | null
  delta: number | null
  deltaLabel: string
  format?: 'number' | 'percent' | 'time' | 'decimal' | 'currency'
  lowerIsBetter?: boolean
}) {
  const formatted =
    value === null ? '—'
    : format === 'percent' ? `${value.toFixed(1)}%`
    : format === 'time' ? value >= 60 ? `${Math.floor(value / 60)}m ${value % 60}s` : `${value}s`
    : format === 'decimal' ? value.toFixed(1)
    : format === 'currency' ? `₹${(value / 100).toLocaleString('en-IN')}`
    : value.toLocaleString('en-IN')

  const positive = (delta ?? 0) >= 0
  const isGood = lowerIsBetter ? !positive : positive

  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-3 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide leading-none">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div className="text-3xl font-bold text-text-primary tabular-nums">{formatted}</div>
      {delta !== null ? (
        <div className={cn(
          'flex items-center gap-1 text-xs font-medium',
          isGood ? 'text-emerald-600' : 'text-rose-500',
        )}>
          {positive
            ? <TrendingUp className="w-3 h-3 flex-shrink-0" />
            : <TrendingDown className="w-3 h-3 flex-shrink-0" />}
          <span>{positive ? '+' : ''}{format === 'decimal' || format === 'percent' ? delta.toFixed(1) : delta}{format === 'percent' ? '%' : ''}</span>
          <span className="text-text-secondary font-normal">{deltaLabel}</span>
        </div>
      ) : (
        <span className="text-xs text-text-secondary">No comparison available</span>
      )}
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const [period, setPeriod] = useState<'1d' | '7d' | '30d'>('7d')
  const [refreshKey, setRefreshKey] = useState(0)

  const { data: overview, isLoading } = useQuery<AnalyticsOverview>({
    queryKey: ['analytics', 'overview', period, refreshKey],
    queryFn: async () => {
      try {
        const r = await api.get<AnalyticsOverview>('/analytics/overview', { params: { period } })
        return r.data
      } catch {
        return getMockOverview(period)
      }
    },
    staleTime: 60_000,
  })

  const timeSeries = getMockTimeSeries(period)
  const aiTrend = timeSeries.map(p => ({
    label: p.label,
    rate: p.conversations > 0 ? Math.round((p.aiResolved / p.conversations) * 100) : 0,
  }))

  const channels = overview
    ? Object.entries(overview.channelBreakdown)
        .filter(([, count]) => count > 0)
        .map(([ch, count]) => ({
          channel: ch,
          count,
          pct: Math.round((count / overview.totalConversations) * 100),
        }))
        .sort((a, b) => b.count - a.count)
    : []

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Analytics</h1>
            <p className="text-sm text-text-secondary mt-0.5">Performance overview for your AI support operations</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-surface border border-border rounded-lg p-1 gap-0.5">
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value as '1d' | '7d' | '30d')}
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
          <>
            {/* Row 1 — core metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={MessageSquare}
                label="Total Conversations"
                value={overview.totalConversations}
                delta={overview.trends.conversationsDelta}
                deltaLabel="vs prev period"
              />
              <KpiCard
                icon={Bot}
                label="AI Resolution Rate"
                value={overview.aiResolutionRate}
                delta={overview.trends.aiResolutionDelta}
                deltaLabel="vs prev period"
                format="percent"
              />
              <KpiCard
                icon={Clock}
                label="Avg First Response"
                value={overview.avgFirstResponseSeconds}
                delta={null}
                deltaLabel=""
                format="time"
                lowerIsBetter
              />
              <KpiCard
                icon={Star}
                label="CSAT Score"
                value={overview.avgCsat}
                delta={overview.trends.csatDelta}
                deltaLabel="vs prev period"
                format="decimal"
              />
            </div>

            {/* Row 2 — revenue / secondary metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={IndianRupee}
                label="COD→Prepaid Revenue"
                value={overview.codConversionRevenue}
                delta={null}
                deltaLabel=""
                format="currency"
              />
              <KpiCard
                icon={Zap}
                label="COD Conversions"
                value={overview.codConversions}
                delta={null}
                deltaLabel=""
              />
              <KpiCard
                icon={MessageSquare}
                label="New Conversations"
                value={overview.newConversations}
                delta={null}
                deltaLabel=""
              />
              <KpiCard
                icon={Star}
                label="Resolved Conversations"
                value={overview.resolvedConversations}
                delta={null}
                deltaLabel=""
              />
            </div>
          </>
        ) : null}

        {/* ── Volume Chart + Channel Breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
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

          <div className="bg-surface border border-border rounded-xl p-5">
            <SectionHeader title="By Channel" subtitle="Message distribution" />
            <div className="space-y-4 mt-2">
              {channels.map(ch => (
                <div key={ch.channel}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm capitalize text-text-primary font-medium">{ch.channel}</span>
                    <span className="text-xs text-text-secondary">{ch.count.toLocaleString('en-IN')} ({ch.pct}%)</span>
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
        {overview && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Human-touched conversations',
                value: (overview.totalConversations - overview.aiResolved).toLocaleString('en-IN'),
              },
              {
                label: 'Avg conversations / day',
                value: Math.round(overview.totalConversations / (period === '1d' ? 1 : period === '7d' ? 7 : 30)).toLocaleString('en-IN'),
              },
              {
                label: 'Response time target (< 60s)',
                value: overview.avgFirstResponseSeconds < 60 ? '✓ Met' : '✗ Missed',
              },
              {
                label: 'Avg resolution time',
                value: overview.avgResolutionSeconds >= 60
                  ? `${Math.floor(overview.avgResolutionSeconds / 60)}m ${overview.avgResolutionSeconds % 60}s`
                  : `${overview.avgResolutionSeconds}s`,
              },
            ].map(stat => (
              <div key={stat.label} className="bg-surface border border-border rounded-xl p-4 text-center">
                <div className="text-xl font-bold text-text-primary">{stat.value}</div>
                <div className="text-xs text-text-secondary mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
