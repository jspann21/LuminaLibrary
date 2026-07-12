import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { motion } from 'motion/react'
import { Check, ImagePlus, Link2, Loader2, Search, Trash2, Upload, X } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { cx } from '../lib/cx'
import {
    buildCoverImageSearchQuery,
    combineCoverCandidates,
    getDefaultCoverImageSearchFields,
    getCoverImageSearchValues,
} from '../lib/coverImageSearch'
import type { CoverImageSearchField } from '../lib/coverImageSearch'
import { api } from '../../../lib/api'
import type { CoverCandidate } from '../../../lib/types'

type CoverPickerModalProps = {
    bookId: string
    currentCoverUrl: string
    bookTitle: string
    bookAuthors: string
    bookIsbn10: string
    bookIsbn13: string
    onSelect: (url: string) => void
    onClose: () => void
}

type CoverSearchState =
    | { bookId: string; status: 'loading'; candidates: CoverCandidate[]; error: null }
    | { bookId: string; status: 'success'; candidates: CoverCandidate[]; error: null }
    | { bookId: string; status: 'error'; candidates: CoverCandidate[]; error: string }

const SOURCE_LABELS: Record<string, string> = {
    current: 'Current',
    open_library: 'Open Library',
    google_books: 'Google Books',
    brave: 'Brave Search',
    local: 'Local File',
    custom: 'Custom URL',
}

const SOURCE_COLORS: Record<string, string> = {
    current: 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300',
    open_library: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    google_books: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    brave: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    local: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    custom: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const IMAGE_LOAD_TIMEOUT_MS = 8000
const IMAGE_SEARCH_FIELD_LABELS: Record<CoverImageSearchField, string> = {
    isbn: 'ISBN',
    title: 'Title',
    author: 'Author',
}

function getCustomCoverUrlFormatError(value: string) {
    const url = value.trim()
    if (!url) return null

    try {
        const parsed = new URL(url)
        if (parsed.protocol === 'data:') {
            return url.toLowerCase().startsWith('data:image/') ? null : 'Paste a direct image URL. Data URLs must start with data:image/.'
        }
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:') return null
    } catch {
        return 'Paste a valid image URL.'
    }

    return 'Paste a direct image URL that starts with http://, https://, blob:, or data:image/.'
}

function getInputValueAfterPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pastedText = event.clipboardData.getData('text')
    const input = event.currentTarget
    const selectionStart = input.selectionStart ?? input.value.length
    const selectionEnd = input.selectionEnd ?? selectionStart
    return `${input.value.slice(0, selectionStart)}${pastedText}${input.value.slice(selectionEnd)}`
}

function canLoadImageUrl(url: string, signal: AbortSignal) {
    return new Promise<boolean>((resolve) => {
        const image = new Image()
        let settled = false
        let timeoutId = 0

        const finish = (result: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timeoutId)
            signal.removeEventListener('abort', handleAbort)
            image.onload = null
            image.onerror = null
            if (!result) image.src = ''
            resolve(result)
        }
        const handleAbort = () => finish(false)

        timeoutId = window.setTimeout(() => finish(false), IMAGE_LOAD_TIMEOUT_MS)
        image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0)
        image.onerror = () => finish(false)
        signal.addEventListener('abort', handleAbort, { once: true })
        if (signal.aborted) {
            finish(false)
            return
        }
        image.referrerPolicy = 'no-referrer'
        image.src = url
    })
}

