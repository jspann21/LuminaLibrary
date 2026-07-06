import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { BookCard } from '../../../lib/types'
import { cx } from '../lib/cx'
import { COVER_GRID_MIN_WIDTH, COVER_LIST_HEIGHT, COVER_LIST_WIDTH } from '../model/constants'
import { LibraryBookCard } from './LibraryBookCard'

type VirtualizedLibraryBooksProps = {
  books: BookCard[]
  viewMode: 'grid' | 'list'
  coverScale: number
  scrollContainerRef: RefObject<HTMLDivElement | null>
  selectedBookIds: Set<string>
  onToggleBookSelection: (bookId: string) => void
  onSelectBook: (bookId: string) => void
}

function areSetsEqual(left: Set<string>, right: Set<string>) {
  if (left === right) return true
  if (left.size !== right.size) return false

  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

export const VirtualizedLibraryBooks = memo(function VirtualizedLibraryBooks({
  books,
  viewMode,
  coverScale,
  scrollContainerRef,
  selectedBookIds,
  onToggleBookSelection,
  onSelectBook,
}: VirtualizedLibraryBooksProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const latestOnToggleBookSelection = useRef(onToggleBookSelection)
  const latestOnSelectBook = useRef(onSelectBook)
  const [viewportWidth, setViewportWidth] = useState(0)
  const cardGapPx = viewMode === 'grid' ? 24 : 12
  const minimumGridWidth = Math.round(COVER_GRID_MIN_WIDTH * coverScale)
  const effectiveWidth = Math.max(viewportWidth, minimumGridWidth)
  const columns =
    viewMode === 'grid' ? Math.max(1, Math.floor((effectiveWidth + cardGapPx) / (minimumGridWidth + cardGapPx))) : 1
  const rowCount = Math.ceil(books.length / columns)
  const cardWidth =
    viewMode === 'grid'
      ? Math.max(120, Math.floor((effectiveWidth - cardGapPx * (columns - 1)) / columns))
      : Math.round(COVER_LIST_WIDTH * coverScale)
  const estimatedRowHeight =
    viewMode === 'grid'
      ? Math.round(cardWidth * 1.5 + 50)
      : Math.max(80, Math.round(COVER_LIST_HEIGHT * coverScale + 34))

  useEffect(() => {
    latestOnToggleBookSelection.current = onToggleBookSelection
    latestOnSelectBook.current = onSelectBook
  }, [onToggleBookSelection, onSelectBook])

  const handleToggleBookSelection = useCallback((bookId: string) => {
    latestOnToggleBookSelection.current(bookId)
  }, [])

  const handleSelectBook = useCallback((bookId: string) => {
    latestOnSelectBook.current(bookId)
  }, [])

  // TanStack Virtual returns methods that React Compiler cannot memoize safely.
  // The hook is the intended integration point, so keep it local and unwrapped.
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: viewMode === 'grid' ? 4 : 8,
  })

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const syncWidth = () => setViewportWidth(viewport.clientWidth)
    syncWidth()

    const observer = new ResizeObserver(() => syncWidth())
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowVirtualizer, books.length, viewMode, coverScale, columns, estimatedRowHeight])

  if (books.length === 0) return null

  // ⚡ Bolt: Bulk UI Visibility Toggle Optimization
  // By applying the 'selection-mode' class to the parent container when any item is selected,
  // we can use Tailwind's descendant selector ([.selection-mode_&]:opacity-100) on the children
  // (LibraryBookCard). This prevents an O(N) re-render of all items just to toggle the checkbox visibility.
  return (
    <div ref={viewportRef} className={cx('relative', selectedBookIds.size > 0 && 'selection-mode')}>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px` }} className="relative">
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columns
          const rowEndIndex = Math.min(startIndex + columns, books.length)
          const rowBookCards = []
          for (let index = startIndex; index < rowEndIndex; index++) {
            const book = books[index]
            const imagePriority = index < (viewMode === 'grid' ? columns * 2 : 8)
            rowBookCards.push(
              <LibraryBookCard
                key={book.id}
                id={book.id}
                title={book.title}
                authors={book.authors}
                coverUrl={book.coverUrl}
                coverLocalPath={book.coverLocalPath}
                imagePriority={imagePriority}
                tags={book.tags}
                format={book.formats[0]}
                viewMode={viewMode}
                coverScale={coverScale}
                selected={selectedBookIds.has(book.id)}
                onToggleSelected={handleToggleBookSelection}
                onClick={handleSelectBook}
              />,
            )
          }

          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div
                className={cx('grid', viewMode === 'grid' ? 'gap-6' : 'grid-cols-1 gap-3')}
                style={viewMode === 'grid' ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
              >
                {rowBookCards}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}, (previous, next) => {
  return (
    previous.books === next.books &&
    previous.viewMode === next.viewMode &&
    previous.coverScale === next.coverScale &&
    previous.scrollContainerRef === next.scrollContainerRef &&
    previous.onToggleBookSelection === next.onToggleBookSelection &&
    previous.onSelectBook === next.onSelectBook &&
    areSetsEqual(previous.selectedBookIds, next.selectedBookIds)
  )
})
