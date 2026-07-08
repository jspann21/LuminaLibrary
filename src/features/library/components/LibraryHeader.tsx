import { useEffect, useRef } from 'react'
import {
  ArrowUpDown,
  ChevronDown,
  Filter,
  LayoutGrid,
  List as ListIcon,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { cx } from '../lib/cx'
import type { FilterType, SortOption, ViewMode } from '../model/types'

const FILTER_OPTIONS: Array<{ value: FilterType; label: string; buttonLabel: string }> = [
  { value: 'all', label: 'All Formats', buttonLabel: 'All Formats' },
  { value: 'pdf', label: 'PDF', buttonLabel: 'PDF' },
  { value: 'epub', label: 'EPUB', buttonLabel: 'EPUB' },
  { value: 'librarything', label: 'LibraryThing', buttonLabel: 'LibraryThing' },
]

type LibraryHeaderProps = {
  query: string
  filterType: FilterType
  sortOption: SortOption
  viewMode: ViewMode
  isFilterOpen: boolean
  isSortOpen: boolean
  isScanning: boolean
  onSetQuery: (value: string) => void
  onToggleFilterOpen: () => void
  onToggleSortOpen: () => void
  onCloseFilterOpen: () => void
  onCloseSortOpen: () => void
  onSetFilterType: (value: FilterType) => void
  onSetSortOption: (value: SortOption) => void
  onSetViewMode: (value: ViewMode) => void
  onQuickAddBooks: () => void
}

function isEditableElement(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

export function LibraryHeader({
  query,
  filterType,
  sortOption,
  viewMode,
  isFilterOpen,
  isSortOpen,
  isScanning,
  onSetQuery,
  onToggleFilterOpen,
  onToggleSortOpen,
  onCloseFilterOpen,
  onCloseSortOpen,
  onSetFilterType,
  onSetSortOption,
  onSetViewMode,
  onQuickAddBooks,
}: LibraryHeaderProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const activeFilterLabel = FILTER_OPTIONS.find((option) => option.value === filterType)?.buttonLabel ?? 'All Formats'

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableElement(event.target)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/60 px-6 backdrop-blur-md transition-colors duration-300 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-1 items-center gap-4">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Search your library"
            placeholder="Search your library..."
            className={cx(
              'w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
              query ? 'pr-10' : 'pr-16',
            )}
            value={query}
            onChange={(event) => onSetQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              if (query) onSetQuery('')
              else searchInputRef.current?.blur()
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear library search"
              title="Clear search (Esc)"
              onClick={() => onSetQuery('')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <X size={14} />
            </button>
          ) : (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 opacity-60 sm:flex"
            >
              <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-sans text-[10px] font-medium text-slate-500 dark:border-slate-600 dark:text-slate-400">
                Ctrl
              </kbd>
              <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-sans text-[10px] font-medium text-slate-500 dark:border-slate-600 dark:text-slate-400">
                F
              </kbd>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={onToggleFilterOpen}
            onBlur={() => setTimeout(onCloseFilterOpen, 200)}
            aria-expanded={isFilterOpen}
            aria-haspopup="menu"
            className={cx(
              'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
              filterType !== 'all'
                ? 'border-accent-200 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
            )}
          >
            <Filter size={16} className={cx(filterType !== 'all' ? 'text-accent-500' : 'text-slate-400')} />
            <span>{activeFilterLabel}</span>
          </button>
          {isFilterOpen ? (
            <div className="absolute right-0 top-full z-30 mt-2 w-44 rounded-xl border border-slate-100 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onSetFilterType(option.value)}
                  className={cx(
                    'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    filterType === option.value
                      ? 'bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={onToggleSortOpen}
            onBlur={() => setTimeout(onCloseSortOpen, 200)}
            aria-expanded={isSortOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
          >
            <ArrowUpDown size={16} className="text-slate-400" />
            <span>
              {sortOption === 'date-desc' && 'Date (Newest)'}
              {sortOption === 'date-asc' && 'Date (Oldest)'}
              {sortOption === 'title-asc' && 'Title (A-Z)'}
              {sortOption === 'title-desc' && 'Title (Z-A)'}
              {sortOption === 'author-asc' && 'Author (A-Z)'}
              {sortOption === 'author-desc' && 'Author (Z-A)'}
            </span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>
          {isSortOpen ? (
            <div className="absolute right-0 top-full z-30 mt-2 w-48 rounded-xl border border-slate-100 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
              {([
                ['date-desc', 'Date Added (Newest)'],
                ['date-asc', 'Date Added (Oldest)'],
                ['title-asc', 'Title (A-Z)'],
                ['title-desc', 'Title (Z-A)'],
                ['author-asc', 'Author (A-Z)'],
                ['author-desc', 'Author (Z-A)'],
              ] as Array<[SortOption, string]>).map(([option, label]) => (
                <button
                  key={option}
                  onClick={() => onSetSortOption(option)}
                  className={cx(
                    'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    sortOption === option
                      ? 'bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mx-2 h-6 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          onClick={() => onSetViewMode('grid')}
          aria-label="Grid view"
          aria-pressed={viewMode === 'grid'}
          title="Grid view"
          className={cx(
            'rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
            viewMode === 'grid'
              ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300',
          )}
        >
          <LayoutGrid size={18} />
        </button>
        <button
          onClick={() => onSetViewMode('list')}
          aria-label="List view"
          aria-pressed={viewMode === 'list'}
          title="List view"
          className={cx(
            'rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
            viewMode === 'list'
              ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300',
          )}
        >
          <ListIcon size={18} />
        </button>

        <div className="mx-2 h-6 w-px bg-slate-200 dark:bg-slate-700" />

        <span className={cx('flex', isScanning && 'cursor-not-allowed')} title={isScanning ? 'Library scan in progress' : 'Add Books'}>
          <button
            type="button"
            onClick={onQuickAddBooks}
            disabled={isScanning}
            className="flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-accent-500/25 transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-60 dark:focus-visible:ring-offset-slate-900"
          >
            {isScanning ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
            {isScanning ? 'Scanning...' : 'Add Books'}
          </button>
        </span>
      </div>
    </header>
  )
}
