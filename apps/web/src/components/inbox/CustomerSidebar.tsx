import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Phone, Mail, MapPin, Calendar, Package,
  Truck, CreditCard, Tag, X, TrendingUp,
  ChevronDown, ChevronUp, ExternalLink, Star,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import type { Conversation, Customer } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Order {
  id: string
  orderNumber: string
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned'
  courierName?: string
  trackingNumber?: string
  estimatedDelivery?: string
  items: Array<{ name: string; imageUrl?: string; quantity: number; price: number }>
  total: number
  paymentMethod: 'cod' | 'prepaid' | 'upi' | 'card'
  createdAt: string
}

interface CustomerSidebarProps {
  customerId: string
  conversation: Conversation
}

// ─── Language Flags ───────────────────────────────────────────────────────────

const LANG_FLAGS: Record<string, string> = {
  en: '🇬🇧',
  hi: '🇮🇳',
  hinglish: '🇮🇳',
  auto: '🌐',
}

// ─── Tier Badge ───────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  if (tier === 'vip') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
        👑 VIP
      </span>
    )
  }
  if (tier === 'loyal') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
        ⭐ Loyal
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" /> New
    </span>
  )
}

// ─── Order Status Badge ───────────────────────────────────────────────────────

function OrderStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    processing: { label: 'Processing', cls: 'bg-blue-100 text-blue-700' },
    shipped:    { label: 'Shipped',    cls: 'bg-amber-100 text-amber-700' },
    delivered:  { label: 'Delivered',  cls: 'bg-emerald-100 text-emerald-700' },
    cancelled:  { label: 'Cancelled',  cls: 'bg-red-100 text-red-600' },
    returned:   { label: 'Returned',   cls: 'bg-gray-100 text-gray-500' },
  }
  const c = config[status] ?? config.processing
  return (
    <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full', c.cls)}>
      {c.label}
    </span>
  )
}

// ─── Payment Method Icon ──────────────────────────────────────────────────────

