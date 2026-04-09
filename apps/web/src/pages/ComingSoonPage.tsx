import { useLocation } from 'react-router-dom'
import { Construction } from 'lucide-react'

/**
 * Generic placeholder rendered for routes that are not yet built.
 * Reads the current pathname to display a friendly page title.
 */
export function ComingSoonPage() {
  const { pathname } = useLocation()

  // Convert "/cod-prepaid" → "COD Prepaid"
  const title = pathname
    .replace(/^\//, '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mb-5">
        <Construction className="w-8 h-8 text-violet-400" />
      </div>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">{title}</h1>
      <p className="text-sm text-gray-500 max-w-xs">
        This section is coming soon. We're building it right now — check back shortly.
      </p>
    </div>
  )
}
