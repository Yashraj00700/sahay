import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmptyInboxStateProps {
  aiResolvedCount?: number
  showConfetti?: boolean
}

// ─── Inline SVG: Indian Postman on Bicycle ────────────────────────────────────

function PostmanSVG() {
  return (
    <svg
      viewBox="0 0 200 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-48 h-auto"
    >
      {/* Rear wheel */}
      <circle cx="60" cy="140" r="28" stroke="#c4b5fd" strokeWidth="4" fill="none" />
      <circle cx="60" cy="140" r="4" fill="#7c3aed" />
      {[0,45,90,135].map(deg => (
        <line
          key={deg}
          x1="60" y1="140"
          x2={60 + 24 * Math.cos(deg * Math.PI / 180)}
          y2={140 + 24 * Math.sin(deg * Math.PI / 180)}
          stroke="#c4b5fd" strokeWidth="2"
        />
      ))}

      {/* Front wheel */}
      <circle cx="140" cy="140" r="28" stroke="#c4b5fd" strokeWidth="4" fill="none" />
      <circle cx="140" cy="140" r="4" fill="#7c3aed" />
      {[0,45,90,135].map(deg => (
        <line
          key={deg}
          x1="140" y1="140"
          x2={140 + 24 * Math.cos(deg * Math.PI / 180)}
          y2={140 + 24 * Math.sin(deg * Math.PI / 180)}
          stroke="#c4b5fd" strokeWidth="2"
        />
      ))}

      {/* Frame */}
      {/* Down tube */}
      <line x1="88" y1="100" x2="60" y2="140" stroke="#7c3aed" strokeWidth="3.5" strokeLinecap="round" />
      {/* Seat tube */}
      <line x1="88" y1="100" x2="95" y2="128" stroke="#7c3aed" strokeWidth="3.5" strokeLinecap="round" />
      {/* Chain stay */}
      <line x1="60" y1="140" x2="95" y2="128" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" />
      {/* Top tube */}
      <line x1="88" y1="100" x2="130" y2="100" stroke="#7c3aed" strokeWidth="3.5" strokeLinecap="round" />
      {/* Fork */}
      <line x1="130" y1="100" x2="140" y2="140" stroke="#7c3aed" strokeWidth="3.5" strokeLinecap="round" />

      {/* Handlebar */}
      <line x1="130" y1="100" x2="136" y2="88" stroke="#4c1d95" strokeWidth="3" strokeLinecap="round" />
      <line x1="133" y1="86" x2="142" y2="86" stroke="#4c1d95" strokeWidth="3" strokeLinecap="round" />

      {/* Seat */}
      <line x1="95" y1="128" x2="90" y2="96" stroke="#4c1d95" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="87" cy="95" rx="10" ry="4" fill="#4c1d95" />

      {/* Rider body */}
      {/* Torso */}
      <path d="M96 95 C100 80 118 76 124 88" stroke="#6B4EFF" strokeWidth="8" strokeLinecap="round" fill="none" />
      {/* Arm to handlebar */}
      <line x1="118" y1="80" x2="136" y2="86" stroke="#6B4EFF" strokeWidth="5" strokeLinecap="round" />

      {/* Leg */}
      <path d="M96 95 L92 115 L80 112" stroke="#6B4EFF" strokeWidth="5" strokeLinecap="round" fill="none" />

      {/* Head */}
      <circle cx="120" cy="70" r="14" fill="#fde68a" />
      {/* Cap */}
      <path d="M106 68 Q120 58 134 68" fill="#6B4EFF" stroke="none" />
      <rect x="104" y="66" width="32" height="5" rx="2.5" fill="#6B4EFF" />
      <rect x="101" y="69" width="6" height="3" rx="1.5" fill="#4c1d95" />

      {/* Smile */}
      <path d="M115 75 Q120 79 125 75" stroke="#92400e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Eyes */}
      <circle cx="117" cy="71" r="1.5" fill="#92400e" />
      <circle cx="123" cy="71" r="1.5" fill="#92400e" />

      {/* Mail bag on back rack */}
      <rect x="60" y="110" width="20" height="14" rx="3" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5" />
      <line x1="60" y1="117" x2="80" y2="117" stroke="#f59e0b" strokeWidth="1" />
      {/* Envelope icon on bag */}
      <path d="M64 113 L70 117 L76 113" stroke="#92400e" strokeWidth="1" fill="none" />

      {/* Motion lines */}
      <line x1="25" y1="100" x2="42" y2="100" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3" />
      <line x1="20" y1="115" x2="38" y2="115" stroke="#ddd6fe" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" />
      <line x1="28" y1="128" x2="40" y2="128" stroke="#ddd6fe" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" />
    </svg>
  )
}

// ─── CSS Confetti ─────────────────────────────────────────────────────────────

function ConfettiPiece({ i }: { i: number }) {
  const colors = ['#6B4EFF', '#a78bfa', '#f59e0b', '#10b981', '#f43f5e', '#3b82f6']
  const color = colors[i % colors.length]
  const left = `${(i * 13 + 5) % 100}%`
  const delay = `${(i * 0.15) % 1.5}s`
  const duration = `${1.2 + (i % 5) * 0.2}s`
  const size = i % 3 === 0 ? 8 : 5

  return (
    <motion.div
      initial={{ y: -20, opacity: 1, rotate: 0 }}
      animate={{ y: 300, opacity: 0, rotate: 360 * (i % 2 === 0 ? 1 : -1) }}
      transition={{ duration: parseFloat(duration), delay: parseFloat(delay), ease: 'easeIn' }}
      className="absolute"
      style={{ left, top: '-10px', width: size, height: size, backgroundColor: color, borderRadius: i % 2 === 0 ? '50%' : '2px' }}
    />
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EmptyInboxState({ aiResolvedCount = 12, showConfetti = false }: EmptyInboxStateProps) {
  const [isFirstTime] = useState(() => {
    if (typeof window === 'undefined') return false
    const seen = localStorage.getItem('sahay_inbox_empty_seen')
    if (!seen) {
      localStorage.setItem('sahay_inbox_empty_seen', '1')
      return true
    }
    return false
  })

  const shouldShowConfetti = showConfetti || isFirstTime

  return (
    <div className="relative flex flex-col items-center justify-center h-full py-12 px-6 bg-gradient-to-b from-[#F8F7FF] to-white overflow-hidden">

      {/* Confetti */}
      {shouldShowConfetti && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 20 }).map((_, i) => (
            <ConfettiPiece key={i} i={i} />
          ))}
        </div>
      )}

      {/* Illustration */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="mb-6"
      >
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <PostmanSVG />
        </motion.div>
      </motion.div>

      {/* Copy */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-center"
      >
        <h3 className="text-[15px] font-semibold text-gray-800 mb-1">
          Your inbox is empty.
        </h3>
        <p className="text-[14px] text-violet-600 font-medium mb-3">
          Sahay handled the rest.
        </p>
        <p className="text-[12px] text-gray-400 leading-relaxed">
          AI resolved{' '}
          <span className="font-semibold text-gray-600">{aiResolvedCount} conversations</span>
          {' '}today without you.
        </p>
      </motion.div>

      {/* Decoration dots */}
      <div className="absolute bottom-6 flex gap-1.5">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full bg-violet-300"
          />
        ))}
      </div>
    </div>
  )
}
