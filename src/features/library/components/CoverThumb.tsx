import { useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { BookOpen } from 'lucide-react'
import { cx } from '../lib/cx'
import type { CoverThumbProps } from '../model/types'

export function CoverThumb({
  coverUrl,
  coverLocalPath,
  loading = 'lazy',
  fetchPriority = 'auto',
  title,
  className,
}: CoverThumbProps) {
  const normalizedRemoteSrc = coverUrl?.trim() || ''
  const normalizedLocalPath = coverLocalPath?.trim() || ''
  const localSrc = normalizedLocalPath ? convertFileSrc(normalizedLocalPath) : ''
  const [failedSrcs, setFailedSrcs] = useState<string[]>([])
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const srcCandidates = [localSrc, normalizedRemoteSrc].filter(Boolean)
  const src = srcCandidates.find((candidate) => !failedSrcs.includes(candidate)) ?? ''

  if (!src) {
    return (
      <div
        className={cx(
          'flex items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
          className,
        )}
      >
        <BookOpen size={18} />
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
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrcs((current) => (current.includes(src) ? current : [...current, src]))}
      />
    </div>
  )
}
