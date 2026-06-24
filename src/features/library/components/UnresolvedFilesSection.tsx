import { useState, useMemo } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, BookPlus, Loader2, RefreshCw, Search, X } from 'lucide-react'
import type { BookDetail, BookPatch, DiscoveredFile, MatchPreview, MatchResult } from '../../../lib/types'
import { formatDisplayPath, sanitizeDisplayText } from '../../../lib/format'
import { api } from '../../../lib/api'
import { cx } from '../lib/cx'
import type { MatchDraft, MatchNotice } from '../model/types'
import { MatchPreviewModal } from './MatchPreviewModal'
import { ManualBookModal } from './ManualBookModal'

type SortField = 'fileName' | 'type' | 'reason' | 'title' | 'author' | 'isbn'

function fileExt(fileName: string): string {
    const dot = fileName.lastIndexOf('.')
    return dot >= 0 ? fileName.slice(dot + 1).toUpperCase() : ''
}
type SortDir = 'asc' | 'desc'

type UnresolvedFilesSectionProps = {
    discoveredQuery: string
    onSetDiscoveredQuery: (value: string) => void
    matchNotice: MatchNotice | null
    discoveredItems: DiscoveredFile[]
    matchDrafts: Record<string, MatchDraft>
    onSetMatchDraft: (fileId: string, patch: MatchDraft) => void
    onPreviewMatch: (input: { fileId: string; title?: string; author?: string; isbn?: string }) => Promise<MatchPreview>
    onConfirmMatch: (input: { fileId: string; title?: string; author?: string; isbn?: string }) => Promise<MatchResult>
    onCreateManualBook: (input: { fileId: string; patch: BookPatch; tags: string[] }) => Promise<BookDetail>
    onAttemptMatchAll: () => void
    isPreviewMatchPending: boolean
    isAttemptMatchPending: boolean
    isAttemptMatchAllPending: boolean
    matchingFileId: string | null
    discoveredPage: number
    discoveredPages: number
    onPreviousDiscoveredPage: () => void
    onNextDiscoveredPage: () => void
}

