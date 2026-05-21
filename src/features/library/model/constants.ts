import type { AccentColor } from '../../../context/ThemeContext'
import type { BulkMatchProgressState, CsvImportProgressState, ScanProgressState } from './types'

export const INITIAL_SCAN_PROGRESS: ScanProgressState = {
  active: false,
  phase: 'idle',
  totalFound: 0,
  pendingFiles: 0,
  processedFiles: 0,
  newFiles: 0,
  updatedFiles: 0,
  unchangedFiles: 0,
  matchedFiles: 0,
  discoveredFiles: 0,
  removedFiles: 0,
  errors: 0,
}

export const INITIAL_BULK_MATCH_PROGRESS: BulkMatchProgressState = {
  active: false,
  phase: 'idle',
  totalFiles: 0,
  processedFiles: 0,
  matchedFiles: 0,
  unresolvedFiles: 0,
  skippedFiles: 0,
}

export const INITIAL_CSV_IMPORT_PROGRESS: CsvImportProgressState = {
  active: false,
  phase: 'idle',
  bytesRead: 0,
  processedRows: 0,
  matchedRows: 0,
  updatedRows: 0,
  unresolvedRows: 0,
  errors: 0,
  progressPercent: 0,
}

export const ACCENT_COLORS: AccentColor[] = [
  'rose',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
]

export const ACCENT_SWATCH: Record<AccentColor, string> = {
  rose: '#f43f5e',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  pink: '#ec4899',
}

export const COVER_ZOOM_MIN = 0.7
export const COVER_ZOOM_MAX = 1.4
export const COVER_ZOOM_STEP = 0.1
export const COVER_GRID_MIN_WIDTH = 170
export const COVER_LIST_WIDTH = 48
export const COVER_LIST_HEIGHT = 64
