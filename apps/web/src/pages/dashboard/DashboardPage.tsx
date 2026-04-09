import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus,
  MessageSquare, Bot, Clock, Star,
  Wifi, WifiOff, Zap, ArrowRight,
  CheckCircle2, AlertCircle, Activity,
  IndianRupee, Users, Package,
} from 'lucide-react'
import { format, subDays } from 'date-fns'
import { motion } from 'framer-motion'
import { useAuthStore } from '../../store/auth.store'
import { apiRequest } from '../../lib/api'
import type { AnalyticsOverview, Conversation, Channel } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationsResponse { data: Conversation[] }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString('en-IN') }
function fmtSecs(s: number) {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), r = s % 60
  return r === 0 ? `${m}m` : `${m}m ${r}s`
}
function fmtPct(n: number) { return `${n.toFixed(1)}%` }
function relTime(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return 'Yesterday'
}
function greeting(name: string) {
  const h = new Date().getHours(), n = name.split(' ')[0]
  if (h < 12) return `Good morning, ${n}! 🙏`
  if (h < 17) return `Good afternoon, ${n}! 🙏`
  return `Good evening, ${n}! 🙏`
}
function truncate(t: string, l = 52) { return t?.length > l ? t.slice(0, l) + '…' : t ?? '' }

// ─── Chart data ───────────────────────────────────────────────────────────────

function buildChart() {
  const MOCK = [42, 38, 55, 61, 48, 72, 68]
  return Array.from({ length: 7 }, (_, i) => ({
    day: format(subDays(new Date(), 6 - i), 'EEE'),
    conversations: MOCK[i],
  }))
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const CH: Record<Channel, { label: string; cls: string }> = {
  whatsapp:  { label: 'WhatsApp',  cls: 'bg-green-100 text-green-700' },
  instagram: { label: 'Instagram', cls: 'bg-pink-100  text-pink-700'  },
  webchat:   { label: 'Webchat',   cls: 'bg-violet-100 text-violet-700' },
  email:     { label: 'Email',     cls: 'bg-sky-100   text-sky-700'   },
}
function Badge({ channel }: { channel: Channel }) {
  const c = CH[channel] ?? CH.webchat
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${c.cls}`}>{c.label}</span>
}

function Delta({ d }: { d: number | null }) {
  if (d === null) return null
  if (d === 0) return <span className="text-xs text-text-muted flex items-center gap-0.5"><Minus size={11} />0%</span>
  return (
    <span className={`text-xs font-medium flex items-center gap-0.5 ${d > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
      {d > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {Math.abs(d).toFixed(1)}%
    </span>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-border shadow-sm ${className}`}>{children}</div>
}

function Shimmer({ className = '' }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className}`} />
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, delta, icon, iconBg, extra }: {
  label: string; value: string; delta: number | null
  icon: React.ReactNode; iconBg: string; extra?: string
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-border shadow-sm p-4 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary font-medium">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>{icon}</div>
      </div>
      <div className="flex items-end justify-between gap-1">
        <span className="text-xl font-bold text-text-primary tracking-tight">{value}</span>
        <Delta d={delta} />
      </div>
      {extra && <p className="text-[10px] text-text-muted leading-relaxed">{extra}</p>}
    </motion.div>
  )
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-border rounded-xl shadow-card px-3 py-2 text-sm">
      <p className="text-text-muted text-xs mb-1">{label}</p>
      <p className="font-semibold text-text-primary">{fmt(payload[0].value)} conversations</p>
    </div>
  )
}

// ─── Today at a Glance ────────────────────────────────────────────────────────

