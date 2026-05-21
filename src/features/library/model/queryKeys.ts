import type { BookFilters, SortSpec } from '../../../lib/types'

export const libraryQueryKeys = {
  books: (query: string, filters: BookFilters, sort: SortSpec) => ['books', query, filters, sort] as const,
  booksTotal: () => ['books', 'total'] as const,
  hiddenBooks: (query = '', page = 1, pageSize = 50) => ['books', 'hidden', query, page, pageSize] as const,
  tags: () => ['tags'] as const,
  discovered: (query: string, page: number, pageSize: number) => ['discovered', query, page, pageSize] as const,
  folders: () => ['folders'] as const,
  appSettings: () => ['app-settings'] as const,
  bookDetail: (bookId?: string) => ['book-detail', bookId] as const,
}
