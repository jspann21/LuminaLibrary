import { useEffect, useId, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { cx } from '../lib/cx'
import type { MatchPreview, MatchResult, MetadataCandidate } from '../../../lib/types'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type MatchPreviewModalProps = {
    preview: MatchPreview
    onConfirm: (input: { fileId: string; title?: string; author?: string; isbn?: string }) => Promise<MatchResult>
    onClose: () => void
    onConfirmed: () => void
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SOURCE_LABELS: Record<string, string> = {
    local_library: 'Existing Book',
    open_library: 'Open Library',
    google_books: 'Google Books',
}

const SOURCE_COLORS: Record<string, string> = {
    local_library: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    open_library: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    google_books: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
}

const PREVIEW_FIELDS: Array<{ key: keyof MetadataCandidate; label: string }> = [
    { key: 'title', label: 'Title' },
    { key: 'subtitle', label: 'Subtitle' },
    { key: 'authors', label: 'Authors' },
    { key: 'publisher', label: 'Publisher' },
    { key: 'publishDate', label: 'Published' },
    { key: 'isbn13', label: 'ISBN-13' },
    { key: 'isbn10', label: 'ISBN-10' },
    { key: 'language', label: 'Language' },
    { key: 'pageCount', label: 'Pages' },
    { key: 'description', label: 'Description' },
]

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fieldDisplayValue(candidate: MetadataCandidate, key: keyof MetadataCandidate): string {
    const value = candidate[key]
    if (value == null) return ''
    if (Array.isArray(value)) return value.join(', ')
    return String(value)
}

function confidenceBadge(confidence?: number) {
    if (confidence == null) return null
    const pct = Math.round(confidence * 100)
    const color =
        pct >= 80
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
            : pct >= 50
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
    return (
        <span className={cx('inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', color)}>
            {pct}%
        </span>
    )
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MatchPreviewModal({ preview, onConfirm, onClose, onConfirmed }: MatchPreviewModalProps) {
    const titleId = useId()
    const [selectedIdx, setSelectedIdx] = useState(0)
    const [isApplying, setIsApplying] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const candidates = preview.candidates
    const selected = candidates[selectedIdx] ?? null
    const noCandidates = candidates.length === 0

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return
            if (event.key !== 'Escape') return
            event.preventDefault()
            onClose()
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose])

    async function handleApprove() {
        if (!selected) return
        setIsApplying(true)
        setError(null)
        try {
            const input: { fileId: string; title?: string; author?: string; isbn?: string } = {
                fileId: preview.fileId,
            }
            // Pass the candidate's key fields so attempt_match can find and link it
            if (selected.title) input.title = selected.title
            if (selected.authors?.length) input.author = selected.authors[0]
            if (selected.isbn13) input.isbn = selected.isbn13
            else if (selected.isbn10) input.isbn = selected.isbn10

            const result = await onConfirm(input)
            if (result.matched) {
                onConfirmed()
                onClose()
            } else {
                setError(`Match was not confirmed: ${result.reason.replaceAll('_', ' ')}`)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to confirm match')
        } finally {
            setIsApplying(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="relative z-10 mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700/60">
                    <div>
                        <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                            Match Preview
                        </h2>
                        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                            {preview.fileName}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        title="Close"
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {noCandidates ? (
                        <div className="py-12 text-center">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                No matches found from any source.
                            </p>
                            {preview.sourceStatuses.map((s) => (
                                <p key={s.source} className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                                    {SOURCE_LABELS[s.source] ?? s.source}: {s.status}
                                    {s.message ? ` — ${s.message}` : ''}
                                </p>
                            ))}
                        </div>
                    ) : (
                        <>
                            {/* Candidate tabs */}
                            {candidates.length > 1 && (
                                <div className="mb-4 flex flex-wrap gap-2">
                                    {candidates.map((c, i) => {
                                        const sourceColor = SOURCE_COLORS[c.source] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                        const isActive = i === selectedIdx
                                        return (
                                            <button
                                                key={c.id}
                                                type="button"
                                                onClick={() => setSelectedIdx(i)}
                                                className={cx(
                                                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                                                    isActive
                                                        ? 'border-accent-400 bg-accent-50 text-accent-700 dark:border-accent-500 dark:bg-accent-900/20 dark:text-accent-300'
                                                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600',
                                                )}
                                            >
                                                <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', sourceColor)}>
                                                    {SOURCE_LABELS[c.source] ?? c.source}
                                                </span>
                                                <span className="max-w-[200px] truncate" title={c.title ?? 'Untitled'}>{c.title ?? 'Untitled'}</span>
                                                {confidenceBadge(c.confidence)}
                                                {isActive && <Check size={14} className="text-accent-500" />}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Selected candidate details */}
                            {selected && (
                                <div className="space-y-1">
                                    {/* Source + confidence header */}
                                    <div className="mb-3 flex items-center gap-2">
                                        <span
                                            className={cx(
                                                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                                                SOURCE_COLORS[selected.source] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                                            )}
                                        >
                                            {SOURCE_LABELS[selected.source] ?? selected.source}
                                        </span>
                                        {confidenceBadge(selected.confidence)}
                                    </div>

                                    {/* Fields table */}
                                    <table className="w-full">
                                        <tbody>
                                            {PREVIEW_FIELDS.map(({ key, label }) => {
                                                const value = fieldDisplayValue(selected, key)
                                                if (!value) return null
                                                return (
                                                    <tr key={key} className="border-b border-slate-50 dark:border-slate-800/60">
                                                        <td className="w-28 py-2 pr-3 text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                                            {label}
                                                        </td>
                                                        <td className="py-2 text-sm text-slate-700 dark:text-slate-200">
                                                            {key === 'description' ? (
                                                                <span className="line-clamp-3" title={value}>{value}</span>
                                                            ) : (
                                                                value
                                                            )}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}

                    {/* Error message */}
                    {error && (
                        <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 dark:border-slate-700/60">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    {!noCandidates && (
                        <button
                            type="button"
                            onClick={handleApprove}
                            disabled={isApplying || !selected}
                            className="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
                        >
                            {isApplying ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Applying...
                                </>
                            ) : (
                                <>
                                    <Check size={14} />
                                    Approve Match
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
