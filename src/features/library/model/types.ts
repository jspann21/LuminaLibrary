import type { ReactNode } from 'react'
import type {
  BookDetail,
  BookPatch,
  MetadataFieldSelection,
  MetadataLockUpdate,
  MetadataRescanPreview,
} from '../../../lib/types'

export type ActiveView = 'library' | 'tags' | 'settings'
export type ViewMode = 'grid' | 'list'
export type SortOption = 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'author-asc' | 'author-desc'
export type FilterType = 'all' | 'pdf' | 'epub' | 'librarything'

export type ScanProgressState = {
  active: boolean
  phase: 'idle' | 'started' | 'progress' | 'completed' | 'local_scan' | 'enrichment_queue'
  totalFound: number
  pendingFiles: number
  processedFiles: number
  newFiles: number
  updatedFiles: number
  unchangedFiles: number
  matchedFiles: number
  discoveredFiles: number
  removedFiles: number
  errors: number
  currentPath?: string
}

export type BulkMatchProgressState = {
  active: boolean
  phase: 'idle' | 'progress' | 'completed'
  totalFiles: number
  processedFiles: number
  matchedFiles: number
  unresolvedFiles: number
  skippedFiles: number
  currentPath?: string
}

export type CsvImportProgressState = {
  active: boolean
  phase: 'idle' | 'started' | 'progress' | 'completed' | 'error'
  path?: string
  totalBytes?: number
  bytesRead: number
  processedRows: number
  matchedRows: number
  updatedRows: number
  unresolvedRows: number
  errors: number
  progressPercent: number
  message?: string
}

export type LibraryThingImportProgressState = {
  active: boolean
  phase: 'idle' | 'parsing' | 'importing' | 'cover_lookup' | 'completed' | 'error'
  path?: string
  totalRows: number
  processedRows: number
  matchedRows: number
  createdRows: number
  skippedRows: number
  coverRows: number
  currentTitle?: string
  errors: number
  progressPercent: number
  message?: string
}

export type DetailFormState = {
  title: string
  subtitle: string
  authors: string
  publisher: string
  publishDate: string
  isbn10: string
  isbn13: string
  language: string
  pageCount: string
  series: string
  seriesIndex: string
  description: string
  coverUrl: string
}

export type RescanNotice = {
  tone: 'loading' | 'success' | 'warning' | 'error'
  message: string
}

export type CsvTransferNotice = {
  tone: 'loading' | 'success' | 'error'
  title: string
  message: string
}

export type CoverRefreshNotice = {
  tone: 'loading' | 'success' | 'warning' | 'error'
  title: string
  message: string
}

export type MaintenanceNotice = {
  tone: 'loading' | 'success' | 'warning' | 'error'
  title: string
  message: string
}

export type KeyTestNotice = {
  tone: 'loading' | 'success' | 'error'
  message: string
}

export type LibraryThingNotice = {
  tone: 'loading' | 'success' | 'error'
  message: string
}

export type MatchNotice = {
  tone: 'success' | 'warning' | 'error'
  message: string
}

type ConfirmTone = 'default' | 'warning' | 'danger'

export type ConfirmDialogState = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  tone?: ConfirmTone
  onCancel?: () => void
  onConfirm: () => void
}

export type MatchDraft = {
  title?: string
  author?: string
  isbn?: string
}

export type BookDetailsPanelProps = {
  book: BookDetail
  onClose: () => void
  onSave: (input: { bookId: string; patch: BookPatch; tags: string[] }) => Promise<void>
  onPreviewRescan: (input: { fileId?: string | null; bookId: string }) => Promise<MetadataRescanPreview>
  onApplyCuratedMetadata: (input: {
    bookId: string
    selection: MetadataFieldSelection[]
    lockUpdates: MetadataLockUpdate[]
  }) => Promise<void>
  onOpenFile: (absPath: string) => Promise<void>
  onOpenFolder: (absPath: string) => Promise<void>
  onOpenLibraryThingUrl: (url: string) => Promise<void>
  onRequestHide: (bookId: string) => void
  onRequestDelete: (bookId: string) => void
  isSaving: boolean
  isHiding: boolean
  isRescanPreviewing: boolean
  isApplyingCuratedMetadata: boolean
  isDeleting: boolean
}

export type SidebarItemProps = {
  icon: ReactNode
  label: string
  active?: boolean
  count?: number
  onClick: () => void
}

export type CoverThumbProps = {
  coverUrl?: string
  coverLocalPath?: string
  libraryThingBadge?: boolean
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'auto' | 'high' | 'low'
  title: string
  className?: string
}

export type ConfirmDialogProps = {
  dialog: ConfirmDialogState
  onCancel: () => void
  onConfirm: () => void
}
