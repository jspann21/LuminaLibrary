import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { formatDisplayPath } from '../../../lib/format'
import { libraryQueryKeys } from '../model/queryKeys'
import type { KeyTestNotice } from '../model/types'
import type { ApiKeyTestResult, FolderRemovalPreview } from '../../../lib/types'

export function useSettingsMutations(deps: {
    setScanStatus: React.Dispatch<React.SetStateAction<string>>
    invalidateLibraryData: () => void
    openConfirmDialog: (dialog: { title: string; message: string; confirmLabel: string; tone?: 'default' | 'warning' | 'danger'; onConfirm: () => void }) => void
}) {
    const { setScanStatus, invalidateLibraryData, openConfirmDialog } = deps
    const queryClient = useQueryClient()

    const [folderPath, setFolderPath] = useState('')
    const [googleBooksApiKeyInput, setGoogleBooksApiKeyInput] = useState('')
    const [keyTestNotice, setKeyTestNotice] = useState<KeyTestNotice | null>(null)

    const addFolderMutation = useMutation({
        mutationFn: (path: string) => api.addLibraryFolder(formatDisplayPath(path).trim(), true),
        onSuccess: (folder) => {
            setFolderPath('')
            void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.folders() })
            void api.startScan(folder.id)
        },
    })
    const removeFolderMutation = useMutation({
        mutationFn: (preview: FolderRemovalPreview) => api.removeLibraryFolder(preview.folderId),
        onSuccess: (_, preview) => {
            setScanStatus(
                `Source removed: ${preview.fileCount} file records removed; ${preview.bookCount} books removed from library.`,
            )
            invalidateLibraryData()
        },
    })
    const setGoogleBooksApiKeyMutation = useMutation({
        mutationFn: (apiKey: string) => api.setGoogleBooksApiKey(apiKey),
        onSuccess: () => {
            setGoogleBooksApiKeyInput('')
            setKeyTestNotice(null)
            void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.appSettings() })
            setScanStatus('Google Books API key saved to secure OS credential storage')
        },
        onError: (error: unknown) => {
            setScanStatus(error instanceof Error ? error.message : 'Failed to save Google Books API key')
        },
    })
    const clearGoogleBooksApiKeyMutation = useMutation({
        mutationFn: () => api.clearGoogleBooksApiKey(),
        onSuccess: () => {
            setGoogleBooksApiKeyInput('')
            setKeyTestNotice(null)
            void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.appSettings() })
            setScanStatus('Google Books API key removed from secure OS credential storage')
        },
        onError: (error: unknown) => {
            setScanStatus(error instanceof Error ? error.message : 'Failed to clear Google Books API key')
        },
    })
    const setScanOnStartupMutation = useMutation({
        mutationFn: (enabled: boolean) => api.setScanOnStartup(enabled),
        onSuccess: (settings) => {
            queryClient.setQueryData(libraryQueryKeys.appSettings(), settings)
            setScanStatus(
                settings.scanOnStartup
                    ? 'Startup local file scan enabled'
                    : 'Startup local file scan disabled',
            )
        },
        onError: (error: unknown) => {
            setScanStatus(error instanceof Error ? error.message : 'Failed to update startup scan setting')
        },
    })
    const testGoogleBooksApiKeyMutation = useMutation({
        mutationFn: (apiKey?: string) => api.testGoogleBooksApiKey(apiKey),
        onMutate: () => {
            setKeyTestNotice({
                tone: 'loading',
                message: 'Testing Google Books API key...',
            })
        },
        onSuccess: (result: ApiKeyTestResult) => {
            setKeyTestNotice({
                tone: result.ok ? 'success' : 'error',
                message: result.message,
            })
            setScanStatus(result.ok ? result.message : `Key test failed: ${result.message}`)
        },
        onError: (error: unknown) => {
            setKeyTestNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Failed to test Google Books API key',
            })
            setScanStatus(error instanceof Error ? error.message : 'Failed to test Google Books API key')
        },
    })

    const browseForFolder = async () => {
        try {
            const selected = await api.browseForFolder()
            if (selected) setFolderPath(formatDisplayPath(selected))
        } catch (error) {
            setScanStatus(error instanceof Error ? error.message : 'Unable to open folder browser')
        }
    }
    const quickAddBooks = async () => {
        try {
            const selected = await api.browseForFolder()
            if (!selected) return
            const displayPath = formatDisplayPath(selected)
            setFolderPath(displayPath)
            addFolderMutation.mutate(displayPath)
        } catch (error) {
            setScanStatus(error instanceof Error ? error.message : 'Unable to add source')
        }
    }
    const requestRemoveFolder = async (folderId: string) => {
        try {
            const preview = await api.getFolderRemovalPreview(folderId)
            const displayPath = formatDisplayPath(preview.path)
            openConfirmDialog({
                title: 'Remove source folder from library?',
                message: `"${displayPath}" will be removed as a source. This removes ${preview.fileCount} indexed file records from this source (including subfolders) and ${preview.bookCount} book entries that only exist in this source. Files on disk are not deleted.`,
                confirmLabel: 'Remove Source',
                tone: 'danger',
                onConfirm: () => removeFolderMutation.mutate(preview),
            })
        } catch (error) {
            setScanStatus(error instanceof Error ? error.message : 'Unable to preview source removal')
        }
    }
    const saveGoogleBooksApiKey = () => {
        const value = googleBooksApiKeyInput.trim()
        if (!value) {
            setScanStatus('Enter a Google Books API key before saving')
            return
        }
        setGoogleBooksApiKeyMutation.mutate(value)
    }
    const clearGoogleBooksApiKey = () => {
        openConfirmDialog({
            title: 'Clear Google Books API key?',
            message: 'This removes the key from secure OS credential storage for this app.',
            confirmLabel: 'Clear Key',
            tone: 'warning',
            onConfirm: () => clearGoogleBooksApiKeyMutation.mutate(),
        })
    }
    const testGoogleBooksApiKey = () => {
        const value = googleBooksApiKeyInput.trim()
        testGoogleBooksApiKeyMutation.mutate(value || undefined)
    }

    return {
        folderPath,
        setFolderPath,
        googleBooksApiKeyInput,
        setGoogleBooksApiKeyInput,
        keyTestNotice,
        setKeyTestNotice,
        addFolderMutation,
        removeFolderMutation,
        setGoogleBooksApiKeyMutation,
        clearGoogleBooksApiKeyMutation,
        setScanOnStartupMutation,
        testGoogleBooksApiKeyMutation,
        browseForFolder,
        quickAddBooks,
        requestRemoveFolder,
        saveGoogleBooksApiKey,
        clearGoogleBooksApiKey,
        testGoogleBooksApiKey,
    }
}