function PaymentIcon({ method }: { method: string }) {
  const icons: Record<string, string> = {
    cod: '💵',
    prepaid: '💳',
    upi: '📱',
    card: '💳',
  }
  const labels: Record<string, string> = {
    cod: 'Cash on Delivery',
    prepaid: 'Prepaid',
    upi: 'UPI',
    card: 'Card',
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-gray-500">
      <span>{icons[method] ?? '💳'}</span>
      {labels[method] ?? method}
    </span>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          {title}
        </span>
        {open
          ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
          : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        }
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CustomerSidebar({ customerId, conversation }: CustomerSidebarProps) {
  const [tagInput, setTagInput] = useState('')
  const [localTags, setLocalTags] = useState<string[]>(conversation.tags ?? [])

  const { data: customerData, isLoading: customerLoading } = useQuery<{
    customer: Customer
    orders: Order[]
  }>({
    queryKey: queryKeys.customers.detail(customerId),
    queryFn: async () => {
      const res = await api.get(`/customers/${customerId}`)
      return res.data
    },
    enabled: !!customerId,
  })

  const customer = customerData?.customer ?? conversation.customer
  const orders = customerData?.orders ?? []
  const latestOrder = orders[0]
  const pastOrders = orders.slice(1, 6)

  const LTV_CAP = 50000
  const ltvProgress = Math.min(((customer?.totalSpent ?? 0) / LTV_CAP) * 100, 100)

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim().toLowerCase()
    if (trimmed && !localTags.includes(trimmed)) {
      setLocalTags(prev => [...prev, trimmed])
      api.patch(`/conversations/${conversation.id}/tags`, { tags: [...localTags, trimmed] })
    }
    setTagInput('')
  }, [localTags, conversation.id])

  const removeTag = useCallback((tag: string) => {
    const next = localTags.filter(t => t !== tag)
    setLocalTags(next)
    api.patch(`/conversations/${conversation.id}/tags`, { tags: next })
  }, [localTags, conversation.id])

  if (customerLoading) {
    return (
      <div className="w-[280px] flex-shrink-0 border-l border-gray-200 bg-white animate-pulse">
        <div className="p-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-100 rounded w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="w-[280px] flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">

      {/* ── Section 1: Identity ─────────────────────────── */}
      <Section title="Customer">
        <div className="space-y-3">
          {/* Avatar + name */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-[14px] font-semibold text-violet-700 flex-shrink-0">
              {(customer?.name?.[0] ?? '?').toUpperCase()}
            </div>
            <div>
              <p className="text-[14px] font-semibold text-gray-900">{customer?.name ?? '—'}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {customer && <TierBadge tier={customer.tier} />}
                <span className="text-[11px]">{LANG_FLAGS[customer?.languagePref ?? 'auto']}</span>
              </div>
            </div>
          </div>

          {/* Contact info */}
          <div className="space-y-1.5">
            {customer?.phone && (
              <a
                href={`tel:${customer.phone}`}
                className="flex items-center gap-2 text-[12px] text-gray-600 hover:text-violet-600 transition-colors group"
              >
                <Phone className="w-3.5 h-3.5 text-gray-400 group-hover:text-violet-500" />
                {customer.phone}
              </a>
            )}
            {customer?.email && (
              <a
                href={`mailto:${customer.email}`}
                className="flex items-center gap-2 text-[12px] text-gray-600 hover:text-violet-600 transition-colors group truncate"
              >
                <Mail className="w-3.5 h-3.5 text-gray-400 group-hover:text-violet-500 flex-shrink-0" />
                <span className="truncate">{customer.email}</span>
              </a>
            )}
            {(customer?.city || customer?.state) && (
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                {[customer.city, customer.state].filter(Boolean).join(', ')}
              </div>
            )}
            {customer?.createdAt && (
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                Customer since {new Date(customer.createdAt).getFullYear()}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Section 2: Active Order ──────────────────────── */}
      {latestOrder && (
        <Section title="Active Order">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[13px] font-semibold text-gray-800">
                  #{latestOrder.orderNumber}
                </span>
              </div>
              <OrderStatusBadge status={latestOrder.status} />
            </div>

            {/* Product thumbnails */}
            {latestOrder.items.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {latestOrder.items.slice(0, 4).map((item, i) => (
                  <div
                    key={i}
                    className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0"
                    title={item.name}
                  >
                    {item.imageUrl
                      ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                      : <span className="text-[8px] text-gray-400 text-center px-0.5 leading-tight">{item.name}</span>
                    }
                  </div>
                ))}
                {latestOrder.items.length > 4 && (
                  <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] text-gray-500">
                    +{latestOrder.items.length - 4}
                  </div>
                )}
              </div>
            )}

            {/* Courier + tracking */}
            {latestOrder.courierName && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[12px] text-gray-600">
                  <Truck className="w-3.5 h-3.5 text-gray-400" />
                  {latestOrder.courierName}
                </div>
                {latestOrder.trackingNumber && (
                  <a
                    href={`https://track.delhivery.com/${latestOrder.trackingNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-violet-600 hover:underline flex items-center gap-0.5"
                  >
                    Track <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            )}

            {/* ETA */}
            {latestOrder.estimatedDelivery && (
              <div className="text-[11px] text-gray-500">
                Est. delivery: {new Date(latestOrder.estimatedDelivery).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </div>
            )}

            {/* Value + Payment */}
            <div className="flex items-center justify-between pt-1 border-t border-gray-100">
              <span className="text-[13px] font-semibold text-gray-800">
                ₹{latestOrder.total.toLocaleString('en-IN')}
              </span>
              <PaymentIcon method={latestOrder.paymentMethod} />
            </div>
          </div>
        </Section>
      )}

      {/* ── Section 3: Order History ─────────────────────── */}
      <Section title="Order History" defaultOpen={false}>
        <div className="space-y-3">
          {/* LTV progress */}
          {customer && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-gray-500">Lifetime Value</span>
                <span className="text-[12px] font-semibold text-gray-800">
                  ₹{(customer.totalSpent ?? 0).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${ltvProgress}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="h-full bg-gradient-to-r from-violet-500 to-violet-400 rounded-full"
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[9px] text-gray-400">{customer.totalOrders} orders</span>
                <span className="text-[9px] text-gray-300">₹50k</span>
              </div>
            </div>
          )}

          {/* Timeline */}
          {pastOrders.length > 0 ? (
            <div className="relative pl-4">
              <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-200" />
              {pastOrders.map((order, i) => (
                <div key={order.id} className="relative pb-3 last:pb-0">
                  <div className="absolute -left-2.5 top-1 w-2 h-2 rounded-full bg-white border-2 border-violet-300" />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-gray-700">
                      #{order.orderNumber}
                    </span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[11px] text-gray-400">
                      {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </span>
                    <span className="text-[11px] text-gray-500">₹{order.total.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 text-center py-2">No past orders</p>
          )}
        </div>
      </Section>

      {/* ── Section 4: AI Insights ───────────────────────── */}
      <Section title="AI Insights" defaultOpen={false}>
        <div className="space-y-3">
          {/* Churn risk */}
          {customer?.churnRisk && (
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-gray-600">Churn Risk</span>
              <span className={clsx(
                'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                customer.churnRisk === 'high'   ? 'bg-red-100 text-red-700' :
                customer.churnRisk === 'medium' ? 'bg-amber-100 text-amber-700' :
                                                   'bg-emerald-100 text-emerald-700'
              )}>
                {customer.churnRisk.charAt(0).toUpperCase() + customer.churnRisk.slice(1)}
              </span>
            </div>
          )}

          {/* Sentiment 7d */}
          {customer?.sentiment7d != null && (
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-gray-600">7-day Sentiment</span>
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 text-amber-400" />
                <span className="text-[12px] font-medium text-gray-700">
                  {customer.sentiment7d.toFixed(1)}
                </span>
              </div>
            </div>
          )}

          {/* Product affinity */}
          {customer?.tags && customer.tags.length > 0 && (
            <div>
              <span className="text-[11px] text-gray-500 block mb-1.5">Product Affinity</span>
              <div className="flex flex-wrap gap-1">
                {customer.tags.slice(0, 5).map(tag => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* CLV Score */}
          {customer?.clvScore != null && (
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-gray-600">CLV Score</span>
              <div className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-violet-500" />
                <span className="text-[12px] font-semibold text-violet-700">
                  {customer.clvScore}
                </span>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Section 5: Tags ──────────────────────────────── */}
      <Section title="Tags">
        <div className="space-y-2">
          {/* Tag chips */}
          {localTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {localTags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200"
                >
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="text-gray-400 hover:text-red-500 transition-colors ml-0.5"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Input */}
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addTag(tagInput)
              }
            }}
            placeholder="Add tag, press Enter"
            className="w-full text-[12px] px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 placeholder:text-gray-400 transition-all"
          />
        </div>
      </Section>
    </div>
  )
}
