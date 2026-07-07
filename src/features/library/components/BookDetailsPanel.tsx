import { useState } from 'react'
import { motion } from 'motion/react'
import { BookOpen, Check, ExternalLink, EyeOff, FolderOpen, ImagePlus, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { formatBytes, formatDate, formatDisplayPath } from '../../../lib/format'
import type { BookDetail, BookPatch } from '../../../lib/types'
import { cx } from '../lib/cx'
import { buildDetailForm } from '../model/selectors'
import type { BookDetailsPanelProps, DetailFormState, RescanNotice } from '../model/types'
import { CoverThumb } from './CoverThumb'
import { CoverPickerModal } from './CoverPickerModal'
import { RescanMetadataModal } from './RescanMetadataModal'

type DraftState = {
  form: DetailFormState
  tags: string[]
  newTag: string
}

const detailSecondaryButtonClass =
  'transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-200'

const detailDangerButtonClass =
  'transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-rose-900/20 dark:hover:text-rose-400'

const detailWarningButtonClass =
  'transition-colors hover:bg-amber-50 hover:text-amber-700 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-amber-900/20 dark:hover:text-amber-300'

function buildPatchFromDetail(detail: BookDetail): BookPatch {
  return {
    title: detail.title,
    subtitle: detail.subtitle ?? '',
    authors: detail.authors,
    publisher: detail.publisher ?? '',
    publishDate: detail.publishDate ?? '',
    isbn10: detail.isbn10 ?? '',
    isbn13: detail.isbn13 ?? '',
    description: detail.description ?? '',
    language: detail.language ?? '',
    series: detail.series ?? '',
    coverUrl: detail.coverUrl ?? '',
    ...(detail.pageCount === undefined ? {} : { pageCount: detail.pageCount }),
    ...(detail.seriesIndex === undefined ? {} : { seriesIndex: detail.seriesIndex }),
  }
}

export function BookDetailsPanel({
  book,
  onClose,
  onSave,
  onPreviewRescan,
  onApplyCuratedMetadata,
  onOpenFile,
  onOpenFolder,
  onOpenLibraryThingUrl,
  onRequestHide,
  onRequestDelete,
  isSaving,
  isHiding,
  isDeleting,
}: BookDetailsPanelProps) {
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [rescanNotice, setRescanNotice] = useState<RescanNotice | null>(null)
  const [undoSnapshot, setUndoSnapshot] = useState<BookDetail | null>(null)
  const [isUndoing, setIsUndoing] = useState(false)
  const [showCoverPicker, setShowCoverPicker] = useState(false)
  const [showRescanModal, setShowRescanModal] = useState(false)
  const resolvedPrimaryFile = book.files.find((file) => file.status !== 'missing') ?? book.files.at(0) ?? null
  const [savedPrimaryFile, setSavedPrimaryFile] = useState<typeof resolvedPrimaryFile>(null)
  const primaryFile = resolvedPrimaryFile ?? savedPrimaryFile
  const isEditing = Boolean(draft)
  const form = draft?.form ?? buildDetailForm(book)
  const tags = draft?.tags ?? book.tags
  const newTag = draft?.newTag ?? ''
  const detailInputId = (field: string) => `book-detail-${book.id}-${field}`
  const displayPathFor = (absPath: string) => formatDisplayPath(absPath)
  const fileNameFor = (absPath: string) => displayPathFor(absPath).split(/[\\/]/).pop() ?? displayPathFor(absPath)
  const folderPathFor = (absPath: string) => {
    const displayPath = displayPathFor(absPath)
    const separatorIndex = Math.max(displayPath.lastIndexOf('\\'), displayPath.lastIndexOf('/'))
    return separatorIndex > 0 ? displayPath.slice(0, separatorIndex) : displayPath
  }

  const startEdit = () => {
    setSavedPrimaryFile(primaryFile)
    setDraft({
      form: buildDetailForm(book),
      tags: [...book.tags],
      newTag: '',
    })
  }

  const cancelEdit = () => {
    setDraft(null)
  }

  const updateForm = (update: (current: DetailFormState) => DetailFormState) => {
    setDraft((current) => (current ? { ...current, form: update(current.form) } : current))
  }

  const setNewTag = (value: string) => {
    setDraft((current) => (current ? { ...current, newTag: value } : current))
  }

  const addTag = (rawValue: string) => {
    const value = rawValue.trim()
    if (!value) return
    setDraft((current) => {
      if (!current) return current
      if (current.tags.some((item) => item.toLowerCase() === value.toLowerCase())) return current
      return { ...current, tags: [...current.tags, value], newTag: '' }
    })
  }

  const removeTag = (value: string) => {
    setDraft((current) => (current ? { ...current, tags: current.tags.filter((item) => item !== value) } : current))
  }

  const saveChanges = async () => {
    setSavedPrimaryFile(primaryFile)
    const authors = form.authors
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    const trimmedSubtitle = form.subtitle.trim()
    const patch = {
      title: form.title,
      ...(trimmedSubtitle ? { subtitle: trimmedSubtitle } : { subtitle: '' }),
      authors,
      publisher: form.publisher,
      publishDate: form.publishDate,
      isbn10: form.isbn10,
      isbn13: form.isbn13,
      description: form.description,
      language: form.language,
      series: form.series,
      coverUrl: form.coverUrl,
    }

    const pageCount = Number.parseInt(form.pageCount, 10)
    const seriesIndex = Number.parseInt(form.seriesIndex, 10)
    await onSave({
      bookId: book.id,
      patch: {
        ...patch,
        ...(Number.isNaN(pageCount) ? {} : { pageCount }),
        ...(Number.isNaN(seriesIndex) ? {} : { seriesIndex }),
      },
      tags,
    })
    setDraft(null)
  }

  const undoCurated = async () => {
    if (!undoSnapshot || isUndoing) return
    setIsUndoing(true)
    setRescanNotice({ tone: 'loading', message: 'Reverting curated metadata...' })
    try {
      await onSave({
        bookId: undoSnapshot.id,
        patch: buildPatchFromDetail(undoSnapshot),
        tags: undoSnapshot.tags,
      })
      setUndoSnapshot(null)
      setRescanNotice({ tone: 'success', message: 'Curated metadata changes were reverted.' })
    } catch (error) {
      setRescanNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to undo curated metadata changes.',
      })
    } finally {
      setIsUndoing(false)
    }
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm" />
      <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-slate-800">
          <h2 className="font-semibold text-slate-900 dark:text-white">Book Details</h2>
          <div className="flex items-center gap-2">
            {isEditing ? <button onClick={cancelEdit} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">Cancel</button> : null}
            <button aria-label="Close book details" title="Close book details" onClick={onClose} className="rounded-full p-2 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-800"><X size={20} className="text-slate-500 dark:text-slate-400" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-8 flex gap-6">
            <button
              type="button"
              onClick={() => setShowCoverPicker(true)}
              className="group relative shrink-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              title="Change cover image"
              aria-label="Change cover image"
            >
              <CoverThumb
                coverUrl={form.coverUrl || book.coverUrl}
                coverLocalPath={form.coverUrl ? undefined : book.coverLocalPath}
                libraryThingBadge={Boolean(book.libraryThingUrl)}
                title={book.title}
                className="h-44 w-32"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-slate-900/0 opacity-0 transition-all group-hover:bg-slate-900/60 group-hover:opacity-100">
                <ImagePlus size={20} className="text-white" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white">Change</span>
              </div>
            </button>
            <div className="min-w-0 flex-1 pt-1">
              {isEditing ? (
                <div className="space-y-4">
                  <div><label htmlFor={detailInputId('title')} className="mb-1 block text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Title</label><input id={detailInputId('title')} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-800/50" value={form.title} onChange={(event) => updateForm((current) => ({ ...current, title: event.target.value }))} /></div>
                  <div><label htmlFor={detailInputId('subtitle')} className="mb-1 block text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Subtitle</label><input id={detailInputId('subtitle')} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-800/50" placeholder="Optional" value={form.subtitle} onChange={(event) => updateForm((current) => ({ ...current, subtitle: event.target.value }))} /></div>
                  <div><label htmlFor={detailInputId('authors')} className="mb-1 block text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Author(s)</label><input id={detailInputId('authors')} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-800/50" value={form.authors} onChange={(event) => updateForm((current) => ({ ...current, authors: event.target.value }))} /></div>
                </div>
              ) : (
                <>
                  <h1 className="mb-2 text-2xl font-bold leading-tight text-slate-900 dark:text-white">{book.title}</h1>
                  {book.subtitle ? <p className="mb-2 text-base text-slate-500 dark:text-slate-400">{book.subtitle}</p> : null}
                  <p className="mb-4 text-lg text-slate-500 dark:text-slate-400">{book.authors.join(', ') || 'Unknown Author'}</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 dark:bg-accent-900/20 dark:text-accent-300">{tag}{isEditing ? <button aria-label={`Remove tag ${tag}`} title={`Remove tag ${tag}`} onClick={() => removeTag(tag)} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"><X size={12} /></button> : null}</span>
                    ))}
                    {isEditing ? <input className="w-28 rounded-full border border-accent-300 bg-white px-3 py-1.5 text-xs dark:border-accent-700 dark:bg-slate-800" value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(newTag) } }} /> : null}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-3">
              {isEditing ? <span className={cx('flex flex-1', isSaving && 'cursor-not-allowed')} title={isSaving ? 'Saving changes' : 'Save changes'}><button onClick={saveChanges} disabled={isSaving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-600 py-2.5 font-medium text-white transition-colors hover:bg-accent-700 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">{isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{isSaving ? 'Saving...' : 'Save Changes'}</button></span> : <button onClick={startEdit} className={cx('flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300', detailSecondaryButtonClass)}>Edit Metadata</button>}
              <span className={cx('flex', !primaryFile && 'cursor-not-allowed')} title={primaryFile ? 'Rescan metadata' : 'Requires a linked local file'}>
                <button aria-label="Rescan metadata" onClick={() => { if (isEditing) { setRescanNotice({ tone: 'warning', message: 'Save changes first. Rescan uses saved metadata and does not include unsaved edits.' }); return } setShowRescanModal(true) }} disabled={!primaryFile} className={cx('rounded-xl border border-slate-200 p-2.5 text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-700', detailSecondaryButtonClass)}><RefreshCw size={20} /></button>
              </span>
              <span className={cx('flex', !primaryFile && 'cursor-not-allowed')} title={primaryFile ? 'Open file' : 'Requires a linked local file'}>
                <button aria-label="Open file" onClick={() => { if (primaryFile) void onOpenFile(primaryFile.absPath) }} disabled={!primaryFile} className={cx('rounded-xl border border-slate-200 p-2.5 text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-700', detailSecondaryButtonClass)}><ExternalLink size={20} /></button>
              </span>
              <span className={cx('flex', isHiding && 'cursor-not-allowed')} title={isHiding ? 'Hiding book' : 'Hide from library'}>
                <button aria-label="Hide from library" onClick={() => onRequestHide(book.id)} disabled={isHiding} className={cx('rounded-xl border border-slate-200 p-2.5 text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-700', detailWarningButtonClass)}><EyeOff size={20} /></button>
              </span>
              <span className={cx('flex', isDeleting && 'cursor-not-allowed')} title={isDeleting ? 'Deleting book' : 'Delete book'}>
                <button aria-label="Delete book" onClick={() => onRequestDelete(book.id)} disabled={isDeleting} className={cx('rounded-xl border border-slate-200 p-2.5 text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-700', detailDangerButtonClass)}><Trash2 size={20} /></button>
              </span>
            </div>

            {rescanNotice ? (
              <div
                className={cx(
                  'rounded-lg border px-3 py-2 text-sm',
                  rescanNotice.tone === 'loading' && 'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300',
                  rescanNotice.tone === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
                  rescanNotice.tone === 'warning' && 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
                  rescanNotice.tone === 'error' && 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
                )}
              >
                <div className="flex items-center gap-2">
                  {rescanNotice.tone === 'loading' ? <RefreshCw size={14} className="animate-spin" /> : null}
                  <span>{rescanNotice.message}</span>
                </div>
                {undoSnapshot ? (
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      onClick={() => { void undoCurated() }}
                      disabled={isUndoing}
                      className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-60 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20"
                    >
                      {isUndoing ? 'Undoing...' : 'Undo'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50"><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Format</span><span className="font-mono text-sm text-slate-700 dark:text-slate-300">{primaryFile?.format?.toUpperCase() ?? '—'}</span></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50"><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Size</span><span className="font-mono text-sm text-slate-700 dark:text-slate-300">{primaryFile ? formatBytes(primaryFile.sizeBytes) : '—'}</span></div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50">{isEditing ? <><label htmlFor={detailInputId('publisher')} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Publisher</label><input id={detailInputId('publisher')} className="w-full border-b border-slate-300 bg-transparent text-sm dark:border-slate-600" value={form.publisher} onChange={(event) => updateForm((current) => ({ ...current, publisher: event.target.value }))} /></> : <><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Publisher</span><span className="block truncate font-mono text-sm text-slate-700 dark:text-slate-300">{book.publisher || '—'}</span></>}</div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50">{isEditing ? <><label htmlFor={detailInputId('publish-date')} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Published</label><input id={detailInputId('publish-date')} type="date" className="w-full border-b border-slate-300 bg-transparent text-sm dark:border-slate-600" value={form.publishDate} onChange={(event) => updateForm((current) => ({ ...current, publishDate: event.target.value }))} /></> : <><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Published</span><span className="font-mono text-sm text-slate-700 dark:text-slate-300">{book.publishDate ? formatDate(book.publishDate) : '—'}</span></>}</div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50">{isEditing ? <><label htmlFor={detailInputId('isbn13')} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">ISBN-13</label><input id={detailInputId('isbn13')} className="w-full border-b border-slate-300 bg-transparent text-sm dark:border-slate-600" value={form.isbn13} onChange={(event) => updateForm((current) => ({ ...current, isbn13: event.target.value }))} /></> : <><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">ISBN-13</span><span className="font-mono text-sm text-slate-700 dark:text-slate-300">{book.isbn13 || '—'}</span></>}</div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50">{isEditing ? <><label htmlFor={detailInputId('isbn10')} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">ISBN-10</label><input id={detailInputId('isbn10')} className="w-full border-b border-slate-300 bg-transparent text-sm dark:border-slate-600" value={form.isbn10} onChange={(event) => updateForm((current) => ({ ...current, isbn10: event.target.value }))} /></> : <><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">ISBN-10</span><span className="font-mono text-sm text-slate-700 dark:text-slate-300">{book.isbn10 || '—'}</span></>}</div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50">{isEditing ? <><label htmlFor={detailInputId('page-count')} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Pages</label><input id={detailInputId('page-count')} type="number" className="w-full border-b border-slate-300 bg-transparent text-sm dark:border-slate-600" value={form.pageCount} onChange={(event) => updateForm((current) => ({ ...current, pageCount: event.target.value }))} /></> : <><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Pages</span><span className="font-mono text-sm text-slate-700 dark:text-slate-300">{book.pageCount ?? '—'}</span></>}</div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50">{isEditing ? <><label htmlFor={detailInputId('series')} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Series</label><div className="flex gap-2"><input id={detailInputId('series')} className="min-w-0 flex-1 border-b border-slate-300 bg-transparent text-sm dark:border-slate-600" value={form.series} onChange={(event) => updateForm((current) => ({ ...current, series: event.target.value }))} /><input type="number" aria-label="Series number" className="w-12 border-b border-slate-300 bg-transparent text-sm dark:border-slate-600" value={form.seriesIndex} onChange={(event) => updateForm((current) => ({ ...current, seriesIndex: event.target.value }))} /></div></> : <><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Series</span><span className="block truncate font-mono text-sm text-slate-700 dark:text-slate-300">{book.series ? `${book.series}${book.seriesIndex ? ` #${book.seriesIndex}` : ''}` : '—'}</span></>}</div>
            </div>

            <div>
              {isEditing ? <><label htmlFor={detailInputId('description')} className="mb-2 block font-semibold text-slate-900 dark:text-white">Description</label><textarea id={detailInputId('description')} className="h-40 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50" value={form.description} onChange={(event) => updateForm((current) => ({ ...current, description: event.target.value }))} /></> : <><h3 className="mb-2 font-semibold text-slate-900 dark:text-white">Description</h3><p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">{book.description || 'No description available.'}</p></>}
            </div>

            <div>
              <h3 className="mb-2 font-semibold text-slate-900 dark:text-white">Local Files</h3>
              <div className="space-y-2">
                {book.libraryThingUrl ? (
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-800/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                      <BookOpen size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">LibraryThing</div>
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={book.libraryThingUrl}>
                        {book.libraryThingUrl}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (book.libraryThingUrl) void onOpenLibraryThingUrl(book.libraryThingUrl)
                      }}
                      className={cx('inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300', detailSecondaryButtonClass)}
                    >
                      <ExternalLink size={12} />
                      Open
                    </button>
                  </div>
                ) : null}
                {book.files.length > 0 ? (
                  book.files.map((file) => {
                    const formatLabel = file.format.toUpperCase()
                    const fileName = fileNameFor(file.absPath)
                    const folderPath = folderPathFor(file.absPath)
                    return (
                      <div
                        key={file.fileId}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-800/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            <span>{formatLabel}</span>
                            <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                            <span className="font-mono normal-case tracking-normal">{formatBytes(file.sizeBytes)}</span>
                          </div>
                          <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={fileName}>
                            {fileName}
                          </p>
                          <p className="truncate font-mono text-[11px] text-slate-400" title={folderPath}>
                            {folderPath}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              void onOpenFile(file.absPath)
                            }}
                            className={cx('inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300', detailSecondaryButtonClass)}
                          >
                            <ExternalLink size={12} />
                            {formatLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void onOpenFolder(file.absPath)
                            }}
                            className={cx('inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300', detailSecondaryButtonClass)}
                          >
                            <FolderOpen size={12} />
                            Folder
                          </button>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="font-mono text-xs text-slate-400">{book.libraryThingUrl ? 'No linked local files.' : 'No linked files.'}</p>
                )}
              </div>
              <div className="mt-3 font-mono text-xs text-slate-400">
                <p>Added: {new Date(book.addedAt).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      </motion.aside>
      {showCoverPicker ? (
        <CoverPickerModal
          bookId={book.id}
          currentCoverUrl={form.coverUrl || book.coverUrl || ''}
          bookTitle={form.title}
          bookAuthors={form.authors}
          onSelect={(url) => {
            setShowCoverPicker(false)
            if (isEditing) {
              updateForm((current) => ({ ...current, coverUrl: url }))
            } else {
              const patch = { coverUrl: url }
              void onSave({ bookId: book.id, patch, tags: book.tags })
            }
          }}
          onClose={() => setShowCoverPicker(false)}
        />
      ) : null}
      {showRescanModal && primaryFile ? (
        <RescanMetadataModal
          book={book}
          primaryFileId={primaryFile.fileId}
          onPreviewRescan={onPreviewRescan}
          onApplyCuratedMetadata={onApplyCuratedMetadata}
          onClose={() => setShowRescanModal(false)}
          onApplied={() => {
            setUndoSnapshot(book)
            setRescanNotice({ tone: 'success', message: 'Curated metadata applied. You can undo below.' })
          }}
        />
      ) : null}
    </>
  )
}