export function CoverPickerModal({
    bookId,
    currentCoverUrl,
    bookTitle,
    bookAuthors,
    bookIsbn10,
    bookIsbn13,
    onSelect,
    onClose,
}: CoverPickerModalProps) {
    const imageSearchData = {
        isbn10: bookIsbn10,
        isbn13: bookIsbn13,
        title: bookTitle,
        author: bookAuthors,
    }
    const [coverSearch, setCoverSearch] = useState<CoverSearchState>({
        bookId,
        status: 'loading',
        candidates: [],
        error: null,
    })
    const [selectedUrl, setSelectedUrl] = useState<string>(currentCoverUrl)
    const [customUrl, setCustomUrl] = useState('')
    const [customUrlError, setCustomUrlError] = useState<string | null>(null)
    const [isCheckingCustomUrl, setIsCheckingCustomUrl] = useState(false)
    const [showUrlInput, setShowUrlInput] = useState(false)
    const [showImageSearch, setShowImageSearch] = useState(false)
    const [imageSearchFields, setImageSearchFields] = useState<CoverImageSearchField[]>(
        () => getDefaultCoverImageSearchFields(imageSearchData),
    )
    const [imageSearchError, setImageSearchError] = useState<string | null>(null)
    const [isSearchingImages, setIsSearchingImages] = useState(false)
    const [imageSearchResults, setImageSearchResults] = useState<CoverCandidate[]>([])
    const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
    const mountedRef = useRef(true)
    const customUrlRef = useRef(customUrl)
    const customUrlCheckRef = useRef(0)
    const customUrlAbortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            customUrlAbortRef.current?.abort()
        }
    }, [])

    useEffect(() => {
        customUrlRef.current = customUrl
    }, [customUrl])

    useEffect(() => {
        let cancelled = false
        api
            .searchCoverCandidates(bookId)
            .then((result) => {
                if (!cancelled) setCoverSearch({ bookId, status: 'success', candidates: result, error: null })
            })
            .catch((err) => {
                if (!cancelled) {
                    setCoverSearch({
                        bookId,
                        status: 'error',
                        candidates: [],
                        error: err instanceof Error ? err.message : 'Failed to search for covers',
                    })
                }
            })
        return () => {
            cancelled = true
        }
    }, [bookId])

    const baseCandidates = coverSearch.bookId === bookId ? coverSearch.candidates : []
    const candidates = combineCoverCandidates(baseCandidates, imageSearchResults)
    const isLoading = (coverSearch.bookId !== bookId || coverSearch.status === 'loading') && candidates.length === 0
    const error = coverSearch.bookId === bookId && candidates.length === 0 ? coverSearch.error : null

    const handleUpload = async () => {
        try {
            const selected = await api.browseForImage()
            if (!mountedRef.current) return
            if (!selected) return
            const fileUrl = convertFileSrc(selected)
            const uploadCandidate: CoverCandidate = { url: fileUrl, source: 'local' }
            setCoverSearch((prev) => ({
                bookId,
                status: 'success',
                candidates: [uploadCandidate, ...(prev.bookId === bookId ? prev.candidates : [])],
                error: null,
            }))
            setSelectedUrl(fileUrl)
        } catch (err) {
            if (!mountedRef.current) return
            setCoverSearch((prev) => ({
                bookId,
                status: 'error',
                candidates: prev.bookId === bookId ? prev.candidates : [],
                error: err instanceof Error ? err.message : 'Failed to select image',
            }))
        }
    }

    const validateCustomImageUrl = async (url: string) => {
        const formatError = getCustomCoverUrlFormatError(url)
        if (formatError) {
            customUrlAbortRef.current?.abort()
            customUrlAbortRef.current = null
            customUrlCheckRef.current += 1
            setIsCheckingCustomUrl(false)
            setCustomUrlError(formatError)
            return false
        }

        const checkId = customUrlCheckRef.current + 1
        customUrlCheckRef.current = checkId
        customUrlAbortRef.current?.abort()
        const abortController = new AbortController()
        customUrlAbortRef.current = abortController
        setCustomUrlError(null)
        setIsCheckingCustomUrl(true)

        const didLoad = await canLoadImageUrl(url, abortController.signal)
        if (customUrlAbortRef.current === abortController) customUrlAbortRef.current = null
        if (!mountedRef.current || customUrlCheckRef.current !== checkId || customUrlRef.current.trim() !== url) return false

        setIsCheckingCustomUrl(false)
        if (!didLoad) {
            setCustomUrlError('That link did not load as an image. Paste a direct image URL.')
            return false
        }

        setCustomUrlError(null)
        return true
    }

    const handleCustomUrl = async () => {
        const url = customUrl.trim()
        if (!url) return
        const isValidImageUrl = await validateCustomImageUrl(url)
        if (!isValidImageUrl) return
        const urlCandidate: CoverCandidate = { url, source: 'custom' }
        setCoverSearch((prev) => {
            const previousCandidates = prev.bookId === bookId ? prev.candidates : []
            if (previousCandidates.some((c) => c.url === url)) return prev
            return { bookId, status: 'success', candidates: [urlCandidate, ...previousCandidates], error: null }
        })
        setSelectedUrl(url)
        setCustomUrl('')
        setCustomUrlError(null)
        setShowUrlInput(false)
    }

    const handleRemoveCover = () => {
        onSelect('')
    }

    const handleApply = () => {
        onSelect(selectedUrl)
    }

    const handleImageError = (url: string) => {
        setFailedUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url)))
    }

    const handleCustomUrlPaste = (event: ClipboardEvent<HTMLInputElement>) => {
        const nextUrl = getInputValueAfterPaste(event).trim()
        event.preventDefault()
        customUrlRef.current = nextUrl
        setCustomUrl(nextUrl)
        if (!nextUrl) {
            customUrlAbortRef.current?.abort()
            customUrlAbortRef.current = null
            customUrlCheckRef.current += 1
            setIsCheckingCustomUrl(false)
            setCustomUrlError(null)
            return
        }
        void validateCustomImageUrl(nextUrl)
    }

    const handleCustomUrlChange = (value: string) => {
        customUrlAbortRef.current?.abort()
        customUrlAbortRef.current = null
        customUrlCheckRef.current += 1
        customUrlRef.current = value
        setCustomUrl(value)
        setIsCheckingCustomUrl(false)
        if (!value.trim()) {
            setCustomUrlError(null)
            return
        }
        if (customUrlError) setCustomUrlError(getCustomCoverUrlFormatError(value))
    }

    const handleToggleUrlInput = () => {
        if (showUrlInput) {
            customUrlAbortRef.current?.abort()
            customUrlAbortRef.current = null
        }
        setShowUrlInput((value) => {
            if (value) setCustomUrlError(null)
            if (!value) setShowImageSearch(false)
            return !value
        })
    }

    const imageSearchValues = getCoverImageSearchValues(imageSearchData)
    const imageSearchQuery = buildCoverImageSearchQuery(imageSearchFields, imageSearchData)

    const handleToggleImageSearch = () => {
        setShowImageSearch((value) => {
            if (!value) {
                setShowUrlInput(false)
                setImageSearchError(null)
            }
            return !value
        })
    }

    const handleToggleImageSearchField = (field: CoverImageSearchField) => {
        if (!imageSearchValues[field]) return
        setImageSearchFields((fields) => (
            fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field]
        ))
        setImageSearchError(null)
    }

    const handleImageSearch = async () => {
        if (!imageSearchQuery) {
            setImageSearchError('Select at least one available book detail to search.')
            return
        }

        setImageSearchError(null)
        setIsSearchingImages(true)
        try {
            const results = await api.searchBraveCoverImages(imageSearchQuery)
            if (!mountedRef.current) return
            if (results.length === 0) {
                setImageSearchError('No image results found. Try a different combination of book details.')
                return
            }
            setImageSearchResults(results)
            setShowImageSearch(false)
        } catch (err) {
            if (!mountedRef.current) return
            setImageSearchError(err instanceof Error ? err.message : 'Image search failed')
        } finally {
            if (mountedRef.current) setIsSearchingImages(false)
        }
    }

    const visibleCandidates = candidates.filter((c) => !failedUrls.has(c.url))

    return (
        <>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="fixed inset-0 z-[60] bg-slate-950/50 backdrop-blur-sm"
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                className="fixed inset-4 z-[61] mx-auto my-auto flex max-h-[min(85vh,700px)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Choose Cover Image</h2>
                        <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">{bookTitle || 'Untitled'}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{bookAuthors || 'Unknown Author'}</p>
                    </div>
                    <button aria-label="Close" title="Close" onClick={onClose} className="rounded-full p-2 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-800">
                        <X size={18} className="text-slate-500 dark:text-slate-400" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
                    <button
                        onClick={() => { void handleUpload() }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                        <Upload size={14} />
                        Upload Image
                    </button>
                    <button
                        onClick={handleToggleUrlInput}
                        className={cx(
                            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                            showUrlInput
                                ? 'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-700 dark:bg-accent-900/20 dark:text-accent-300'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                        )}
                    >
                        <Link2 size={14} />
                        Paste URL
                    </button>
                    <button
                        onClick={handleToggleImageSearch}
                        className={cx(
                            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                            showImageSearch
                                ? 'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-700 dark:bg-accent-900/20 dark:text-accent-300'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                        )}
                    >
                        <Search size={14} />
                        Search Images
                    </button>
                    <button
                        onClick={handleRemoveCover}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-800 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-900/20"
                    >
                        <Trash2 size={14} />
                        Remove Cover
                    </button>
                </div>

                {/* Embedded Image Search */}
                {showImageSearch ? (
                    <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                        <div className="flex flex-col gap-3">
                            <div>
                                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Search using</p>
                                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Choose one or more book details. Results appear in this cover grid.</p>
                            </div>
                            <div role="group" aria-label="Book details to search" className="flex flex-wrap gap-2">
                                {(Object.keys(IMAGE_SEARCH_FIELD_LABELS) as CoverImageSearchField[]).map((field) => {
                                    const value = imageSearchValues[field]
                                    const isSelected = imageSearchFields.includes(field)
                                    return (
                                        <button
                                            key={field}
                                            type="button"
                                            aria-pressed={isSelected}
                                            disabled={!value}
                                            onClick={() => handleToggleImageSearchField(field)}
                                            title={value || `${IMAGE_SEARCH_FIELD_LABELS[field]} is unavailable`}
                                            className={cx(
                                                'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40',
                                                isSelected
                                                    ? 'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-700 dark:bg-accent-900/20 dark:text-accent-300'
                                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                                            )}
                                        >
                                            <span className={cx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border', isSelected ? 'border-accent-500 bg-accent-600' : 'border-slate-300 dark:border-slate-600')}>
                                                {isSelected ? <Check size={10} className="text-white" /> : null}
                                            </span>
                                            <span className="font-semibold">{IMAGE_SEARCH_FIELD_LABELS[field]}</span>
                                            {value ? <span className="max-w-52 truncate text-slate-400 dark:text-slate-500">{value}</span> : null}
                                        </button>
                                    )
                                })}
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="min-w-0 truncate font-mono text-xs text-slate-400" title={imageSearchQuery || undefined}>
                                    {imageSearchQuery || 'Select a search field'}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => { void handleImageSearch() }}
                                    disabled={!imageSearchQuery || isSearchingImages}
                                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-700 disabled:opacity-50"
                                >
                                    {isSearchingImages ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                                    {isSearchingImages ? 'Searching' : 'Search'}
                                </button>
                            </div>
                            {imageSearchError ? <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{imageSearchError}</p> : null}
                        </div>
                    </div>
                ) : null}

                {/* URL Input */}
                {showUrlInput ? (
                    <div className="border-b border-slate-100 px-6 py-3 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                            <input
                                aria-label="Cover image URL"
                                type="url"
                                value={customUrl}
                                onChange={(e) => handleCustomUrlChange(e.target.value)}
                                onPaste={handleCustomUrlPaste}
                                onKeyDown={(e) => { if (e.key === 'Enter') void handleCustomUrl() }}
                                placeholder="https://example.com/cover.jpg"
                                aria-invalid={customUrlError ? true : undefined}
                                aria-describedby={customUrlError || isCheckingCustomUrl ? 'cover-url-status' : undefined}
                                className={cx(
                                    'min-w-0 flex-1 rounded-lg border bg-slate-50 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500',
                                    customUrlError
                                        ? 'border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-200 dark:border-rose-700 dark:focus:ring-rose-900/40'
                                        : 'border-slate-200 dark:border-slate-700',
                                )}
                                autoFocus
                            />
                            <button
                                onClick={() => { void handleCustomUrl() }}
                                disabled={!customUrl.trim() || isCheckingCustomUrl}
                                className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-700 disabled:opacity-50"
                            >
                                {isCheckingCustomUrl ? 'Checking' : 'Add'}
                            </button>
                        </div>
                        {customUrlError ? (
                            <p id="cover-url-status" role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">
                                {customUrlError}
                            </p>
                        ) : isCheckingCustomUrl ? (
                            <p id="cover-url-status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                Checking image link...
                            </p>
                        ) : null}
                    </div>
                ) : null}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-16">
                            <Loader2 size={28} className="animate-spin text-accent-500" />
                            <p className="text-sm text-slate-500 dark:text-slate-400">Searching Open Library & Google Books…</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-16">
                            <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
                        </div>
                    ) : visibleCandidates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-16">
                            <ImagePlus size={36} className="text-slate-300 dark:text-slate-600" />
                            <p className="text-sm text-slate-500 dark:text-slate-400">No cover images found. Try image search, upload an image, or paste a URL.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
                            {visibleCandidates.map((candidate) => {
                                const isSelected = selectedUrl === candidate.url
                                return (
                                    <button
                                        key={candidate.url}
                                        onClick={() => setSelectedUrl(candidate.url)}
                                        className={cx(
                                            'group relative flex flex-col overflow-hidden rounded-xl border-2 transition-all',
                                            isSelected
                                                ? 'border-accent-500 shadow-lg shadow-accent-500/20 ring-2 ring-accent-500/30'
                                                : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
                                        )}
                                    >
                                        <div className="relative aspect-[2/3] w-full bg-slate-100 dark:bg-slate-800">
                                            <img
                                                src={candidate.thumbnailUrl || candidate.url}
                                                alt={candidate.title || 'Cover candidate'}
                                                title={candidate.title || undefined}
                                                className="h-full w-full object-cover"
                                                loading="lazy"
                                                referrerPolicy="no-referrer"
                                                onError={() => handleImageError(candidate.url)}
                                            />
                                            {isSelected ? (
                                                <div className="absolute inset-0 flex items-center justify-center bg-accent-600/20">
                                                    <div className="rounded-full bg-accent-600 p-1.5 shadow-lg">
                                                        <Check size={14} className="text-white" />
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="px-1.5 py-1.5">
                                            <span
                                                className={cx(
                                                    'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                                                    SOURCE_COLORS[candidate.source] || SOURCE_COLORS.custom,
                                                )}
                                            >
                                                {SOURCE_LABELS[candidate.source] || candidate.source}
                                            </span>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
                    <button
                        onClick={onClose}
                        className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={selectedUrl === currentCoverUrl}
                        className="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-700 disabled:opacity-50"
                    >
                        <Check size={16} />
                        Apply
                    </button>
                </div>
            </motion.div>
        </>
    )
}
