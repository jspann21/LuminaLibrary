export type LibraryFolder = {
  id: string
  path: string
  recursive: boolean
  enabled: boolean
  addedAt: string
  lastScanAt?: string | null
}

export type ScanSummary = {
  scannedFiles: number
  newFiles: number
  updatedFiles: number
  unchangedFiles: number
  matchedFiles: number
  discoveredFiles: number
  removedFiles: number
  errors: number
}

export type LibraryMaintenanceResult = {
  checkedFiles: number
  missingFilesFound: number
  removedFiles: number
  removedOrphanBooks: number
  mergedDuplicateBooks: number
}

export type FolderRemovalPreview = {
  folderId: string
  path: string
  fileCount: number
  bookCount: number
}

export type AppSettings = {
  googleBooksApiKeyConfigured: boolean
  googleBooksApiKeyManagedByApp: boolean
  googleBooksApiKeyFromEnvironment: boolean
  scanOnStartup: boolean
  libraryThingEnabled: boolean
  libraryThingCatalogLabel?: string | null
  libraryThingLastImportAt?: string | null
  libraryThingBookCount: number
}

export type ApiKeyTestResult = {
  ok: boolean
  message: string
}

export type SortSpec = {
  field: 'title' | 'publisher' | 'publishDate' | 'updatedAt' | 'createdAt' | 'author'
  direction: 'asc' | 'desc'
}

export type BookFilters = {
  formats: string[]
  tags: string[]
  authors: string[]
  publisher?: string
  yearFrom?: number
  yearTo?: number
  folderIds: string[]
  status?: string
}

export type Paged<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type BookCard = {
  id: string
  title: string
  authors: string[]
  tags: string[]
  publisher?: string
  publishDate?: string
  coverUrl?: string
  coverLocalPath?: string
  confidence?: number
  formats: string[]
  fileCount: number
  missingFiles: number
  libraryThingUrl?: string | null
}

type BookFile = {
  fileId: string
  absPath: string
  format: string
  status: string
  folderPath: string
  sizeBytes: number
}

export type BookDetail = {
  id: string
  title: string
  subtitle?: string
  authors: string[]
  tags: string[]
  publisher?: string
  publishDate?: string
  addedAt: string
  isbn10?: string
  isbn13?: string
  description?: string
  language?: string
  pageCount?: number
  series?: string
  seriesIndex?: number
  coverUrl?: string
  coverLocalPath?: string
  metadataSource: string
  confidence?: number
  files: BookFile[]
  libraryThingUrl?: string | null
}

export type LibraryThingImportResult = {
  importedRows: number
  matchedRows: number
  createdRows: number
  skippedRows: number
  path: string
  importedAt: string
}

export type DiscoveredFile = {
  fileId: string
  absPath: string
  fileName: string
  folderPath: string
  guessedTitle?: string
  guessedAuthor?: string
  guessedIsbn?: string
  status: string
  parserError?: string
  reason: string
  lastSeenAt: string
}

export type MatchResult = {
  fileId: string
  matched: boolean
  bookId?: string
  confidence?: number
  reason: string
}

export type BulkMatchInput = {
  fileId: string
  title?: string
  author?: string
  isbn?: string
}

export type BulkMatchResult = {
  results: MatchResult[]
  matchedCount: number
  failedCount: number
  skippedCount: number
  errorCount: number
}

export type BulkMatchProgressEvent = {
  phase?: 'progress' | 'completed'
  totalFiles?: number
  processedFiles?: number
  matchedFiles?: number
  unresolvedFiles?: number
  skippedFiles?: number
  errorFiles?: number
  currentPath?: string
  progressPercent?: number
}

export type BookPatch = Partial<{
  title: string
  subtitle: string
  authors: string[]
  publisher: string
  publishDate: string
  isbn10: string
  isbn13: string
  description: string
  language: string
  pageCount: number
  series: string
  seriesIndex: number
  coverUrl: string
}>

export type MetadataField =
  | 'title'
  | 'subtitle'
  | 'authors'
  | 'publisher'
  | 'publishDate'
  | 'isbn10'
  | 'isbn13'
  | 'description'
  | 'language'
  | 'pageCount'
  | 'series'
  | 'seriesIndex'
  | 'coverUrl'

export type MetadataCandidate = {
  id: string
  source: string
  title?: string
  subtitle?: string
  authors?: string[]
  publisher?: string
  publishDate?: string
  isbn10?: string
  isbn13?: string
  description?: string
  language?: string
  pageCount?: number
  series?: string
  seriesIndex?: number
  coverUrl?: string
  confidence?: number
}

type MetadataSourceStatus = {
  source: string
  status: 'ok' | 'limited' | 'no_match' | 'error'
  message?: string
  candidateCount: number
}

export type MetadataFieldSelection = {
  field: MetadataField
  candidateId?: string
  value?: string
  values?: string[]
  intValue?: number
}

export type MetadataLockUpdate = {
  field: MetadataField
  locked: boolean
}

export type MetadataRescanPreview = {
  bookId: string
  fileId: string
  candidates: MetadataCandidate[]
  sourceStatuses: MetadataSourceStatus[]
  lockedFields: MetadataField[]
  suggestedSelections: MetadataFieldSelection[]
}

export type MatchPreview = {
  fileId: string
  fileName: string
  candidates: MetadataCandidate[]
  sourceStatuses: MetadataSourceStatus[]
}

export type CoverCandidate = {
  url: string
  source: string
}

export type TagCount = {
  tag: string
  count: number
}

export type TagMergeResult = {
  targetTag: string
  mergedTagCount: number
  affectedBooks: number
}

export type TagDeleteResult = {
  deletedTagCount: number
  affectedBooks: number
}

export type ExportResult = {
  exportedRows: number
  path: string
}

export type ImportResult = {
  importedRows: number
  matchedRows: number
  updatedRows: number
  path: string
}

export type FileRecord = {
  id: string
  folderId: string
  absPath: string
  ext: string
  sizeBytes: number
  mtimeUtc: string
  hashSha256?: string
  status: string
  firstSeenAt: string
  lastSeenAt: string
  parserError?: string
  guessedTitle?: string
  guessedAuthor?: string
  guessedIsbn?: string
}

export type ScanProgressEvent = {
  folderId?: string
  phase?: 'started' | 'progress' | 'completed' | 'local_scan' | 'enrichment_queue'
  fileId?: string
  path?: string
  status?: string
  bookId?: string
  error?: string
  parseMs?: number
  hashMs?: number
  enrichMs?: number
  skipReason?: string
  totalFound?: number
  pendingFiles?: number
  processedFiles?: number
  newFiles?: number
  updatedFiles?: number
  unchangedFiles?: number
  matchedFiles?: number
  discoveredFiles?: number
  removedFiles?: number
  errors?: number
}

export type CsvImportProgressEvent = {
  phase?: 'started' | 'progress' | 'completed' | 'error'
  path?: string
  totalBytes?: number
  bytesRead?: number
  processedRows?: number
  matchedRows?: number
  updatedRows?: number
  unresolvedRows?: number
  errors?: number
  message?: string
  progressPercent?: number
}

export type GoogleBooksQuotaNoticeEvent = {
  message: string
  limitedUntilUtc?: string
}
