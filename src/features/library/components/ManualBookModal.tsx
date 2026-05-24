import { useState } from 'react'
import { BookPlus, Check, Loader2, X } from 'lucide-react'
import type { BookDetail, BookPatch, DiscoveredFile } from '../../../lib/types'
import { formatDisplayPath } from '../../../lib/format'

type ManualBookModalProps = {
    file: DiscoveredFile
    initialTitle: string
    initialAuthor: string
    initialIsbn: string
    onCreate: (input: { fileId: string; patch: BookPatch; tags: string[] }) => Promise<BookDetail>
    onClose: () => void
    onCreated: (detail: BookDetail) => void
}

type ManualBookForm = {
    title: string
    subtitle: string
    authors: string
    publisher: string
    publishDate: string
    isbn10: string
    isbn13: string
    language: string
    pageCount: string
    series: string
    seriesIndex: string
    description: string
    coverUrl: string
    tags: string
}

const labelClass = 'mb-1 block text-xs font-medium uppercase text-slate-500 dark:text-slate-400'
const inputClass =
    'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200 dark:placeholder:text-slate-600'

function splitList(value: string): string[] {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
}

function textValue(value: string): string | undefined {
    const trimmed = value.trim()
    return trimmed || undefined
}

function numberValue(value: string): number | undefined {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isNaN(parsed) ? undefined : parsed
}

function splitIsbn(initialIsbn: string) {
    const normalized = initialIsbn.replace(/[^0-9Xx]/g, '').toUpperCase()
    if (normalized.length === 10) return { isbn10: normalized, isbn13: '' }
    if (normalized.length === 13) return { isbn10: '', isbn13: normalized }
    return { isbn10: '', isbn13: initialIsbn }
}

export function ManualBookModal({
    file,
    initialTitle,
    initialAuthor,
    initialIsbn,
    onCreate,
    onClose,
    onCreated,
}: ManualBookModalProps) {
    const initialIsbns = splitIsbn(initialIsbn)
    const [form, setForm] = useState<ManualBookForm>({
        title: initialTitle,
        subtitle: '',
        authors: initialAuthor,
        publisher: '',
        publishDate: '',
        isbn10: initialIsbns.isbn10,
        isbn13: initialIsbns.isbn13,
        language: '',
        pageCount: '',
        series: '',
        seriesIndex: '',
        description: '',
        coverUrl: '',
        tags: '',
    })
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const updateField = (field: keyof ManualBookForm, value: string) => {
        setForm((current) => ({ ...current, [field]: value }))
    }

    const submit = async () => {
        const title = textValue(form.title)
        if (!title) {
            setError('Title is required.')
            return
        }

        const authors = splitList(form.authors)
        const patch: BookPatch = {
            title,
            ...(authors.length > 0 ? { authors } : {}),
            ...(textValue(form.subtitle) ? { subtitle: textValue(form.subtitle) } : {}),
            ...(textValue(form.publisher) ? { publisher: textValue(form.publisher) } : {}),
            ...(textValue(form.publishDate) ? { publishDate: textValue(form.publishDate) } : {}),
            ...(textValue(form.isbn10) ? { isbn10: textValue(form.isbn10) } : {}),
            ...(textValue(form.isbn13) ? { isbn13: textValue(form.isbn13) } : {}),
            ...(textValue(form.language) ? { language: textValue(form.language) } : {}),
            ...(numberValue(form.pageCount) === undefined ? {} : { pageCount: numberValue(form.pageCount) }),
            ...(textValue(form.series) ? { series: textValue(form.series) } : {}),
            ...(numberValue(form.seriesIndex) === undefined ? {} : { seriesIndex: numberValue(form.seriesIndex) }),
            ...(textValue(form.description) ? { description: textValue(form.description) } : {}),
            ...(textValue(form.coverUrl) ? { coverUrl: textValue(form.coverUrl) } : {}),
        }

        setIsSaving(true)
        setError(null)
        try {
            const detail = await onCreate({
                fileId: file.fileId,
                patch,
                tags: splitList(form.tags),
            })
            onCreated(detail)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add book manually.')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative z-10 mx-4 flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700/60">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <BookPlus size={18} className="text-accent-500" />
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Add Book Manually</h2>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400" title={formatDisplayPath(file.absPath)}>
                            {file.fileName}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close manual book form"
                        title="Close"
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                            <label htmlFor="manual-book-title" className={labelClass}>Title <span className="text-rose-500">*</span></label>
                            <input id="manual-book-title" className={inputClass} value={form.title} onChange={(event) => updateField('title', event.target.value)} />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="manual-book-subtitle" className={labelClass}>Subtitle</label>
                            <input id="manual-book-subtitle" className={inputClass} value={form.subtitle} onChange={(event) => updateField('subtitle', event.target.value)} />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="manual-book-authors" className={labelClass}>Author(s)</label>
                            <input id="manual-book-authors" className={inputClass} value={form.authors} onChange={(event) => updateField('authors', event.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="manual-book-publisher" className={labelClass}>Publisher</label>
                            <input id="manual-book-publisher" className={inputClass} value={form.publisher} onChange={(event) => updateField('publisher', event.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="manual-book-publishDate" className={labelClass}>Published</label>
                            <input id="manual-book-publishDate" type="date" className={inputClass} value={form.publishDate} onChange={(event) => updateField('publishDate', event.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="manual-book-isbn13" className={labelClass}>ISBN-13</label>
                            <input id="manual-book-isbn13" className={inputClass} value={form.isbn13} onChange={(event) => updateField('isbn13', event.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="manual-book-isbn10" className={labelClass}>ISBN-10</label>
                            <input id="manual-book-isbn10" className={inputClass} value={form.isbn10} onChange={(event) => updateField('isbn10', event.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="manual-book-language" className={labelClass}>Language</label>
                            <input id="manual-book-language" className={inputClass} value={form.language} onChange={(event) => updateField('language', event.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="manual-book-pageCount" className={labelClass}>Pages</label>
                            <input id="manual-book-pageCount" type="number" className={inputClass} value={form.pageCount} onChange={(event) => updateField('pageCount', event.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="manual-book-series" className={labelClass}>Series</label>
                            <input id="manual-book-series" className={inputClass} value={form.series} onChange={(event) => updateField('series', event.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="manual-book-seriesIndex" className={labelClass}>Series #</label>
                            <input id="manual-book-seriesIndex" type="number" className={inputClass} value={form.seriesIndex} onChange={(event) => updateField('seriesIndex', event.target.value)} />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="manual-book-coverUrl" className={labelClass}>Cover URL</label>
                            <input id="manual-book-coverUrl" className={inputClass} value={form.coverUrl} onChange={(event) => updateField('coverUrl', event.target.value)} />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="manual-book-tags" className={labelClass}>Tags</label>
                            <input id="manual-book-tags" className={inputClass} value={form.tags} onChange={(event) => updateField('tags', event.target.value)} />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="manual-book-description" className={labelClass}>Description</label>
                            <textarea id="manual-book-description"
                                className={`${inputClass} h-32 resize-none`}
                                value={form.description}
                                onChange={(event) => updateField('description', event.target.value)}
                            />
                        </div>
                    </div>

                    {error ? (
                        <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
                            {error}
                        </div>
                    ) : null}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 dark:border-slate-700/60">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => void submit()}
                        disabled={isSaving}
                        className="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        {isSaving ? 'Adding...' : 'Add to Library'}
                    </button>
                </div>
            </div>
        </div>
    )
}
