import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { formatDisplayPath } from '../../../lib/format'
import { INITIAL_CSV_IMPORT_PROGRESS } from '../model/constants'
import type { CsvImportProgressState, CsvTransferNotice } from '../model/types'

export function useCsvTransferMutations(deps: {
    setScanStatus: React.Dispatch<React.SetStateAction<string>>
    setCsvImportProgress: React.Dispatch<React.SetStateAction<CsvImportProgressState>>
    invalidateLibraryData: () => void
}) {
    const { setScanStatus, setCsvImportProgress, invalidateLibraryData } = deps

    const [csvTransferNotice, setCsvTransferNotice] = useState<CsvTransferNotice | null>(null)

    const exportMutation = useMutation({
        mutationFn: (path: string) => api.exportUnresolvedCsv(path),
        onMutate: (path) => {
            const displayPath = formatDisplayPath(path)
            setCsvTransferNotice({
                tone: 'loading',
                title: 'Exporting unresolved CSV',
                message: `Saving to ${displayPath}...`,
            })
            setScanStatus('Exporting unresolved CSV...')
        },
        onSuccess: (result) => {
            const displayPath = formatDisplayPath(result.path)
            setCsvTransferNotice({
                tone: 'success',
                title: 'CSV export complete',
                message: `Exported ${result.exportedRows} unresolved rows to ${displayPath}`,
            })
            setScanStatus(`Exported ${result.exportedRows} rows to ${displayPath}`)
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'CSV export failed'
            setCsvTransferNotice({
                tone: 'error',
                title: 'CSV export failed',
                message,
            })
            setScanStatus(message)
        },
    })
    const importMutation = useMutation({
        mutationFn: (path: string) => api.importEnrichmentCsv(path),
        onMutate: (path) => {
            const displayPath = formatDisplayPath(path)
            setCsvImportProgress({
                ...INITIAL_CSV_IMPORT_PROGRESS,
                active: true,
                phase: 'started',
                path,
                message: `Processing ${displayPath}...`,
            })
            setCsvTransferNotice({
                tone: 'loading',
                title: 'Importing enrichment CSV',
                message: `Processing ${displayPath}...`,
            })
            setScanStatus('Importing enrichment CSV...')
        },
        onSuccess: (result) => {
            const unresolvedRows = Math.max(0, result.importedRows - result.matchedRows)
            setCsvImportProgress((previous) => ({
                active: false,
                phase: 'completed',
                path: result.path,
                totalBytes: previous.totalBytes,
                bytesRead: previous.totalBytes ?? previous.bytesRead,
                processedRows: result.importedRows,
                matchedRows: result.matchedRows,
                updatedRows: result.updatedRows,
                unresolvedRows,
                errors: 0,
                progressPercent: 100,
                message: `CSV import complete: ${result.importedRows} rows processed, ${result.matchedRows} matched, ${result.updatedRows} updated`,
            }))
            setCsvTransferNotice({
                tone: 'success',
                title: 'CSV import complete',
                message: `${result.importedRows} rows processed: ${result.matchedRows} matched, ${result.updatedRows} updated, ${unresolvedRows} still unresolved`,
            })
            setScanStatus(
                `Imported ${result.importedRows} rows, matched ${result.matchedRows}, updated ${result.updatedRows}`,
            )
            invalidateLibraryData()
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'CSV import failed'
            setCsvImportProgress((previous) => ({
                ...previous,
                active: false,
                phase: 'error',
                errors: Math.max(previous.errors, 1),
                message,
            }))
            setCsvTransferNotice({
                tone: 'error',
                title: 'CSV import failed',
                message,
            })
            setScanStatus(message)
        },
    })

    const exportUnresolvedCsv = async () => {
        try {
            const path = await api.browseForCsvSave('lumina_library_unresolved.csv')
            if (!path) return
            exportMutation.mutate(path)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to open export dialog'
            setCsvTransferNotice({
                tone: 'error',
                title: 'CSV export failed',
                message,
            })
            setScanStatus(message)
        }
    }
    const importEnrichmentCsv = async () => {
        try {
            const path = await api.browseForCsvImport()
            if (!path) return
            importMutation.mutate(path)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to open import dialog'
            setCsvTransferNotice({
                tone: 'error',
                title: 'CSV import failed',
                message,
            })
            setScanStatus(message)
        }
    }

    return {
        exportMutation,
        importMutation,
        csvTransferNotice,
        exportUnresolvedCsv,
        importEnrichmentCsv,
    }
}