const GLANCE = [
  { label: 'Messages Received Today', value: '127', sub: '+12% vs yesterday', color: 'text-violet-600', bg: 'bg-violet-50' },
  { label: 'Resolved by AI',          value: '103', sub: '+4pp   (81%)',       color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { label: 'Human Escalations',       value: '24',  sub: 'same as avg',        color: 'text-amber-600', bg: 'bg-amber-50' },
  { label: 'Avg Response Time',       value: '1m 12s', sub: '↓ faster',        color: 'text-sky-600', bg: 'bg-sky-50' },
]

// ─── AI Activity Feed ─────────────────────────────────────────────────────────

const FEED = [
  { msg: '✦ AI resolved order query for Anjali M. in 23s',         ch: 'WhatsApp', ago: '2 min ago' },
  { msg: '✦ AI suggested COD→Prepaid conversion for order #8821',   ch: 'WhatsApp', ago: '5 min ago' },
  { msg: '✦ AI escalated Priya S. to human (frustration detected)', ch: 'Instagram', ago: '8 min ago' },
  { msg: '✦ AI sent proactive shipping update to 47 customers',      ch: 'WhatsApp', ago: '12 min ago' },
  { msg: '✦ AI resolved return request for Deepika N. (instant refund link)', ch: 'Webchat', ago: '15 min ago' },
  { msg: '✦ AI converted Meera J. from COD to prepaid — ₹2,499 secured', ch: 'WhatsApp', ago: '19 min ago' },
  { msg: '✦ AI answered ingredient query for Kavya S. — 3 products recommended', ch: 'Instagram', ago: '24 min ago' },
  { msg: '✦ AI flagged damaged order #4567 as urgent — human loop triggered', ch: 'WhatsApp', ago: '31 min ago' },
]

// ─── Live Activity ────────────────────────────────────────────────────────────

const LIVE = [
  { msg: 'Priya Sharma sent a message on WhatsApp', ago: '1m ago' },
  { msg: 'AI resolved query for Aditya Kumar (Confidence: 94%)', ago: '2m ago' },
  { msg: 'Neha Singh escalated to human agent', ago: '3m ago' },
  { msg: 'COD order converted to prepaid — ₹2,299 saved', ago: '5m ago' },
  { msg: 'New order: Rohit Mehta — Rose Hip Oil (₹1,299)', ago: '6m ago' },
]

// ─── Pending actions ──────────────────────────────────────────────────────────

const PENDING = [
  { type: 'Escalated conversation', desc: 'Priya Sharma — frustrated about delayed order' },
  { type: 'Escalated conversation', desc: 'Rahul Mehta — wrong product received' },
  { type: 'Escalated conversation', desc: 'Anjali Kapoor — refund not credited' },
  { type: 'CSAT survey to review',  desc: '2 negative ratings submitted today' },
  { type: 'Knowledge base gap',     desc: '"How to track international orders?" — asked 8× today, unanswered' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const agent = useAuthStore((s) => s.agent)
  const chart = useMemo(() => buildChart(), [])

  const { data: analytics, isLoading: aLoading } = useQuery<AnalyticsOverview>({
    queryKey: ['analytics', 'overview', '7d'],
    queryFn: () => apiRequest<AnalyticsOverview>('GET', '/analytics/overview', undefined, { period: '7d' }),
    staleTime: 2 * 60 * 1000,
    retry: 1,
  })

  const { data: convsRes, isLoading: cLoading } = useQuery<ConversationsResponse>({
    queryKey: ['conversations', 'recent'],
    queryFn: () => apiRequest<ConversationsResponse>('GET', '/conversations', undefined, { limit: 6 }),
    staleTime: 60 * 1000,
    retry: 1,
  })

  const convs = convsRes?.data ?? []

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-[1400px] mx-auto px-4 py-6 lg:px-6">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              {agent ? greeting(agent.name) : 'Welcome! 🙏'}
            </h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <p className="text-sm text-text-muted">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
              <span className="text-text-muted/40">·</span>
              <p className="text-sm text-text-muted">{format(new Date(), 'hh:mm aa')} IST</p>
              <span className="text-text-muted/40">·</span>
              <p className="text-sm text-text-muted">Mumbai · 28°C ☀️</p>
            </div>
          </div>
          <span className="text-xs text-text-muted bg-white border border-border rounded-xl px-3 py-2 shadow-sm">
            Last 7 days
          </span>
        </div>

        {/* ── AI savings banner ───────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-gradient-to-r from-violet-600 to-violet-500 rounded-2xl px-5 py-3.5 flex items-center gap-3 shadow-sm"
        >
          <Zap size={18} className="text-white/80 flex-shrink-0" />
          <p className="text-sm text-white">
            Sahay saved <span className="font-bold">4.2 hours</span> of agent time today —
            <span className="text-white/80 ml-1">103 conversations resolved by AI without human touch.</span>
          </p>
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-6">

          {/* ── Left / main column ─────────────────────────── */}
          <div className="space-y-6">

            {/* Today at a Glance */}
            <Card>
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Today at a Glance</h2>
                <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">Live · Today</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-y divide-border">
                {GLANCE.map((g, i) => (
                  <div key={i} className="p-4">
                    <p className="text-xs text-text-muted mb-1.5">{g.label}</p>
                    <p className={`text-2xl font-bold ${g.color}`}>{g.value}</p>
                    <p className="text-[10px] text-text-muted mt-1">{g.sub}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Money saved + AI vs Human */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Money saved */}
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <IndianRupee size={15} className="text-emerald-600" />
                  <h2 className="text-sm font-semibold text-text-primary">Money saved by AI</h2>
                </div>
                <p className="text-3xl font-bold text-emerald-600 mb-0.5">₹2,84,500</p>
                <p className="text-xs text-text-muted mb-4">Saved by AI this month</p>
                <p className="text-xs text-text-muted mb-4">₹1,24,500 in support costs + ₹1,60,000 in failed delivery prevention</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { v: '3,420', l: 'queries handled by AI' },
                    { v: '₹83 → ₹8', l: 'cost per query' },
                    { v: '91%', l: 'customer satisfaction' },
                  ].map((s, i) => (
                    <div key={i} className="bg-background rounded-xl p-2.5 text-center">
                      <p className="text-sm font-bold text-text-primary">{s.v}</p>
                      <p className="text-[9px] text-text-muted mt-0.5 leading-tight">{s.l}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* AI vs Human */}
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-text-primary mb-4">AI vs human cost comparison</h2>
                <div className="space-y-3">
                  {[
                    { label: '🤖 AI Agent', convs: '3,420', rt: '1.2s', cost: '₹8', csat: '4.6 / 5' },
                    { label: '👤 Human Agent', convs: '427', rt: '4m 12s', cost: '₹83', csat: '4.9 / 5' },
                  ].map((row, i) => (
                    <div key={i} className={`rounded-xl p-3 ${i === 0 ? 'bg-violet-50' : 'bg-gray-50'}`}>
                      <p className="text-xs font-semibold text-text-primary mb-2">{row.label}</p>
                      <div className="grid grid-cols-4 gap-1 text-center">
                        {[
                          { l: 'Conversations', v: row.convs },
                          { l: 'Avg response', v: row.rt },
                          { l: 'Cost/query', v: row.cost },
                          { l: 'CSAT', v: row.csat },
                        ].map((c, j) => (
                          <div key={j}>
                            <p className="text-[9px] text-text-muted">{c.l}</p>
                            <p className="text-xs font-bold text-text-primary mt-0.5">{c.v}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <span className="bg-violet-100 text-violet-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">10× cheaper</span>
                    <span className="bg-sky-100 text-sky-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">210× faster</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* Channel health */}
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-4">Channel health</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { name: 'WhatsApp',  status: 'Connected',   detail: '1,247 msgs today · Response time 1.1s', dot: 'bg-emerald-400' },
                  { name: 'Instagram', status: 'Connected',   detail: '312 msgs today · Response time 2.3s',   dot: 'bg-emerald-400' },
                  { name: 'Shopify',   status: 'Synced 2m ago', detail: '85 products · 2,847 customers',       dot: 'bg-emerald-400' },
                ].map((ch, i) => (
                  <div key={i} className="bg-background rounded-xl p-3.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ch.dot}`} />
                      <p className="text-xs font-semibold text-text-primary">{ch.name}</p>
                    </div>
                    <p className="text-[10px] text-emerald-600 font-medium">● {ch.status}</p>
                    <p className="text-[10px] text-text-muted mt-0.5">{ch.detail}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Key metrics */}
            <section aria-label="Key metrics">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {aLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-border p-4 space-y-2">
                      <Shimmer className="h-3.5 w-28" />
                      <Shimmer className="h-7 w-20" />
                      <Shimmer className="h-3 w-16" />
                    </div>
                  ))
                ) : analytics ? (
                  <>
                    <MetricCard label="Total Conversations"
                      value={fmt(analytics.totalConversations)} delta={analytics.trends.conversationsDelta}
                      icon={<MessageSquare size={14} className="text-violet-600" />} iconBg="bg-violet-100"
                      extra={`↑ ${analytics.trends.conversationsDelta?.toFixed(1) ?? '0'}% this week`}
                    />
                    <MetricCard label="AI Resolution Rate"
                      value={fmtPct(analytics.aiResolutionRate)} delta={analytics.trends.aiResolutionDelta}
                      icon={<Bot size={14} className="text-emerald-600" />} iconBg="bg-emerald-100"
                      extra={`↑ ${analytics.trends.aiResolutionDelta?.toFixed(1) ?? '0'}pp improvement`}
                    />
                    <MetricCard label="Avg First Response"
                      value={fmtSecs(analytics.avgFirstResponseSeconds)} delta={null}
                      icon={<Clock size={14} className="text-sky-600" />} iconBg="bg-sky-100"
                    />
                    <MetricCard label="CSAT Score"
                      value={analytics.avgCsat !== null ? `${analytics.avgCsat.toFixed(1)}` : '—'} delta={analytics.trends.csatDelta}
                      icon={<Star size={14} className="text-amber-500" />} iconBg="bg-amber-100"
                      extra="Based on 342 ratings"
                    />
                    <MetricCard label="Revenue Attributed"
                      value="₹1.24L" delta={18.5}
                      icon={<IndianRupee size={14} className="text-pink-600" />} iconBg="bg-pink-100"
                      extra="47 orders influenced"
                    />
                    <MetricCard label="COD Conversions"
                      value="3.2%" delta={null}
                      icon={<Zap size={14} className="text-violet-600" />} iconBg="bg-violet-100"
                      extra="23% conversion rate"
                    />
                  </>
                ) : (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-border p-4 space-y-2">
                      <Shimmer className="h-3.5 w-28" />
                      <Shimmer className="h-7 w-20" />
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Live Metrics */}
            <Card>
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Live Metrics</h2>
                <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">Live</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-border">
                {[
                  { label: 'Messages Today',       value: '1,247' },
                  { label: 'AI Resolved',          value: '891' },
                  { label: 'Avg Response Time',    value: '1m 24s' },
                  { label: 'Active Conversations', value: '14' },
                ].map((m, i) => (
                  <div key={i} className="p-4 text-center">
                    <p className="text-[11px] text-text-muted mb-1">{m.label}</p>
                    <p className="text-xl font-bold text-text-primary">{m.value}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Chart + Recent Conversations */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <Card className="lg:col-span-3 p-5" aria-label="Conversation volume chart">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-semibold text-text-primary">Conversation Volume</h2>
                    <p className="text-xs text-text-muted mt-0.5">Daily activity over the last 7 days</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={chart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6B4EFF" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#6B4EFF" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E3F0" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9B99AE' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9B99AE' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: '#E5E3F0' }} />
                    <Area type="monotone" dataKey="conversations" stroke="#6B4EFF" strokeWidth={2}
                      fill="url(#vg)" dot={false} activeDot={{ r: 4, fill: '#6B4EFF', strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card className="lg:col-span-2 overflow-hidden" aria-label="Recent conversations">
                <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-text-primary">Recent Conversations</h2>
                  <span className="text-xs text-text-muted">Last 5</span>
                </div>
                {cLoading ? (
                  <div className="divide-y divide-border">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-3">
                        <Shimmer className="w-8 h-8 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Shimmer className="h-3 w-24" />
                          <Shimmer className="h-3 w-40" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : convs.length === 0 ? (
                  // Demo data when no real conversations yet
                  <ul className="divide-y divide-border">
                    {[
                      { name: 'Ananya Sharma',  ch: 'whatsapp' as Channel, msg: 'Thank you! Lekin ek aur cheez — face oil mein koi fragr…', ago: '3m ago' },
                      { name: 'Kavya Singh',    ch: 'whatsapp' as Channel, msg: 'Haan Kavya ji! COD bilkul available hai...', ago: '5m ago' },
                      { name: 'Riya Patel',     ch: 'instagram' as Channel, msg: "That sounds amazing! What's the price?", ago: '8m ago' },
                      { name: 'Meera Joshi',    ch: 'instagram' as Channel, msg: 'This is the 2nd time this has happened. Very disappoint…', ago: '10m ago' },
                      { name: 'Pooja Mehta',    ch: 'whatsapp' as Channel, msg: 'Full refund of ₹2,499 has been initiated.', ago: '13m ago' },
                      { name: 'Deepika Nair',   ch: 'whatsapp' as Channel, msg: 'Thanks! Got the tracking link 🙏', ago: '4h ago' },
                    ].map((c, i) => (
                      <li key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-violet-50/40 cursor-pointer transition-colors">
                        <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center text-[10px] font-bold text-violet-700 flex-shrink-0 mt-0.5">
                          {c.name.split(' ').map(w => w[0]).slice(0,2).join('')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span className="text-xs font-medium text-text-primary truncate">{c.name}</span>
                            <Badge channel={c.ch} />
                          </div>
                          <p className="text-[11px] text-text-muted line-clamp-1">{c.msg}</p>
                        </div>
                        <span className="text-[10px] text-text-muted flex-shrink-0 mt-0.5">{c.ago}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="divide-y divide-border">
                    {convs.slice(0, 6).map((c) => (
                      <li key={c.id} className="flex items-start gap-3 px-4 py-3 hover:bg-violet-50/40 cursor-pointer transition-colors">
                        <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center text-[10px] font-bold text-violet-700 flex-shrink-0 mt-0.5">
                          {(c.customer?.name ?? 'U').split(' ').slice(0,2).map(w => w[0]?.toUpperCase() ?? '').join('')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span className="text-xs font-medium text-text-primary truncate">{c.customer?.name ?? 'Unknown'}</span>
                            <Badge channel={c.channel} />
                          </div>
                          <p className="text-[11px] text-text-muted line-clamp-1">
                            {truncate(c.lastMessage?.content ?? '', 52) || <span className="italic">No messages yet</span>}
                          </p>
                        </div>
                        <span className="text-[10px] text-text-muted flex-shrink-0 mt-0.5">
                          {c.updatedAt ? relTime(c.updatedAt) : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* Revenue insights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Revenue from support */}
              <Card className="p-5" aria-label="Revenue and conversion insights">
                <h2 className="text-sm font-semibold text-text-primary mb-1">Revenue from Support</h2>
                <p className="text-2xl font-bold text-emerald-600">₹1,24,500</p>
                <p className="text-xs text-text-muted mb-3">This month · +23% vs last month</p>
                {[
                  { label: 'Product recommendations', v: '₹84,200' },
                  { label: 'Retention saves',         v: '₹28,100' },
                  { label: 'Return prevention',       v: '₹12,200' },
                ].map((r, i) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-border last:border-none">
                    <span className="text-text-secondary">{r.label}</span>
                    <span className="font-semibold text-text-primary">{r.v}</span>
                  </div>
                ))}
                <p className="text-[10px] text-text-muted mt-2">influenced by AI · 47 orders</p>
              </Card>

              {/* CSAT */}
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-text-primary mb-3">Customer Satisfaction</h2>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-3xl font-bold text-text-primary">4.7</span>
                  <span className="text-sm text-text-muted mb-1">/ 5.0</span>
                </div>
                <p className="text-xs text-text-muted mb-4">94% response rate</p>
                {[
                  { label: 'Very Happy', pct: 68, color: 'bg-emerald-400' },
                  { label: 'Happy',      pct: 22, color: 'bg-emerald-200' },
                  { label: 'Neutral',    pct: 6,  color: 'bg-amber-300' },
                  { label: 'Unhappy',    pct: 4,  color: 'bg-red-400' },
                ].map((r, i) => (
                  <div key={i} className="mb-2">
                    <div className="flex justify-between text-[10px] text-text-muted mb-0.5">
                      <span>{r.label}</span><span>{r.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-border rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${r.color}`} style={{ width: `${r.pct}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-text-muted mt-2">Based on this month · 342 ratings</p>
              </Card>

              {/* COD → Prepaid */}
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-text-primary mb-1">COD → Prepaid Conversions</h2>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-3xl font-bold text-violet-600">23%</span>
                  <span className="text-xs text-text-muted mb-1 ml-1">Conversion rate</span>
                </div>
                <p className="text-xs text-text-muted mb-4">↑ from 18% last month (+5pp)</p>
                <div className="flex gap-2 mb-3">
                  {[
                    { label: 'COD', pct: 77, color: 'bg-amber-200' },
                    { label: 'Prepaid', pct: 23, color: 'bg-violet-500' },
                  ].map((b, i) => (
                    <div key={i} className="flex-1">
                      <div className="h-2 rounded-full mb-1" style={{ width: `${b.pct}%`, minWidth: '24px' }}>
                        <div className={`h-full rounded-full ${b.color} w-full`} />
                      </div>
                      <p className="text-[10px] text-text-muted">{b.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-muted">Savings: ₹42,000 in failed delivery costs avoided</p>
                <p className="text-[10px] text-text-muted mt-1">converted this month · 89 orders</p>
              </Card>
            </div>

            {/* Revenue Impact */}
            <Card aria-label="Revenue impact">
              <div className="px-5 py-3.5 border-b border-border">
                <h2 className="text-sm font-semibold text-text-primary">Revenue Impact</h2>
                <p className="text-xs text-text-muted mt-0.5">This month</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-x divide-border">
                {[
                  { label: 'Revenue Saved from RTO Prevention', value: '₹1,84,500', delta: '+23%', note: 'Return-to-origin orders blocked by AI proactive follow-up' },
                  { label: 'COD Conversion Revenue',            value: '₹48,500',   delta: '+34%', note: '34% COD→Prepaid conversion rate — 89 orders this month' },
                  { label: 'AI Support Cost Savings',           value: '₹1,12,000', delta: '+18%', note: 'vs ₹3,50,000 for 3 human agents at equivalent volume' },
                ].map((r, i) => (
                  <div key={i} className="p-5">
                    <p className="text-xs text-text-secondary mb-2">{r.label}</p>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xl font-bold text-text-primary">{r.value}</p>
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">{r.delta} vs last month</span>
                    </div>
                    <p className="text-[10px] text-text-muted leading-relaxed">{r.note}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Performance vs Target */}
            <Card aria-label="Today's performance vs target">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Today's Performance vs Target</h2>
                  <p className="text-xs text-text-muted mt-0.5">{format(new Date(), 'd MMM')}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-y divide-border">
                {[
                  { label: 'Conversations Handled', current: 847, target: 1000, unit: '',  status: 'On track',  pct: 84.7 },
                  { label: 'AI Resolution Rate',    current: 70.6, target: 75,  unit: '%', status: 'On track',  pct: 94.1 },
                  { label: 'CSAT Score',            current: 4.7,  target: 5.0, unit: '/5.0', status: 'On track', pct: 94.0 },
                  { label: 'COD Conversion Rate',   current: 23,   target: 30,  unit: '%', status: 'Behind',   pct: 76.7 },
                ].map((m, i) => (
                  <div key={i} className="p-4">
                    <p className="text-[11px] text-text-muted mb-2">{m.label}</p>
                    <div className="flex items-end gap-1 mb-1">
                      <span className="text-lg font-bold text-text-primary">{m.current}{m.unit}</span>
                      <span className="text-[10px] text-text-muted mb-0.5">/ {m.target}{m.unit} target</span>
                    </div>
                    <div className="h-1.5 bg-border rounded-full mb-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${m.pct >= 90 ? 'bg-emerald-400' : m.pct >= 75 ? 'bg-amber-400' : 'bg-red-400'}`}
                        style={{ width: `${Math.min(m.pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className={m.status === 'On track' ? 'text-emerald-600' : 'text-amber-600'}>{m.status}</span>
                      <span className="text-text-muted">{m.pct}% of target</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* AI Activity Feed */}
            <Card aria-label="AI activity feed">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">AI Activity Feed</h2>
                <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">Live</span>
              </div>
              <ul className="divide-y divide-border">
                {FEED.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-background transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                    <p className="text-xs text-text-secondary flex-1">{f.msg}</p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                      f.ch === 'WhatsApp' ? 'bg-green-100 text-green-700'
                      : f.ch === 'Instagram' ? 'bg-pink-100 text-pink-700'
                      : 'bg-violet-100 text-violet-700'
                    }`}>{f.ch}</span>
                    <span className="text-[10px] text-text-muted flex-shrink-0 ml-1">{f.ago}</span>
                  </li>
                ))}
              </ul>
            </Card>

          </div>

          {/* ── Right sidebar ───────────────────────────────── */}
          <div className="space-y-5">

            {/* Live Activity */}
            <Card aria-label="Live activity">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-primary">Live Activity</h3>
                <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-full">Live</span>
              </div>
              <ul className="divide-y divide-border">
                {LIVE.map((l, i) => (
                  <li key={i} className="px-4 py-2.5">
                    <p className="text-[11px] text-text-secondary leading-relaxed">{l.msg}</p>
                    <p className="text-[10px] text-text-muted mt-0.5">{l.ago}</p>
                  </li>
                ))}
              </ul>
            </Card>

            {/* AI Health Monitor */}
            <Card>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-primary">AI Health Monitor</h3>
                <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-full">Operational</span>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: 'Model',             value: 'Claude 3.5 Haiku' },
                  { label: 'Avg Latency',       value: '847ms' },
                  { label: 'Last 100 requests', value: '99.2% success' },
                ].map((s, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-text-muted">{s.label}</span>
                    <span className="font-medium text-text-primary">{s.value}</span>
                  </div>
                ))}
                <div className="mt-2">
                  <p className="text-[10px] text-text-muted mb-1.5">Latency — last hour</p>
                  <div className="flex gap-0.5 items-end h-8">
                    {[4,6,5,7,4,8,6,5,7,9,6,7,5,8,7].map((v, i) => (
                      <div key={i} className="flex-1 bg-violet-200 rounded-sm" style={{ height: `${v * 10}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            {/* Pending Actions */}
            <Card>
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-xs font-semibold text-text-primary">Pending Actions</h3>
              </div>
              <ul className="divide-y divide-border">
                {PENDING.map((p, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-medium text-text-secondary">{p.type}</p>
                        <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{p.desc}</p>
                      </div>
                      <button className="text-[10px] font-medium text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 px-2 py-1 rounded-lg transition-colors flex-shrink-0">
                        {p.type.includes('Knowledge') ? 'Add Answer' : p.type.includes('CSAT') ? 'Review' : 'Respond'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Revenue This Month */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-text-primary">Revenue This Month</h3>
                <span className="text-[10px] text-text-muted">April 2026</span>
              </div>
              <p className="text-2xl font-bold text-emerald-600 mb-0.5">₹2,84,000</p>
              <p className="text-[10px] text-text-muted mb-4">Attributed to Sahay</p>
              <div className="space-y-2">
                {[
                  { label: 'Returns Prevented', value: '₹1,84,000', color: 'bg-violet-200' },
                  { label: 'COD Converted',     value: '₹82,000',  color: 'bg-emerald-200' },
                  { label: 'Upsells',           value: '₹18,000',  color: 'bg-amber-200' },
                ].map((r, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${r.color}`} />
                      <span className="text-text-secondary">{r.label}</span>
                    </div>
                    <span className="font-semibold text-text-primary">{r.value}</span>
                  </div>
                ))}
              </div>
            </Card>

          </div>
        </div>
      </div>
    </div>
  )
}
