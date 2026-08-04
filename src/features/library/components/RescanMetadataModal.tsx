import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Check, ChevronRight, Loader2, Lock, Search, X } from 'lucide-react'
import { cx } from '../lib/cx'
import type {
  BookDetail,
  MetadataCandidate,
  MetadataField,
  MetadataFieldSelection,
  MetadataLockUpdate,
  MetadataRescanPreview,
} from '../../../lib/types'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type WizardStep = 'lock' | 'searching' | 'pick-edition' | 'fine-tune'

type RescanMetadataModalProps = {
  book: BookDetail
  initialLockedFields?: MetadataField[]
  onPreviewRescan: (input: { fileId?: string | null; bookId: string }) => Promise<MetadataRescanPreview>
  onApplyCuratedMetadata: (input: {
    bookId: string
    selection: MetadataFieldSelection[]
    lockUpdates: MetadataLockUpdate[]
  }) => Promise<void>
  onClose: () => void
  /** Called after a successful apply — parent can store an undo snapshot */
  onApplied?: () => void
  primaryFileId?: string | null
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'lock', label: 'Lock Fields' },
  { key: 'searching', label: 'Searching' },
  { key: 'pick-edition', label: 'Pick Edition' },
  { key: 'fine-tune', label: 'Fine-Tune' },
]

const LOCKABLE_FIELDS: MetadataField[] = ['title', 'authors', 'isbn13', 'isbn10', 'publishDate', 'publisher']

const RESCAN_FIELDS: MetadataField[] = [
  'title',
  'subtitle',
  'authors',
  'publisher',
  'publishDate',
  'isbn13',
  'isbn10',
  'description',
  'language',
  'pageCount',
  'series',
  'seriesIndex',
  'coverUrl',
]

const FIELD_LABELS: Record<MetadataField, string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  authors: 'Authors',
  publisher: 'Publisher',
  publishDate: 'Published',
  isbn13: 'ISBN-13',
  isbn10: 'ISBN-10',
  description: 'Description',
  language: 'Language',
  pageCount: 'Pages',
  series: 'Series',
  seriesIndex: 'Series #',
  coverUrl: 'Cover URL',
}

const SOURCE_LABELS: Record<string, string> = {
  open_library: 'Open Library',
  google_books: 'Google Books',
}

