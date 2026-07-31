import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { formatDisplayPath } from '../../../lib/format'
import { libraryQueryKeys } from '../model/queryKeys'
import type { KeyTestNotice, LibraryThingNotice } from '../model/types'
import type { ApiKeyTestResult, FolderRemovalPreview, LibraryThingImportResult } from '../../../lib/types'

export function useSettingsMutations(deps: {
    setScanStatus: React.Dispatch<React.SetStateAction<string>>
    invalidateLibraryData: () => void
    openConfirmDialog: (dialog: { title: string; message: string; confirmLabel: string; tone?: 'default' | 'warning' | 'danger'; onConfirm: () => void }) => void
}) {
    const { setScanStatus, invalidateLibraryData, openConfirmDialog } = deps
    const queryClient = useQueryClient()

    const [folderPath, setFolderPath] = useState('')
    const [googleBooksApiKeyInput, setGoogleBooksApiKeyInput] = useState('')
    const [braveSearchApiKeyInput, setBraveSearchApiKeyInput] = useState('')
    const [libraryThingCatalogLabelInput, setLibraryThingCatalogLabelInput] = useState('')
    const [keyTestNotice, setKeyTestNotice] = useState<KeyTestNotice | null>(null)
    const [braveKeyTestNotice, setBraveKeyTestNotice] = useState<KeyTestNotice | null>(null)
    const [libraryThingNotice, setLibraryThingNotice] = useState<LibraryThingNotice | null>(null)

    const addFolderMutation = useMutation({
        mutationFn: (path: string) => api.addLibraryFolder(formatDisplayPath(path).trim(), true),
        onSuccess: (folder) => {
            setFolderPath('')
            void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.folders() })
            void api.startScan(folder.id).catch((error: unknown) => {
                setScanStatus(error instanceof Error ? error.message : 'Failed to scan the added source')
            })
        },
        onError: (error: unknown) => {
            setScanStatus(error instanceof Error ? error.message : 'Failed to add library source')
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
    const setBraveSearchApiKeyMutation = useMutation({
        mutationFn: (apiKey: string) => api.setBraveSearchApiKey(apiKey),
        onSuccess: () => {
            setBraveSearchApiKeyInput('')
            setBraveKeyTestNotice(null)
            void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.appSettings() })
            setScanStatus('Brave Search API key saved to secure OS credential storage')
        },
        onError: (error: unknown) => {
            setScanStatus(error instanceof Error ? error.message : 'Failed to save Brave Search API key')
        },
    })
    const clearBraveSearchApiKeyMutation = useMutation({
        mutationFn: () => api.clearBraveSearchApiKey(),
        onSuccess: () => {
            setBraveSearchApiKeyInput('')
            setBraveKeyTestNotice(null)
            void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.appSettings() })
            setScanStatus('Brave Search API key removed from secure OS credential storage')
        },
        onError: (error: unknown) => {
            setScanStatus(error instanceof Error ? error.message : 'Failed to clear Brave Search API key')
        },
    })
    const setLibraryThingEnabledMutation = useMutation({
        mutationFn: (enabled: boolean) => api.setLibraryThingEnabled(enabled),
        onSuccess: (settings) => {
            queryClient.setQueryData(libraryQueryKeys.appSettings(), settings)
            invalidateLibraryData()
            setScanStatus(settings.libraryThingEnabled ? 'LibraryThing integration enabled' : 'LibraryThing integration disabled')
        },
        onError: (error: unknown) => {
            setScanStatus(error instanceof Error ? error.message : 'Failed to update LibraryThing integration')
        },
    })
    const setLibraryThingCatalogLabelMutation = useMutation({
        mutationFn: (label?: string) => api.setLibraryThingCatalogLabel(label),
        onSuccess: (settings) => {
            queryClient.setQueryData(libraryQueryKeys.appSettings(), settings)
            setLibraryThingCatalogLabelInput('')
            setLibraryThingNotice({
                tone: 'success',
                message: settings.libraryThingCatalogLabel ? 'LibraryThing catalog label saved.' : 'LibraryThing catalog label cleared.',
            })
        },
        onError: (error: unknown) => {
            setLibraryThingNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Failed to save LibraryThing catalog label',
            })
        },
    })
    const importLibraryThingMutation = useMutation({
        mutationFn: (path: string) => api.importLibraryThingExport(path),
        onMutate: () => {
            setLibraryThingNotice({ tone: 'loading', message: 'LibraryThing import started. Progress is shown in the lower-right popup.' })
        },
        onSuccess: (result: LibraryThingImportResult) => {
            invalidateLibraryData()
            setLibraryThingNotice({
                tone: 'success',
                message: `Imported ${result.importedRows} LibraryThing rows (${result.matchedRows} matched, ${result.createdRows} new, ${result.skippedRows} skipped).`,
            })
            setScanStatus('LibraryThing export imported')
        },
        onError: (error: unknown) => {
            setLibraryThingNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Failed to import LibraryThing export',
            })
            setScanStatus(error instanceof Error ? error.message : 'Failed to import LibraryThing export')
        },
    })
    const clearLibraryThingMutation = useMutation({
        mutationFn: () => api.clearLibraryThingIntegration(),
        onSuccess: (settings) => {
            queryClient.setQueryData(libraryQueryKeys.appSettings(), settings)
            setLibraryThingCatalogLabelInput('')
            invalidateLibraryData()
            setLibraryThingNotice({ tone: 'success', message: 'LibraryThing integration data cleared.' })
            setScanStatus('LibraryThing integration data cleared')
        },
        onError: (error: unknown) => {
            setLibraryThingNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Failed to clear LibraryThing integration',
            })
            setScanStatus(error instanceof Error ? error.message : 'Failed to clear LibraryThing integration')
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
    const testBraveSearchApiKeyMutation = useMutation({
        mutationFn: (apiKey?: string) => api.testBraveSearchApiKey(apiKey),
        onMutate: () => {
            setBraveKeyTestNotice({ tone: 'loading', message: 'Testing Brave Search API key...' })
        },
        onSuccess: (result: ApiKeyTestResult) => {
            setBraveKeyTestNotice({
                tone: result.ok ? 'success' : 'error',
                message: result.message,
            })
            setScanStatus(result.ok ? result.message : `Key test failed: ${result.message}`)
        },
        onError: (error: unknown) => {
            setBraveKeyTestNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Failed to test Brave Search API key',
            })
            setScanStatus(error instanceof Error ? error.message : 'Failed to test Brave Search API key')
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
    const saveBraveSearchApiKey = () => {
        const value = braveSearchApiKeyInput.trim()
        if (!value) {
            setScanStatus('Enter a Brave Search API key before saving')
            return
        }
        setBraveSearchApiKeyMutation.mutate(value)
    }
    const clearBraveSearchApiKey = () => {
        openConfirmDialog({
            title: 'Clear Brave Search API key?',
            message: 'This removes the key from secure OS credential storage for this app.',
            confirmLabel: 'Clear Key',
            tone: 'warning',
            onConfirm: () => clearBraveSearchApiKeyMutation.mutate(),
        })
    }
    const testBraveSearchApiKey = () => {
        const value = braveSearchApiKeyInput.trim()
        testBraveSearchApiKeyMutation.mutate(value || undefined)
    }
    const browseAndImportLibraryThing = async () => {
        try {
            const selected = await api.browseForLibraryThingImport()
            if (selected) importLibraryThingMutation.mutate(formatDisplayPath(selected))
        } catch (error) {
            setLibraryThingNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Unable to open LibraryThing export picker',
            })
            setScanStatus(error instanceof Error ? error.message : 'Unable to open LibraryThing export picker')
        }
    }
    const saveLibraryThingCatalogLabel = () => {
        setLibraryThingCatalogLabelMutation.mutate(libraryThingCatalogLabelInput.trim() || undefined)
    }
    const clearLibraryThingIntegration = () => {
        openConfirmDialog({
            title: 'Clear LibraryThing integration?',
            message: 'This removes imported LibraryThing-only books and LibraryThing links from merged books. Local PDF/EPUB books and files are not deleted.',
            confirmLabel: 'Clear LibraryThing',
            tone: 'danger',
            onConfirm: () => clearLibraryThingMutation.mutate(),
        })
    }

    return {
        folderPath,
        setFolderPath,
        googleBooksApiKeyInput,
        setGoogleBooksApiKeyInput,
        braveSearchApiKeyInput,
        setBraveSearchApiKeyInput,
        libraryThingCatalogLabelInput,
        setLibraryThingCatalogLabelInput,
        keyTestNotice,
        setKeyTestNotice,
        braveKeyTestNotice,
        setBraveKeyTestNotice,
        libraryThingNotice,
        setLibraryThingNotice,
        addFolderMutation,
        removeFolderMutation,
        setGoogleBooksApiKeyMutation,
        clearGoogleBooksApiKeyMutation,
        setBraveSearchApiKeyMutation,
        clearBraveSearchApiKeyMutation,
        setScanOnStartupMutation,
        setLibraryThingEnabledMutation,
        setLibraryThingCatalogLabelMutation,
        importLibraryThingMutation,
        clearLibraryThingMutation,
        testGoogleBooksApiKeyMutation,
        testBraveSearchApiKeyMutation,
        browseForFolder,
        quickAddBooks,
        requestRemoveFolder,
        saveGoogleBooksApiKey,
        clearGoogleBooksApiKey,
        testGoogleBooksApiKey,
        saveBraveSearchApiKey,
        clearBraveSearchApiKey,
        testBraveSearchApiKey,
        browseAndImportLibraryThing,
        saveLibraryThingCatalogLabel,
        clearLibraryThingIntegration,
    }
}
