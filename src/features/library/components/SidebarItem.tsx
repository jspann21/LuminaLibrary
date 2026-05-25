import { cx } from '../lib/cx'
import type { SidebarItemProps } from '../model/types'

export function SidebarItem({ icon, label, active, count, onClick }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
        active
          ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/20 dark:text-accent-300'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
      {typeof count === 'number' ? (
        <span
          className={cx(
            'rounded-full px-2 py-0.5 text-xs',
            active
              ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}