const SOURCE_COLORS: Record<string, string> = {
  current: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  open_library: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  google_books: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isEmptyText(value: string | undefined | null): boolean {
  return !value || value.trim().length === 0
}

function getBookFieldText(book: BookDetail, field: MetadataField): string {
  if (field === 'title') return book.title
  if (field === 'subtitle') return book.subtitle ?? ''
  if (field === 'authors') return book.authors.join(', ')
  if (field === 'publisher') return book.publisher ?? ''
  if (field === 'publishDate') return book.publishDate ?? ''
  if (field === 'isbn10') return book.isbn10 ?? ''
  if (field === 'isbn13') return book.isbn13 ?? ''
  if (field === 'description') return book.description ?? ''
  if (field === 'language') return book.language ?? ''
  if (field === 'pageCount') return book.pageCount === undefined ? '' : String(book.pageCount)
  if (field === 'series') return book.series ?? ''
  if (field === 'seriesIndex') return book.seriesIndex === undefined ? '' : String(book.seriesIndex)
  return book.coverUrl ?? ''
}

function getCandidateFieldText(candidate: MetadataCandidate, field: MetadataField): string {
  if (field === 'title') return candidate.title ?? ''
  if (field === 'subtitle') return candidate.subtitle ?? ''
  if (field === 'authors') return (candidate.authors ?? []).join(', ')
  if (field === 'publisher') return candidate.publisher ?? ''
  if (field === 'publishDate') return candidate.publishDate ?? ''
  if (field === 'isbn10') return candidate.isbn10 ?? ''
  if (field === 'isbn13') return candidate.isbn13 ?? ''
  if (field === 'description') return candidate.description ?? ''
  if (field === 'language') return candidate.language ?? ''
  if (field === 'pageCount') return candidate.pageCount === undefined ? '' : String(candidate.pageCount)
  if (field === 'series') return candidate.series ?? ''
  if (field === 'seriesIndex') return candidate.seriesIndex === undefined ? '' : String(candidate.seriesIndex)
  return candidate.coverUrl ?? ''
}

function buildSelectionFromCandidate(
  field: MetadataField,
  candidate: MetadataCandidate,
): MetadataFieldSelection | null {
  if (field === 'authors') {
    const values = candidate.authors?.filter((v) => v.trim().length > 0) ?? []
    return values.length > 0 ? { field, candidateId: candidate.id, values } : null
  }
  if (field === 'pageCount') {
    return candidate.pageCount === undefined ? null : { field, candidateId: candidate.id, intValue: candidate.pageCount }
  }
  if (field === 'seriesIndex') {
    return candidate.seriesIndex === undefined ? null : { field, candidateId: candidate.id, intValue: candidate.seriesIndex }
  }
  const value = getCandidateFieldText(candidate, field)
  return isEmptyText(value) ? null : { field, candidateId: candidate.id, value }
}

/** Groups candidates by source name */
function groupBySource(candidates: MetadataCandidate[]): Record<string, MetadataCandidate[]> {
  const groups: Record<string, MetadataCandidate[]> = {}
  for (const c of candidates) {
    const source = c.source
    if (!groups[source]) groups[source] = []
    groups[source].push(c)
  }
  return groups
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === currentStep)
  return (
    <ol aria-label="Rescan metadata progress" className="flex shrink-0 items-center gap-1 text-xs">
      {STEPS.map((step, idx) => {
        const isActive = idx === currentIdx
        const isCompleted = idx < currentIdx
        return (
          <li key={step.key} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight size={12} className="text-slate-400 dark:text-slate-600" />}
            <span
              aria-current={isActive ? 'step' : undefined}
              className={cx(
                'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-colors',
                isActive && 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300',
                isCompleted && 'text-emerald-600 dark:text-emerald-400',
                !isActive && !isCompleted && 'text-slate-400 dark:text-slate-500',
              )}
            >
              {isCompleted && <Check size={10} className="mr-1 inline shrink-0" />}
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function ExpandableText({ text, maxLength = 120 }: { text: string; maxLength?: number }) {
  const [expanded, setExpanded] = useState(false)
  if (text.length <= maxLength) return <span>{text}</span>
  return (
    <span>
      {expanded ? text : `${text.slice(0, maxLength)}…`}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        className="ml-1 text-accent-600 hover:underline dark:text-accent-400"
      >
        {expanded ? 'Less' : 'More'}
      </button>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function RescanMetadataModal({
  book,
  initialLockedFields,
  onPreviewRescan,
  onApplyCuratedMetadata,
  onClose,
  onApplied,
  primaryFileId,
}: RescanMetadataModalProps) {
  const [step, setStep] = useState<WizardStep>('lock')
  const [lockState, setLockState] = useState<Partial<Record<MetadataField, boolean>>>(() => {
    const state: Partial<Record<MetadataField, boolean>> = {}
    for (const field of LOCKABLE_FIELDS) {
      state[field] = initialLockedFields?.includes(field) ?? false
    }
    return state
  })
  const [preview, setPreview] = useState<MetadataRescanPreview | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null)
  // Per-field selections: field -> candidateId (null = keep current)
  const [fieldPicks, setFieldPicks] = useState<Partial<Record<MetadataField, string | null>>>({})
  const [isApplying, setIsApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  /* ---------- search ---------- */

  const doSearch = useCallback(async () => {
    setStep('searching')
    setSearchError(null)
    setPreview(null)
    setSelectedBaseId(null)
    setFieldPicks({})
    try {
      const result = await onPreviewRescan({ fileId: primaryFileId ?? null, bookId: book.id })
      if (!mountedRef.current) return
      setPreview(result)
      // Update lock state from server (may differ if user hasn't toggled yet)
      const serverLocks: Partial<Record<MetadataField, boolean>> = {}
      for (const f of LOCKABLE_FIELDS) serverLocks[f] = result.lockedFields.includes(f)
      setLockState(serverLocks)
      if (result.candidates.length > 0) {
        setStep('pick-edition')
      } else {
        setStep('pick-edition') // show "no candidates" state
      }
    } catch (err) {
      if (!mountedRef.current) return
      setSearchError(err instanceof Error ? err.message : 'Search failed')
      setStep('lock')
    }
  }, [book.id, primaryFileId, onPreviewRescan])

  /* ---------- pick base edition ---------- */

  const selectBase = (candidateId: string) => {
    setSelectedBaseId(candidateId)
    // Pre-fill field picks from the selected edition for fields that are currently empty on the book
    if (!preview) return
    const candidate = preview.candidates.find((c) => c.id === candidateId)
    if (!candidate) return
    const picks: Partial<Record<MetadataField, string | null>> = {}
    for (const field of RESCAN_FIELDS) {
      const candidateValue = getCandidateFieldText(candidate, field)
      if (!isEmptyText(candidateValue)) {
        picks[field] = candidateId
      }
    }
    setFieldPicks(picks)
    setStep('fine-tune')
  }

  const skipToFineTune = () => {
    setFieldPicks({})
    setSelectedBaseId(null)
    setStep('fine-tune')
  }

  /* ---------- fine-tune: build unique column candidates ---------- */

  // Deduplicate candidates that appear in multiple columns.
  // Columns: current book + plus each candidate from the preview.
  const columnCandidates = useMemo(() => {
    if (!preview) return []
    return preview.candidates
  }, [preview])

  const toggleFieldPick = (field: MetadataField, candidateId: string | null) => {
    setFieldPicks((prev) => ({ ...prev, [field]: candidateId }))
  }

  /* ---------- apply ---------- */

  const buildLockUpdates = (): MetadataLockUpdate[] => {
    if (!preview) return []
    const initial = new Set(preview.lockedFields)
    const updates: MetadataLockUpdate[] = []
    for (const field of LOCKABLE_FIELDS) {
      const before = initial.has(field)
      const after = Boolean(lockState[field])
      if (before !== after) updates.push({ field, locked: after })
    }
    return updates
  }

  const handleApply = async () => {
    if (!preview) return
    setIsApplying(true)
    setApplyError(null)

    // Build selection list from field picks
    const selection: MetadataFieldSelection[] = []
    const candidateById = new Map<string, (typeof preview.candidates)[number]>()
    for (const candidate of preview.candidates) {
      candidateById.set(candidate.id, candidate)
    }
    for (const field of RESCAN_FIELDS) {
      const candidateId = fieldPicks[field]
      if (!candidateId) continue // null or undefined = keep current
      const candidate = candidateById.get(candidateId)
      if (!candidate) continue
      const sel = buildSelectionFromCandidate(field, candidate)
      if (sel) selection.push(sel)
    }

    // Auto-unlock any locked field the user explicitly chose a new value for,
    // so manual-override locks don't silently block the update.
    const lockUpdates = buildLockUpdates()
    const lockedSet = new Set(preview.lockedFields)
    for (const sel of selection) {
      if (lockedSet.has(sel.field) && !lockUpdates.some((u) => u.field === sel.field)) {
        lockUpdates.push({ field: sel.field, locked: false })
      }
    }

    try {
      await onApplyCuratedMetadata({
        bookId: book.id,
        selection,
        lockUpdates,
      })
      if (!mountedRef.current) return
      onApplied?.()
      onClose()
    } catch (err) {
      if (!mountedRef.current) return
      setApplyError(err instanceof Error ? err.message : 'Failed to apply metadata')
    } finally {
      if (mountedRef.current) setIsApplying(false)
    }
  }

  /* ---------- render ---------- */

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-slate-950/50 backdrop-blur-sm"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
        role="dialog"
        aria-modal="true"
        aria-label="Rescan Metadata"
        className={cx(
          'fixed inset-4 z-[61] mx-auto my-auto flex max-h-[min(90vh,800px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
          step === 'fine-tune' ? 'max-w-[1400px]' : 'max-w-[900px]',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {step !== 'lock' && step !== 'searching' && (
              <button
                aria-label="Back"
                onClick={() => {
                  if (step === 'fine-tune') setStep('pick-edition')
                  else if (step === 'pick-edition') setStep('lock')
                }}
                className="rounded-full p-1.5 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-800"
                title="Back"
              >
                <ArrowLeft size={18} className="text-slate-500 dark:text-slate-400" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Rescan Metadata</h2>
              <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                {book.title} — {book.authors.join(', ') || 'Unknown Author'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StepIndicator currentStep={step} />
            <button aria-label="Close" title="Close" onClick={onClose} className="rounded-full p-2 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-800">
              <X size={18} className="text-slate-500 dark:text-slate-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={cx('flex-1 p-6', step === 'fine-tune' ? 'min-h-0 overflow-hidden' : 'overflow-y-auto')}>
          {step === 'lock' && (
            <StepLock
              book={book}
              lockState={lockState}
              setLockState={setLockState}
              onSearch={() => { void doSearch() }}
              searchError={searchError}
            />
          )}
          {step === 'searching' && <StepSearching />}
          {step === 'pick-edition' && preview && (
            <StepPickEdition
              preview={preview}
              selectedBaseId={selectedBaseId}
              onSelect={selectBase}
              onSkip={skipToFineTune}
            />
          )}
          {step === 'fine-tune' && preview && (
            <StepFineTune
              book={book}
              candidates={columnCandidates}
              fieldPicks={fieldPicks}
              onTogglePick={toggleFieldPick}
            />
          )}
        </div>

        {/* Footer */}
        {step === 'fine-tune' && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
            <div>
              {applyError && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{applyError}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleApply() }}
                disabled={isApplying}
                className="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-700 disabled:opacity-50"
              >
                {isApplying ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {isApplying ? 'Applying…' : 'Apply Changes'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>
  )
}

/* ================================================================== */
/*  Step 1 — Lock Search Fields                                        */
/* ================================================================== */

function StepLock({
  book,
  lockState,
  setLockState,
  onSearch,
  searchError,
}: {
  book: BookDetail
  lockState: Partial<Record<MetadataField, boolean>>
  setLockState: React.Dispatch<React.SetStateAction<Partial<Record<MetadataField, boolean>>>>
  onSearch: () => void
  searchError: string | null
}) {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Configure Search</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Lock fields you know are correct. These values will be used as search constraints.
        </p>
      </div>

      {/* Current metadata summary */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="space-y-3">
          {LOCKABLE_FIELDS.map((field) => {
            const value = getBookFieldText(book, field)
            const isLocked = Boolean(lockState[field])
            return (
              <div key={field} className="flex items-start gap-3">
                <button
                  onClick={() => setLockState((prev) => ({ ...prev, [field]: !prev[field] }))}
                  className={cx(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                    isLocked
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800',
                  )}
                  title={isLocked ? 'Unlock field' : 'Lock field — use this value for searching'}
                >
                  {isLocked && <Lock size={12} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{FIELD_LABELS[field]}</p>
                  <p className={cx(
                    'mt-0.5 truncate text-sm',
                    isEmptyText(value) ? 'italic text-slate-400' : 'text-slate-700 dark:text-slate-200',
                  )}>
                    {isEmptyText(value) ? '(empty)' : value}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {searchError && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
          {searchError}
        </div>
      )}

      <div className="flex justify-center">
        <button
          onClick={onSearch}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-accent-700"
        >
          <Search size={16} />
          Search Metadata
        </button>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  Step 2 — Searching (transient)                                     */
/* ================================================================== */

function StepSearching() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <Loader2 size={32} className="animate-spin text-accent-500" />
      <div className="text-center">
        <p className="font-medium text-slate-700 dark:text-slate-200">Searching metadata sources…</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Querying Open Library and Google Books
        </p>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  Step 3 — Pick Base Edition                                         */
/* ================================================================== */

function StepPickEdition({
  preview,
  selectedBaseId,
  onSelect,
  onSkip,
}: {
  preview: MetadataRescanPreview
  selectedBaseId: string | null
  onSelect: (candidateId: string) => void
  onSkip: () => void
}) {
  const grouped = useMemo(() => groupBySource(preview.candidates), [preview.candidates])
  const sources = Object.keys(grouped)
  const bestCandidate = preview.candidates.reduce<MetadataCandidate | null>((best, c) => {
    if (!best) return c
    return (c.confidence ?? 0) > (best.confidence ?? 0) ? c : best
  }, null)

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Choose a Base Edition</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pick an edition as a starting point, then fine-tune individual fields. Or skip to compare all fields directly.
        </p>
      </div>

      {/* Source status badges */}
      <div className="flex flex-wrap justify-center gap-2">
        {preview.sourceStatuses.map((status) => (
          <span
            key={status.source}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              status.status === 'ok' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
              status.status === 'no_match' && 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              status.status === 'limited' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
              status.status === 'error' && 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
            )}
          >
            {SOURCE_LABELS[status.source] ?? status.source}: {status.status.replace('_', ' ')} ({status.candidateCount})
            {status.message ? ` — ${status.message}` : ''}
          </span>
        ))}
      </div>

      {preview.candidates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-sm text-slate-500 dark:text-slate-400">No metadata candidates found.</p>
          <button
            onClick={onSkip}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Continue to Fine-Tune
          </button>
        </div>
      ) : (
        <>
          {sources.map((source) => (
            <div key={source}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {SOURCE_LABELS[source] ?? source}
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {grouped[source].map((candidate) => {
                  const isBest = bestCandidate?.id === candidate.id
                  const isSelected = selectedBaseId === candidate.id
                  return (
                    <button
                      key={candidate.id}
                      onClick={() => onSelect(candidate.id)}
                      className={cx(
                        'relative rounded-xl border-2 p-4 text-left transition-all',
                        isSelected
                          ? 'border-accent-500 bg-accent-50/50 shadow-md dark:border-accent-600 dark:bg-accent-900/10'
                          : isBest
                            ? 'border-emerald-300 bg-white hover:border-emerald-400 dark:border-emerald-700 dark:bg-slate-800 dark:hover:border-emerald-600'
                            : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600',
                      )}
                    >
                      {isBest && (
                        <span className="absolute -top-2 right-3 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                          Best Match
                        </span>
                      )}
                      <p className="font-medium text-slate-900 dark:text-white">{candidate.title ?? 'Untitled'}</p>
                      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                        {(candidate.authors ?? []).join(', ') || 'Unknown Author'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {candidate.publisher && (
                          <span className="text-slate-500 dark:text-slate-400">{candidate.publisher}</span>
                        )}
                        {candidate.publishDate && (
                          <span className="text-slate-500 dark:text-slate-400">• {candidate.publishDate}</span>
                        )}
                        {(candidate.isbn13 || candidate.isbn10) && (
                          <span className="text-slate-500 dark:text-slate-400">
                            • {candidate.isbn13 || candidate.isbn10}
                          </span>
                        )}
                      </div>
                      {candidate.confidence !== undefined && (
                        <div className="mt-2">
                          <span className={cx(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                            candidate.confidence >= 0.9 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
                            candidate.confidence >= 0.7 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                            'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                          )}>
                            {Math.round(candidate.confidence * 100)}% match
                          </span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex justify-center pt-2">
            <button
              onClick={onSkip}
              className="text-sm font-medium text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Skip — compare all fields directly →
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ================================================================== */
/*  Step 4 — Fine-Tune (Comparison Table)                              */
/* ================================================================== */

function StepFineTune({
  book,
  candidates,
  fieldPicks,
  onTogglePick,
}: {
  book: BookDetail
  candidates: MetadataCandidate[]
  fieldPicks: Partial<Record<MetadataField, string | null>>
  onTogglePick: (field: MetadataField, candidateId: string | null) => void
}) {
  // Group by source for column headers
  const sourceGroups = useMemo(() => groupBySource(candidates), [candidates])
  const fieldsWithCandidateValues = useMemo(() => {
    const fields = new Set<MetadataField>()
    for (const field of RESCAN_FIELDS) {
      for (const candidate of candidates) {
        if (!isEmptyText(getCandidateFieldText(candidate, field))) {
          fields.add(field)
          break
        }
      }
    }
    return fields
  }, [candidates])
  const sourceOrder = Object.keys(sourceGroups)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 text-center">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Fine-Tune Fields</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Click any cell to select that value. Green-highlighted cells will be applied.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
              <th className="sticky left-0 top-0 z-30 min-w-[100px] bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-800">
                Field
              </th>
              <th className="sticky top-0 z-20 min-w-[200px] bg-slate-50 px-4 py-2.5 text-left dark:bg-slate-800">
                <span className={cx('inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', SOURCE_COLORS.current)}>
                  Current
                </span>
              </th>
              {sourceOrder.map((source) =>
                sourceGroups[source].map((candidate, index) => (
                  <th key={candidate.id} className="sticky top-0 z-20 min-w-[200px] bg-slate-50 px-4 py-2.5 text-left dark:bg-slate-800">
                    <span className={cx('inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', SOURCE_COLORS[source] || SOURCE_COLORS.current)}>
                      {SOURCE_LABELS[source] ?? source}
                    </span>
                    {sourceGroups[source].length > 1 && (
                      <span className="ml-1 text-[10px] text-slate-400">#{index + 1}</span>
                    )}
                    {candidate.confidence !== undefined && (
                      <span className="ml-1 text-[10px] text-slate-400">{Math.round(candidate.confidence * 100)}%</span>
                    )}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {RESCAN_FIELDS.map((field) => {
              // Skip fields where no candidate has any value AND current is empty
              const currentValue = getBookFieldText(book, field)
              const anyHasValue = fieldsWithCandidateValues.has(field)
              if (!anyHasValue && isEmptyText(currentValue)) return null

              const pickedCandidateId = fieldPicks[field]
              const isDescription = field === 'description'

              return (
                <tr key={field} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    {FIELD_LABELS[field]}
                  </td>

                  {/* Current book value */}
                  <td
                    onClick={() => onTogglePick(field, null)}
                    className={cx(
                      'cursor-pointer px-4 py-2.5 transition-colors',
                      pickedCandidateId === undefined || pickedCandidateId === null
                        ? 'bg-slate-50 ring-2 ring-inset ring-slate-300 dark:bg-slate-800/40 dark:ring-slate-600'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/30',
                    )}
                  >
                    <span className={cx(
                      'text-sm',
                      isEmptyText(currentValue) ? 'italic text-slate-400' : 'text-slate-700 dark:text-slate-200',
                    )}>
                      {isEmptyText(currentValue) ? '—' : isDescription ? <ExpandableText text={currentValue} /> : currentValue}
                    </span>
                  </td>

                  {/* Candidate values */}
                  {sourceOrder.map((source) =>
                    sourceGroups[source].map((candidate) => {
                      const cellValue = getCandidateFieldText(candidate, field)
                      const isEmpty = isEmptyText(cellValue)
                      const isPicked = pickedCandidateId === candidate.id
                      const isDifferent = !isEmpty && cellValue !== currentValue

                      return (
                        <td
                          key={candidate.id}
                          onClick={() => {
                            if (!isEmpty) onTogglePick(field, candidate.id)
                          }}
                          className={cx(
                            'px-4 py-2.5 transition-colors',
                            !isEmpty && 'cursor-pointer',
                            isPicked
                              ? 'bg-emerald-50 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-900/20 dark:ring-emerald-600'
                              : !isEmpty && 'hover:bg-slate-50 dark:hover:bg-slate-800/30',
                          )}
                        >
                          <span className={cx(
                            'text-sm',
                            isEmpty
                              ? 'italic text-slate-300 dark:text-slate-600'
                              : isDifferent
                                ? 'font-medium text-slate-900 dark:text-white'
                                : 'text-slate-500 dark:text-slate-400',
                          )}>
                            {isEmpty ? '—' : isDescription ? <ExpandableText text={cellValue} /> : cellValue}
                          </span>
                        </td>
                      )
                    }),
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
