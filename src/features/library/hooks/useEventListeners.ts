import { useEffect, useRef } from 'react'
import { onBulkMatchProgress, onCsvImportProgress, onGoogleBooksQuotaNotice, onLibraryThingImportProgress, onScanCompleted, onScanProgress } from '../../../lib/api'
import { formatDisplayMessagePaths, formatDisplayPath } from '../../../lib/format'
import type { ScanSummary } from '../../../lib/types'

import type { BulkMatchProgressState, CsvImportProgressState, KeyTestNotice, LibraryThingImportProgressState, ScanProgressState } from '../model/types'

const UI_STATUS_UPDATE_INTERVAL_MS = 250
const PHASE_LABELS: Partial<Record<ScanProgressState['phase'], string>> = {
    local_scan: 'Indexing files (1/2)',
    enrichment_queue: 'Matching metadata (2/2)',
}

function phaseLabel(phase: ScanProgressState['phase']) {
    return PHASE_LABELS[phase] ?? 'Scanning'
}

function buildScanCompletedMessage(summary: ScanSummary): string {
    const parts: string[] = []
    if (summary.newFiles > 0) parts.push(`${summary.newFiles} new`)
    if (summary.matchedFiles > 0) parts.push(`${summary.matchedFiles} matched`)
    if (summary.discoveredFiles > 0) parts.push(`${summary.discoveredFiles} unresolved`)
    if (summary.updatedFiles > 0) parts.push(`${summary.updatedFiles} updated`)
    if (summary.removedFiles > 0) parts.push(`${summary.removedFiles} removed`)
    if (summary.errors > 0) parts.push(`${summary.errors} errors`)
    if (parts.length === 0) return 'Scan complete – no changes'
    return `Scan complete – ${parts.join(', ')}`
}

function csvImportProgressPercent(state: Pick<CsvImportProgressState, 'phase' | 'totalBytes' | 'bytesRead'>) {
    if (state.phase === 'completed') return 100
    if (!state.totalBytes || state.totalBytes <= 0) return 0
    return Math.min(99, Math.round((state.bytesRead / state.totalBytes) * 100))
}

export function progressPercentForPhase(scanProgress: ScanProgressState) {
    if (scanProgress.phase === 'completed') return 100
    if (scanProgress.totalFound <= 0) return 0

    const stageProgress = Math.min(1, scanProgress.processedFiles / scanProgress.totalFound)
    if (scanProgress.phase === 'local_scan') {
        return Math.min(99, Math.round(stageProgress * 50))
    }
    if (scanProgress.phase === 'enrichment_queue') {
        return Math.min(99, 50 + Math.round(stageProgress * 50))
    }
    return Math.min(99, Math.round(stageProgress * 100))
}

function shouldResetScanProgressPath(event: { phase?: ScanProgressState['phase']; processedFiles?: number }) {
    return event.phase === 'completed' || event.processedFiles === 0
}

export type EventListenerState = {
    scanProgress: ScanProgressState
    setScanProgress: React.Dispatch<React.SetStateAction<ScanProgressState>>
    setBulkMatchProgress: React.Dispatch<React.SetStateAction<BulkMatchProgressState>>
    csvImportProgress: CsvImportProgressState
    setCsvImportProgress: React.Dispatch<React.SetStateAction<CsvImportProgressState>>
    libraryThingImportProgress: LibraryThingImportProgressState
    setLibraryThingImportProgress: React.Dispatch<React.SetStateAction<LibraryThingImportProgressState>>
    scanStatus: string
    setScanStatus: React.Dispatch<React.SetStateAction<string>>
    keyTestNotice: KeyTestNotice | null
    setKeyTestNotice: React.Dispatch<React.SetStateAction<KeyTestNotice | null>>
    invalidateLibraryData: () => void
}

