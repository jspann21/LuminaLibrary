import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from '../../lib/cx'

type ProgressOverlayTone = 'accent' | 'success' | 'warning' | 'error'

type ProgressOverlayShellProps = {
  children: ReactNode
  tone?: ProgressOverlayTone
  bottomClassName?: string
  dismissLabel: string
  onDismiss: () => void
}

const TONE_STYLES: Record<ProgressOverlayTone, string> = {
  accent: 'border-accent-300 bg-accent-50/95 text-accent-800 dark:border-accent-800 dark:bg-accent-900/40 dark:text-accent-200',
  success:
    'border-emerald-300 bg-emerald-50/95 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/35 dark:text-emerald-200',
  warning: 'border-amber-300 bg-amber-50/95 text-amber-800 dark:border-amber-800 dark:bg-amber-900/35 dark:text-amber-200',
  error: 'border-rose-300 bg-rose-50/95 text-rose-800 dark:border-rose-800 dark:bg-rose-900/35 dark:text-rose-200',
}

export function ProgressOverlayShell({
  children,
  tone = 'accent',
  bottomClassName = 'bottom-6',
  dismissLabel,
  onDismiss,
}: ProgressOverlayShellProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className={cx(
        'absolute right-6 z-50 w-[min(24rem,calc(100vw-3rem))] rounded-xl border p-4 shadow-lg backdrop-blur-sm md:w-96',
        bottomClassName,
        TONE_STYLES[tone],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <button
          className="shrink-0 rounded-md p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  )
}
