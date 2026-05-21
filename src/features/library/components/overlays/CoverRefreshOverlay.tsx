import type { CoverRefreshNotice, ScanProgressState } from '../../model/types'
import { formatDisplayMessagePaths, formatDisplayPath } from '../../../../lib/format'
import { ProgressOverlayShell } from './ProgressOverlayShell'

type CoverRefreshOverlayProps = {
  coverRefreshNotice: CoverRefreshNotice
  scanStatus: string
  progressPercent: number
  scanProgress: ScanProgressState
  bottomClassName?: string
  onDismiss: () => void
}

export function CoverRefreshOverlay({
  coverRefreshNotice,
  scanStatus,
  progressPercent,
  scanProgress,
  bottomClassName,
  onDismiss,
}: CoverRefreshOverlayProps) {
  const tone =
    coverRefreshNotice.tone === 'loading'
      ? 'accent'
      : coverRefreshNotice.tone === 'success'
      ? 'success'
      : coverRefreshNotice.tone === 'warning'
      ? 'warning'
      : 'error'

  return (
    <ProgressOverlayShell tone={tone} bottomClassName={bottomClassName} dismissLabel="Dismiss cover refresh notice" onDismiss={onDismiss}>
      <p className="truncate text-sm font-semibold">{coverRefreshNotice.title}</p>
      <p className="mt-1 truncate text-xs opacity-90">{formatDisplayMessagePaths(coverRefreshNotice.message)}</p>
      {coverRefreshNotice.tone === 'loading' ? (
        <div className="mt-3">
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2 text-sm">
            <span className="truncate font-medium">{formatDisplayMessagePaths(scanStatus)}</span>
            <span className="text-right text-xs font-medium tabular-nums">{progressPercent}%</span>
          </div>
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-accent-700/20">
            <div className="h-full rounded-full bg-accent-500 transition-all duration-300" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-xs opacity-90">
            <span className="truncate tabular-nums">{scanProgress.matchedFiles} matched</span>
            <span className="truncate">{formatDisplayPath(scanProgress.currentPath)}</span>
          </div>
        </div>
      ) : null}
    </ProgressOverlayShell>
  )
}
