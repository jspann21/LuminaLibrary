import { FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { LibraryFolder } from '../../../../lib/types'
import { formatDate, formatDisplayPath } from '../../../../lib/format'
import { cx } from '../../lib/cx'

type LibrarySourcesSectionProps = {
    folderPath: string
    onSetFolderPath: (value: string) => void
    onBrowseForFolder: () => void
    onQuickAddBooks: () => void
    onAddFolder: () => void
    folders: LibraryFolder[]
    onScanFolder: (folderId: string) => void
    onRemoveFolder: (folderId: string) => void
    isScanningFolder: boolean
    isAddingFolder: boolean
    isRemovingFolder: boolean
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
        <span className={cx(className ?? 'inline-grid', reason && 'cursor-not-allowed')} title={reason}>
            {children}
        </span>
    )
}

export function LibrarySourcesSection({
    folderPath,
    onSetFolderPath,
    onBrowseForFolder,
    onQuickAddBooks,
    onAddFolder,
    folders,
    onScanFolder,
    onRemoveFolder,
    isScanningFolder,
    isAddingFolder,
    isRemovingFolder,
}: LibrarySourcesSectionProps) {
    const addFolderDisabledReason = isAddingFolder
        ? 'Adding folder'
        : !folderPath.trim()
            ? 'Enter a valid path to add'
            : undefined

    return (
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-slate-700/60">
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">Library Sources</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Folders we monitor for new books</p>
                </div>
                <button onClick={onQuickAddBooks} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-accent-600 transition-colors hover:bg-accent-50 hover:text-accent-700 dark:text-accent-300 dark:hover:bg-accent-900/20 dark:hover:text-accent-200"><Plus size={16} />Add Source</button>
            </div>
            <div className="space-y-4 p-6">
                <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <input aria-label="Folder path" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/30" placeholder="Add folder path (e.g. C:\\Books)" value={folderPath} onChange={(event) => onSetFolderPath(event.target.value)} />
                    <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700" onClick={onBrowseForFolder}><FolderOpen className="mr-2 inline-block" size={14} />Browse</button>
                    <DisabledTooltip className="grid" reason={addFolderDisabledReason}>
                        <button className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:pointer-events-none disabled:opacity-50" disabled={!folderPath.trim() || isAddingFolder} onClick={onAddFolder}>Add Folder</button>
                    </DisabledTooltip>
                </div>

                <div className="space-y-2">
                    {folders.map((folder) => (
                        <div key={folder.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/30">
                            <div>
                                <p className="font-medium text-slate-900 dark:text-slate-100">{formatDisplayPath(folder.path)}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Recursive: Yes • Last scan: {folder.lastScanAt ? formatDate(folder.lastScanAt) : 'Never'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <DisabledTooltip reason={isScanningFolder ? 'Scanning in progress' : undefined}>
                                    <button className="rounded-md border border-slate-300 px-2 py-1 text-xs transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => onScanFolder(folder.id)} disabled={isScanningFolder}><RefreshCw className="mr-1 inline-block" size={12} />Scan</button>
                                </DisabledTooltip>
                                <DisabledTooltip reason={isRemovingFolder ? 'Removing folder' : undefined}>
                                    <button className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 transition-colors hover:bg-red-50 disabled:pointer-events-none disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20" onClick={() => onRemoveFolder(folder.id)} disabled={isRemovingFolder}><Trash2 className="mr-1 inline-block" size={12} />Remove</button>
                                </DisabledTooltip>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
