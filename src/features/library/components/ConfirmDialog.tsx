import { motion } from 'motion/react'
import { cx } from '../lib/cx'
import type { ConfirmDialogProps } from '../model/types'

export function ConfirmDialog({ dialog, onCancel, onConfirm }: ConfirmDialogProps) {
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
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 p-5 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{dialog.title}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{dialog.message}</p>
          </div>
          <div className="flex items-center justify-end gap-2 p-4">
            <button
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {dialog.cancelLabel ?? 'Cancel'}
            </button>
            <button
              onClick={onConfirm}
              className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors',
                dialog.tone === 'danger' && 'bg-rose-600 hover:bg-rose-700',
                dialog.tone === 'warning' && 'bg-amber-600 hover:bg-amber-700',
                (!dialog.tone || dialog.tone === 'default') && 'bg-accent-600 hover:bg-accent-700',
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