function reasonBadge(reason: string) {
    const normalizedReason = reason.trim().toLowerCase()
    if (normalizedReason.startsWith('api_error') || normalizedReason.startsWith('api error')) {
        return { label: 'API Error', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' }
    }

    switch (reason) {
        case 'no_api_match':
            return { label: 'No Match', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' }
        case 'weak_lookup_keys':
            return { label: 'Weak Keys', color: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
        case 'low_confidence':
            return { label: 'Low Conf.', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' }
        case 'api_error':
            return { label: 'API Error', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' }
        case 'missing_lookup_keys':
            return { label: 'Missing Info', color: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
        default:
            return { label: reason.replaceAll('_', ' '), color: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
    }
}

export function UnresolvedFilesSection({
    discoveredQuery,
    onSetDiscoveredQuery,
    matchNotice,
    discoveredItems,
    matchDrafts,
    onSetMatchDraft,
    onPreviewMatch,
    onConfirmMatch,
    onCreateManualBook,
    onAttemptMatchAll,
    isPreviewMatchPending,
    isAttemptMatchPending,
    isAttemptMatchAllPending,
    matchingFileId,
    discoveredPage,
    discoveredPages,
    onPreviousDiscoveredPage,
    onNextDiscoveredPage,
}: UnresolvedFilesSectionProps) {
    const [sortField, setSortField] = useState<SortField | null>(null)
    const [sortDir, setSortDir] = useState<SortDir>('asc')
    const [previewData, setPreviewData] = useState<MatchPreview | null>(null)
    const [previewingFileId, setPreviewingFileId] = useState<string | null>(null)
    const [manualFile, setManualFile] = useState<DiscoveredFile | null>(null)

    function toggleSort(field: SortField) {
        if (sortField === field) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
            setSortField(field)
            setSortDir('asc')
        }
    }

    function sortIcon(field: SortField) {
        if (sortField !== field) return <ArrowUpDown size={12} className="ml-1 inline opacity-40" />
        return sortDir === 'asc'
            ? <ArrowUp size={12} className="ml-1 inline text-accent-500" />
            : <ArrowDown size={12} className="ml-1 inline text-accent-500" />
    }

    const sortedItems = useMemo(() => {
        if (!sortField) return discoveredItems

        // OPTIMIZATION (Bolt): Use Schwartzian transform (decorate-sort-undecorate) to pre-compute sort values.
        // This avoids calling expensive operations like sanitizeDisplayText (which uses 3 regexes)
        // O(N log N) times inside the sort loop, reducing them to exactly O(N) operations.
        const mapped = discoveredItems.map((item) => {
            let sortValue = ''
            switch (sortField) {
                case 'fileName': sortValue = item.fileName ?? ''; break
                case 'type': sortValue = fileExt(item.fileName); break
                case 'reason': sortValue = item.reason ?? ''; break
                case 'title': sortValue = sanitizeDisplayText(item.guessedTitle) ?? ''; break
                case 'author': sortValue = sanitizeDisplayText(item.guessedAuthor) ?? ''; break
                case 'isbn': sortValue = sanitizeDisplayText(item.guessedIsbn) ?? ''; break
            }
            return { item, sortValue }
        })

        mapped.sort((a, b) => {
            const cmp = a.sortValue.localeCompare(b.sortValue, undefined, { sensitivity: 'base' })
            return sortDir === 'asc' ? cmp : -cmp
        })

        return mapped.map((x) => x.item)
    }, [discoveredItems, sortField, sortDir])

    return (
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-6 dark:border-slate-700/60">
                <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">Unresolved Files</h3>
                    {discoveredItems.length > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            {discoveredItems.length} on this page
                        </span>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            aria-label="Search unresolved files"
                            className="w-52 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-slate-700 dark:bg-slate-900/30"
                            placeholder="Search unresolved files..."
                            value={discoveredQuery}
                            onChange={(event) => onSetDiscoveredQuery(event.target.value)}
                        />
                        {discoveredQuery ? (
                            <button
                                type="button"
                                aria-label="Clear unresolved files search"
                                title="Clear search"
                                onClick={() => onSetDiscoveredQuery('')}
                                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            >
                                <X size={14} />
                            </button>
                        ) : null}
                    </div>
                    <button
                        className="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
                        disabled={isAttemptMatchPending || isAttemptMatchAllPending || discoveredItems.length === 0}
                        onClick={onAttemptMatchAll}
                    >
                        <RefreshCw size={14} className={cx(isAttemptMatchAllPending && 'animate-spin')} />
                        {isAttemptMatchAllPending ? 'Matching All...' : 'Match All'}
                    </button>
                </div>
            </div>

            {/* Match notice */}
            {matchNotice ? (
                <div
                    className={cx(
                        'mx-6 mt-4 rounded-lg border px-3 py-2 text-sm',
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

            {/* Table */}
            <div className="overflow-x-auto px-3 py-4">
                {discoveredItems.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                        {discoveredQuery ? 'No unresolved files match your search.' : 'No unresolved files — great job! 🎉'}
                    </div>
                ) : (
                    <table className="w-full min-w-[980px] table-fixed border-separate border-spacing-0">
                        <colgroup>
                            <col className="w-[27%]" />
                            <col className="w-[6%]" />
                            <col className="w-[10%]" />
                            <col className="w-[19%]" />
                            <col className="w-[14%]" />
                            <col className="w-[7%]" />
                            <col className="w-[17%]" />
                        </colgroup>
                        <thead>
                            <tr className="text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <th className="border-b border-slate-100 px-2 py-2.5 dark:border-slate-700/60">
                                    <button type="button" className="inline-flex items-center hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('fileName')}>File{sortIcon('fileName')}</button>
                                </th>
                                <th className="border-b border-slate-100 px-2 py-2.5 dark:border-slate-700/60">
                                    <button type="button" className="inline-flex items-center hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('type')}>Type{sortIcon('type')}</button>
                                </th>
                                <th className="border-b border-slate-100 px-2 py-2.5 dark:border-slate-700/60">
                                    <button type="button" className="inline-flex items-center hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('reason')}>Reason{sortIcon('reason')}</button>
                                </th>
                                <th className="border-b border-slate-100 px-2 py-2.5 dark:border-slate-700/60">
                                    <button type="button" className="inline-flex items-center hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('title')}>Title{sortIcon('title')}</button>
                                </th>
                                <th className="border-b border-slate-100 px-2 py-2.5 dark:border-slate-700/60">
                                    <button type="button" className="inline-flex items-center hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('author')}>Author{sortIcon('author')}</button>
                                </th>
                                <th className="border-b border-slate-100 px-2 py-2.5 dark:border-slate-700/60">
                                    <button type="button" className="inline-flex items-center hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('isbn')}>ISBN{sortIcon('isbn')}</button>
                                </th>
                                <th className="border-b border-slate-100 px-1.5 py-2.5 text-right dark:border-slate-700/60" />
                            </tr>
                        </thead>
                        <tbody>
                            {sortedItems.map((file) => {
                                const cleanTitle = sanitizeDisplayText(file.guessedTitle)
                                const cleanAuthor = sanitizeDisplayText(file.guessedAuthor)
                                const cleanIsbn = sanitizeDisplayText(file.guessedIsbn)
                                const draft = matchDrafts[file.fileId] ?? {}
                                const titleValue = draft.title ?? cleanTitle ?? ''
                                const authorValue = draft.author ?? cleanAuthor ?? ''
                                const isbnValue = draft.isbn ?? cleanIsbn ?? ''
                                const isMatchingThisFile = isAttemptMatchPending && matchingFileId === file.fileId
                                const badge = reasonBadge(file.reason)

                                return (
                                    <tr
                                        key={file.fileId}
                                        className={cx(
                                            'group transition-colors',
                                            isMatchingThisFile
                                                ? 'bg-accent-50/60 dark:bg-accent-900/10'
                                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                                        )}
                                    >
                                        {/* File info */}
                                        <td className="border-b border-slate-50 px-2 py-2.5 dark:border-slate-800/60">
                                            <div className="min-w-0">
                                                <button
                                                    type="button"
                                                    className="truncate text-sm font-medium text-accent-600 hover:text-accent-700 hover:underline dark:text-accent-400 dark:hover:text-accent-300 max-w-full text-left"
                                                    title={`Open ${file.fileName}`}
                                                    onClick={() => api.openLocalFile(file.absPath)}
                                                >
                                                    {file.fileName}
                                                </button>
                                                <p className="truncate text-[11px] text-slate-400 dark:text-slate-500" title={formatDisplayPath(file.absPath)}>
                                                    {formatDisplayPath(file.absPath)}
                                                </p>
                                            </div>
                                        </td>

                                        {/* File type */}
                                        <td className="border-b border-slate-50 px-2 py-2.5 dark:border-slate-800/60">
                                            <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                                {fileExt(file.fileName) || '—'}
                                            </span>
                                        </td>

                                        {/* Reason badge */}
                                        <td className="border-b border-slate-50 px-2 py-2.5 dark:border-slate-800/60">
                                            <span
                                                className={cx('inline-block max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-[11px] font-medium', badge.color)}
                                                title={file.reason}
                                            >
                                                {badge.label}
                                            </span>
                                        </td>

                                        {/* Title input */}
                                        <td className="border-b border-slate-50 px-1.5 py-1.5 dark:border-slate-800/60">
                                            <input
                                                aria-label={`Title for ${file.fileName}`}
                                                className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-300 hover:border-slate-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400/30 dark:text-slate-200 dark:placeholder:text-slate-600 dark:hover:border-slate-600 dark:focus:border-accent-500"
                                                placeholder="Title"
                                                value={titleValue}
                                                onChange={(event) => onSetMatchDraft(file.fileId, { ...draft, title: event.target.value })}
                                            />
                                        </td>

                                        {/* Author input */}
                                        <td className="border-b border-slate-50 px-1.5 py-1.5 dark:border-slate-800/60">
                                            <input
                                                aria-label={`Author for ${file.fileName}`}
                                                className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-300 hover:border-slate-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400/30 dark:text-slate-200 dark:placeholder:text-slate-600 dark:hover:border-slate-600 dark:focus:border-accent-500"
                                                placeholder="Author"
                                                value={authorValue}
                                                onChange={(event) => onSetMatchDraft(file.fileId, { ...draft, author: event.target.value })}
                                            />
                                        </td>

                                        {/* ISBN input */}
                                        <td className="border-b border-slate-50 px-1.5 py-1.5 dark:border-slate-800/60">
                                            <input
                                                aria-label={`ISBN for ${file.fileName}`}
                                                className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-300 hover:border-slate-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400/30 dark:text-slate-200 dark:placeholder:text-slate-600 dark:hover:border-slate-600 dark:focus:border-accent-500"
                                                placeholder="ISBN"
                                                value={isbnValue}
                                                onChange={(event) => onSetMatchDraft(file.fileId, { ...draft, isbn: event.target.value })}
                                            />
                                        </td>

                                        {/* Actions */}
                                        <td className="border-b border-slate-50 px-1.5 py-2.5 text-right dark:border-slate-800/60">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <button
                                                    className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                                    disabled={isPreviewMatchPending || isAttemptMatchPending || isAttemptMatchAllPending}
                                                    onClick={() => setManualFile(file)}
                                                >
                                                    <BookPlus size={12} />
                                                    Manual
                                                </button>
                                                <button
                                                    className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-accent-500/40 bg-accent-50 px-2 py-1.5 text-[11px] font-medium text-accent-700 transition-colors hover:bg-accent-100 disabled:opacity-50 dark:border-accent-500/30 dark:bg-accent-900/20 dark:text-accent-300 dark:hover:bg-accent-900/40"
                                                    disabled={isPreviewMatchPending || isAttemptMatchPending || isAttemptMatchAllPending}
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
                                                >
                                                    {(isMatchingThisFile || previewingFileId === file.fileId) && (
                                                        <Loader2 size={12} className="animate-spin" />
                                                    )}
                                                    {isMatchingThisFile || previewingFileId === file.fileId ? 'Searching...' : 'Match'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            {discoveredPages > 1 ? (
                <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 dark:border-slate-700/60">
                    <button
                        className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        disabled={discoveredPage <= 1}
                        onClick={onPreviousDiscoveredPage}
                    >
                        Previous
                    </button>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                        Page {discoveredPage} / {discoveredPages}
                    </span>
                    <button
                        className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        disabled={discoveredPage >= discoveredPages}
                        onClick={onNextDiscoveredPage}
                    >
                        Next
                    </button>
                </div>
            ) : null}

            {/* Match preview modal */}
            {previewData && (
                <MatchPreviewModal
                    preview={previewData}
                    onConfirm={onConfirmMatch}
                    onClose={() => setPreviewData(null)}
                    onConfirmed={() => setPreviewData(null)}
                />
            )}
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
