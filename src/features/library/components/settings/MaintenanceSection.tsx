import { Download, RefreshCw, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { formatDisplayMessagePaths, formatDisplayPath } from '../../../../lib/format'
import type { AppSettings } from '../../../../lib/types'
import type {
    CsvImportProgressState,
    CsvTransferNotice,
    MaintenanceNotice,
} from '../../model/types'

type MaintenanceSectionProps = {
    appSettings?: AppSettings
    onSetScanOnStartup: (enabled: boolean) => void
    isSetScanOnStartupPending: boolean
    onRescanMissingMetadata: () => void
    isRescanMissingMetadataPending: boolean
    onRefreshMissingCovers: () => void
    isRefreshMissingCoversPending: boolean
    onReconcileLocalFiles: () => void
    isReconcileLocalFilesPending: boolean
    maintenanceNotice: MaintenanceNotice | null
    onExportUnresolvedCsv: () => Promise<void>
    onImportEnrichmentCsv: () => Promise<void>
    isExportPending: boolean
    isImportPending: boolean
    csvTransferNotice: CsvTransferNotice | null
    csvImportProgress: CsvImportProgressState
}

function DisabledTooltip({
    reason,
    className,
    children,
}: {
    reason?: string
    className?: string
    children: ReactNode
}) {
    return (
        <span className={cx(className ?? 'inline-grid')} title={reason}>
            {children}
        </span>
    )
}

export function MaintenanceSection({
    appSettings,
    onSetScanOnStartup,
    isSetScanOnStartupPending,
    onRescanMissingMetadata,
    isRescanMissingMetadataPending,
    onRefreshMissingCovers,
    isRefreshMissingCoversPending,
    onReconcileLocalFiles,
    isReconcileLocalFilesPending,
    maintenanceNotice,
    onExportUnresolvedCsv,
    onImportEnrichmentCsv,
    isExportPending,
    isImportPending,
    csvTransferNotice,
    csvImportProgress,
}: MaintenanceSectionProps) {
    const csvOperationReason = isImportPending || isExportPending ? 'CSV operation in progress' : undefined

    return (
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-100 p-6 dark:border-slate-700/60">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Library Maintenance</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Manage metadata refresh, reconciliation, and data import/export</p>
            </div>
            <div className="space-y-6 p-6">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/70">
                        <div>
                            <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Run Local File Check On Startup</h4>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                On app launch, verify indexed files still exist and remove missing entries automatically.
                            </p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={appSettings?.scanOnStartup ?? true}
                            disabled={!appSettings || isSetScanOnStartupPending}
                            onClick={() => onSetScanOnStartup(!(appSettings?.scanOnStartup ?? true))}
                            className={cx(
                                'relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors',
                                (appSettings?.scanOnStartup ?? true)
                                    ? 'border-accent-500 bg-accent-500'
                                    : 'border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-slate-700',
                                (!appSettings || isSetScanOnStartupPending) && 'cursor-not-allowed opacity-60',
                            )}
                        >
                            <span
                                className={cx(
                                    'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                                    (appSettings?.scanOnStartup ?? true) ? 'translate-x-6' : 'translate-x-1',
                                )}
                            />
                        </button>
                    </div>
                    <DisabledTooltip className="grid w-fit" reason={isRescanMissingMetadataPending ? 'Rescan in progress' : undefined}>
                        <button className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-accent-600 transition-colors hover:bg-accent-50 hover:text-accent-700 disabled:pointer-events-none disabled:opacity-50 dark:text-accent-300 dark:hover:bg-accent-900/20 dark:hover:text-accent-200" disabled={isRescanMissingMetadataPending} onClick={onRescanMissingMetadata}><RefreshCw size={16} className={cx(isRescanMissingMetadataPending && 'animate-spin')} />{isRescanMissingMetadataPending ? 'Rescanning Metadata...' : 'Rescan & Update Metadata'}</button>
                    </DisabledTooltip>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Re-processes library entries to fill missing metadata and covers.</p>
                    <DisabledTooltip className="mt-3 grid w-fit" reason={isRefreshMissingCoversPending ? 'Cover refresh in progress' : undefined}>
                        <button className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-accent-600 transition-colors hover:bg-accent-50 hover:text-accent-700 disabled:pointer-events-none disabled:opacity-50 dark:text-accent-300 dark:hover:bg-accent-900/20 dark:hover:text-accent-200" disabled={isRefreshMissingCoversPending} onClick={onRefreshMissingCovers}><RefreshCw size={16} className={cx(isRefreshMissingCoversPending && 'animate-spin')} />{isRefreshMissingCoversPending ? 'Refreshing Covers...' : 'Refresh Missing Covers'}</button>
                    </DisabledTooltip>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Only fills missing cover art using ISBN and title/author lookups.</p>
                    <DisabledTooltip className="mt-3 grid w-fit" reason={isReconcileLocalFilesPending ? 'Local file check in progress' : undefined}>
                        <button
                            className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-accent-600 transition-colors hover:bg-accent-50 hover:text-accent-700 disabled:pointer-events-none disabled:opacity-50 dark:text-accent-300 dark:hover:bg-accent-900/20 dark:hover:text-accent-200"
                            disabled={isReconcileLocalFilesPending}
                            onClick={onReconcileLocalFiles}
                        >
                            <RefreshCw size={16} className={cx(isReconcileLocalFilesPending && 'animate-spin')} />
                            {isReconcileLocalFilesPending ? 'Checking Local Files...' : 'Reconcile with Local Files (Fast)'}
                        </button>
                    </DisabledTooltip>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Quickly checks indexed file paths, removes missing file records, and merges duplicate books.
                    </p>
                    {maintenanceNotice ? (
                        <div
                            className={cx(
                                'mt-3 rounded-lg border px-3 py-2 text-sm',
                                maintenanceNotice.tone === 'loading' &&
                                'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300',
                                maintenanceNotice.tone === 'success' &&
                                'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
                                maintenanceNotice.tone === 'warning' &&
                                'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
                                maintenanceNotice.tone === 'error' &&
                                'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
                            )}
                        >
                            <p className="font-medium">{maintenanceNotice.title}</p>
                            <p className="mt-0.5 text-xs opacity-90">{maintenanceNotice.message}</p>
                        </div>
                    ) : null}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <div className="space-y-3">
                        <DisabledTooltip className="grid w-fit" reason={csvOperationReason}>
                            <button
                                className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-accent-600 transition-colors hover:bg-accent-50 hover:text-accent-700 disabled:pointer-events-none disabled:opacity-50 dark:text-accent-300 dark:hover:bg-accent-900/20 dark:hover:text-accent-200"
                                disabled={isExportPending || isImportPending}
                                onClick={() => void onExportUnresolvedCsv()}
                            >
                                {isExportPending ? (
                                    <RefreshCw size={16} className="animate-spin" />
                                ) : (
                                    <Download size={16} />
                                )}
                                {isExportPending ? 'Exporting unresolved CSV...' : 'Export Unresolved CSV'}
                            </button>
                        </DisabledTooltip>

                        <DisabledTooltip className="grid w-fit" reason={csvOperationReason}>
                            <button
                                className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-accent-600 transition-colors hover:bg-accent-50 hover:text-accent-700 disabled:pointer-events-none disabled:opacity-50 dark:text-accent-300 dark:hover:bg-accent-900/20 dark:hover:text-accent-200"
                                disabled={isImportPending || isExportPending}
                                onClick={() => void onImportEnrichmentCsv()}
                            >
                                {isImportPending ? (
                                    <RefreshCw size={16} className="animate-spin" />
                                ) : (
                                    <Upload size={16} />
                                )}
                                {isImportPending ? 'Importing enrichment CSV...' : 'Import Enrichment CSV'}
                            </button>
                        </DisabledTooltip>
                    </div>

                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                        Export prompts for a save location. Import opens a file picker for an enrichment CSV.
                    </p>

                    {csvTransferNotice ? (
                        <div
                            className={cx(
                                'mt-3 rounded-lg border px-3 py-2 text-sm',
                                csvTransferNotice.tone === 'loading' &&
                                'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300',
                                csvTransferNotice.tone === 'success' &&
                                'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
                                csvTransferNotice.tone === 'error' &&
                                'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
                            )}
                        >
                            <p className="font-medium">{csvTransferNotice.title}</p>
                            <p className="mt-0.5 text-xs opacity-90">{csvTransferNotice.message}</p>
                            {csvImportProgress.active ? (
                                <div className="mt-3">
                                    <div className="mb-2 flex items-center justify-between text-xs">
                                        <span className="max-w-[220px] truncate font-medium">
                                            {csvImportProgress.message ? formatDisplayMessagePaths(csvImportProgress.message) : 'Importing enrichment CSV...'}
                                        </span>
                                        <span>{csvImportProgress.progressPercent}%</span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-accent-700/20">
                                        <div
                                            className="h-full rounded-full bg-accent-500 transition-all duration-300"
                                            style={{ width: `${csvImportProgress.progressPercent}%` }}
                                        />
                                    </div>
                                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] opacity-90">
                                        <span>{csvImportProgress.processedRows} processed</span>
                                        <span>{csvImportProgress.matchedRows} matched</span>
                                        <span>{csvImportProgress.updatedRows} updated</span>
                                        <span>{csvImportProgress.unresolvedRows} unresolved</span>
                                    </div>
                                    {csvImportProgress.path ? (
                                        <p className="mt-2 truncate text-[11px] opacity-80">{formatDisplayPath(csvImportProgress.path)}</p>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </section>
    )
}
