import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes safely — combines clsx (conditional classes) with
 * tailwind-merge (deduplication of conflicting Tailwind utilities).
 *
 * Example:
 *   cn('px-4 py-2', isActive && 'bg-primary text-white', 'py-3')
 *   → 'px-4 py-3 bg-primary text-white'  (py-2 overridden by py-3)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
