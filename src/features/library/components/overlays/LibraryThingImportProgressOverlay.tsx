import type { LibraryThingImportProgressState } from '../../model/types'
import { formatDisplayMessagePaths, formatDisplayPath } from '../../../../lib/format'
import { ProgressOverlayShell } from './ProgressOverlayShell'

type LibraryThingImportProgressOverlayProps = {
  progress: LibraryThingImportProgressState
  bottomClassName?: string
  onDismiss: () => void
}

function defaultMessage(progress: LibraryThingImportProgressState) {
  if (progress.phase === 'parsing') return 'Reading LibraryThing export'
  if (progress.phase === 'cover_lookup') return 'Finding cover art'
  if (progress.phase === 'completed') return 'LibraryThing import complete'
  if (progress.phase === 'error') return 'LibraryThing import failed'
  return 'Importing LibraryThing books'
}

export function LibraryThingImportProgressOverlay({
  progress,
  bottomClassName,
  onDismiss,
}: LibraryThingImportProgressOverlayProps) {
  const message = progress.message ? formatDisplayMessagePaths(progress.message) : defaultMessage(progress)

  return (
    <ProgressOverlayShell
      tone={progress.phase === 'error' ? 'error' : 'accent'}
      bottomClassName={bottomClassName}
      dismissLabel="Dismiss LibraryThing import progress"
      onDismiss={onDismiss}
    >
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2 text-sm">
        <span className="truncate font-medium">{message}</span>
        <span className="text-right text-xs font-medium tabular-nums">{progress.progressPercent}%</span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={progress.phase === 'error' ? 'h-full rounded-full bg-rose-500 transition-all duration-300' : 'h-full rounded-full bg-accent-500 transition-all duration-300'}
          style={{ width: `${progress.progressPercent}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs opacity-90 tabular-nums">
        <span>{progress.processedRows}/{progress.totalRows} processed</span>
        <span>{progress.matchedRows} matched</span>
        <span>{progress.createdRows} new</span>
        <span>{progress.coverRows} covers</span>
        <span>{progress.skippedRows} skipped</span>
        <span>{progress.errors} errors</span>
      </div>
      {progress.currentTitle ? <p className="mt-2 truncate text-[11px] opacity-90">{progress.currentTitle}</p> : null}
      {progress.path ? <p className="mt-1 truncate text-[11px] opacity-80">{formatDisplayPath(progress.path)}</p> : null}
    </ProgressOverlayShell>
  )
}
