import { Library, Settings, Tag } from 'lucide-react'
import type { TagCount } from '../../../lib/types'
import { cx } from '../lib/cx'
import type { ActiveView } from '../model/types'
import { SidebarItem } from './SidebarItem'

type LibrarySidebarProps = {
  activeView: ActiveView
  selectedTag?: string
  tags: TagCount[]
  totalBooks: number
  isScanning: boolean
  onSetActiveView: (value: ActiveView) => void
  onSetSelectedTag: (value?: string) => void
}

export function LibrarySidebar({
  activeView,
  selectedTag,
  tags,
  totalBooks,
  isScanning,
  onSetActiveView,
  onSetSelectedTag,
}: LibrarySidebarProps) {
  return (
    <aside className="z-20 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-colors duration-300 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 p-6">
        <img src="/lumina-icon.svg" alt="Lumina Library icon" className="h-8 w-8 shrink-0" />
        <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Lumina Library</h1>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        <SidebarItem
          icon={<Library size={20} />}
          label="Library"
          active={activeView === 'library'}
          count={totalBooks}
          onClick={() => onSetActiveView('library')}
        />
        <SidebarItem
          icon={<Tag size={20} />}
          label="Tag Manager"
          active={activeView === 'tags'}
          count={tags.length}
          onClick={() => onSetActiveView('tags')}
        />
        <SidebarItem
          icon={<Settings size={20} />}
          label="Settings"
          active={activeView === 'settings'}
          onClick={() => onSetActiveView('settings')}
        />

        <div className="pb-2 pt-6">
          <h3 className="mb-3 flex items-center justify-between px-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span>Tags</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {tags.length}
            </span>
          </h3>
          <div className="space-y-1">
            {tags.map((tagItem) => {
              const active = selectedTag === tagItem.tag
              return (
                <button
                  key={tagItem.tag}
                  onClick={() => {
                    onSetActiveView('library')
                    onSetSelectedTag(active ? undefined : tagItem.tag)
                  }}
                  className={cx(
                    'group flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/20 dark:text-accent-300'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Tag size={16} className={cx('shrink-0', active ? 'text-accent-500' : 'text-slate-400')} />
                    <span className="truncate">{tagItem.tag}</span>
                  </span>
                  <span className="text-xs text-slate-400">{tagItem.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      </nav>

      <div className="p-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-800/40">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Books</span>
            <span className="text-sm font-bold text-slate-900 dark:text-white">{totalBooks}</span>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700/60">
            <span className={cx('h-2 w-2 rounded-full', isScanning ? 'animate-pulse bg-amber-500' : 'bg-emerald-500')} />
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{isScanning ? 'Scanning Library...' : 'System Idle'}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
