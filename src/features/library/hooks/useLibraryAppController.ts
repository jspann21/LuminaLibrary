import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from '../../../context/ThemeContext'
import { api } from '../../../lib/api'
import { sanitizeDisplayText } from '../../../lib/format'
import type { BookCard, BookPatch, MetadataFieldSelection, MetadataLockUpdate } from '../../../lib/types'
import { useLibraryUi } from '../../../store/useLibraryUi'
import {
  ACCENT_COLORS,
  ACCENT_SWATCH,
  INITIAL_BULK_MATCH_PROGRESS,
  COVER_ZOOM_MAX,
  COVER_ZOOM_MIN,
  COVER_ZOOM_STEP,
  INITIAL_CSV_IMPORT_PROGRESS,
  INITIAL_SCAN_PROGRESS,
} from '../model/constants'
import { libraryQueryKeys } from '../model/queryKeys'
import {
  filterTypeToFormats,
  formatsToFilterType,
  optionToSort,
  sortToOption,
} from '../model/selectors'
import type { BulkMatchProgressState, ConfirmDialogState, CsvImportProgressState, ScanProgressState } from '../model/types'

import { useEventListeners, progressPercentForPhase } from './useEventListeners'
import { useScanMutations } from './useScanMutations'
import { useSettingsMutations } from './useSettingsMutations'
import { useCsvTransferMutations } from './useCsvTransferMutations'
import { useBookMutations } from './useBookMutations'
import { useTagMutations } from './useTagMutations'
import { useDebounce } from './useDebounce'

const DYNAMIC_QUERY_GC_TIME_MS = 2 * 60 * 1000
const COVER_CACHE_STARTUP_BATCH_SIZE = 48
const EMPTY_BOOKS: BookCard[] = []

