import { useEffect, useId } from 'react'
import { motion } from 'motion/react'
import { cx } from '../lib/cx'
import type { ConfirmDialogProps } from '../model/types'

export function ConfirmDialog({ dialog, onCancel, onConfirm }: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCancel}
        className="fixed inset-0 z-[70] bg-slate-950/50 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        className="fixed inset-0 z-[71] flex items-center justify-center p-4"
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 p-5 dark:border-slate-800">
            <h3 id={titleId} className="text-base font-semibold text-slate-900 dark:text-slate-100">{dialog.title}</h3>
            <p id={descriptionId} className="mt-1 text-sm text-slate-600 dark:text-slate-300">{dialog.message}</p>
          </div>
          <div className="flex items-center justify-end gap-2 p-4">
            <button
              type="button"
              onClick={onCancel}
              autoFocus={dialog.tone === 'danger'}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-900"
            >
              {dialog.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              autoFocus={dialog.tone !== 'danger'}
              className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
                dialog.tone === 'danger' && 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500',
                dialog.tone === 'warning' && 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500',
                (!dialog.tone || dialog.tone === 'default') && 'bg-accent-600 hover:bg-accent-700 focus-visible:ring-accent-500',
              )}
            >
              {dialog.confirmLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
