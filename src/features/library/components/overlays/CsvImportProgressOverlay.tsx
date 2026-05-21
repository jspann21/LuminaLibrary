import type { CsvImportProgressState } from '../../model/types'
import { formatDisplayMessagePaths, formatDisplayPath } from '../../../../lib/format'
import { ProgressOverlayShell } from './ProgressOverlayShell'

type CsvImportProgressOverlayProps = {
  csvImportProgress: CsvImportProgressState
  bottomClassName?: string
  onDismiss: () => void
}

export function CsvImportProgressOverlay({
  csvImportProgress,
  bottomClassName,
  onDismiss,
}: CsvImportProgressOverlayProps) {
  return (
    <ProgressOverlayShell
      tone={csvImportProgress.phase === 'error' ? 'error' : 'accent'}
      bottomClassName={bottomClassName}
      dismissLabel="Dismiss CSV import progress"
      onDismiss={onDismiss}
    >
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2 text-sm">
        <span className="truncate font-medium">{csvImportProgress.message ? formatDisplayMessagePaths(csvImportProgress.message) : 'Importing enrichment CSV...'}</span>
        <span className="text-right text-xs font-medium tabular-nums">{csvImportProgress.progressPercent}%</span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={csvImportProgress.phase === 'error' ? 'h-full rounded-full bg-rose-500 transition-all duration-300' : 'h-full rounded-full bg-accent-500 transition-all duration-300'}
          style={{ width: `${csvImportProgress.progressPercent}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs opacity-90 tabular-nums">
        <span>{csvImportProgress.processedRows} processed</span>
        <span>{csvImportProgress.matchedRows} matched</span>
        <span>{csvImportProgress.updatedRows} updated</span>
        <span>{csvImportProgress.unresolvedRows} unresolved</span>
      </div>
      {csvImportProgress.path ? <p className="mt-2 truncate text-[11px] opacity-80">{formatDisplayPath(csvImportProgress.path)}</p> : null}
    </ProgressOverlayShell>
  )
}
