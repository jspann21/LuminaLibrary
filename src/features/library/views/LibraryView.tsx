import type { RefObject } from 'react'
import { FolderOpen, Loader2, Plus } from 'lucide-react'
import type { BookCard } from '../../../lib/types'
import type { ViewMode } from '../model/types'
import { CoverThumb } from '../components/CoverThumb'
import { VirtualizedLibraryBooks } from '../components/VirtualizedLibraryBooks'

type LibraryViewProps = {
  books: BookCard[]
  hiddenBooks: BookCard[]
  hiddenBookCount: number
  isLoading: boolean
  isHiddenLoading: boolean
  isFetching: boolean
  viewMode: ViewMode
  coverScale: number
  scrollContainerRef: RefObject<HTMLDivElement | null>
  selectedBookIds: Set<string>
  isHidePending: boolean
  isRestorePending: boolean
  onToggleBookSelection: (bookId: string) => void
  onSelectAllBooks: () => void
  onClearSelection: () => void
  onHideSelectedBooks: () => void
  onRestoreBook: (bookId: string) => void
  onRestoreAllHiddenBooks: () => void
  onSelectBook: (bookId: string) => void
  onQuickAddBooks: () => void
}

export function LibraryView({
  books,
  hiddenBooks,
  hiddenBookCount,
  isLoading,
  isHiddenLoading,
  isFetching,
  viewMode,
  coverScale,
  scrollContainerRef,
  selectedBookIds,
  isHidePending,
  isRestorePending,
  onToggleBookSelection,
  onSelectAllBooks,
  onClearSelection,
  onHideSelectedBooks,
  onRestoreBook,
  onRestoreAllHiddenBooks,
  onSelectBook,
  onQuickAddBooks,
}: LibraryViewProps) {
  const hasVisibleBooks = books.length > 0
  const hasHiddenBooks = hiddenBooks.length > 0

  if (isLoading && !hasHiddenBooks) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-center gap-2">
          <Loader2 aria-hidden="true" className="animate-spin text-slate-400" size={20} />
          <span>Loading library...</span>
        </div>
      </div>
    )
  }

  if (!hasVisibleBooks && !hasHiddenBooks) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-accent-50 text-accent-500 dark:bg-accent-900/25 dark:text-accent-300">
          <FolderOpen size={40} />
        </div>
        <h2 className="mb-2 text-2xl font-bold text-slate-900 dark:text-slate-100">Your library is empty</h2>
        <p className="mb-6 max-w-md text-sm text-slate-500 dark:text-slate-400">
          Add a local folder to start scanning PDF/EPUB files and enriching metadata.
        </p>
        <button
          onClick={onQuickAddBooks}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-accent-500/25 transition-colors hover:bg-accent-700"
        >
          <Plus size={18} />
          Add Local Folder
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {hasVisibleBooks && selectedBookIds.size > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {selectedBookIds.size} selected
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onSelectAllBooks}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Select All
              </button>
              <span className={selectedBookIds.size === 0 ? 'flex cursor-not-allowed' : 'flex'} title={selectedBookIds.size === 0 ? 'No books selected' : undefined}>
                <button
                  onClick={onClearSelection}
                  disabled={selectedBookIds.size === 0}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Clear
                </button>
              </span>
              <span className={selectedBookIds.size === 0 || isHidePending ? 'flex cursor-not-allowed' : 'flex'} title={selectedBookIds.size === 0 ? 'No books selected to hide' : isHidePending ? 'Hiding selected books' : undefined}>
                <button
                  onClick={onHideSelectedBooks}
                  disabled={selectedBookIds.size === 0 || isHidePending}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:pointer-events-none disabled:opacity-50"
                >
                  {isHidePending ? 'Hiding...' : 'Hide Selected'}
                </button>
              </span>
            </div>
          </div>
        </div>
      ) : !hasVisibleBooks ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          No visible books. Restore from the hidden section below.
        </div>
      ) : null}

      {hasVisibleBooks ? (
        <>
          {isFetching ? (
            <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">Updating library results...</div>
          ) : null}
          <VirtualizedLibraryBooks
            books={books}
            viewMode={viewMode}
            coverScale={coverScale}
            scrollContainerRef={scrollContainerRef}
            selectedBookIds={selectedBookIds}
            onToggleBookSelection={onToggleBookSelection}
            onSelectBook={onSelectBook}
          />
        </>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Hidden from Library ({hiddenBookCount})
          </h3>
          <span className={hiddenBookCount === 0 || isRestorePending ? 'flex cursor-not-allowed' : 'flex'} title={hiddenBookCount === 0 ? 'No hidden books to restore' : isRestorePending ? 'Restoring hidden books' : undefined}>
            <button
              onClick={onRestoreAllHiddenBooks}
              disabled={hiddenBookCount === 0 || isRestorePending}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {isRestorePending ? 'Restoring...' : 'Restore All'}
            </button>
          </span>
        </div>
        {isHiddenLoading ? (
          <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Loader2 aria-hidden="true" className="animate-spin text-slate-400" size={14} />
            Loading hidden books...
          </p>
        ) : hiddenBooks.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No hidden books.</p>
        ) : (
          <div className="space-y-2">
            {hiddenBooks.map((book) => (
              <div
                key={book.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-900/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <CoverThumb coverUrl={book.coverUrl} coverLocalPath={book.coverLocalPath} libraryThingBadge={Boolean(book.libraryThingUrl)} title={book.title} className="h-12 w-9 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{book.title}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {book.authors.join(', ') || 'Unknown Author'}
                    </p>
                  </div>
                </div>
                <span className={isRestorePending ? 'flex shrink-0 cursor-not-allowed' : 'flex shrink-0'} title={isRestorePending ? 'Restoring hidden books' : undefined}>
                  <button
                    onClick={() => onRestoreBook(book.id)}
                    disabled={isRestorePending}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Restore
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
