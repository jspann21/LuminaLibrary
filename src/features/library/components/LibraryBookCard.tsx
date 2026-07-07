import { memo } from 'react'
import { cx } from '../lib/cx'
import { COVER_LIST_HEIGHT, COVER_LIST_WIDTH } from '../model/constants'
import { CoverThumb } from './CoverThumb'

type LibraryBookCardProps = {
  id: string
  title: string
  authors: string[]
  coverUrl?: string
  coverLocalPath?: string
  imagePriority?: boolean
  tags: string[]
  format?: string
  viewMode: 'grid' | 'list'
  coverScale: number
  selected: boolean
  selectionModeActive?: boolean
  onToggleSelected: (id: string) => void
  onClick: (id: string) => void
}

export const LibraryBookCard = memo(function LibraryBookCard({
  id,
  title,
  authors,
  coverUrl,
  coverLocalPath,
  imagePriority,
  tags,
  format,
  viewMode,
  coverScale,
  selected,
  selectionModeActive,
  onToggleSelected,
  onClick,
}: LibraryBookCardProps) {
  const authorLabel = authors.join(', ') || 'Unknown Author'
  const listCoverWidth = Math.round(COVER_LIST_WIDTH * coverScale)
  const listCoverHeight = Math.round(COVER_LIST_HEIGHT * coverScale)

  if (viewMode === 'list') {
    return (
      <button
        onClick={() => onClick(id)}
        className={cx(
          'group flex w-full items-center gap-4 rounded-xl border p-3 text-left transition hover:border-accent-400/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
          selected
            ? 'border-accent-400 bg-accent-50/50 dark:border-accent-500/50 dark:bg-accent-900/20'
            : 'border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-800',
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation()
            onToggleSelected(id)
          }}
          className={`h-4 w-4 shrink-0 transition-opacity accent-accent-600 ${selectionModeActive || selected ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-hover:opacity-100'}`}
          aria-label={`Select ${title}`}
        />
        <div className="shrink-0" style={{ width: `${listCoverWidth}px`, height: `${listCoverHeight}px` }}>
          <CoverThumb
            coverUrl={coverUrl}
            coverLocalPath={coverLocalPath}
            loading={imagePriority ? 'eager' : 'lazy'}
            fetchPriority={imagePriority ? 'high' : 'auto'}
            title={title}
            className="h-full w-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{authorLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300"
            >
              {tag}
            </span>
          ))}
          {format ? <span className="px-2 font-mono text-xs uppercase text-slate-400 dark:text-slate-500">{format}</span> : null}
        </div>
      </button>
    )
  }

  return (
    <button onClick={() => onClick(id)} className="group flex cursor-pointer flex-col gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900">
      <div
        className={cx(
          'relative aspect-[2/3] w-full overflow-hidden rounded-lg border shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-xl',
          selected
            ? 'border-accent-500 bg-white ring-2 ring-accent-500 dark:border-accent-400 dark:bg-slate-800 dark:ring-accent-400'
            : 'border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-800',
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation()
            onToggleSelected(id)
          }}
          className={`absolute left-2 top-2 z-10 h-4 w-4 transition-opacity accent-accent-600 ${selectionModeActive || selected ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-hover:opacity-100'}`}
          aria-label={`Select ${title}`}
        />
        <CoverThumb
          coverUrl={coverUrl}
          coverLocalPath={coverLocalPath}
          loading={imagePriority ? 'eager' : 'lazy'}
          fetchPriority={imagePriority ? 'high' : 'auto'}
          title={title}
          className="h-full w-full rounded-none border-none"
        />
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/25 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full border border-white/20 bg-white/15 px-2 py-0.5 text-[10px] text-white">
                {tag}
              </span>
            ))}
          </div>
          <span className="truncate text-xs text-white/95">{authorLabel}</span>
        </div>
      </div>
      <div>
        <h3 className="line-clamp-1 text-sm font-semibold text-slate-900 transition-colors group-hover:text-accent-600 dark:text-slate-100 dark:group-hover:text-accent-300">
          {title}
        </h3>
        <p className="mt-1 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">{authorLabel}</p>
      </div>
    </button>
  )
})
