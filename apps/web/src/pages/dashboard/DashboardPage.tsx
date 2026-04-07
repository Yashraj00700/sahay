import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  AreaChart,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus, MessageSquare, Bot, Clock, Star } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { motion } from 'framer-motion'
import { useAuthStore } from '../../store/auth.store'
import { apiRequest } from '../../lib/api'
import type { AnalyticsOverview, Conversation, Channel } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationsResponse {
  data: Conversation[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString('en-IN')
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (secs === 0) return `${mins}m`
  return `${mins}m ${secs}s`
}

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return format(new Date(dateStr), 'd MMM')
}

function truncate(text: string, len = 55): string {
  if (!text) return ''
  return text.length > len ? text.slice(0, len) + '…' : text
}

function getGreeting(name: string): string {
  const hour = new Date().getHours()
  const firstName = name.split(' ')[0]
  if (hour < 12) return `Good morning, ${firstName}! 🙏`
  if (hour < 17) return `Good afternoon, ${firstName}! 🙏`
  return `Good evening, ${firstName}! 🙏`
}

// ─── Mock chart data (7 days volume) ─────────────────────────────────────────

function buildChartData() {
  const today = new Date()
  return Array.from({ length: 7 }, (_, i) => {
    const date = subDays(today, 6 - i)
    return {
      day: format(date, 'EEE'),
      conversations: Math.floor(Math.random() * 40 + 10),
    }
  })
}

// ─── Channel Badge ────────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<Channel, { label: string; cls: string }> = {
  whatsapp:  { label: 'WhatsApp',  cls: 'bg-green-100 text-green-700' },
  instagram: { label: 'Instagram', cls: 'bg-pink-100 text-pink-700' },
  webchat:   { label: 'Webchat',   cls: 'bg-violet-100 text-violet-700' },
  email:     { label: 'Email',     cls: 'bg-sky-100 text-sky-700' },
}

