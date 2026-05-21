import type { ScanProgressState } from '../../model/types'
import { formatDisplayMessagePaths, formatDisplayPath } from '../../../../lib/format'
import { ProgressOverlayShell } from './ProgressOverlayShell'

type ScanProgressOverlayProps = {
  scanStatus: string
  progressPercent: number
  scanProgress: ScanProgressState
  bottomClassName?: string
  onDismiss: () => void
}

export function ScanProgressOverlay({
  scanStatus,
  progressPercent,
  scanProgress,
  bottomClassName,
  onDismiss,
}: ScanProgressOverlayProps) {
  return (
    <ProgressOverlayShell bottomClassName={bottomClassName} dismissLabel="Dismiss scan progress" onDismiss={onDismiss}>
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2 text-sm">
        <span className="truncate font-medium">{formatDisplayMessagePaths(scanStatus)}</span>
        <span className="text-right text-xs font-medium tabular-nums">{progressPercent}%</span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-accent-700/20">
        <div className="h-full rounded-full bg-accent-500 transition-all duration-300" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-xs opacity-90">
        <span className="truncate tabular-nums">
          {scanProgress.removedFiles > 0
            ? `${scanProgress.removedFiles} removed`
            : `${scanProgress.matchedFiles} matched`}
        </span>
        <span className="truncate">{formatDisplayPath(scanProgress.currentPath)}</span>
      </div>
    </ProgressOverlayShell>
  )
}
