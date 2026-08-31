import { create } from 'zustand'
import type { BookFilters, DiscoveredFileFilters, DiscoveredFileSort, SortSpec } from '../lib/types'

type ActiveView = 'library' | 'unresolved' | 'tags' | 'settings'
type ViewMode = 'grid' | 'list'

type LibraryUiState = {
  activeView: ActiveView
  viewMode: ViewMode
  selectedTag?: string
  query: string
  page: number
  pageSize: number
  sort: SortSpec
  filters: BookFilters
  selectedBookId?: string
  discoveredQuery: string
  discoveredFilters: DiscoveredFileFilters
  discoveredSort: DiscoveredFileSort
  discoveredPage: number
  discoveredPageSize: number
  setActiveView: (value: ActiveView) => void
  setViewMode: (value: ViewMode) => void
  setSelectedTag: (value?: string) => void
  setQuery: (value: string) => void
  setSort: (value: SortSpec) => void
  setPage: (value: number) => void
  setSelectedBookId: (value?: string) => void
  setPublisherFilter: (value: string) => void
  setStatusFilter: (value: string) => void
  setFormatFilter: (value: string[]) => void
  setTagFilter: (value: string[]) => void
  setDiscoveredQuery: (value: string) => void
  setDiscoveredFilters: (value: DiscoveredFileFilters) => void
  setDiscoveredSort: (value: DiscoveredFileSort) => void
  setDiscoveredPage: (value: number) => void
  setDiscoveredPageSize: (value: number) => void
}

export const useLibraryUi = create<LibraryUiState>((set) => ({
  activeView: 'library',
  viewMode: 'grid',
  selectedTag: undefined,
  query: '',
  page: 1,
  pageSize: 40,
  sort: { field: 'createdAt', direction: 'desc' },
  filters: {
    formats: [],
    tags: [],
    authors: [],
    folderIds: [],
  },
  selectedBookId: undefined,
  discoveredQuery: '',
  discoveredFilters: {},
  discoveredSort: { field: 'lastSeenAt', direction: 'desc' },
  discoveredPage: 1,
  discoveredPageSize: 25,
  setActiveView: (activeView) => set({ activeView }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSelectedTag: (selectedTag) =>
    set((state) => ({
      selectedTag,
      filters: { ...state.filters, tags: selectedTag ? [selectedTag] : [] },
      page: 1,
    })),
  setQuery: (query) => set({ query, page: 1 }),
  setSort: (sort) => set({ sort }),
  setPage: (page) => set({ page }),
  setSelectedBookId: (selectedBookId) => set({ selectedBookId }),
  setPublisherFilter: (publisher) =>
    set((state) => ({
      filters: { ...state.filters, publisher: publisher || undefined },
      page: 1,
    })),
  setStatusFilter: (status) =>
    set((state) => ({
      filters: { ...state.filters, status: status || undefined },
      page: 1,
    })),
  setFormatFilter: (formats) =>
    set((state) => ({
      filters: { ...state.filters, formats },
      page: 1,
    })),
  setTagFilter: (tags) =>
    set((state) => ({
      filters: { ...state.filters, tags },
      page: 1,
    })),
  setDiscoveredQuery: (discoveredQuery) => set({ discoveredQuery, discoveredPage: 1 }),
  setDiscoveredFilters: (discoveredFilters) => set({ discoveredFilters, discoveredPage: 1 }),
  setDiscoveredSort: (discoveredSort) => set({ discoveredSort, discoveredPage: 1 }),
  setDiscoveredPage: (discoveredPage) => set({ discoveredPage }),
  setDiscoveredPageSize: (discoveredPageSize) => set({ discoveredPageSize, discoveredPage: 1 }),
}))
