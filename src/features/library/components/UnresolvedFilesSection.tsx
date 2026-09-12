import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookPlus,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import type {
  BookDetail,
  BookPatch,
  DiscoveredFile,
  DiscoveredFileFilters,
  DiscoveredFileSort,
  MatchPreview,
  MatchResult,
  MetadataCandidate,
} from '../../../lib/types'
import { formatDisplayPath, sanitizeDisplayText } from '../../../lib/format'
import { api } from '../../../lib/api'
import { cx } from '../lib/cx'
import type { MatchDraft, MatchNotice } from '../model/types'
import { MatchPreviewModal } from './MatchPreviewModal'
import { ManualBookModal } from './ManualBookModal'

export type UnresolvedFilesSectionProps = {
  discoveredQuery: string
  onSetDiscoveredQuery: (value: string) => void
  discoveredFilters: DiscoveredFileFilters
  onSetDiscoveredFilters: (value: DiscoveredFileFilters) => void
  discoveredSort: DiscoveredFileSort
  onSetDiscoveredSort: (value: DiscoveredFileSort) => void
  matchNotice: MatchNotice | null
  discoveredItems: DiscoveredFile[]
  discoveredTotal: number
  isDiscoveredLoading: boolean
  isDiscoveredFetching: boolean
  discoveredError: string | null
  onRetryDiscovered: () => void
  matchDrafts: Record<string, MatchDraft>
  onSetMatchDraft: (fileId: string, patch: MatchDraft) => void
  onPreviewMatch: (input: { fileId: string; title?: string; author?: string; isbn?: string }) => Promise<MatchPreview>
  onConfirmMatch: (input: { fileId: string; candidate: MetadataCandidate }) => Promise<MatchResult>
  onCreateManualBook: (input: { fileId: string; patch: BookPatch; tags: string[] }) => Promise<BookDetail>
  onAttemptMatchItems: (fileIds: string[]) => Promise<void>
  isPreviewMatchPending: boolean
  isAttemptMatchPending: boolean
  isAttemptMatchAllPending: boolean
  matchingFileId: string | null
  discoveredPage: number
  discoveredPageSize: number
  discoveredPages: number
  onSetDiscoveredPage: (page: number) => void
  onSetDiscoveredPageSize: (pageSize: number) => void
}

type IssueDetails = {
  label: string
  guidance: string
  color: string
}

const CONTROL_CLASS =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200'

function fileExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot + 1).toUpperCase() : ''
}

function issueDetails(file: DiscoveredFile): IssueDetails {
  if (file.status === 'error' || file.parserError) {
    return {
      label: 'File error',
      guidance: 'Open the file and check that it is readable.',
      color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    }
  }

  const reason = file.reason.trim().toLowerCase()
  if (reason.startsWith('api_error') || reason.startsWith('api error')) {
    return {
      label: 'Lookup error',
      guidance: 'The catalog lookup failed. Retry this file later.',
      color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    }
  }
  if (reason === 'low_confidence') {
    return {
      label: 'Possible match',
      guidance: 'Review the candidates before choosing one.',
      color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    }
  }
  if (reason === 'weak_lookup_keys' || reason === 'missing_lookup_keys') {
    return {
      label: 'Missing details',
      guidance: 'Add a title, author, or ISBN to improve the search.',
      color: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    }
  }
  if (reason === 'no_api_match') {
    return {
      label: 'No catalog match',
      guidance: 'Adjust the details or add this book manually.',
      color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    }
  }
  return {
    label: 'Needs review',
    guidance: file.reason.replaceAll('_', ' '),
    color: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  }
}

function sortOptionValue(sort: DiscoveredFileSort): string {
  return `${sort.field}:${sort.direction}`
}