export function useLibraryAppController() {
  const queryClient = useQueryClient()
  const { theme, setTheme, accentColor, setAccentColor } = useTheme()

  // Shared state
  const [scanStatus, setScanStatus] = useState('Idle')
  const [scanProgress, setScanProgress] = useState<ScanProgressState>(INITIAL_SCAN_PROGRESS)
  const [bulkMatchProgress, setBulkMatchProgress] = useState<BulkMatchProgressState>(INITIAL_BULK_MATCH_PROGRESS)
  const [csvImportProgress, setCsvImportProgress] = useState<CsvImportProgressState>(INITIAL_CSV_IMPORT_PROGRESS)
  const [isAccentOpen, setIsAccentOpen] = useState(false)
  const [isSortOpen, setIsSortOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [coverScale, setCoverScale] = useState(1)
  const [selectedLibraryBookIds, setSelectedLibraryBookIds] = useState<string[]>([])
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const libraryScrollContainerRef = useRef<HTMLDivElement | null>(null)
  const lastCoverCacheBatchKeyRef = useRef('')

  const {
    activeView,
    viewMode,
    selectedTag,
    query,
    sort,
    filters,
    selectedBookId,
    discoveredQuery,
    discoveredPage,
    discoveredPageSize,
    setActiveView,
    setViewMode,
    setSelectedTag,
    setQuery,
    setSort,
    setSelectedBookId,
    setFormatFilter,
    setDiscoveredQuery,
    setDiscoveredPage,
  } = useLibraryUi()
  const deferredQuery = useDebounce(query, 300)
  const deferredDiscoveredQuery = useDebounce(discoveredQuery, 300)

  const invalidateLibraryData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    void queryClient.invalidateQueries({ queryKey: ['book-detail'] })
    void queryClient.invalidateQueries({ queryKey: ['tags'] })
    void queryClient.invalidateQueries({ queryKey: ['discovered'] })
    void queryClient.invalidateQueries({ queryKey: ['folders'] })
    void queryClient.invalidateQueries({ queryKey: ['app-settings'] })
  }, [queryClient])

  // Confirm dialog helpers
  const openConfirmDialog = (dialog: ConfirmDialogState) => setConfirmDialog(dialog)
  const closeConfirmDialog = () => setConfirmDialog(null)
  const cancelConfirmDialogAction = () => {
    if (!confirmDialog) return
    const action = confirmDialog.onCancel
    closeConfirmDialog()
    action?.()
  }
  const confirmDialogAction = () => {
    if (!confirmDialog) return
    const action = confirmDialog.onConfirm
    closeConfirmDialog()
    action()
  }

  // Queries
  const booksQuery = useQuery({
    queryKey: libraryQueryKeys.books(deferredQuery, filters, sort),
    queryFn: () => api.getLibraryBooks({ query: deferredQuery, filters, sort }),
    enabled: activeView === 'library',
    placeholderData: (previousData) => previousData,
    gcTime: DYNAMIC_QUERY_GC_TIME_MS,
  })
  const hiddenBooksQuery = useQuery({
    queryKey: libraryQueryKeys.hiddenBooks('', 1, 200),
    queryFn: () => api.getHiddenBooks({ page: 1, pageSize: 200 }),
    enabled: activeView === 'library',
    placeholderData: (previousData) => previousData,
  })
  const totalBooksQuery = useQuery({
    queryKey: libraryQueryKeys.booksTotal(),
    queryFn: () =>
      api.getLibraryBooks({
        page: 1,
        pageSize: 1,
        sort: { field: 'createdAt', direction: 'desc' },
        filters: { formats: [], tags: [], authors: [], folderIds: [] },
      }),
    enabled: activeView !== 'library',
  })
  const tagsQuery = useQuery({ queryKey: libraryQueryKeys.tags(), queryFn: () => api.getLibraryTags() })
  const discoveredQueryResult = useQuery({
    queryKey: libraryQueryKeys.discovered(deferredDiscoveredQuery, discoveredPage, discoveredPageSize),
    queryFn: () =>
      api.getDiscoveredFiles({
        query: deferredDiscoveredQuery,
        page: discoveredPage,
        pageSize: discoveredPageSize,
      }),
    placeholderData: (previousData) => previousData,
    gcTime: DYNAMIC_QUERY_GC_TIME_MS,
  })
  const foldersQuery = useQuery({ queryKey: libraryQueryKeys.folders(), queryFn: () => api.getLibraryFolders() })
  const appSettingsQuery = useQuery({ queryKey: libraryQueryKeys.appSettings(), queryFn: () => api.getAppSettings() })
  const bookDetailQuery = useQuery({
    queryKey: libraryQueryKeys.bookDetail(selectedBookId),
    queryFn: () => api.getBookDetail(selectedBookId!),
    enabled: Boolean(selectedBookId),
    gcTime: DYNAMIC_QUERY_GC_TIME_MS,
  })
  const discoveredMatchItems = useMemo(
    () =>
      (discoveredQueryResult.data?.items ?? []).map((item) => ({
        fileId: item.fileId,
        fileName: item.fileName,
      })),
    [discoveredQueryResult.data?.items],
  )

  // Sub-hooks
  const scanMutations = useScanMutations({ setScanProgress, setScanStatus, invalidateLibraryData })
  const { triggerStartupReconcile } = scanMutations
  const settingsMutations = useSettingsMutations({ setScanStatus, invalidateLibraryData, openConfirmDialog })
  const csvTransfer = useCsvTransferMutations({ setScanStatus, setCsvImportProgress, invalidateLibraryData })
  const bookMutations = useBookMutations({
    setScanStatus,
    setBulkMatchProgress,
    invalidateLibraryData,
    openConfirmDialog,
    onBooksHidden: (bookIds) => {
      const hiddenBookIdSet = new Set(bookIds)
      setSelectedLibraryBookIds((current) => current.filter((id) => !hiddenBookIdSet.has(id)))
      if (selectedBookId && hiddenBookIdSet.has(selectedBookId)) {
        setSelectedBookId(undefined)
      }
    },
    getDiscoveredItems: () => discoveredMatchItems,
  })
  const { matchNotice, setMatchNotice } = bookMutations
  const tagMutations = useTagMutations({
    tags: tagsQuery.data ?? [],
    selectedTag,
    setSelectedTag,
    setScanStatus,
    invalidateLibraryData,
    openConfirmDialog,
  })

  // Wire keyTestNotice from settings mutations into event listeners
  useEventListeners({
    scanProgress,
    setScanProgress,
    setBulkMatchProgress,
    csvImportProgress,
    setCsvImportProgress,
    scanStatus,
    setScanStatus,
    keyTestNotice: settingsMutations.keyTestNotice,
    setKeyTestNotice: settingsMutations.setKeyTestNotice,
    invalidateLibraryData,
  })

  // Startup reconcile effect
  useEffect(() => {
    return triggerStartupReconcile(
      appSettingsQuery.data?.scanOnStartup,
      appSettingsQuery.isLoading,
    )
  }, [
    appSettingsQuery.data?.scanOnStartup,
    appSettingsQuery.isLoading,
    triggerStartupReconcile,
  ])

  // Auto-dismiss match notice
  useEffect(() => {
    if (!matchNotice) return
    const timer = window.setTimeout(() => setMatchNotice(null), 7000)
    return () => window.clearTimeout(timer)
  }, [matchNotice, setMatchNotice])

  // Book selection
  const toggleLibraryBookSelection = useCallback((bookId: string) => {
    setSelectedLibraryBookIds((current) =>
      current.includes(bookId) ? current.filter((id) => id !== bookId) : [...current, bookId],
    )
  }, [])
  const selectLibraryBook = useCallback((bookId: string) => {
    setSelectedBookId(bookId)
  }, [setSelectedBookId])
  const selectAllLibraryBooks = () => {
    setSelectedLibraryBookIds(books.map((book) => book.id))
  }
  const clearLibraryBookSelection = () => {
    setSelectedLibraryBookIds([])
  }
  const hideSelectedBooks = () => {
    if (selectedLibraryBookIdSet.size === 0) return
    const targetBookIds = [...selectedLibraryBookIdSet]
    openConfirmDialog({
      title: 'Hide selected books from library?',
      message: `Hide ${targetBookIds.length} selected book(s)? Files remain indexed and can be restored from Hidden Books.`,
      confirmLabel: 'Hide Books',
      tone: 'warning',
      onConfirm: () => bookMutations.hideBooksMutation.mutate(targetBookIds),
    })
  }
  const restoreHiddenBook = (bookId: string) => {
    bookMutations.restoreBooksMutation.mutate([bookId])
  }
  const restoreAllHiddenBooks = () => {
    const hiddenBooks = hiddenBooksQuery.data?.items ?? []
    if (hiddenBooks.length === 0) return
    const targetBookIds = hiddenBooks.map((book) => book.id)
    openConfirmDialog({
      title: 'Restore all hidden books?',
      message: `Restore ${targetBookIds.length} hidden book(s) back into the main library view?`,
      confirmLabel: 'Restore All',
      tone: 'warning',
      onConfirm: () => bookMutations.restoreBooksMutation.mutate(targetBookIds),
    })
  }

  // Zoom
  const zoomCoversOut = () => {
    setCoverScale((value) => Math.max(COVER_ZOOM_MIN, Number((value - COVER_ZOOM_STEP).toFixed(2))))
  }
  const zoomCoversIn = () => {
    setCoverScale((value) => Math.min(COVER_ZOOM_MAX, Number((value + COVER_ZOOM_STEP).toFixed(2))))
  }

  // Derived values
  const sortOption = useMemo(() => sortToOption(sort), [sort])
  const filterType = useMemo(() => formatsToFilterType(filters.formats), [filters.formats])
  const discoveredPages = Math.max(1, Math.ceil((discoveredQueryResult.data?.total ?? 0) / discoveredPageSize))
  const totalBooks =
    activeView === 'library'
      ? booksQuery.data?.total ?? totalBooksQuery.data?.total ?? 0
      : totalBooksQuery.data?.total ?? booksQuery.data?.total ?? 0
  const progressPercent = progressPercentForPhase(scanProgress)
  const bulkMatchProgressPercent =
    bulkMatchProgress.phase === 'completed'
      ? 100
      : bulkMatchProgress.totalFiles <= 0
        ? 0
        : Math.min(99, Math.round((bulkMatchProgress.processedFiles / bulkMatchProgress.totalFiles) * 100))
  const canZoomOut = coverScale > COVER_ZOOM_MIN
  const canZoomIn = coverScale < COVER_ZOOM_MAX
  const zoomPercent = Math.round(coverScale * 100)
  const isCsvImportProgressVisible = csvImportProgress.active
  const isCsvImportRunning = csvImportProgress.active && csvImportProgress.phase !== 'completed' && csvImportProgress.phase !== 'error'
  const isCsvImportActive = isCsvImportRunning || csvTransfer.importMutation.isPending
  const isScanProgressRunning = scanProgress.active && scanProgress.phase !== 'completed'
  const isScanTaskActive =
    isScanProgressRunning ||
    scanMutations.scanMutation.isPending ||
    scanMutations.rescanMissingMetadataMutation.isPending ||
    scanMutations.refreshMissingCoversMutation.isPending ||
    settingsMutations.addFolderMutation.isPending
  const isScanProgressPopupVisible =
    scanProgress.active ||
    scanMutations.scanMutation.isPending ||
    scanMutations.rescanMissingMetadataMutation.isPending ||
    scanMutations.refreshMissingCoversMutation.isPending ||
    settingsMutations.addFolderMutation.isPending
  const isBulkMatchProgressVisible = bulkMatchProgress.active
  const isBulkMatchRunning = bulkMatchProgress.active && bulkMatchProgress.phase !== 'completed'
  const isBulkMatchActive = isBulkMatchRunning || bookMutations.isMatchAllPending
  const isScanning = isScanTaskActive || isCsvImportActive || isBulkMatchActive
  const showScanProgressPopup = isScanProgressPopupVisible && !scanMutations.refreshMissingCoversMutation.isPending
  const showBulkMatchProgressPopup = isBulkMatchProgressVisible || bookMutations.isMatchAllPending
  const showCsvImportProgressPopup = isCsvImportProgressVisible || csvTransfer.importMutation.isPending

  const books = booksQuery.data?.items ?? EMPTY_BOOKS
  const hiddenBooks = hiddenBooksQuery.data?.items ?? EMPTY_BOOKS

  useEffect(() => {
    if (activeView !== 'library' || booksQuery.isLoading) return
    const bookIds = books
      .filter((book) => book.coverUrl && !book.coverLocalPath)
      .slice(0, COVER_CACHE_STARTUP_BATCH_SIZE)
      .map((book) => book.id)
    if (bookIds.length === 0) return

    const batchKey = bookIds.join('|')
    if (lastCoverCacheBatchKeyRef.current === batchKey) return
    lastCoverCacheBatchKeyRef.current = batchKey

    let cancelled = false
    void api.cacheBookCovers(bookIds).then((updated) => {
      if (!cancelled && updated > 0) {
        void queryClient.invalidateQueries({ queryKey: ['books'] })
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeView, books, booksQuery.isLoading, queryClient])

  const visibleBookIds = new Set<string>()
  for (const book of books) {
    visibleBookIds.add(book.id)
  }
  const selectedLibraryBookIdSet = new Set<string>()
  for (const bookId of selectedLibraryBookIds) {
    if (visibleBookIds.has(bookId)) {
      selectedLibraryBookIdSet.add(bookId)
    }
  }

  // Sync delete mutation with selected book
  useEffect(() => {
    if (!bookMutations.deleteBookMutation.isSuccess) return
    setSelectedBookId(undefined)
  }, [bookMutations.deleteBookMutation.isSuccess, setSelectedBookId])

  const hasLibraryBooks = books.length > 0

  return {
    layout: {
      activeView,
      scrollContainerRef: libraryScrollContainerRef,
    },
    sidebar: {
      activeView,
      selectedTag,
      tags: tagsQuery.data ?? [],
      totalBooks,
      isScanning,
      onSetActiveView: setActiveView,
      onSetSelectedTag: setSelectedTag,
    },
    header: {
      query,
      filterType,
      sortOption,
      viewMode,
      isFilterOpen,
      isSortOpen,
      isScanning,
      onSetQuery: setQuery,
      onToggleFilterOpen: () => setIsFilterOpen((open) => !open),
      onToggleSortOpen: () => setIsSortOpen((open) => !open),
      onCloseFilterOpen: () => setIsFilterOpen(false),
      onCloseSortOpen: () => setIsSortOpen(false),
      onSetFilterType: (value: 'all' | 'pdf' | 'epub') => setFormatFilter(filterTypeToFormats(value)),
      onSetSortOption: (value: typeof sortOption) => setSort(optionToSort(value)),
      onSetViewMode: setViewMode,
      onQuickAddBooks: () => {
        void settingsMutations.quickAddBooks()
      },
    },
    libraryView: {
      books,
      hiddenBooks,
      isLoading: booksQuery.isLoading,
      isHiddenLoading: hiddenBooksQuery.isLoading,
      isFetching: booksQuery.isFetching,
      viewMode,
      coverScale,
      scrollContainerRef: libraryScrollContainerRef,
      selectedBookIds: selectedLibraryBookIdSet,
      isHidePending: bookMutations.hideBooksMutation.isPending,
      isRestorePending: bookMutations.restoreBooksMutation.isPending,
      onToggleBookSelection: toggleLibraryBookSelection,
      onSelectAllBooks: selectAllLibraryBooks,
      onClearSelection: clearLibraryBookSelection,
      onHideSelectedBooks: hideSelectedBooks,
      onRestoreBook: restoreHiddenBook,
      onRestoreAllHiddenBooks: restoreAllHiddenBooks,
      onSelectBook: selectLibraryBook,
      onQuickAddBooks: () => {
        void settingsMutations.quickAddBooks()
      },
    },
    tagView: {
      tags: tagsQuery.data ?? [],
      tagManagerQuery: tagMutations.tagManagerQuery,
      tagMergeTarget: tagMutations.tagMergeTarget,
      tagManagerFiltered: tagMutations.tagManagerFiltered,
      selectedCount: tagMutations.effectiveTagManagerSelection.length,
      tagManagerSelectionSet: tagMutations.tagManagerSelectionSet,
      isMerging: tagMutations.mergeTagsMutation.isPending,
      isDeleting: tagMutations.deleteTagsMutation.isPending,
      onSetTagManagerQuery: tagMutations.setTagManagerQuery,
      onSetTagMergeTarget: tagMutations.setTagMergeTarget,
      onMergeSelectedTags: tagMutations.mergeSelectedTags,
      onDeleteSelectedTags: tagMutations.deleteSelectedTags,
      onClearSelection: () => tagMutations.setTagManagerSelection([]),
      onToggleTagSelection: tagMutations.toggleTagManagerSelection,
    },
    settingsView: {
      theme,
      accentColor,
      accentColors: ACCENT_COLORS,
      accentSwatch: ACCENT_SWATCH,
      isAccentOpen,
      onSetTheme: setTheme,
      onToggleAccentOpen: () => setIsAccentOpen((open) => !open),
      onSetAccentColor: (value: typeof accentColor) => {
        setAccentColor(value)
        setIsAccentOpen(false)
      },
      onCloseAccentOpen: () => setIsAccentOpen(false),
      googleBooksApiKeyInput: settingsMutations.googleBooksApiKeyInput,
      onSetGoogleBooksApiKeyInput: settingsMutations.setGoogleBooksApiKeyInput,
      onSaveGoogleBooksApiKey: settingsMutations.saveGoogleBooksApiKey,
      onTestGoogleBooksApiKey: settingsMutations.testGoogleBooksApiKey,
      onClearGoogleBooksApiKey: settingsMutations.clearGoogleBooksApiKey,
      appSettings: appSettingsQuery.data,
      onSetScanOnStartup: (enabled: boolean) => settingsMutations.setScanOnStartupMutation.mutate(enabled),
      isSetScanOnStartupPending: settingsMutations.setScanOnStartupMutation.isPending,
      keyTestNotice: settingsMutations.keyTestNotice,
      isSetGoogleBooksApiKeyPending: settingsMutations.setGoogleBooksApiKeyMutation.isPending,
      isClearGoogleBooksApiKeyPending: settingsMutations.clearGoogleBooksApiKeyMutation.isPending,
      isTestGoogleBooksApiKeyPending: settingsMutations.testGoogleBooksApiKeyMutation.isPending,
      folderPath: settingsMutations.folderPath,
      onSetFolderPath: settingsMutations.setFolderPath,
      onBrowseForFolder: () => {
        void settingsMutations.browseForFolder()
      },
      onQuickAddBooks: () => {
        void settingsMutations.quickAddBooks()
      },
      onAddFolder: () => settingsMutations.addFolderMutation.mutate(settingsMutations.folderPath),
      folders: foldersQuery.data ?? [],
      onScanFolder: (folderId: string) => scanMutations.scanMutation.mutate(folderId),
      onRemoveFolder: (folderId: string) => {
        void settingsMutations.requestRemoveFolder(folderId)
      },
      isScanningFolder: scanMutations.scanMutation.isPending,
      isAddingFolder: settingsMutations.addFolderMutation.isPending,
      isRemovingFolder: settingsMutations.removeFolderMutation.isPending,
      onRescanMissingMetadata: () => scanMutations.rescanMissingMetadataMutation.mutate(),
      isRescanMissingMetadataPending: scanMutations.rescanMissingMetadataMutation.isPending,
      onRefreshMissingCovers: () => scanMutations.refreshMissingCoversMutation.mutate(),
      isRefreshMissingCoversPending: scanMutations.refreshMissingCoversMutation.isPending,
      onReconcileLocalFiles: () => scanMutations.reconcileLocalFilesMutation.mutate(),
      isReconcileLocalFilesPending: scanMutations.reconcileLocalFilesMutation.isPending,
      maintenanceNotice: scanMutations.maintenanceNotice,
      onExportUnresolvedCsv: csvTransfer.exportUnresolvedCsv,
      onImportEnrichmentCsv: csvTransfer.importEnrichmentCsv,
      isExportPending: csvTransfer.exportMutation.isPending,
      isImportPending: csvTransfer.importMutation.isPending,
      csvTransferNotice: csvTransfer.csvTransferNotice,
      csvImportProgress,
      discoveredQuery,
      onSetDiscoveredQuery: setDiscoveredQuery,
      matchNotice,
      discoveredItems: discoveredQueryResult.data?.items ?? [],
      matchDrafts: bookMutations.matchDrafts,
      onSetMatchDraft: bookMutations.setMatchDraft,
      onPreviewMatch: (input: { fileId: string; title?: string; author?: string; isbn?: string }) =>
        bookMutations.previewMatchMutation.mutateAsync({
          fileId: input.fileId,
          title: sanitizeDisplayText(input.title) || undefined,
          author: sanitizeDisplayText(input.author) || undefined,
          isbn: sanitizeDisplayText(input.isbn) || undefined,
        }),
      onConfirmMatch: (input: { fileId: string; title?: string; author?: string; isbn?: string }) =>
        bookMutations.attemptMatchMutation.mutateAsync({
          fileId: input.fileId,
          title: sanitizeDisplayText(input.title) || undefined,
          author: sanitizeDisplayText(input.author) || undefined,
          isbn: sanitizeDisplayText(input.isbn) || undefined,
        }),
      onCreateManualBook: (input: { fileId: string; patch: BookPatch; tags: string[] }) =>
        bookMutations.createManualBookMutation.mutateAsync(input),
      onAttemptMatchAll: () => void bookMutations.attemptMatchAll(),
      isPreviewMatchPending: bookMutations.previewMatchMutation.isPending,
      isAttemptMatchPending:
        bookMutations.attemptMatchMutation.isPending ||
        bookMutations.createManualBookMutation.isPending ||
        bookMutations.isMatchAllPending,
      isAttemptMatchAllPending: bookMutations.isMatchAllPending,
      matchingFileId: bookMutations.matchingFileId,
      discoveredPage,
      discoveredPages,
      onPreviousDiscoveredPage: () => setDiscoveredPage(Math.max(1, discoveredPage - 1)),
      onNextDiscoveredPage: () => setDiscoveredPage(Math.min(discoveredPages, discoveredPage + 1)),
    },
    detailsPanel: {
      isOpen: Boolean(selectedBookId && bookDetailQuery.data),
      book: bookDetailQuery.data ?? null,
      onClose: () => setSelectedBookId(undefined),
      onSave: async (payload: { bookId: string; patch: BookPatch; tags: string[] }) => {
        const detail = await bookMutations.saveDetailMutation.mutateAsync(payload)
        if (detail.id !== payload.bookId) {
          setSelectedBookId(detail.id)
        }
      },
      onPreviewRescan: async (input: { fileId: string; bookId: string }) =>
        bookMutations.previewRescanMetadataMutation.mutateAsync(input),
      onApplyCuratedMetadata: async (input: {
        bookId: string
        selection: MetadataFieldSelection[]
        lockUpdates: MetadataLockUpdate[]
      }) => {
        const detail = await bookMutations.applyCuratedMetadataMutation.mutateAsync(input)
        if (detail.id !== input.bookId) {
          setSelectedBookId(detail.id)
        }
      },
      onOpenFile: (absPath: string) => api.openLocalFile(absPath),
      onOpenFolder: (absPath: string) => api.openLocalFileFolder(absPath),
      onRequestHide: (bookId: string) => bookMutations.requestHideBook(bookId),
      onRequestDelete: (bookId: string) =>
        openConfirmDialog({
          title: 'Remove book from library?',
          message: 'This removes the book from your library index, but does not delete files on disk.',
          confirmLabel: 'Remove Book',
          tone: 'danger',
          onConfirm: () => void bookMutations.deleteBookMutation.mutateAsync(bookId),
        }),
      isSaving: bookMutations.saveDetailMutation.isPending,
      isHiding: bookMutations.hideBooksMutation.isPending,
      isRescanPreviewing: bookMutations.previewRescanMetadataMutation.isPending,
      isApplyingCuratedMetadata: bookMutations.applyCuratedMetadataMutation.isPending,
      isDeleting: bookMutations.deleteBookMutation.isPending,
    },
    overlays: {
      hasLibraryBooks,
      showCoverZoomControls: activeView === 'library' && hasLibraryBooks,
      canZoomOut,
      canZoomIn,
      zoomPercent,
      onZoomCoversOut: zoomCoversOut,
      onZoomCoversIn: zoomCoversIn,
      showScanProgressPopup,
      showBulkMatchProgressPopup,
      showCsvImportProgressPopup,
      scanStatus,
      progressPercent,
      scanProgress,
      bulkMatchProgress,
      bulkMatchProgressPercent,
      csvImportProgress,
      onDismissScanProgress: () => setScanProgress((prev) => ({ ...prev, active: false })),
      onDismissBulkMatchProgress: () => setBulkMatchProgress((prev) => ({ ...prev, active: false })),
      onDismissCsvImportProgress: () => setCsvImportProgress((prev) => ({ ...prev, active: false })),
      coverRefreshNotice: scanMutations.coverRefreshNotice,
      onDismissCoverRefreshNotice: () => scanMutations.setCoverRefreshNotice(null),
    },
    confirmDialog: {
      dialog: confirmDialog,
      onCancel: cancelConfirmDialogAction,
      onConfirm: confirmDialogAction,
    },
    actions: {
      setSelectedBookId,
    },
  }
}
