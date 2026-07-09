import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { INITIAL_SCAN_PROGRESS } from '../model/constants'
import type { CoverRefreshNotice, MaintenanceNotice, ScanProgressState } from '../model/types'

export function useScanMutations(deps: {
    setScanProgress: React.Dispatch<React.SetStateAction<ScanProgressState>>
    setScanStatus: React.Dispatch<React.SetStateAction<string>>
    invalidateLibraryData: () => void
}) {
    const { setScanProgress, setScanStatus, invalidateLibraryData } = deps


    const [coverRefreshNotice, setCoverRefreshNotice] = useState<CoverRefreshNotice | null>(null)
    const [maintenanceNotice, setMaintenanceNotice] = useState<MaintenanceNotice | null>(null)
    const startupReconcileTriggeredRef = useRef(false)

    const scanMutation = useMutation({
        mutationFn: (folderId?: string) => api.startScan(folderId),
        onMutate: (folderId) => {
            setScanProgress(INITIAL_SCAN_PROGRESS)
            setScanStatus(folderId ? 'Indexing selected folder (1/2)...' : 'Indexing all folders (1/2)...')
        },
    })
    const rescanMissingMetadataMutation = useMutation({
        mutationFn: () => api.rescanMissingMetadata(),
        onMutate: () => {
            setScanProgress(INITIAL_SCAN_PROGRESS)
            setScanStatus('Indexing metadata refresh set (1/2)...')
        },
        onSuccess: (summary) => {
            setScanStatus(`Metadata refresh completed - matched ${summary.matchedFiles}, unresolved ${summary.discoveredFiles}`)
            invalidateLibraryData()
        },
    })
    const refreshMissingCoversMutation = useMutation({
        mutationFn: () => api.refreshMissingCovers(),
        onMutate: () => {
            setScanProgress(INITIAL_SCAN_PROGRESS)
            setScanStatus('Refreshing missing covers...')
            setCoverRefreshNotice({
                tone: 'loading',
                title: 'Refreshing covers',
                message: 'Looking up missing cover images...',
            })
        },
        onSuccess: (summary) => {
            setScanStatus(
                `Cover refresh completed - updated ${summary.updatedFiles}, still missing ${summary.unchangedFiles}, errors ${summary.errors}`,
            )
            setCoverRefreshNotice({
                tone: summary.errors > 0 ? 'warning' : 'success',
                title: 'Cover refresh complete',
                message: `${summary.updatedFiles} added, ${summary.unchangedFiles} not found, ${summary.errors} errors`,
            })
            invalidateLibraryData()
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Failed to refresh missing covers'
            setCoverRefreshNotice({
                tone: 'error',
                title: 'Cover refresh failed',
                message,
            })
            setScanStatus(message)
        },
    })
    const reconcileLocalFilesMutation = useMutation({
        mutationFn: () => api.reconcileLocalFiles(),
        onMutate: () => {
            setMaintenanceNotice({
                tone: 'loading',
                title: 'Checking local files',
                message: 'Verifying indexed files exist on disk and consolidating duplicate books...',
            })
            setScanStatus('Checking local files...')
        },
        onSuccess: (result) => {
            setMaintenanceNotice({
                tone:
                    result.missingFilesFound > 0 || result.mergedDuplicateBooks > 0 || result.removedOrphanBooks > 0
                        ? 'success'
                        : 'warning',
                title: 'Local file sync complete',
                message: `Checked ${result.checkedFiles} files: missing ${result.missingFilesFound}, removed file records ${result.removedFiles}, removed orphan books ${result.removedOrphanBooks}, merged duplicates ${result.mergedDuplicateBooks}.`,
            })
            setScanStatus(
                `Local sync complete - removed files ${result.removedFiles}, orphan books ${result.removedOrphanBooks}, merged duplicates ${result.mergedDuplicateBooks}`,
            )
            invalidateLibraryData()
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Failed to reconcile local files'
            setMaintenanceNotice({
                tone: 'error',
                title: 'Local file sync failed',
                message,
            })
            setScanStatus(message)
        },
    })

    // Auto-trigger startup reconcile when settings indicate scan-on-startup
    const { mutate: reconcileLocalFiles } = reconcileLocalFilesMutation
    const triggerStartupReconcile = useCallback((scanOnStartup: boolean | undefined, isLoading: boolean) => {
        if (startupReconcileTriggeredRef.current) return
        if (isLoading) return
        if (!scanOnStartup) {
            startupReconcileTriggeredRef.current = true
            return
        }
        startupReconcileTriggeredRef.current = true
        const timer = window.setTimeout(() => {
            reconcileLocalFiles()
        }, 1200)
        return () => window.clearTimeout(timer)
    }, [reconcileLocalFiles])

    // Auto-dismiss maintenance notice
    useEffect(() => {
        if (!maintenanceNotice || maintenanceNotice.tone === 'loading') return
        const timer = window.setTimeout(() => {
            setMaintenanceNotice((current) => (current?.tone === 'loading' ? current : null))
        }, 7000)
        return () => window.clearTimeout(timer)
    }, [maintenanceNotice])

    return {
        scanMutation,
        rescanMissingMetadataMutation,
        refreshMissingCoversMutation,
        reconcileLocalFilesMutation,
        coverRefreshNotice,
        setCoverRefreshNotice,
        maintenanceNotice,
        triggerStartupReconcile,
    }
}
