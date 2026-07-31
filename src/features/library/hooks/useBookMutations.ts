import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { sanitizeDisplayText } from '../../../lib/format'
import type { BookPatch, BulkMatchInput, MatchResult, MetadataFieldSelection, MetadataLockUpdate } from '../../../lib/types'
import { libraryQueryKeys } from '../model/queryKeys'
import { describeMatchReason } from '../model/selectors'
import type { BulkMatchProgressState, ConfirmDialogState, MatchDraft, MatchNotice } from '../model/types'

export function useBookMutations(deps: {
    setScanStatus: React.Dispatch<React.SetStateAction<string>>
    setBulkMatchProgress: React.Dispatch<React.SetStateAction<BulkMatchProgressState>>
    invalidateLibraryData: () => void
    openConfirmDialog: (dialog: ConfirmDialogState) => void
    getDiscoveredItems: () => Array<{ fileId: string; fileName: string }>
    onBooksHidden?: (bookIds: string[]) => void
}) {
    const { setScanStatus, invalidateLibraryData, openConfirmDialog, getDiscoveredItems } = deps
    const queryClient = useQueryClient()

    const [matchNotice, setMatchNotice] = useState<MatchNotice | null>(null)
    const [matchingFileId, setMatchingFileId] = useState<string | null>(null)
    const [matchDrafts, setMatchDrafts] = useState<Record<string, MatchDraft>>({})
    const [isMatchAllPending, setIsMatchAllPending] = useState(false)

    const attemptMatchMutation = useMutation({
        mutationFn: (input: { fileId: string; title?: string; author?: string; isbn?: string }) => api.attemptMatch(input),
        onMutate: (input) => {
            setMatchingFileId(input.fileId)
            setMatchNotice(null)
        },
        onSuccess: (result: MatchResult, input) => {
            const fileName =
                getDiscoveredItems().find((item) => item.fileId === input.fileId)?.fileName ?? input.fileId
            const reasonText = describeMatchReason(result.reason)
            if (result.matched) {
                setMatchNotice({
                    tone: 'success',
                    message: `Matched "${fileName}". ${reasonText}.`,
                })
            } else {
                setMatchNotice({
                    tone: 'warning',
                    message: `No match for "${fileName}". ${reasonText}.`,
                })
            }
            setScanStatus(result.matched ? `Matched ${fileName}` : `No match for ${fileName}: ${reasonText}`)
            invalidateLibraryData()
        },
        onError: (error: unknown, input) => {
            const fileName =
                getDiscoveredItems().find((item) => item.fileId === input.fileId)?.fileName ?? input.fileId
            const message = error instanceof Error ? error.message : 'Match attempt failed'
            setMatchNotice({
                tone: 'error',
                message: `Match failed for "${fileName}". ${message}`,
            })
            setScanStatus(message)
        },
        onSettled: () => {
            setMatchingFileId(null)
        },
    })
    const previewMatchMutation = useMutation({
        mutationFn: (input: { fileId: string; title?: string; author?: string; isbn?: string }) => api.previewMatch(input),
        onMutate: (input) => {
            setMatchingFileId(input.fileId)
            setMatchNotice(null)
        },
        onError: (error: unknown, input) => {
            const fileName =
                getDiscoveredItems().find((item) => item.fileId === input.fileId)?.fileName ?? input.fileId
            const message = error instanceof Error ? error.message : 'Preview failed'
            setMatchNotice({
                tone: 'error',
                message: `Preview failed for "${fileName}". ${message}`,
            })
        },
        onSettled: () => {
            setMatchingFileId(null)
        },
    })
    const createManualBookMutation = useMutation({
        mutationFn: (input: { fileId: string; patch: BookPatch; tags: string[] }) =>
            api.createManualBook(input.fileId, input.patch, input.tags),
        onMutate: (input) => {
            setMatchingFileId(input.fileId)
            setMatchNotice(null)
        },
        onSuccess: (detail, input) => {
            const fileName =
                getDiscoveredItems().find((item) => item.fileId === input.fileId)?.fileName ?? input.fileId
            setMatchDrafts((state) => {
                const next = { ...state }
                delete next[input.fileId]
                return next
            })
            setMatchNotice({
                tone: 'success',
                message: `Added "${fileName}" as "${detail.title}".`,
            })
            setScanStatus(`Added ${fileName} to library`)
            invalidateLibraryData()
        },
        onError: (error: unknown, input) => {
            const fileName =
                getDiscoveredItems().find((item) => item.fileId === input.fileId)?.fileName ?? input.fileId
            const message = error instanceof Error ? error.message : 'Manual add failed'
            setMatchNotice({
                tone: 'error',
                message: `Manual add failed for "${fileName}". ${message}`,
            })
            setScanStatus(message)
        },
        onSettled: () => {
            setMatchingFileId(null)
        },
    })

    const saveDetailMutation = useMutation({
        mutationFn: async (input: { bookId: string; patch: BookPatch; tags: string[] }) => {
            const detail = await api.applyManualBookEdit(input.bookId, input.patch)
            return api.setBookTags(detail.id, input.tags)
        },
        onSuccess: (detail) => {
            setScanStatus('Book metadata updated')
            queryClient.setQueryData(libraryQueryKeys.bookDetail(detail.id), detail)
            void queryClient.invalidateQueries({ queryKey: ['books'] })
            void queryClient.invalidateQueries({ queryKey: ['tags'] })
        },
    })
    const previewRescanMetadataMutation = useMutation({
        mutationFn: (input: { fileId?: string | null; bookId: string }) => api.previewRescanMetadata(input.bookId, input.fileId),
        onSuccess: (preview) => {
            const matched = preview.candidates.length
            if (matched > 0) {
                setScanStatus(`Rescan preview ready (${matched} metadata candidate${matched === 1 ? '' : 's'})`)
            } else {
                setScanStatus('Rescan preview complete (no metadata candidates)')
            }
        },
    })
    const applyCuratedMetadataMutation = useMutation({
        mutationFn: async (input: { bookId: string; selection: MetadataFieldSelection[]; lockUpdates: MetadataLockUpdate[] }) => {
            return api.applyCuratedMetadata(input.bookId, input.selection, input.lockUpdates)
        },
        onSuccess: (detail) => {
            setScanStatus('Curated metadata applied')
            queryClient.setQueryData(libraryQueryKeys.bookDetail(detail.id), detail)
            void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.bookDetail(detail.id) })
            void queryClient.invalidateQueries({ queryKey: ['books'] })
            void queryClient.invalidateQueries({ queryKey: ['tags'] })
        },
    })
    const deleteBookMutation = useMutation({
        mutationFn: (bookId: string) => api.deleteBook(bookId),
        onSuccess: () => {
            setScanStatus('Book removed from library')
            invalidateLibraryData()
        },
        onError: (error: unknown) => {
            setScanStatus(error instanceof Error ? error.message : 'Failed to remove book')
        },
    })
    const hideBooksMutation = useMutation({
        mutationFn: (bookIds: string[]) => api.hideBooks(bookIds),
        onSuccess: (updatedCount, bookIds) => {
            setScanStatus(`Hidden ${updatedCount} book${updatedCount === 1 ? '' : 's'} from library view`)
            deps.onBooksHidden?.(bookIds)
            invalidateLibraryData()
        },
    })
    const restoreBooksMutation = useMutation({
        mutationFn: (bookIds: string[]) => api.restoreBooks(bookIds),
        onSuccess: (updatedCount) => {
            setScanStatus(`Restored ${updatedCount} hidden book${updatedCount === 1 ? '' : 's'}`)
            invalidateLibraryData()
        },
    })
    const restoreAllHiddenBooksMutation = useMutation({
        mutationFn: () => api.restoreAllHiddenBooks(),
        onSuccess: (updatedCount) => {
            setScanStatus(`Restored ${updatedCount} hidden book${updatedCount === 1 ? '' : 's'}`)
            invalidateLibraryData()
        },
    })

    const requestHideBook = (bookId: string) => {
        openConfirmDialog({
            title: 'Hide book from library?',
            message: 'This keeps the file indexed but removes the book from your main library view until restored.',
            confirmLabel: 'Hide Book',
            tone: 'warning',
            onConfirm: () => hideBooksMutation.mutate([bookId]),
        })
    }

    const setMatchDraft = (fileId: string, patch: MatchDraft) => {
        setMatchDrafts((state) => ({ ...state, [fileId]: patch }))
    }

    const attemptMatchAll = async () => {
        const items = getDiscoveredItems()
        if (items.length === 0) return
        setIsMatchAllPending(true)

        deps.setBulkMatchProgress({
            active: true,
            phase: 'progress',
            totalFiles: items.length,
            processedFiles: 0,
            matchedFiles: 0,
            unresolvedFiles: 0,
            skippedFiles: 0,
            currentPath: '',
        })

        const batchItems: BulkMatchInput[] = items.map((file) => {
            const draft = matchDrafts[file.fileId] ?? {}
            return {
                fileId: file.fileId,
                title: sanitizeDisplayText(draft.title ?? '') || undefined,
                author: sanitizeDisplayText(draft.author ?? '') || undefined,
                isbn: sanitizeDisplayText(draft.isbn ?? '') || undefined,
            }
        })

        try {
            const result = await api.batchAttemptMatch(batchItems)

            deps.setBulkMatchProgress({
                active: true,
                phase: 'completed',
                totalFiles: items.length,
                processedFiles: items.length,
                matchedFiles: result.matchedCount,
                unresolvedFiles: result.failedCount + result.errorCount,
                skippedFiles: result.skippedCount,
                currentPath: '',
            })
            const failedTotal = result.failedCount + result.errorCount
            setMatchNotice({
                tone: result.matchedCount > 0 ? 'success' : 'warning',
                message: `Bulk match complete: ${result.matchedCount} matched, ${failedTotal} unresolved${result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : ''}.`,
            })
            setScanStatus(`Bulk match: ${result.matchedCount} matched, ${failedTotal} unresolved${result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : ''}`)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Bulk match failed'
            setMatchNotice({ tone: 'error', message })
            setScanStatus(message)
            deps.setBulkMatchProgress((prev) => ({
                ...prev,
                active: true,
                phase: 'completed',
            }))
        } finally {
            setMatchingFileId(null)
            setIsMatchAllPending(false)
            invalidateLibraryData()
        }
    }

    return {
        matchNotice,
        setMatchNotice,
        matchingFileId,
        matchDrafts,
        isMatchAllPending,
        attemptMatchMutation,
        previewMatchMutation,
        createManualBookMutation,
        saveDetailMutation,
        previewRescanMetadataMutation,
        applyCuratedMetadataMutation,
        deleteBookMutation,
        hideBooksMutation,
        restoreBooksMutation,
        restoreAllHiddenBooksMutation,
        requestHideBook,
        setMatchDraft,
        attemptMatchAll,
    }
}
