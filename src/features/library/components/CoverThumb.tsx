import { memo, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { BookOpen } from 'lucide-react'
import { cx } from '../lib/cx'
import type { CoverThumbProps } from '../model/types'

type CoverLoadState = {
  sourceKey: string
  failedSrcs: string[]
  loadedSrc: string | null
}

export const CoverThumb = memo(function CoverThumb({
  coverUrl,
  coverLocalPath,
  libraryThingBadge = false,
  loading = 'lazy',
  fetchPriority = 'auto',
  title,
  className,
}: CoverThumbProps) {
  const normalizedRemoteSrc = coverUrl?.trim() || ''
  const normalizedLocalPath = coverLocalPath?.trim() || ''
  const localSrc = normalizedLocalPath ? convertFileSrc(normalizedLocalPath) : ''
  const sourceKey = `${localSrc}\n${normalizedRemoteSrc}`
  const [loadState, setLoadState] = useState<CoverLoadState>({ sourceKey, failedSrcs: [], loadedSrc: null })
  const failedSrcs = loadState.sourceKey === sourceKey ? loadState.failedSrcs : []
  const loadedSrc = loadState.sourceKey === sourceKey ? loadState.loadedSrc : null
  const srcCandidates = [localSrc, normalizedRemoteSrc].filter(Boolean)
  const src = srcCandidates.find((candidate) => !failedSrcs.includes(candidate)) ?? ''

  if (!src) {
    return (
      <div
        className={cx(
          'relative flex items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
          className,
        )}
      >
        <BookOpen size={18} />
        {libraryThingBadge ? <LibraryThingBadge /> : null}
      </div>
    )
  }

  return (
    <div
      className={cx(
        'relative flex items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
        className,
      )}
    >
      {loadedSrc !== src ? <BookOpen size={18} /> : null}
      <img
        src={src}
        alt={`${title} cover`}
        className={cx('absolute inset-0 h-full w-full object-cover', loadedSrc === src ? 'opacity-100' : 'opacity-0')}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setLoadState({ sourceKey, failedSrcs, loadedSrc: src })}
        onError={() => setLoadState({
          sourceKey,
          failedSrcs: failedSrcs.includes(src) ? failedSrcs : [...failedSrcs, src],
          loadedSrc,
        })}
      />
      {libraryThingBadge ? <LibraryThingBadge /> : null}
    </div>
  )
})

function LibraryThingBadge() {
  return (
    <span className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-slate-950/75 text-white shadow-sm">
      <BookOpen size={13} />
    </span>
  )
}
