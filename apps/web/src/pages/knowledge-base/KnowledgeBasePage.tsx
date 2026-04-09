import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Plus, BookOpen, Globe, Clock,
  RefreshCw, X, Loader2, Trash2, Pencil,
  FileText, BarChart2, CheckCircle, XCircle,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

// ─── Types (aligned with API schema) ─────────────────────────────────────────

interface KBArticle {
  id: string
  title: string
  slug: string
  language: string
  category: string | null
  tags: string[]
  isPublished: boolean
  isAiGenerated: boolean
  createdAt: string
  updatedAt: string
  // Only present when fetching a single article
  content?: string
  chunks?: KBChunk[]
}

interface KBChunk {
  id: string
  chunkIndex: number
  chunkType: string
  content: string
  language: string
  isActive: boolean
  retrievalCount: number
  lastUpdated: string
}

interface KBArticleDetail extends KBArticle {
  content: string
  chunks: KBChunk[]
}

interface KBListResponse {
  data: KBArticle[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}

interface KBStats {
  totalArticles: number
  publishedCount: number
  lastUpdated: string | null
}

interface ArticleFormData {
  title: string
  slug: string
  content: string
  language: string
  category: string
  isPublished: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor(diff / 60_000)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 200)
}

// ─── Stats Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-primary bg-primary/10',
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">{label}</span>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', color)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="text-3xl font-bold text-text-primary tabular-nums">{value}</div>
      {sub && <p className="text-xs text-text-secondary">{sub}</p>}
    </div>
  )
}

// ─── Article Row ──────────────────────────────────────────────────────────────

function ArticleRow({
  article,
  onEdit,
  onDelete,
  isDeleting,
}: {
  article: KBArticle
  onEdit: (a: KBArticle) => void
  onDelete: (id: string) => void
  isDeleting: boolean
}) {
  return (
    <tr className="group hover:bg-surface/60 transition-colors border-b border-border last:border-0">
      {/* Title */}
      <td className="px-4 py-3.5 max-w-0 w-full">
        <button
          onClick={() => onEdit(article)}
          className="text-left w-full min-w-0"
        >
          <p className="text-sm font-medium text-text-primary truncate hover:text-primary transition-colors">
            {article.title}
          </p>
          {article.category && (
            <p className="text-xs text-text-secondary truncate mt-0.5">{article.category}</p>
          )}
        </button>
      </td>

      {/* Language */}
      <td className="px-4 py-3.5 whitespace-nowrap">
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Globe className="w-3 h-3 flex-shrink-0" />
          {article.language === 'en' ? 'English' : article.language === 'hi' ? 'Hindi' : article.language === 'hinglish' ? 'Hinglish' : article.language.toUpperCase()}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5 whitespace-nowrap">
        {article.isPublished ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            <CheckCircle className="w-3 h-3" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary bg-border/60 px-2 py-0.5 rounded-full">
            <XCircle className="w-3 h-3" />
            Inactive
          </span>
        )}
      </td>

      {/* Chunks — only when article detail has chunks; otherwise show dash */}
      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-text-secondary">
        <span className="flex items-center gap-1">
          <BarChart2 className="w-3 h-3" />
          {article.chunks ? article.chunks.filter(c => c.isActive).length : '—'}
        </span>
      </td>

      {/* Last updated */}
      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-text-secondary">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo(article.updatedAt)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3.5 whitespace-nowrap">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
          <button
            onClick={() => onEdit(article)}
            className="p-1.5 rounded hover:bg-primary/10 hover:text-primary text-text-secondary transition-colors"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(article.id)}
            disabled={isDeleting}
            className="p-1.5 rounded hover:bg-red-50 hover:text-red-600 text-text-secondary transition-colors disabled:opacity-40"
            title="Delete (soft)"
          >
            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Article Editor Modal ─────────────────────────────────────────────────────

