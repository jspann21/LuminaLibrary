import type { BulkMatchProgressState } from '../../model/types'
import { formatDisplayPath } from '../../../../lib/format'
import { ProgressOverlayShell } from './ProgressOverlayShell'

type BulkMatchProgressOverlayProps = {
  progress: BulkMatchProgressState
  progressPercent: number
  bottomClassName?: string
  onDismiss: () => void
}

export function BulkMatchProgressOverlay({
  progress,
  progressPercent,
  bottomClassName,
  onDismiss,
}: BulkMatchProgressOverlayProps) {
  const title =
    progress.phase === 'completed'
      ? `Match All complete: ${progress.matchedFiles} matched, ${progress.unresolvedFiles} unresolved`
      : `Matching All ${progress.processedFiles}/${progress.totalFiles}...`
  const skippedText = progress.skippedFiles > 0 ? `${progress.skippedFiles} skipped` : `${progress.unresolvedFiles} unresolved`

  return (
    <ProgressOverlayShell
      bottomClassName={bottomClassName}
      dismissLabel="Dismiss match all progress"
      onDismiss={onDismiss}
    >
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2 text-sm">
        <span className="truncate font-medium">{title}</span>
        <span className="text-right text-xs font-medium tabular-nums">{progressPercent}%</span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-accent-700/20">
        <div className="h-full rounded-full bg-accent-500 transition-all duration-300" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="grid grid-cols-[7rem_7rem_minmax(0,1fr)] items-center gap-2 text-xs opacity-90">
        <span className="truncate tabular-nums">{progress.matchedFiles} matched</span>
        <span className="truncate tabular-nums">{skippedText}</span>
        <span className="truncate">{formatDisplayPath(progress.currentPath)}</span>
      </div>
    </ProgressOverlayShell>
  )
}
