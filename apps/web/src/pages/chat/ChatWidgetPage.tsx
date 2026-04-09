import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'bot'
  text: string
  createdAt: Date
}

type ChatState = 'name' | 'chat'
type SendState = 'idle' | 'sending' | 'error'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── Send message to parent window ─────────────────────────────────────────────

function notifyParent(type: string, payload?: Record<string, unknown>) {
  try {
    window.parent.postMessage({ type, ...payload }, '*')
  } catch {
    // silently ignore
  }
}

// ─── Message bubble ────────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="mr-2 mt-auto flex-shrink-0">
          <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold select-none">
            S
          </div>
        </div>
      )}
      <div className={`max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div
          className={[
            'px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words',
            isUser
              ? 'bg-indigo-600 text-white rounded-br-sm'
              : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm',
          ].join(' ')}
        >
          {msg.text}
        </div>
        <span className="text-[10px] text-gray-400 px-1">{formatTime(msg.createdAt)}</span>
      </div>
    </div>
  )
}

// ─── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="mr-2 mt-auto flex-shrink-0">
        <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold select-none">
          S
        </div>
      </div>
      <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Name capture screen ───────────────────────────────────────────────────────

function NameScreen({
  onSubmit,
}: {
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-10 text-center gap-5">
      {/* Bot avatar */}
      <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Hi there! 👋</h2>
        <p className="mt-1 text-sm text-gray-500">
          Welcome! What's your name so we can get started?
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs flex flex-col gap-3">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={80}
          autoComplete="name"
          className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start chatting
        </button>
      </form>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function ChatWidgetPage() {
  const [searchParams] = useSearchParams()
  const tenantId = searchParams.get('tenantId') ?? ''

  const [screen, setScreen] = useState<ChatState>('name')
  const [customerName, setCustomerName] = useState('')
  const [sessionId] = useState(() => uid())

  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')
  const [isTyping, setIsTyping] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Track unread messages while widget is closed
  const unreadRef = useRef(0)
  const isVisibleRef = useRef(true)

  // Scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Listen for open/close events from parent
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return
      if (event.data.type === 'sahay:open') {
        isVisibleRef.current = true
        unreadRef.current = 0
        notifyParent('sahay:unread', { count: 0 })
      }
      if (event.data.type === 'sahay:close') {
        isVisibleRef.current = false
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Add incoming bot message and track unread
  const addBotMessage = useCallback((text: string) => {
    const msg: Message = { id: uid(), role: 'bot', text, createdAt: new Date() }
    setMessages((prev) => [...prev, msg])
    if (!isVisibleRef.current) {
      unreadRef.current += 1
      notifyParent('sahay:unread', { count: unreadRef.current })
    }
  }, [])

  // Handle name submission — show greeting then enter chat
  function handleNameSubmit(name: string) {
    setCustomerName(name)
    setScreen('chat')
    // Greeting message
    setTimeout(() => {
      addBotMessage(`Hi ${name}! How can I help you today?`)
    }, 400)
  }

  // Send message to backend
  async function sendMessage(text: string) {
    if (!text.trim() || sendState === 'sending') return

    const userMsg: Message = { id: uid(), role: 'user', text: text.trim(), createdAt: new Date() }
    setMessages((prev) => [...prev, userMsg])
    setDraft('')
    setSendState('sending')
    setIsTyping(true)

    try {
      const res = await fetch('/api/messages/webchat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          sessionId,
          customerName,
          message: text.trim(),
        }),
      })

      setIsTyping(false)

      if (!res.ok) {
        setSendState('error')
        addBotMessage('Sorry, something went wrong. Please try again.')
        return
      }

      const body = await res.json() as { reply?: string }
      setSendState('idle')
      if (body.reply) {
        addBotMessage(body.reply)
      }
    } catch {
      setIsTyping(false)
      setSendState('error')
      addBotMessage('Unable to reach support. Please check your connection.')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void sendMessage(draft)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(draft)
    }
  }

  // Auto-resize textarea
  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }

  if (!tenantId) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 text-sm text-gray-500 p-6 text-center">
        Invalid widget configuration. Please contact support.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-indigo-600 px-4 py-3.5 flex items-center gap-3 shadow-sm">
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">Support</p>
          <p className="text-xs text-indigo-200">Typically replies in minutes</p>
        </div>
        {/* Close button — sends message to parent */}
        <button
          type="button"
          onClick={() => notifyParent('sahay:close')}
          className="text-white/70 hover:text-white transition-colors p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close chat"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      {screen === 'name' ? (
        <NameScreen onSubmit={handleNameSubmit} />
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 scroll-smooth">
            {messages.map((msg) => (
              <Bubble key={msg.id} msg={msg} />
            ))}
            {isTyping && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="flex-shrink-0 border-t border-gray-200 bg-white px-3 py-3">
            <form onSubmit={handleSubmit} className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message…"
                rows={1}
                maxLength={2000}
                className="flex-1 resize-none rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 max-h-[120px] overflow-y-auto"
                style={{ height: 'auto' }}
                disabled={sendState === 'sending'}
              />
              <button
                type="submit"
                disabled={!draft.trim() || sendState === 'sending'}
                aria-label="Send message"
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {sendState === 'sending' ? (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </form>
            <p className="mt-1.5 text-center text-[10px] text-gray-400">
              Powered by{' '}
              <span className="font-medium text-indigo-500">Sahay</span>
            </p>
          </div>
        </>
      )}
    </div>
  )
}
