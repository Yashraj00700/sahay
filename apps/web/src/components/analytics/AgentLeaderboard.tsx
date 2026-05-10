import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Users } from 'lucide-react'
import type { AgentMetric } from '@sahay/shared'
import { cn } from '../../lib/utils'

type SortKey =
  | 'name'
  | 'conversationsHandled'
  | 'conversationsResolved'
  | 'avgResponseTimeSec'
  | 'avgResolutionTimeSec'
  | 'avgCsat'
  | 'turnCountAvg'
  | 'aiAssistedRate'

interface ColumnDef {
  key: SortKey
  label: string
  align: 'left' | 'right'
  numeric: boolean
}

const COLUMNS: ReadonlyArray<ColumnDef> = [
  { key: 'name', label: 'Agent', align: 'left', numeric: false },
  { key: 'conversationsHandled', label: 'Handled', align: 'right', numeric: true },
  { key: 'conversationsResolved', label: 'Resolved', align: 'right', numeric: true },
  { key: 'avgResponseTimeSec', label: 'Avg 1st Resp', align: 'right', numeric: true },
  { key: 'avgResolutionTimeSec', label: 'Avg Resolution', align: 'right', numeric: true },
  { key: 'avgCsat', label: 'CSAT', align: 'right', numeric: true },
  { key: 'turnCountAvg', label: 'Avg Turns', align: 'right', numeric: true },
  { key: 'aiAssistedRate', label: 'AI Assisted', align: 'right', numeric: true },
]

function formatSeconds(sec: number | null): string {
  if (sec === null) return '—'
  if (sec >= 60) {
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return `${m}m ${s}s`
  }
  return `${Math.round(sec)}s`
}

function formatDecimal(v: number | null, digits = 1): string {
  if (v === null) return '—'
  return v.toFixed(digits)
}

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`
}

interface AgentLeaderboardProps {
  data: ReadonlyArray<AgentMetric>
  isLoading: boolean
}

export function AgentLeaderboard({ data, isLoading }: AgentLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('conversationsHandled')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const arr = [...data]
    arr.sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      // null → bottom regardless of direction
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      }
      const na = Number(va)
      const nb = Number(vb)
      return sortDir === 'asc' ? na - nb : nb - na
    })
    return arr
  }, [data, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-text-secondary" />
          <h3 className="text-sm font-semibold text-text-primary">Agent Leaderboard</h3>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-border/40 rounded animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center">
        <Users className="w-8 h-8 text-text-secondary/50 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-text-primary">No agent activity yet</h3>
        <p className="text-xs text-text-secondary mt-1">
          Once your team handles conversations in this date range, their metrics will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Users className="w-4 h-4 text-text-secondary" />
        <h3 className="text-sm font-semibold text-text-primary">Agent Leaderboard</h3>
        <span className="text-xs text-text-secondary ml-auto">{data.length} agent{data.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background/40 text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-2.5 font-medium select-none cursor-pointer hover:bg-background/80',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                  onClick={() => toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.agentId} className="border-t border-border hover:bg-background/30">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-text-primary">{m.name}</div>
                  <div className="text-xs text-text-secondary capitalize">{m.role.replace('_', ' ')}</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
                  {m.conversationsHandled.toLocaleString('en-IN')}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
                  {m.conversationsResolved.toLocaleString('en-IN')}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
                  {formatSeconds(m.avgResponseTimeSec)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
                  {formatSeconds(m.avgResolutionTimeSec)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {m.avgCsat !== null ? (
                    <span className="text-text-primary">
                      {formatDecimal(m.avgCsat, 1)}
                      <span className="text-xs text-text-secondary"> ({m.csatCount})</span>
                    </span>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
                  {formatDecimal(m.turnCountAvg, 1)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
                  {formatPct(m.aiAssistedRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