function parseSortOption(value: string): DiscoveredFileSort {
  const [field, direction] = value.split(':')
  return {
    field: field as DiscoveredFileSort['field'],
    direction: direction as DiscoveredFileSort['direction'],
  }
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-4" aria-label="Loading files needing review">
      {[0, 1, 2].map((index) => (
        <div key={index} className="animate-pulse rounded-xl border border-slate-100 p-4 dark:border-slate-700/60">
          <div className="mb-4 h-4 w-2/5 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="h-9 rounded bg-slate-100 dark:bg-slate-700/60" />
            <div className="h-9 rounded bg-slate-100 dark:bg-slate-700/60" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function UnresolvedFilesSection({
  discoveredQuery,
  onSetDiscoveredQuery,
  discoveredFilters,
  onSetDiscoveredFilters,
  discoveredSort,
  onSetDiscoveredSort,
  matchNotice,
  discoveredItems,
  discoveredTotal,
  isDiscoveredLoading,
  isDiscoveredFetching,
  discoveredError,
  onRetryDiscovered,
  matchDrafts,
  onSetMatchDraft,
  onPreviewMatch,
  onConfirmMatch,
  onCreateManualBook,
  onAttemptMatchItems,
  isPreviewMatchPending,
  isAttemptMatchPending,
  isAttemptMatchAllPending,
  matchingFileId,
  discoveredPage,
  discoveredPageSize,
  discoveredPages,
  onSetDiscoveredPage,
  onSetDiscoveredPageSize,
}: UnresolvedFilesSectionProps) {
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])
  const [previewData, setPreviewData] = useState<MatchPreview | null>(null)
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null)
  const [manualFile, setManualFile] = useState<DiscoveredFile | null>(null)
  const selectPageRef = useRef<HTMLInputElement>(null)

  const visibleFileIds = useMemo(() => discoveredItems.map((file) => file.fileId), [discoveredItems])
  const visibleFileIdSet = useMemo(() => new Set(visibleFileIds), [visibleFileIds])
  const selectedVisibleFileIds = useMemo(
    () => selectedFileIds.filter((id) => visibleFileIdSet.has(id)),
    [selectedFileIds, visibleFileIdSet],
  )
  const selectedFileIdSet = useMemo(() => new Set(selectedVisibleFileIds), [selectedVisibleFileIds])
  const allPageSelected = visibleFileIds.length > 0 && visibleFileIds.every((id) => selectedFileIdSet.has(id))
  const somePageSelected = visibleFileIds.some((id) => selectedFileIdSet.has(id))
  const activeFilterCount = Object.values(discoveredFilters).filter(Boolean).length + (discoveredQuery ? 1 : 0)
  const rangeStart = discoveredTotal === 0 ? 0 : (discoveredPage - 1) * discoveredPageSize + 1
  const rangeEnd = Math.min(discoveredPage * discoveredPageSize, discoveredTotal)
  const busy = isDiscoveredFetching || isPreviewMatchPending || isAttemptMatchPending || isAttemptMatchAllPending

  useEffect(() => {
    if (selectPageRef.current) {
      selectPageRef.current.indeterminate = somePageSelected && !allPageSelected
    }
  }, [allPageSelected, somePageSelected])

  function toggleFileSelection(fileId: string) {
    setSelectedFileIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId],
    )
  }

  function togglePageSelection() {
    setSelectedFileIds(allPageSelected ? [] : visibleFileIds)
  }

  async function matchItems(fileIds: string[]) {
    await onAttemptMatchItems(fileIds)
    setSelectedFileIds([])
  }

  function clearFilters() {
    onSetDiscoveredQuery('')
    onSetDiscoveredFilters({})
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b border-slate-100 p-5 dark:border-slate-700/60">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Files needing review</h1>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {discoveredTotal.toLocaleString()}
              </span>
              {isDiscoveredFetching && !isDiscoveredLoading ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" aria-live="polite">
                  <Loader2 size={12} className="animate-spin" /> Updating
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Review files that could not be matched automatically. Edit the details, compare candidates, or add a book manually.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedVisibleFileIds.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedFileIds([])}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Clear {selectedVisibleFileIds.length} selected
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void matchItems(selectedVisibleFileIds)}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-slate-800"
                >
                  {isAttemptMatchAllPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  Auto-match selected ({selectedVisibleFileIds.length})
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy || discoveredItems.length === 0}
                onClick={() => void matchItems(visibleFileIds)}
                className="inline-flex items-center gap-2 rounded-lg border border-accent-500/40 bg-accent-50 px-4 py-2 text-sm font-medium text-accent-700 hover:bg-accent-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-50 dark:border-accent-500/30 dark:bg-accent-900/20 dark:text-accent-300 dark:hover:bg-accent-900/40"
              >
                {isAttemptMatchAllPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Auto-match this page ({discoveredItems.length})
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-2 lg:grid-cols-[minmax(260px,1fr)_repeat(4,auto)]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search files needing review"
              className={cx(CONTROL_CLASS, 'w-full py-2 pl-9 pr-9')}
              placeholder="Search file, path, title, author, ISBN, or issue..."
              value={discoveredQuery}
              onChange={(event) => onSetDiscoveredQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  if (discoveredQuery) onSetDiscoveredQuery('')
                  else event.currentTarget.blur()
                }
              }}
            />
            {discoveredQuery ? (
              <button
                type="button"
                aria-label="Clear review search"
                onClick={() => onSetDiscoveredQuery('')}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          <select
            aria-label="Filter by issue"
            className={CONTROL_CLASS}
            value={discoveredFilters.reason ?? ''}
            onChange={(event) =>
              onSetDiscoveredFilters({
                ...discoveredFilters,
                reason: (event.target.value || undefined) as DiscoveredFileFilters['reason'],
              })
            }
          >
            <option value="">All issues</option>
            <option value="lowConfidence">Possible match</option>
            <option value="missingInfo">Missing details</option>
            <option value="noMatch">No catalog match</option>
            <option value="apiError">Lookup error</option>
            <option value="fileError">File error</option>
            <option value="other">Other</option>
          </select>

          <select
            aria-label="Filter by format"
            className={CONTROL_CLASS}
            value={discoveredFilters.format ?? ''}
            onChange={(event) =>
              onSetDiscoveredFilters({
                ...discoveredFilters,
                format: (event.target.value || undefined) as DiscoveredFileFilters['format'],
              })
            }
          >
            <option value="">All formats</option>
            <option value="pdf">PDF</option>
            <option value="epub">EPUB</option>
          </select>

          <select
            aria-label="Filter by available metadata"
            className={CONTROL_CLASS}
            value={discoveredFilters.metadata ?? ''}
            onChange={(event) =>
              onSetDiscoveredFilters({
                ...discoveredFilters,
                metadata: (event.target.value || undefined) as DiscoveredFileFilters['metadata'],
              })
            }
          >
            <option value="">Any metadata</option>
            <option value="hasIsbn">Has ISBN</option>
            <option value="hasTitle">Has title</option>
            <option value="needsInput">Missing title &amp; ISBN</option>
          </select>

          <select
            aria-label="Sort files needing review"
            className={CONTROL_CLASS}
            value={sortOptionValue(discoveredSort)}
            onChange={(event) => onSetDiscoveredSort(parseSortOption(event.target.value))}
          >
            <option value="lastSeenAt:desc">Newest scan first</option>
            <option value="lastSeenAt:asc">Oldest scan first</option>
            <option value="fileName:asc">File path A–Z</option>
            <option value="fileName:desc">File path Z–A</option>
            <option value="reason:asc">Issue A–Z</option>
            <option value="title:asc">Title A–Z</option>
            <option value="title:desc">Title Z–A</option>
            <option value="author:asc">Author A–Z</option>
            <option value="isbn:asc">ISBN ascending</option>
          </select>
        </div>

        <div className="mt-3 flex min-h-7 flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span aria-live="polite">
            {discoveredTotal > 0
              ? `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${discoveredTotal.toLocaleString()}`
              : 'No files to show'}
          </span>
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-900/20"
            >
              <X size={12} /> Clear {activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}
            </button>
          ) : null}
        </div>
      </div>

      {matchNotice ? (
        <div
          aria-live="polite"
          className={cx(
            'mx-5 mt-4 rounded-lg border px-3 py-2 text-sm',
            matchNotice.tone === 'success' &&
              'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
            matchNotice.tone === 'warning' &&
              'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
            matchNotice.tone === 'error' &&
              'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
          )}
        >
          {matchNotice.message}
        </div>
      ) : null}

      {discoveredError ? (
        <div
          role="alert"
          className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300"
        >
          <span>Could not load files needing review. {discoveredError}</span>
          <button
            type="button"
            onClick={onRetryDiscovered}
            className="rounded-md bg-white/70 px-3 py-1.5 font-medium hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:bg-slate-900/40 dark:hover:bg-slate-900/70"
          >
            Retry
          </button>
        </div>
      ) : null}

      {isDiscoveredLoading ? (
        <LoadingRows />
      ) : discoveredItems.length === 0 ? (
        <div className="px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
          {activeFilterCount > 0 ? (
            <>
              <p className="font-medium text-slate-700 dark:text-slate-200">No files match these filters.</p>
              <p className="mt-1">Try a broader search or clear the active filters.</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-3 font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300"
              >
                Clear filters
              </button>
            </>
          ) : discoveredError ? null : (
            <>
              <p className="font-medium text-slate-700 dark:text-slate-200">Everything is matched.</p>
              <p className="mt-1">New files that need attention will appear here after a scan.</p>
            </>
          )}
        </div>
      ) : (
        <div className="p-4">
          <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
            <input
              ref={selectPageRef}
              type="checkbox"
              checked={allPageSelected}
              onChange={togglePageSelection}
              className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
            />
            Select this page
          </label>

          <div className="space-y-3">
            {discoveredItems.map((file) => {
              const cleanTitle = sanitizeDisplayText(file.guessedTitle)
              const cleanAuthor = sanitizeDisplayText(file.guessedAuthor)
              const cleanIsbn = sanitizeDisplayText(file.guessedIsbn)
              const draft = matchDrafts[file.fileId] ?? {}
              const titleValue = draft.title ?? cleanTitle ?? ''
              const authorValue = draft.author ?? cleanAuthor ?? ''
              const isbnValue = draft.isbn ?? cleanIsbn ?? ''
              const issue = issueDetails(file)
              const isMatchingThisFile = isAttemptMatchPending && matchingFileId === file.fileId
              const selected = selectedFileIdSet.has(file.fileId)

              return (
                <article
                  key={file.fileId}
                  className={cx(
                    'rounded-xl border p-4 transition-colors',
                    selected
                      ? 'border-accent-300 bg-accent-50/50 dark:border-accent-700 dark:bg-accent-900/10'
                      : isMatchingThisFile
                        ? 'border-accent-200 bg-accent-50/40 dark:border-accent-800 dark:bg-accent-900/10'
                        : 'border-slate-100 hover:border-slate-200 dark:border-slate-700/60 dark:hover:border-slate-600',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${file.fileName}`}
                      checked={selected}
                      onChange={() => toggleFileSelection(file.fileId)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                    />

                    <div className="grid min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(180px,0.8fr)_minmax(300px,1.2fr)_auto] lg:items-start">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            className="min-w-0 truncate text-left text-sm font-semibold text-accent-600 hover:text-accent-700 hover:underline dark:text-accent-400 dark:hover:text-accent-300"
                            title={`Open ${file.fileName}`}
                            onClick={() => api.openLocalFile(file.absPath)}
                          >
                            {file.fileName}
                          </button>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                            {fileExt(file.fileName) || 'FILE'}
                          </span>
                          <button
                            type="button"
                            aria-label={`Show ${file.fileName} in folder`}
                            title="Show in folder"
                            onClick={() => api.openLocalFileFolder(file.absPath)}
                            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                          >
                            <FolderOpen size={14} />
                          </button>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-slate-400 dark:text-slate-500" title={formatDisplayPath(file.absPath)}>
                          {formatDisplayPath(file.absPath)}
                        </p>
                        <div className="mt-2">
                          <span className={cx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', issue.color)}>
                            {issue.label}
                          </span>
                          <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400" title={file.parserError ?? file.reason}>
                            {issue.guidance}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(110px,0.55fr)]">
                        <input
                          aria-label={`Title for ${file.fileName}`}
                          className={cx(CONTROL_CLASS, 'min-w-0 sm:col-span-2')}
                          placeholder="Title"
                          value={titleValue}
                          onChange={(event) => onSetMatchDraft(file.fileId, { ...draft, title: event.target.value })}
                        />
                        <input
                          aria-label={`Author for ${file.fileName}`}
                          className={cx(CONTROL_CLASS, 'min-w-0')}
                          placeholder="Author"
                          value={authorValue}
                          onChange={(event) => onSetMatchDraft(file.fileId, { ...draft, author: event.target.value })}
                        />
                        <input
                          aria-label={`ISBN for ${file.fileName}`}
                          className={cx(CONTROL_CLASS, 'min-w-0')}
                          placeholder="ISBN"
                          value={isbnValue}
                          onChange={(event) => onSetMatchDraft(file.fileId, { ...draft, isbn: event.target.value })}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:w-36 lg:flex-col lg:items-stretch">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setPreviewingFileId(file.fileId)
                            try {
                              const preview = await onPreviewMatch({
                                fileId: file.fileId,
                                title: titleValue || undefined,
                                author: authorValue || undefined,
                                isbn: isbnValue || undefined,
                              })
                              setPreviewData(preview)
                            } finally {
                              setPreviewingFileId(null)
                            }
                          }}
                          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-accent-500/40 bg-accent-50 px-3 py-2 text-xs font-semibold text-accent-700 hover:bg-accent-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-50 dark:border-accent-500/30 dark:bg-accent-900/20 dark:text-accent-300 dark:hover:bg-accent-900/40"
                        >
                          {(isMatchingThisFile || previewingFileId === file.fileId) && <Loader2 size={13} className="animate-spin" />}
                          {isMatchingThisFile || previewingFileId === file.fileId ? 'Searching…' : 'Review matches'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setManualFile(file)}
                          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          <BookPlus size={13} /> Add manually
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {discoveredTotal > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-700/60">
          <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            Rows
            <select
              aria-label="Files per page"
              className={cx(CONTROL_CLASS, 'py-1.5')}
              value={discoveredPageSize}
              onChange={(event) => onSetDiscoveredPageSize(Number(event.target.value))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="First page"
              title="First page"
              disabled={discoveredPage <= 1}
              onClick={() => onSetDiscoveredPage(1)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
            >
              <ChevronFirst size={16} />
            </button>
            <button
              type="button"
              aria-label="Previous page"
              title="Previous page"
              disabled={discoveredPage <= 1}
              onClick={() => onSetDiscoveredPage(Math.max(1, discoveredPage - 1))}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-24 px-2 text-center text-sm text-slate-500 dark:text-slate-400">
              Page {discoveredPage} of {discoveredPages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              title="Next page"
              disabled={discoveredPage >= discoveredPages}
              onClick={() => onSetDiscoveredPage(Math.min(discoveredPages, discoveredPage + 1))}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              aria-label="Last page"
              title="Last page"
              disabled={discoveredPage >= discoveredPages}
              onClick={() => onSetDiscoveredPage(discoveredPages)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
            >
              <ChevronLast size={16} />
            </button>
          </div>
        </div>
      ) : null}

      {previewData ? (
        <MatchPreviewModal
          preview={previewData}
          onConfirm={onConfirmMatch}
          onClose={() => setPreviewData(null)}
          onConfirmed={() => setPreviewData(null)}
        />
      ) : null}
      {manualFile ? (
        <ManualBookModal
          file={manualFile}
          initialTitle={matchDrafts[manualFile.fileId]?.title ?? sanitizeDisplayText(manualFile.guessedTitle) ?? ''}
          initialAuthor={matchDrafts[manualFile.fileId]?.author ?? sanitizeDisplayText(manualFile.guessedAuthor) ?? ''}
          initialIsbn={matchDrafts[manualFile.fileId]?.isbn ?? sanitizeDisplayText(manualFile.guessedIsbn) ?? ''}
          onCreate={onCreateManualBook}
          onClose={() => setManualFile(null)}
          onCreated={() => setManualFile(null)}
        />
      ) : null}
    </section>
  )
}