function ChannelBadge({ channel }: { channel: Channel }) {
  const cfg = CHANNEL_CONFIG[channel] ?? CHANNEL_CONFIG.webchat
  return (
    <span className={`channel-badge ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

// ─── Delta Badge ──────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return null
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-text-muted">
        <Minus size={12} /> 0%
      </span>
    )
  }
  const positive = delta > 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        positive ? 'text-emerald-600' : 'text-red-500'
      }`}
    >
      {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(delta).toFixed(1)}%
    </span>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRect({ className }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className ?? ''}`} />
}

function MetricCardSkeleton() {
  return (
    <div className="metric-card space-y-3">
      <SkeletonRect className="h-4 w-28" />
      <SkeletonRect className="h-8 w-20" />
      <SkeletonRect className="h-3 w-16" />
    </div>
  )
}

function ConvRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
      <SkeletonRect className="w-9 h-9 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <SkeletonRect className="h-3 w-32" />
        <SkeletonRect className="h-3 w-48" />
      </div>
      <SkeletonRect className="h-3 w-10 flex-shrink-0" />
    </div>
  )
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string
  value: string
  delta: number | null
  icon: React.ReactNode
  iconBg: string
}

function MetricCard({ label, value, delta, icon, iconBg }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="metric-card flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-bold text-text-primary tracking-tight">{value}</span>
        <DeltaBadge delta={delta} />
      </div>
    </motion.div>
  )
}

// ─── Error State ──────────────────────────────────────────────────────────────

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-text-secondary">{message}</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-lg bg-violet-500 text-white text-sm font-medium
                   hover:bg-violet-600 transition-colors duration-150 focus-visible:ring-2"
      >
        Retry
      </button>
    </div>
  )
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-border rounded-xl shadow-card px-3 py-2 text-sm">
      <p className="text-text-muted text-xs mb-1">{label}</p>
      <p className="font-semibold text-text-primary">
        {formatNumber(payload[0].value)} conversations
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const agent = useAuthStore((s) => s.agent)

  const chartData = useMemo(() => buildChartData(), [])

  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
    refetch: refetchAnalytics,
  } = useQuery<AnalyticsOverview>({
    queryKey: ['analytics', 'overview', '7d'],
    queryFn: () => apiRequest<AnalyticsOverview>('GET', '/analytics/overview', undefined, { period: '7d' }),
    staleTime: 2 * 60 * 1000,
    retry: 2,
  })

  const {
    data: conversationsRes,
    isLoading: convsLoading,
    isError: convsError,
    refetch: refetchConvs,
  } = useQuery<ConversationsResponse>({
    queryKey: ['conversations', 'recent'],
    queryFn: () => apiRequest<ConversationsResponse>('GET', '/conversations', undefined, { limit: 5 }),
    staleTime: 60 * 1000,
    retry: 2,
  })

  const conversations = conversationsRes?.data ?? []

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* ─── Header ────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              {agent ? getGreeting(agent.name) : 'Welcome! 🙏'}
            </h1>
            <p className="text-sm text-text-muted mt-1">
              {format(new Date(), 'EEEE, d MMMM yyyy')}
            </p>
          </div>
          <div className="text-xs text-text-muted bg-white border border-border rounded-xl px-3 py-2 shadow-card">
            Last 7 days
          </div>
        </div>

        {/* ─── Metric Cards ───────────────────────────────────────── */}
        <section aria-label="Key metrics">
          {analyticsError ? (
            <div className="bg-white rounded-2xl border border-border shadow-sm p-4">
              <ErrorCard
                message="Could not load metrics. Check your connection."
                onRetry={refetchAnalytics}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {analyticsLoading ? (
                Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
              ) : analytics ? (
                <>
                  <MetricCard
                    label="Total Conversations"
                    value={formatNumber(analytics.totalConversations)}
                    delta={analytics.trends.conversationsDelta}
                    icon={<MessageSquare size={16} className="text-violet-600" />}
                    iconBg="bg-violet-100"
                  />
                  <MetricCard
                    label="AI Resolution Rate"
                    value={formatPercent(analytics.aiResolutionRate)}
                    delta={analytics.trends.aiResolutionDelta}
                    icon={<Bot size={16} className="text-emerald-600" />}
                    iconBg="bg-emerald-100"
                  />
                  <MetricCard
                    label="Avg First Response"
                    value={formatSeconds(analytics.avgFirstResponseSeconds)}
                    delta={null}
                    icon={<Clock size={16} className="text-sky-600" />}
                    iconBg="bg-sky-100"
                  />
                  <MetricCard
                    label="CSAT Score"
                    value={analytics.avgCsat !== null ? `${analytics.avgCsat.toFixed(1)} / 5.0` : '—'}
                    delta={analytics.trends.csatDelta}
                    icon={<Star size={16} className="text-saffron-500" />}
                    iconBg="bg-saffron-100"
                  />
                </>
              ) : null}
            </div>
          )}
        </section>

        {/* ─── Chart + Recent Conversations ──────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Line chart — 3/5 width on large screens */}
          <section
            aria-label="Conversation volume chart"
            className="lg:col-span-3 bg-white rounded-2xl border border-border shadow-sm p-5"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Conversation Volume</h2>
                <p className="text-xs text-text-muted mt-0.5">Daily activity over the last 7 days</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="violetGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6B4EFF" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#6B4EFF" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E3F0" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#9B99AE' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#9B99AE' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#E5E3F0', strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="conversations"
                  stroke="#6B4EFF"
                  strokeWidth={2}
                  fill="url(#violetGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#6B4EFF', strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </section>

          {/* Recent conversations — 2/5 width on large screens */}
          <section
            aria-label="Recent conversations"
            className="lg:col-span-2 bg-white rounded-2xl border border-border shadow-sm overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Recent Conversations</h2>
              <span className="text-xs text-text-muted">Last 5</span>
            </div>

            {convsError ? (
              <ErrorCard
                message="Could not load conversations."
                onRetry={refetchConvs}
              />
            ) : convsLoading ? (
              <div>
                {Array.from({ length: 5 }).map((_, i) => <ConvRowSkeleton key={i} />)}
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-10 text-center gap-2">
                <MessageSquare size={28} className="text-text-muted" />
                <p className="text-sm text-text-secondary font-medium">No conversations yet</p>
                <p className="text-xs text-text-muted">Connect your first channel to get started</p>
              </div>
            ) : (
              <ul>
                {conversations.map((conv) => (
                  <li
                    key={conv.id}
                    className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-none
                               hover:bg-violet-50/50 transition-colors cursor-pointer"
                  >
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center
                                    text-[11px] font-semibold text-violet-700 flex-shrink-0 mt-0.5">
                      {(conv.customer?.name ?? 'U')
                        .split(' ')
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() ?? '')
                        .join('')}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-xs font-medium text-text-primary truncate">
                          {conv.customer?.name ?? 'Unknown'}
                        </span>
                        <ChannelBadge channel={conv.channel} />
                      </div>
                      <p className="text-[11px] text-text-muted leading-relaxed line-clamp-1">
                        {truncate(conv.lastMessage?.content ?? '', 55) || (
                          <span className="italic">No messages yet</span>
                        )}
                      </p>
                    </div>

                    {/* Time */}
                    <span className="text-[10px] text-text-muted flex-shrink-0 mt-0.5">
                      {conv.updatedAt ? relativeTime(conv.updatedAt) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

      </div>
    </div>
  )
}
