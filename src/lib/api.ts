import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import type {
  ApiKeyTestResult,
  AppSettings,
  BookCard,
  BookDetail,
  BookFilters,
  BookPatch,
  BulkMatchInput,
  BulkMatchProgressEvent,
  BulkMatchResult,
  CoverCandidate,
  CsvImportProgressEvent,
  DiscoveredFile,
  ExportResult,
  FileRecord,
  FolderRemovalPreview,
  GoogleBooksQuotaNoticeEvent,
  ImportResult,
  LibraryMaintenanceResult,
  LibraryFolder,
  LibraryThingImportProgressEvent,
  LibraryThingImportResult,
  MatchPreview,
  MatchResult,
  MetadataFieldSelection,
  MetadataLockUpdate,
  MetadataRescanPreview,
  Paged,
  ScanProgressEvent,
  ScanSummary,
  SortSpec,
  TagDeleteResult,
  TagCount,
  TagMergeResult,
} from './types'

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function invokeOrThrow<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error('Tauri runtime not detected. Run with `pnpm tauri:dev`.')
  }
  return invoke<T>(command, args)
}

export const api = {
  addLibraryFolder: (path: string, recursive = true) =>
    invokeOrThrow<LibraryFolder>('add_library_folder', { path, recursive }),
  removeLibraryFolder: (folderId: string) =>
    invokeOrThrow<void>('remove_library_folder', { folderId }),
  getFolderRemovalPreview: (folderId: string) =>
    invokeOrThrow<FolderRemovalPreview>('get_folder_removal_preview', { folderId }),
  getLibraryFolders: () => invokeOrThrow<LibraryFolder[]>('get_library_folders'),
  getAppSettings: () => invokeOrThrow<AppSettings>('get_app_settings'),
  setScanOnStartup: (enabled: boolean) =>
    invokeOrThrow<AppSettings>('set_scan_on_startup', { enabled }),
  setLibraryThingEnabled: (enabled: boolean) =>
    invokeOrThrow<AppSettings>('set_library_thing_enabled', { enabled }),
  setLibraryThingCatalogLabel: (label?: string) =>
    invokeOrThrow<AppSettings>('set_library_thing_catalog_label', { label }),
  clearLibraryThingIntegration: () =>
    invokeOrThrow<AppSettings>('clear_library_thing_integration'),
  setGoogleBooksApiKey: (apiKey: string) =>
    invokeOrThrow<AppSettings>('set_google_books_api_key', { apiKey }),
  clearGoogleBooksApiKey: () => invokeOrThrow<AppSettings>('clear_google_books_api_key'),
  testGoogleBooksApiKey: (apiKey?: string) =>
    invokeOrThrow<ApiKeyTestResult>('test_google_books_api_key', { apiKey }),
  setBraveSearchApiKey: (apiKey: string) =>
    invokeOrThrow<AppSettings>('set_brave_search_api_key', { apiKey }),
  clearBraveSearchApiKey: () => invokeOrThrow<AppSettings>('clear_brave_search_api_key'),
  testBraveSearchApiKey: (apiKey?: string) =>
    invokeOrThrow<ApiKeyTestResult>('test_brave_search_api_key', { apiKey }),
  startScan: (folderId?: string) => invokeOrThrow<ScanSummary>('start_scan', { folderId }),
  rescanMissingMetadata: () => invokeOrThrow<ScanSummary>('rescan_missing_metadata'),
  refreshMissingCovers: () => invokeOrThrow<ScanSummary>('refresh_missing_covers'),
  cacheBookCovers: (bookIds: string[]) =>
    invokeOrThrow<number>('cache_book_covers', { bookIds }),
  getLibraryBooks: (args: {
    query?: string
    filters?: BookFilters
    sort?: SortSpec
    page?: number
    pageSize?: number
  }) =>
    invokeOrThrow<Paged<BookCard>>('get_library_books', {
      query: args.query,
      filters: args.filters,
      sort: args.sort,
      page: args.page,
      pageSize: args.pageSize,
    }),
  getHiddenBooks: (args: { query?: string; page?: number; pageSize?: number }) =>
    invokeOrThrow<Paged<BookCard>>('get_hidden_books', {
      query: args.query,
      page: args.page,
      pageSize: args.pageSize,
    }),
  getBookDetail: (bookId: string) => invokeOrThrow<BookDetail>('get_book_detail', { bookId }),
  getLibraryTags: () => invokeOrThrow<TagCount[]>('get_library_tags'),
  getDiscoveredFiles: (args: { query?: string; page?: number; pageSize?: number }) =>
    invokeOrThrow<Paged<DiscoveredFile>>('get_discovered_files', {
      query: args.query,
      page: args.page,
      pageSize: args.pageSize,
    }),
  attemptMatch: (args: { fileId: string; isbn?: string; title?: string; author?: string }) =>
    invokeOrThrow<MatchResult>('attempt_match', args),
  batchAttemptMatch: (items: BulkMatchInput[]) =>
    invokeOrThrow<BulkMatchResult>('batch_attempt_match', { items }),
  previewMatch: (args: { fileId: string; isbn?: string; title?: string; author?: string }) =>
    invokeOrThrow<MatchPreview>('preview_match', args),
  applyManualBookEdit: (bookId: string, patch: BookPatch) =>
    invokeOrThrow<BookDetail>('apply_manual_book_edit', { bookId, patch }),
  createManualBook: (fileId: string, patch: BookPatch, tags: string[]) =>
    invokeOrThrow<BookDetail>('create_manual_book', { fileId, patch, tags }),
  setBookTags: (bookId: string, tags: string[]) =>
    invokeOrThrow<BookDetail>('set_book_tags', { bookId, tags }),
  hideBooks: (bookIds: string[]) => invokeOrThrow<number>('hide_books', { bookIds }),
  restoreBooks: (bookIds: string[]) => invokeOrThrow<number>('restore_books', { bookIds }),
  restoreAllHiddenBooks: () => invokeOrThrow<number>('restore_all_hidden_books'),
  mergeTags: (sourceTags: string[], targetTag: string) =>
    invokeOrThrow<TagMergeResult>('merge_tags', { sourceTags, targetTag }),
  deleteTags: (tags: string[]) => invokeOrThrow<TagDeleteResult>('delete_tags', { tags }),
  deleteBook: (bookId: string) => invokeOrThrow<void>('delete_book', { bookId }),
  markFileMissing: (fileId: string, missing: boolean) =>
    invokeOrThrow<void>('mark_file_missing', { fileId, missing }),
  reconcileLocalFiles: () => invokeOrThrow<LibraryMaintenanceResult>('reconcile_local_files'),
  exportUnresolvedCsv: (path: string) =>
    invokeOrThrow<ExportResult>('export_unresolved_csv', { path }),
  importEnrichmentCsv: (path: string) =>
    invokeOrThrow<ImportResult>('import_enrichment_csv', { path }),
  importLibraryThingExport: (path: string) =>
    invokeOrThrow<LibraryThingImportResult>('import_library_thing_export', { path }),
  rescanFile: (fileId: string) => invokeOrThrow<FileRecord>('rescan_file', { fileId }),
  previewRescanMetadata: (bookId: string, fileId?: string | null) =>
    invokeOrThrow<MetadataRescanPreview>('preview_rescan_metadata', { bookId, fileId }),
  applyCuratedMetadata: (bookId: string, selection: MetadataFieldSelection[], lockUpdates: MetadataLockUpdate[]) =>
    invokeOrThrow<BookDetail>('apply_curated_metadata', { bookId, selection, lockUpdates }),
  openLocalFile: (absPath: string) => invokeOrThrow<void>('open_local_file', { absPath }),
  openLocalFileFolder: (absPath: string) => invokeOrThrow<void>('open_local_file_folder', { absPath }),
  openLibraryThingUrl: (url: string) => invokeOrThrow<void>('open_library_thing_url', { url }),
  searchBraveCoverImages: (query: string) =>
    invokeOrThrow<CoverCandidate[]>('search_brave_cover_images', { query }),
  browseForFolder: async () => {
    if (!isTauri()) {
      throw new Error('Tauri runtime not detected. Run with `pnpm tauri:dev`.')
    }
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Lumina Library Folder',
    })
    if (Array.isArray(selected)) return selected[0] ?? null
    return selected
  },
  browseForCsvSave: async (defaultPath = 'lumina_library_unresolved.csv') => {
    if (!isTauri()) {
      throw new Error('Tauri runtime not detected. Run with `pnpm tauri:dev`.')
    }
    return save({
      title: 'Export Lumina Unresolved CSV',
      defaultPath,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
  },
  browseForCsvImport: async () => {
    if (!isTauri()) {
      throw new Error('Tauri runtime not detected. Run with `pnpm tauri:dev`.')
    }
    const selected = await open({
      directory: false,
      multiple: false,
      title: 'Import Lumina Enrichment CSV',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (Array.isArray(selected)) return selected[0] ?? null
    return selected
  },
  browseForLibraryThingImport: async () => {
    if (!isTauri()) {
      throw new Error('Tauri runtime not detected. Run with `pnpm tauri:dev`.')
    }
    const selected = await open({
      directory: false,
      multiple: false,
      title: 'Import LibraryThing Export',
      filters: [{ name: 'LibraryThing Export', extensions: ['json', 'tsv', 'txt'] }],
    })
    if (Array.isArray(selected)) return selected[0] ?? null
    return selected
  },
  searchCoverCandidates: (bookId: string) =>
    invokeOrThrow<CoverCandidate[]>('search_cover_candidates', { bookId }),
  browseForImage: async () => {
    if (!isTauri()) {
      throw new Error('Tauri runtime not detected. Run with `pnpm tauri:dev`.')
    }
    const selected = await open({
      directory: false,
      multiple: false,
      title: 'Select Cover Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    })
    if (Array.isArray(selected)) return selected[0] ?? null
    return selected
  },
}

export async function onScanProgress(
  cb: (event: ScanProgressEvent) => void,
): Promise<UnlistenFn | undefined> {
  if (!isTauri()) return undefined
  return listen<ScanProgressEvent>('scan_progress', (event) => cb(event.payload))
}

export async function onScanCompleted(
  cb: (event: ScanSummary) => void,
): Promise<UnlistenFn | undefined> {
  if (!isTauri()) return undefined
  return listen<ScanSummary>('scan_completed', (event) => cb(event.payload))
}

export async function onCsvImportProgress(
  cb: (event: CsvImportProgressEvent) => void,
): Promise<UnlistenFn | undefined> {
  if (!isTauri()) return undefined
  return listen<CsvImportProgressEvent>('csv_import_progress', (event) => cb(event.payload))
}

export async function onLibraryThingImportProgress(
  cb: (event: LibraryThingImportProgressEvent) => void,
): Promise<UnlistenFn | undefined> {
  if (!isTauri()) return undefined
  return listen<LibraryThingImportProgressEvent>('library_thing_import_progress', (event) => cb(event.payload))
}

export async function onBulkMatchProgress(
  cb: (event: BulkMatchProgressEvent) => void,
): Promise<UnlistenFn | undefined> {
  if (!isTauri()) return undefined
  return listen<BulkMatchProgressEvent>('bulk_match_progress', (event) => cb(event.payload))
}

export async function onGoogleBooksQuotaNotice(
  cb: (event: GoogleBooksQuotaNoticeEvent) => void,
): Promise<UnlistenFn | undefined> {
  if (!isTauri()) return undefined
  return listen<GoogleBooksQuotaNoticeEvent>('google_books_quota_notice', (event) => cb(event.payload))
}