function ArticleModal({
  articleId,
  onClose,
}: {
  articleId: string | 'new'
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isNew = articleId === 'new'

  // Fetch full article detail (includes content) when editing
  const { data: existing, isLoading: loadingDetail } = useQuery<KBArticleDetail>({
    queryKey: ['kb', 'article', articleId],
    queryFn: () => api.get<KBArticleDetail>(`/kb/articles/${articleId}`).then(r => r.data),
    enabled: !isNew,
    staleTime: 0,
  })

  const [form, setForm] = useState<ArticleFormData>({
    title: '',
    slug: '',
    content: '',
    language: 'en',
    category: '',
    isPublished: false,
  })

  // Populate form once existing data loads
  const [seeded, setSeeded] = useState(false)
  if (existing && !seeded) {
    setForm({
      title: existing.title,
      slug: existing.slug,
      content: existing.content ?? '',
      language: existing.language,
      category: existing.category ?? '',
      isPublished: existing.isPublished,
    })
    setSeeded(true)
  }

  const handleTitleChange = useCallback((val: string) => {
    setForm(f => ({
      ...f,
      title: val,
      // Auto-generate slug only for new articles, and only if user hasn't manually edited it
      slug: isNew ? slugify(val) : f.slug,
    }))
  }, [isNew])

  const saveMutation = useMutation({
    mutationFn: async (data: ArticleFormData) => {
      if (isNew) {
        return api.post('/kb/articles', data).then(r => r.data)
      } else {
        return api.patch(`/kb/articles/${articleId}`, data).then(r => r.data)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/kb/articles/${articleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb'] })
      onClose()
    },
  })

  const isValid = form.title.trim().length > 0 && form.content.trim().length > 0 && form.slug.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-background border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold text-text-primary">
            {isNew ? 'Add knowledge article' : 'Edit article'}
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {!isNew && loadingDetail ? (
          <div className="flex-1 flex items-center justify-center p-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* Title */}
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder="e.g. Returns & Refund Policy"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            {/* Slug */}
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Slug *</label>
              <input
                type="text"
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                placeholder="returns-refund-policy"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary font-mono"
              />
            </div>

            {/* Language + Category */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Language</label>
                <select
                  value={form.language}
                  onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="hinglish">Hinglish</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Category (optional)</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Shipping, Serums"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            {/* Status toggle */}
            <div className="flex items-center justify-between py-2 px-3 bg-surface border border-border rounded-lg">
              <div>
                <p className="text-sm font-medium text-text-primary">Published</p>
                <p className="text-xs text-text-secondary mt-0.5">Active articles are used for AI retrieval</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.isPublished}
                onClick={() => setForm(f => ({ ...f, isPublished: !f.isPublished }))}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30',
                  form.isPublished ? 'bg-primary' : 'bg-border',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                    form.isPublished ? 'translate-x-6' : 'translate-x-1',
                  )}
                />
              </button>
            </div>

            {/* Content */}
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Content *</label>
              <textarea
                rows={12}
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Write the article content here. This will be auto-chunked and embedded for AI retrieval."
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none font-mono"
              />
              <p className="text-xs text-text-secondary mt-1">{form.content.length} characters</p>
            </div>

            {/* Chunks preview (edit mode only) */}
            {!isNew && existing?.chunks && existing.chunks.length > 0 && (
              <div>
                <label className="text-xs font-medium text-text-secondary mb-2 block">
                  Embedded Chunks ({existing.chunks.filter(c => c.isActive).length} active)
                </label>
                <div className="space-y-2">
                  {existing.chunks.map(chunk => (
                    <div
                      key={chunk.id}
                      className="px-3 py-2 bg-surface border border-border rounded-lg text-xs text-text-secondary"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-text-primary">#{chunk.chunkIndex + 1}</span>
                        <span className="uppercase opacity-60">{chunk.chunkType}</span>
                        <span className={cn('ml-auto', chunk.isActive ? 'text-emerald-600' : 'text-border')}>
                          {chunk.isActive ? 'active' : 'inactive'}
                        </span>
                        <span>{chunk.retrievalCount} hits</span>
                      </div>
                      <p className="line-clamp-2 leading-relaxed">{chunk.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            {!isNew && (
              <button
                onClick={() => {
                  if (window.confirm('Soft-delete this article? It will be unpublished and its chunks deactivated.')) {
                    deleteMutation.mutate()
                  }
                }}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {saveMutation.isError && (
              <p className="text-xs text-red-500">Save failed — check console</p>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => saveMutation.mutate(form)}
              disabled={!isValid || saveMutation.isPending || loadingDetail}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isNew ? 'Add article' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'unpublished', label: 'Unpublished' },
] as const

type StatusFilter = 'all' | 'published' | 'unpublished'

export function KnowledgeBasePage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [modalArticleId, setModalArticleId] = useState<string | 'new' | null>(null)

  // Debounce search to avoid firing on every keystroke
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val)
    clearTimeout((handleSearchChange as any)._t)
    ;(handleSearchChange as any)._t = setTimeout(() => {
      setDebouncedSearch(val)
      setPage(1)
    }, 300)
  }, [])

  // Stats
  const { data: stats } = useQuery<KBStats>({
    queryKey: ['kb', 'stats'],
    queryFn: () => api.get<KBStats>('/kb/stats').then(r => r.data),
    staleTime: 30_000,
  })

  // Article list
  const { data: listData, isLoading, isFetching } = useQuery<KBListResponse>({
    queryKey: ['kb', 'articles', { page, search: debouncedSearch, status: statusFilter }],
    queryFn: () =>
      api.get<KBListResponse>('/kb/articles', {
        params: {
          page,
          pageSize: 20,
          search: debouncedSearch || undefined,
          status: statusFilter,
        },
      }).then(r => r.data),
    staleTime: 30_000,
    placeholderData: prev => prev,
  })

  const articles = listData?.data ?? []
  const pagination = listData?.pagination

  const deletingIds = new Set<string>()

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/kb/articles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb'] })
    },
  })

  const TABLE_HEADERS = ['Title', 'Language', 'Status', 'Chunks', 'Last Updated', '']

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* ── Page header ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Knowledge Base</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              Articles embedded for AI retrieval — edit, add, or remove content the AI knows about
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['kb'] })}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors"
              title="Refresh"
            >
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setModalArticleId('new')}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Article
            </button>
          </div>
        </div>

        {/* ── Stats cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={FileText}
            label="Total Articles"
            value={stats?.totalArticles ?? '—'}
            sub={stats ? `${stats.publishedCount} published` : undefined}
            color="text-primary bg-primary/10"
          />
          <StatCard
            icon={BarChart2}
            label="Published"
            value={stats?.publishedCount ?? '—'}
            sub={stats && stats.totalArticles > 0
              ? `${Math.round((stats.publishedCount / stats.totalArticles) * 100)}% of total`
              : undefined}
            color="text-emerald-600 bg-emerald-50"
          />
          <StatCard
            icon={Clock}
            label="Last Sync"
            value={stats?.lastUpdated ? timeAgo(stats.lastUpdated) : '—'}
            sub={stats?.lastUpdated
              ? new Date(stats.lastUpdated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
              : 'No articles yet'}
            color="text-amber-600 bg-amber-50"
          />
        </div>

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search articles…"
              className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(1) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <div className="flex bg-surface border border-border rounded-lg p-1 gap-0.5">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setStatusFilter(opt.value); setPage(1) }}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-colors',
                  statusFilter === opt.value
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {pagination && (
            <span className="text-xs text-text-secondary ml-auto">
              {pagination.total} article{pagination.total !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ── Table ── */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="space-y-0 divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse bg-surface" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
              <BookOpen className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No articles found</p>
              {(search || statusFilter !== 'all') && (
                <button
                  onClick={() => { setSearch(''); setDebouncedSearch(''); setStatusFilter('all'); setPage(1) }}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Clear filters
                </button>
              )}
              {!search && statusFilter === 'all' && (
                <button
                  onClick={() => setModalArticleId('new')}
                  className="mt-3 flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <Plus className="w-4 h-4" />
                  Add your first article
                </button>
              )}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface">
                  {TABLE_HEADERS.map((h, i) => (
                    <th
                      key={i}
                      className={cn(
                        'px-4 py-2.5 text-xs font-medium text-text-secondary uppercase tracking-wide text-left',
                        i === 0 && 'w-full',
                        i === TABLE_HEADERS.length - 1 && 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {articles.map(article => (
                  <ArticleRow
                    key={article.id}
                    article={article}
                    onEdit={a => setModalArticleId(a.id)}
                    onDelete={id => {
                      if (window.confirm('Soft-delete this article? It will be unpublished and its chunks deactivated.')) {
                        deleteMutation.mutate(id)
                      }
                    }}
                    isDeleting={deleteMutation.isPending && deleteMutation.variables === article.id}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-secondary">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => p - 1)}
                disabled={!pagination.hasPreviousPage}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!pagination.hasNextPage}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── Article Modal ── */}
      {modalArticleId !== null && (
        <ArticleModal
          articleId={modalArticleId}
          onClose={() => setModalArticleId(null)}
        />
      )}
    </div>
  )
}
