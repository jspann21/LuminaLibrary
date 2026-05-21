import { Check, Search, X } from 'lucide-react'
import type { TagCount } from '../../../lib/types'
import { cx } from '../lib/cx'

type TagManagerViewProps = {
  tags: TagCount[]
  tagManagerQuery: string
  tagMergeTarget: string
  tagManagerFiltered: TagCount[]
  selectedCount: number
  tagManagerSelectionSet: Set<string>
  isMerging: boolean
  isDeleting: boolean
  onSetTagManagerQuery: (value: string) => void
  onSetTagMergeTarget: (value: string) => void
  onMergeSelectedTags: () => void
  onDeleteSelectedTags: () => void
  onClearSelection: () => void
  onToggleTagSelection: (tag: string) => void
}

export function TagManagerView({
  tags,
  tagManagerQuery,
  tagMergeTarget,
  tagManagerFiltered,
  selectedCount,
  tagManagerSelectionSet,
  isMerging,
  isDeleting,
  onSetTagManagerQuery,
  onSetTagMergeTarget,
  onMergeSelectedTags,
  onDeleteSelectedTags,
  onClearSelection,
  onToggleTagSelection,
}: TagManagerViewProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-100 p-6 dark:border-slate-700/60">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Tag Manager</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Select multiple tags, merge them into one tag, or delete them in bulk.
          </p>
        </div>
        <div className="space-y-4 p-6">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                aria-label="Filter tags"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-slate-700 dark:bg-slate-900/30"
                placeholder="Filter tags..."
                value={tagManagerQuery}
                onChange={(event) => onSetTagManagerQuery(event.target.value)}
              />
              {tagManagerQuery ? (
                <button
                  type="button"
                  aria-label="Clear tag filter"
                  title="Clear search"
                  onClick={() => onSetTagManagerQuery('')}
                  className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30">
              <input
                className="w-full bg-transparent text-sm outline-none"
                placeholder="Merge selected into tag..."
                value={tagMergeTarget}
                onChange={(event) => onSetTagMergeTarget(event.target.value)}
                list="tag-merge-target-options"
              />
              <datalist id="tag-merge-target-options">
                {tags.map((tagItem) => (
                  <option key={tagItem.tag} value={tagItem.tag} />
                ))}
              </datalist>
            </div>

            <span
              className="flex"
              title={selectedCount === 0 ? 'Select tags to merge' : !tagMergeTarget.trim() ? 'Enter a target tag name' : isMerging ? 'Merging tags' : isDeleting ? 'Cannot merge while deleting tags' : undefined}
            >
              <button
                onClick={onMergeSelectedTags}
                disabled={selectedCount === 0 || !tagMergeTarget.trim() || isMerging || isDeleting}
                className="w-full rounded-xl bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:pointer-events-none disabled:opacity-50"
              >
                {isMerging ? 'Merging...' : 'Merge Selected'}
              </button>
            </span>

            <span
              className="flex"
              title={selectedCount === 0 ? 'Select tags to delete' : isDeleting ? 'Deleting tags' : isMerging ? 'Cannot delete while merging tags' : undefined}
            >
              <button
                onClick={onDeleteSelectedTags}
                disabled={selectedCount === 0 || isDeleting || isMerging}
                className="w-full rounded-xl border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:pointer-events-none disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-900/20"
              >
                {isDeleting ? 'Deleting...' : 'Delete Selected'}
              </button>
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {selectedCount} selected • {tagManagerFiltered.length} shown
            </span>
            <span className="flex" title={selectedCount === 0 ? 'No tags selected' : undefined}>
              <button
                onClick={onClearSelection}
                disabled={selectedCount === 0}
                className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Clear Selection
              </button>
            </span>
          </div>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {tagManagerFiltered.map((tagItem) => {
              const isSelected = tagManagerSelectionSet.has(tagItem.tag)
              return (
                <button
                  key={tagItem.tag}
                  onClick={() => onToggleTagSelection(tagItem.tag)}
                  className={cx(
                    'flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                    isSelected
                      ? 'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300 dark:hover:bg-slate-900/60',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cx(
                        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        isSelected
                          ? 'border-accent-500 bg-accent-500 text-white'
                          : 'border-slate-300 bg-white text-transparent dark:border-slate-600 dark:bg-slate-800',
                      )}
                    >
                      <Check size={12} />
                    </span>
                    <span className="truncate">{tagItem.tag}</span>
                  </span>
                  <span className="ml-3 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    {tagItem.count}
                  </span>
                </button>
              )
            })}
          </div>

          {tags.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
              Your library has no tags yet.
            </div>
          ) : tagManagerFiltered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
              No tags match your filter.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
