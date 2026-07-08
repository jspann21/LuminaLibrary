import type { BookDetail, SortSpec } from '../../../lib/types'
import type { DetailFormState, FilterType, SortOption } from './types'

export function sortToOption(sort: SortSpec): SortOption {
  if (sort.field === 'createdAt' && sort.direction === 'desc') return 'date-desc'
  if (sort.field === 'createdAt' && sort.direction === 'asc') return 'date-asc'
  if (sort.field === 'title' && sort.direction === 'asc') return 'title-asc'
  if (sort.field === 'title' && sort.direction === 'desc') return 'title-desc'
  if (sort.field === 'author' && sort.direction === 'asc') return 'author-asc'
  if (sort.field === 'author' && sort.direction === 'desc') return 'author-desc'
  return 'date-desc'
}

export function optionToSort(option: SortOption): SortSpec {
  switch (option) {
    case 'date-desc':
      return { field: 'createdAt', direction: 'desc' }
    case 'date-asc':
      return { field: 'createdAt', direction: 'asc' }
    case 'title-asc':
      return { field: 'title', direction: 'asc' }
    case 'title-desc':
      return { field: 'title', direction: 'desc' }
    case 'author-asc':
      return { field: 'author', direction: 'asc' }
    case 'author-desc':
      return { field: 'author', direction: 'desc' }
    default:
      return { field: 'createdAt', direction: 'desc' }
  }
}

export function formatsToFilterType(formats: string[]): FilterType {
  const normalized = formats.map((item) => item.toLowerCase())
  if (normalized.length === 1 && normalized[0] === 'pdf') return 'pdf'
  if (normalized.length === 1 && normalized[0] === 'epub') return 'epub'
  if (normalized.length === 1 && normalized[0] === 'librarything') return 'librarything'
  return 'all'
}

export function filterTypeToFormats(value: FilterType): string[] {
  if (value === 'all') return []
  return [value]
}

export function buildDetailForm(book: BookDetail): DetailFormState {
  return {
    title: book.title ?? '',
    subtitle: book.subtitle ?? '',
    authors: book.authors.join(', '),
    publisher: book.publisher ?? '',
    publishDate: book.publishDate ?? '',
    isbn10: book.isbn10 ?? '',
    isbn13: book.isbn13 ?? '',
    language: book.language ?? '',
    pageCount: book.pageCount?.toString() ?? '',
    series: book.series ?? '',
    seriesIndex: book.seriesIndex?.toString() ?? '',
    description: book.description ?? '',
    coverUrl: book.coverUrl ?? '',
  }
}

export function describeMatchReason(reason: string) {
  switch (reason) {
    case 'matched_by_hash':
      return 'Matched by duplicate file content'
    case 'matched_by_isbn':
      return 'Matched by ISBN'
    case 'matched_by_title_author':
      return 'Matched by title and author'
    case 'matched_by_exact_title':
      return 'Matched by exact title'
    case 'matched_by_api':
      return 'Matched by metadata lookup'
    case 'low_confidence':
      return 'Possible match found, but confidence was too low'
    case 'missing_lookup_keys':
      return 'Not enough title, author, or ISBN information'
    case 'no_api_match':
      return 'No match found'
    case 'api_error':
      return 'Lookup service error'
    default:
      return reason.replaceAll('_', ' ')
  }
}
