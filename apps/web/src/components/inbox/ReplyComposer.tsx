import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, Smile, Send, Hash } from 'lucide-react'
import clsx from 'clsx'
import type { Channel } from '@sahay/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CannedResponse {
  shortcut: string
  title: string
  content: string
}

interface ReplyComposerProps {
  conversationId: string
  channel: Channel
  onSend: (content: string) => void
  customerName?: string
}

// ─── Fake canned responses for demo ──────────────────────────────────────────

const CANNED_RESPONSES: CannedResponse[] = [
  { shortcut: '/greet',   title: 'Greeting',          content: 'Hello! Thank you for reaching out to us. How can I help you today?' },
  { shortcut: '/order',   title: 'Order Status',       content: 'I can help you check your order status. Could you please share your order number?' },
  { shortcut: '/delay',   title: 'Delivery Delay',     content: 'We sincerely apologise for the delay in your delivery. Our team is working on it and you will receive your order shortly.' },
  { shortcut: '/return',  title: 'Return Policy',      content: 'We offer a 7-day easy return policy. Please visit our website or share the product details to initiate a return.' },
  { shortcut: '/thanks',  title: 'Thank You',          content: 'Thank you for your patience and understanding. Is there anything else I can help you with?' },
  { shortcut: '/resolve', title: 'Issue Resolved',     content: 'I am glad we could resolve your issue today! Please feel free to reach out if you need any further assistance.' },
]

// WA templates are 1024 chars; other channels can be longer
const CHAR_LIMITS: Record<Channel, number | null> = {
  whatsapp:  1024,
  instagram: null,
  webchat:   null,
  email:     null,
}

// ─── Channel Badge ────────────────────────────────────────────────────────────

function ChannelBadge({ channel }: { channel: Channel }) {
  const config = {
    whatsapp:  { label: 'WhatsApp',  cls: 'bg-green-100 text-green-700 border-green-200' },
    instagram: { label: 'Instagram', cls: 'bg-pink-100 text-pink-700 border-pink-200' },
    webchat:   { label: 'Web Chat',  cls: 'bg-violet-100 text-violet-700 border-violet-200' },
    email:     { label: 'Email',     cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  }[channel]

  return (
    <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded border', config.cls)}>
      {config.label}
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ReplyComposer({ conversationId, channel, onSend, customerName }: ReplyComposerProps) {
  const [value, setValue] = useState('')
  const [showCannedMenu, setShowCannedMenu] = useState(false)
  const [cannedSearch, setCannedSearch] = useState('')
  const [cannedIndex, setCannedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const charLimit = CHAR_LIMITS[channel]

  const placeholder = customerName
    ? `Reply to ${customerName.split(' ')[0]}… (⌘ Enter to send)`
    : 'Write a reply… (⌘ Enter to send)'

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 20
    const maxHeight = lineHeight * 5 + 24 // 5 lines + padding
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [value])

  const filteredCanned = CANNED_RESPONSES.filter(c =>
    c.shortcut.includes(cannedSearch) || c.title.toLowerCase().includes(cannedSearch.toLowerCase())
  )

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)

    // Detect "/" trigger for canned responses
    const lastSlashIdx = v.lastIndexOf('/')
    if (lastSlashIdx !== -1 && (lastSlashIdx === 0 || v[lastSlashIdx - 1] === '\n')) {
      const query = v.slice(lastSlashIdx + 1)
      setCannedSearch(query)
      setShowCannedMenu(true)
      setCannedIndex(0)
    } else {
      setShowCannedMenu(false)
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+Enter sends
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
      return
    }

    if (showCannedMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCannedIndex(i => Math.min(i + 1, filteredCanned.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCannedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertCanned(filteredCanned[cannedIndex])
      } else if (e.key === 'Escape') {
        setShowCannedMenu(false)
      }
    }
  }, [showCannedMenu, filteredCanned, cannedIndex, value])

  const insertCanned = useCallback((canned: CannedResponse) => {
    if (!canned) return
    const lastSlashIdx = value.lastIndexOf('/')
    const newValue = value.slice(0, lastSlashIdx) + canned.content
    setValue(newValue)
    setShowCannedMenu(false)
    textareaRef.current?.focus()
  }, [value])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed)
    setValue('')
  }, [value, onSend])

  const remaining = charLimit ? charLimit - value.length : null
  const overLimit = remaining !== null && remaining < 0

  return (
    <div className="relative border-t border-gray-200 bg-white">

      {/* ── Canned responses menu ───────────────────────────── */}
      <AnimatePresence>
        {showCannedMenu && filteredCanned.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 right-0 mb-1 mx-3 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden z-50"
          >
            <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1.5">
              <Hash className="w-3 h-3 text-gray-400" />
              <span className="text-[11px] text-gray-400">Canned responses</span>
            </div>
            {filteredCanned.map((c, i) => (
              <button
                key={c.shortcut}
                onClick={() => insertCanned(c)}
                className={clsx(
                  'w-full text-left px-3 py-2 transition-colors',
                  i === cannedIndex ? 'bg-violet-50' : 'hover:bg-gray-50'
                )}
              >
                <div className="flex items-center gap-2">
                  <code className="text-[11px] text-violet-600 font-mono bg-violet-50 px-1 rounded">
                    {c.shortcut}
                  </code>
                  <span className="text-[12px] text-gray-700 font-medium">{c.title}</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5 truncate">{c.content}</p>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Top bar: channel + char count ──────────────────── */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <ChannelBadge channel={channel} />

        {remaining !== null && value.length > 0 && (
          <span className={clsx('text-[10px] font-medium', overLimit ? 'text-red-500' : 'text-gray-400')}>
            {remaining} remaining
          </span>
        )}
      </div>

      {/* ── Textarea ───────────────────────────────────────── */}
      <div className="px-3 pb-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className={clsx(
            'w-full resize-none bg-transparent text-[13px] text-gray-900 placeholder:text-gray-400',
            'outline-none leading-relaxed overflow-hidden',
            overLimit && 'text-red-600'
          )}
          style={{ minHeight: '44px', maxHeight: '120px' }}
        />
      </div>

      {/* ── Action bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 pb-3">
        <div className="flex items-center gap-1">
          {/* Emoji */}
          <button
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Emoji"
          >
            <Smile className="w-4 h-4" />
          </button>

          {/* Attach */}
          <button
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Canned responses */}
          <button
            onClick={() => {
              setValue(v => v + '/')
              setShowCannedMenu(true)
              setCannedSearch('')
              textareaRef.current?.focus()
            }}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Canned responses (/)"
          >
            <Hash className="w-4 h-4" />
          </button>
        </div>

        {/* Send button */}
        <div className="flex items-center gap-2">
          <kbd className="hidden sm:inline text-[10px] text-gray-300 font-mono">⌘↵</kbd>
          <button
            onClick={handleSend}
            disabled={!value.trim() || overLimit}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-medium transition-all',
              value.trim() && !overLimit
                ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm shadow-violet-200'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