export function useEventListeners(state: EventListenerState) {
    const {
        setScanProgress,
        setBulkMatchProgress,
        setCsvImportProgress,
        setLibraryThingImportProgress,
        setScanStatus,
        setKeyTestNotice,
        invalidateLibraryData,
    } = state

    const lastProgressUiUpdateAt = useRef(0)
    const lastCsvImportUiUpdateAt = useRef(0)
    const lastLibraryThingImportUiUpdateAt = useRef(0)

    useEffect(() => {
        let disposed = false
        const unlistenFns: Array<() => void> = []
        const register = (listener: Promise<(() => void) | undefined>) => {
            void listener
                .then((unlisten) => {
                    if (!unlisten) return
                    if (disposed) {
                        unlisten()
                        return
                    }
                    unlistenFns.push(unlisten)
                })
                .catch(() => {
                    // Ignore listener registration failures; API calls surface Tauri runtime issues.
                })
        }

        register(onScanProgress((event) => {
            if (disposed) return
            setScanProgress((previous) => {
                const nextPhase = event.phase ?? previous.phase
                const active = nextPhase !== 'completed' && nextPhase !== 'idle'
                const currentPath = event.path ?? (shouldResetScanProgressPath(event) ? undefined : previous.currentPath)
                return {
                    active,
                    phase: nextPhase,
                    totalFound: event.totalFound ?? previous.totalFound,
                    pendingFiles: event.pendingFiles ?? previous.pendingFiles,
                    processedFiles: event.processedFiles ?? previous.processedFiles,
                    newFiles: event.newFiles ?? previous.newFiles,
                    updatedFiles: event.updatedFiles ?? previous.updatedFiles,
                    unchangedFiles: event.unchangedFiles ?? previous.unchangedFiles,
                    matchedFiles: event.matchedFiles ?? previous.matchedFiles,
                    discoveredFiles: event.discoveredFiles ?? previous.discoveredFiles,
                    removedFiles: event.removedFiles ?? previous.removedFiles,
                    errors: event.errors ?? previous.errors,
                    currentPath,
                }
            })

            const now = Date.now()
            if (!event.error && now - lastProgressUiUpdateAt.current < UI_STATUS_UPDATE_INTERVAL_MS) {
                return
            }

            lastProgressUiUpdateAt.current = now

            if (event.error) {
                setScanStatus(`Error: ${formatDisplayMessagePaths(event.error)}`)
                return
            }

            const phase = event.phase ?? 'progress'
            const isDetailedPhase = phase === 'local_scan' || phase === 'enrichment_queue'
            const label = phaseLabel(phase)

            if (typeof event.processedFiles === 'number' && typeof event.totalFound === 'number') {
                const suffix = isDetailedPhase ? '' : ' files'
                setScanStatus(`${label} ${event.processedFiles}/${event.totalFound}${suffix}...`)
                return
            }

            if (event.path) {
                setScanStatus(`${label}: ${formatDisplayPath(event.path)}`)
            }
        }))

        register(onScanCompleted((summary: ScanSummary) => {
            if (disposed) return
            setScanProgress((previous) => ({
                ...previous,
                active: true,
                phase: 'completed',
                newFiles: summary.newFiles,
                updatedFiles: summary.updatedFiles,
                unchangedFiles: summary.unchangedFiles,
                matchedFiles: summary.matchedFiles,
                discoveredFiles: summary.discoveredFiles,
                removedFiles: summary.removedFiles,
                errors: summary.errors,
                processedFiles: Math.max(previous.processedFiles, summary.scannedFiles),
                totalFound: Math.max(previous.totalFound, summary.scannedFiles),
                currentPath: undefined,
            }))
            setScanStatus(buildScanCompletedMessage(summary))
            invalidateLibraryData()
        }))

        register(onCsvImportProgress((event) => {
            if (disposed) return
            setCsvImportProgress((previous) => {
                const nextPhase = event.phase ?? previous.phase
                const totalBytes = typeof event.totalBytes === 'number' ? event.totalBytes : previous.totalBytes
                const bytesRead = typeof event.bytesRead === 'number' ? event.bytesRead : previous.bytesRead
                const processedRows = event.processedRows ?? previous.processedRows
                const matchedRows = event.matchedRows ?? previous.matchedRows
                const updatedRows = event.updatedRows ?? previous.updatedRows
                const unresolvedRows = event.unresolvedRows ?? Math.max(0, processedRows - matchedRows)
                const errors = event.errors ?? previous.errors
                const progressPercent =
                    typeof event.progressPercent === 'number'
                        ? Math.max(0, Math.min(nextPhase === 'completed' ? 100 : 99, event.progressPercent))
                        : csvImportProgressPercent({
                            phase: nextPhase,
                            totalBytes,
                            bytesRead,
                        })
                return {
                    active: nextPhase !== 'idle',
                    phase: nextPhase,
                    path: event.path ?? previous.path,
                    totalBytes,
                    bytesRead,
                    processedRows,
                    matchedRows,
                    updatedRows,
                    unresolvedRows,
                    errors,
                    progressPercent,
                    message: event.message ? formatDisplayMessagePaths(event.message) : previous.message,
                }
            })

            const phase = event.phase ?? 'progress'
            if (phase === 'error') {
                setScanStatus(event.message ? `CSV import failed: ${formatDisplayMessagePaths(event.message)}` : 'CSV import failed')
                return
            }
            if (phase === 'completed') {
                const processedRows = event.processedRows ?? 0
                const matchedRows = event.matchedRows ?? 0
                const updatedRows = event.updatedRows ?? 0
                setScanStatus(
                    (event.message ? formatDisplayMessagePaths(event.message) : undefined) ??
                    `CSV import complete: ${processedRows} rows processed, ${matchedRows} matched, ${updatedRows} updated`,
                )
                return
            }

            const now = Date.now()
            if (now - lastCsvImportUiUpdateAt.current < UI_STATUS_UPDATE_INTERVAL_MS) return

            lastCsvImportUiUpdateAt.current = now

            const processedRows = event.processedRows ?? 0
            const totalBytes = event.totalBytes
            const bytesRead = event.bytesRead ?? 0
            const progressPercent =
                typeof event.progressPercent === 'number'
                    ? Math.max(0, Math.min(99, event.progressPercent))
                    : totalBytes && totalBytes > 0
                        ? Math.min(99, Math.round((bytesRead / totalBytes) * 100))
                        : 0
            setScanStatus(
                (event.message ? formatDisplayMessagePaths(event.message) : undefined) ??
                `Importing enrichment CSV: ${processedRows} rows processed (${progressPercent}%)`,
            )
        }))

        register(onLibraryThingImportProgress((event) => {
            if (disposed) return
            setLibraryThingImportProgress((previous) => {
                const nextPhase = event.phase ?? previous.phase
                const totalRows = event.totalRows ?? previous.totalRows
                const processedRows = event.processedRows ?? previous.processedRows
                const matchedRows = event.matchedRows ?? previous.matchedRows
                const createdRows = event.createdRows ?? previous.createdRows
                const skippedRows = event.skippedRows ?? previous.skippedRows
                const coverRows = event.coverRows ?? previous.coverRows
                const errors = event.errors ?? previous.errors
                const progressPercent =
                    typeof event.progressPercent === 'number'
                        ? Math.max(0, Math.min(nextPhase === 'completed' ? 100 : 99, event.progressPercent))
                        : nextPhase === 'completed'
                            ? 100
                            : totalRows > 0
                                ? Math.min(99, Math.round((processedRows / totalRows) * 100))
                                : 0
                return {
                    active: nextPhase !== 'idle',
                    phase: nextPhase,
                    path: event.path ?? previous.path,
                    totalRows,
                    processedRows,
                    matchedRows,
                    createdRows,
                    skippedRows,
                    coverRows,
                    currentTitle: event.currentTitle ?? previous.currentTitle,
                    errors,
                    progressPercent,
                    message: event.message ? formatDisplayMessagePaths(event.message) : previous.message,
                }
            })

            const phase = event.phase ?? 'importing'
            if (phase === 'error') {
                setScanStatus(event.message ? `LibraryThing import failed: ${formatDisplayMessagePaths(event.message)}` : 'LibraryThing import failed')
                return
            }
            if (phase === 'completed') {
                setScanStatus(
                    event.message
                        ? formatDisplayMessagePaths(event.message)
                        : `LibraryThing import complete: ${event.processedRows ?? 0}/${event.totalRows ?? 0} processed`,
                )
                invalidateLibraryData()
                return
            }

            const now = Date.now()
            if (now - lastLibraryThingImportUiUpdateAt.current < UI_STATUS_UPDATE_INTERVAL_MS) return
            lastLibraryThingImportUiUpdateAt.current = now

            const processedRows = event.processedRows ?? 0
            const totalRows = event.totalRows ?? 0
            const action =
                phase === 'parsing'
                    ? 'Reading LibraryThing export'
                    : phase === 'cover_lookup'
                        ? 'Finding LibraryThing cover art'
                        : 'Importing LibraryThing books'
            setScanStatus(
                event.message
                    ? formatDisplayMessagePaths(event.message)
                    : totalRows > 0
                        ? `${action}: ${processedRows}/${totalRows}`
                        : action,
            )
        }))

        register(onBulkMatchProgress((event) => {
            if (disposed) return
            setBulkMatchProgress((previous) => {
                const phase = event.phase ?? previous.phase
                return {
                    active: phase !== 'idle',
                    phase,
                    totalFiles: event.totalFiles ?? previous.totalFiles,
                    processedFiles: event.processedFiles ?? previous.processedFiles,
                    matchedFiles: event.matchedFiles ?? previous.matchedFiles,
                    unresolvedFiles: event.unresolvedFiles ?? previous.unresolvedFiles,
                    skippedFiles: event.skippedFiles ?? previous.skippedFiles,
                    currentPath: event.currentPath ?? (phase === 'completed' ? undefined : previous.currentPath),
                }
            })

            const phase = event.phase ?? 'progress'
            if (phase === 'completed') {
                const matchedFiles = event.matchedFiles ?? 0
                const unresolvedFiles = event.unresolvedFiles ?? 0
                const skippedFiles = event.skippedFiles ?? 0
                setScanStatus(
                    `Match All complete: ${matchedFiles} matched, ${unresolvedFiles} unresolved${skippedFiles > 0 ? `, ${skippedFiles} skipped` : ''}`,
                )
                return
            }

            if (typeof event.processedFiles === 'number' && typeof event.totalFiles === 'number') {
                setScanStatus(`Matching All ${event.processedFiles}/${event.totalFiles}...`)
            }
        }))

        register(onGoogleBooksQuotaNotice((event) => {
            if (disposed) return
            setScanStatus(formatDisplayMessagePaths(event.message))
            setKeyTestNotice({
                tone: 'error',
                message: formatDisplayMessagePaths(event.message),
            })
        }))

        return () => {
            disposed = true
            for (const unlisten of unlistenFns.splice(0)) {
                unlisten()
            }
        }
    }, [invalidateLibraryData, setScanProgress, setBulkMatchProgress, setCsvImportProgress, setLibraryThingImportProgress, setScanStatus, setKeyTestNotice])
}
