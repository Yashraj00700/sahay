// ─── Currency (INR) ───────────────────────────────────────────
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function parseINR(str: string): number {
  return parseFloat(str.replace(/[₹,\s]/g, ''))
}

// ─── Phone Numbers ────────────────────────────────────────────
export function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')
  // Already has country code (11+ digits)
  if (digits.length >= 11) return `+${digits}`
  // 10-digit Indian number — only prepend +91 if explicitly Indian context
  if (digits.length === 10) return `+91${digits}`
  // Return as-is with + prefix
  return `+${digits}`
}

// Keep backward compat alias
export const normalizeIndianPhone = normalizePhone

export function parseWhatsAppPhone(waPhone: string): string {
  // WhatsApp sends phones without + prefix: "919876543210"
  const digits = waPhone.replace(/\D/g, '')
  return `+${digits}`
}

export function formatIndianPhone(phone: string): string {
  const normalized = normalizeIndianPhone(phone)
  // Format: +91 98765 43210
  if (normalized.startsWith('+91') && normalized.length === 13) {
    return `+91 ${normalized.slice(3, 8)} ${normalized.slice(8)}`
  }
  return normalized
}

export function isValidIndianPhone(phone: string): boolean {
  const normalized = normalizeIndianPhone(phone)
  return /^\+91[6-9]\d{9}$/.test(normalized)
}

// ─── Date & Time (IST) ────────────────────────────────────────
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function formatISTDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatISTTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

// ─── String Utils ─────────────────────────────────────────────
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

// Deterministic pastel color from name (for customer avatars)
export function getAvatarColor(name: string): string {
  const colors = [
    '#FFB3B3', '#FFCBA4', '#FFE4A0', '#B8F0A0',
    '#A0E4FF', '#C4B5FD', '#FBCFE8', '#FDE68A',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

// ─── Channel Utils ────────────────────────────────────────────
export function getChannelLabel(channel: string): string {
  const labels: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    webchat: 'Web Chat',
    email: 'Email',
  }
  return labels[channel] ?? channel
}

export function getChannelColor(channel: string): string {
  const colors: Record<string, string> = {
    whatsapp: '#25D366',
    instagram: '#E1306C',
    webchat: '#6B4EFF',
    email: '#6B7280',
  }
  return colors[channel] ?? '#6B7280'
}

// ─── Sentiment Utils ──────────────────────────────────────────
export function getSentimentEmoji(sentiment: string): string {
  const emojis: Record<string, string> = {
    very_negative: '😠',
    negative: '😟',
    neutral: '😐',
    positive: '😊',
    very_positive: '😄',
  }
  return emojis[sentiment] ?? '😐'
}

// ─── Customer Tier ────────────────────────────────────────────
export function getTierLabel(tier: string): string {
  const labels: Record<string, string> = {
    new: 'New',
    loyal: 'Loyal',
    vip: 'VIP',
  }
  return labels[tier] ?? tier
}

export function getTierIcon(tier: string): string {
  const icons: Record<string, string> = {
    new: '●',
    loyal: '⭐',
    vip: '👑',
  }
  return icons[tier] ?? '●'
}
