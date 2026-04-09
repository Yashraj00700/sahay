import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Plus, FileText, Cpu, ShoppingBag,
  BookOpen, HelpCircle, Filter, X, Loader2,
  Pencil, Trash2, ChevronRight, Globe, Clock,
  RefreshCw, BarChart2,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KBArticle {
  id: string
  title: string
  content: string
  sourceType: 'product' | 'faq' | 'policy' | 'brand' | 'shopify'
  category: string | null
  language: string
  chunkCount: number
  lastUpdated: string
  isActive: boolean
  retrievalCount: number
}

type FilterType = 'all' | 'product' | 'faq' | 'policy' | 'brand'

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_ARTICLES: KBArticle[] = [
  {
    id: '1', title: 'Rose Hip Face Oil — Ingredients & Usage',
    content: 'RAS Rose Hip Face Oil is a lightweight, non-greasy face oil...',
    sourceType: 'product', category: 'Oils', language: 'en',
    chunkCount: 4, lastUpdated: '2026-04-05T10:00:00Z', isActive: true, retrievalCount: 245,
  },
  {
    id: '2', title: 'Returns & Refund Policy',
    content: 'We accept returns within 7 days of delivery for unopened products...',
    sourceType: 'policy', category: 'Policies', language: 'en',
    chunkCount: 2, lastUpdated: '2026-03-20T10:00:00Z', isActive: true, retrievalCount: 189,
  },
  {
    id: '3', title: 'Shipping & Delivery — FAQ',
    content: 'Orders are shipped within 1-2 business days. COD available...',
    sourceType: 'faq', category: 'Shipping', language: 'en',
    chunkCount: 3, lastUpdated: '2026-04-01T10:00:00Z', isActive: true, retrievalCount: 312,
  },
  {
    id: '4', title: 'Vitamin C Brightening Serum — Skincare Routine',
    content: 'The Vitamin C Brightening Serum works best on cleansed skin...',
    sourceType: 'product', category: 'Serums', language: 'en',
    chunkCount: 5, lastUpdated: '2026-04-06T10:00:00Z', isActive: true, retrievalCount: 178,
  },
  {
    id: '5', title: 'About RAS Luxury Oils',
    content: 'RAS is a luxury skincare brand founded by Shubhika Jain...',
    sourceType: 'brand', category: 'Brand', language: 'en',
    chunkCount: 2, lastUpdated: '2026-02-10T10:00:00Z', isActive: true, retrievalCount: 67,
  },
  {
    id: '6', title: 'COD to Prepaid Conversion FAQ',
    content: 'You can switch your COD order to prepaid within 24 hours...',
    sourceType: 'faq', category: 'Payments', language: 'en',
    chunkCount: 2, lastUpdated: '2026-03-15T10:00:00Z', isActive: true, retrievalCount: 143,
  },
  {
    id: '7', title: 'Scalp & Hair Oil — Usage Guide',
    content: 'Apply the scalp oil to dry or damp scalp, section by section...',
    sourceType: 'product', category: 'Hair Care', language: 'en',
    chunkCount: 3, lastUpdated: '2026-04-03T10:00:00Z', isActive: true, retrievalCount: 94,
  },
  {
    id: '8', title: 'Ingredient Glossary',
    content: 'Bakuchiol: Plant-based retinol alternative. Suitable for sensitive skin...',
    sourceType: 'brand', category: 'Ingredients', language: 'en',
    chunkCount: 8, lastUpdated: '2026-03-25T10:00:00Z', isActive: true, retrievalCount: 211,
  },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

const SOURCE_META: Record<KBArticle['sourceType'], { label: string; icon: React.ElementType; color: string }> = {
  product: { label: 'Product', icon: ShoppingBag, color: 'text-primary bg-primary/10' },
  faq: { label: 'FAQ', icon: HelpCircle, color: 'text-amber-600 bg-amber-100' },
  policy: { label: 'Policy', icon: FileText, color: 'text-violet-600 bg-violet-100' },
  brand: { label: 'Brand', icon: BookOpen, color: 'text-emerald-600 bg-emerald-100' },
  shopify: { label: 'Shopify', icon: ShoppingBag, color: 'text-success bg-success/10' },
}

function ArticleRow({
  article,
  onEdit,
  onDelete,
}: {
  article: KBArticle
  onEdit: (a: KBArticle) => void
  onDelete: (id: string) => void
}) {
  const meta = SOURCE_META[article.sourceType]
  const Icon = meta.icon

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const days = Math.floor(diff / 86_400_000)
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    return `${days}d ago`
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3.5 hover:bg-surface transition-colors group border-b border-border last:border-0">
      {/* Source badge */}
      <div className={cn('p-2 rounded-lg flex-shrink-0', meta.color)}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{article.title}</p>
        <div className="flex items-center gap-3 mt-0.5">
          {article.category && (
            <span className="text-xs text-text-secondary">{article.category}</span>
          )}
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            <Cpu className="w-3 h-3" />
            {article.chunkCount} chunks
          </span>
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            <Globe className="w-3 h-3" />
            {article.language.toUpperCase()}
          </span>
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            <Clock className="w-3 h-3" />
            {timeAgo(article.lastUpdated)}
          </span>
        </div>
      </div>

      {/* Retrieval count */}
      <div className="hidden md:flex items-center gap-1 text-xs text-text-secondary w-20 justify-end">
        <BarChart2 className="w-3 h-3" />
        {article.retrievalCount} hits
      </div>

      {/* Status */}
      <div className={cn(
        'w-2 h-2 rounded-full flex-shrink-0',
        article.isActive ? 'bg-success' : 'bg-border',
      )} title={article.isActive ? 'Active' : 'Inactive'} />

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(article)}
          className="p-1.5 rounded hover:bg-primary/10 hover:text-primary text-text-secondary transition-colors"
          title="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(article.id)}
          className="p-1.5 rounded hover:bg-error/10 hover:text-error text-text-secondary transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button className="p-1.5 rounded hover:bg-surface text-text-secondary transition-colors" title="View">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────

interface ArticleFormData {
  title: string
  content: string
  sourceType: KBArticle['sourceType']
  category: string
  language: string
}

function ArticleModal({
  article,
  onClose,
  onSave,
}: {
  article?: KBArticle | null
  onClose: () => void
  onSave: (data: ArticleFormData) => void
}) {
  const [form, setForm] = useState<ArticleFormData>({
    title: article?.title ?? '',
    content: article?.content ?? '',
    sourceType: article?.sourceType ?? 'faq',
    category: article?.category ?? '',
    language: article?.language ?? 'en',
  })

  const isEdit = !!article

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-background border border-border rounded-2xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">
            {isEdit ? 'Edit article' : 'Add knowledge article'}
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Returns & Refund Policy"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Type</label>
              <select
                value={form.sourceType}
                onChange={e => setForm(f => ({ ...f, sourceType: e.target.value as KBArticle['sourceType'] }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="faq">FAQ</option>
                <option value="product">Product</option>
                <option value="policy">Policy</option>
                <option value="brand">Brand</option>
              </select>
            </div>
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
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Category (optional)</label>
            <input
              type="text"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Shipping, Serums, Policies"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Content</label>
            <textarea
              rows={8}
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Write the article content here. This will be chunked and embedded for AI retrieval."
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <p className="text-xs text-text-secondary">
            Content will be auto-chunked and embedded for AI search
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { onSave(form); onClose() }}
              disabled={!form.title.trim() || !form.content.trim()}
              className="px-4 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isEdit ? 'Save changes' : 'Add article'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'product', label: 'Products' },
  { value: 'faq', label: 'FAQs' },
  { value: 'policy', label: 'Policies' },
  { value: 'brand', label: 'Brand' },
]

export function KnowledgeBasePage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editArticle, setEditArticle] = useState<KBArticle | null>(null)

  const { data: articles = MOCK_ARTICLES, isLoading } = useQuery<KBArticle[]>({
    queryKey: ['kb', 'articles'],
    queryFn: () =>
      api.get<KBArticle[]>('/kb/articles').then(r => r.data).catch(() => MOCK_ARTICLES),
    staleTime: 30_000,
  })

  const saveMutation = useMutation({
    mutationFn: (data: ArticleFormData) =>
      api.post('/kb/articles', data).then(r => r.data).catch(() => ({})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/kb/articles/${id}`).catch(() => ({})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  })

  const filtered = articles.filter(a => {
    const matchesFilter = filter === 'all' || a.sourceType === filter
    const matchesSearch =
      !search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.content.toLowerCase().includes(search.toLowerCase()) ||
      (a.category ?? '').toLowerCase().includes(search.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const totalChunks = articles.reduce((s, a) => s + a.chunkCount, 0)
  const totalHits = articles.reduce((s, a) => s + a.retrievalCount, 0)

  return (
    <div className="h-full flex flex-col bg-background">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Knowledge Base</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {articles.length} articles · {totalChunks} chunks · {totalHits.toLocaleString()} total retrievals
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['kb'] })}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setEditArticle(null); setModalOpen(true) }}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add article
            </button>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search articles…"
              className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  filter === opt.value
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface',
                )}
              >
                {opt.label}
                {opt.value === 'all' && (
                  <span className="ml-1 text-text-secondary font-normal">({articles.length})</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Article List ── */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="space-y-0.5 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 bg-surface rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-text-secondary">
            <BookOpen className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">No articles found</p>
            {search && (
              <button onClick={() => setSearch('')} className="mt-2 text-xs text-primary hover:underline">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(article => (
              <ArticleRow
                key={article.id}
                article={article}
                onEdit={a => { setEditArticle(a); setModalOpen(true) }}
                onDelete={id => deleteMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Stats footer ── */}
      <div className="flex-shrink-0 border-t border-border px-6 py-2.5 flex items-center gap-6 text-xs text-text-secondary bg-surface">
        <span>{filtered.length} of {articles.length} articles shown</span>
        <span>·</span>
        <span>{totalChunks} total embedded chunks</span>
        <span>·</span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
          pgvector index active
        </span>
      </div>

      {/* ── Modal ── */}
      {modalOpen && (
        <ArticleModal
          article={editArticle}
          onClose={() => setModalOpen(false)}
          onSave={data => saveMutation.mutate(data)}
        />
      )}
    </div>
  )
}
