import { useState } from 'react'
import { ChevronDown, ChevronUp, Keyboard } from 'lucide-react'
import clsx from 'clsx'

const SHORTCUTS = [
  { key: 'R', description: 'Reply — focus composer' },
  { key: 'E', description: 'Escalate — route to senior' },
  { key: 'N', description: 'Next conversation' },
  { key: 'C', description: 'Close / resolve' },
  { key: 'Esc', description: 'Blur current input' },
]

export function KeyboardShortcutsPanel() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border-t border-gray-100 mt-auto">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Keyboard className="w-3.5 h-3.5" />
          <span className="font-medium">Shortcuts</span>
        </div>
        {isOpen
          ? <ChevronUp className="w-3.5 h-3.5" />
          : <ChevronDown className="w-3.5 h-3.5" />
        }
      </button>

      {isOpen && (
        <div className="px-4 pb-3 space-y-1.5">
          {SHORTCUTS.map(({ key, description }) => (
            <div key={key} className="flex items-center gap-2.5">
              <kbd className="inline-flex items-center justify-center min-w-[28px] h-5 px-1.5 rounded bg-gray-100 border border-gray-200 text-[10px] font-mono text-gray-600 font-medium">
                {key}
              </kbd>
              <span className="text-[11px] text-gray-500">{description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
