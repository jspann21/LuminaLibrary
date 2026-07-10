import type { CoverCandidate } from '../../../lib/types'

export type CoverImageSearchField = 'isbn' | 'title' | 'author'

export type CoverImageSearchData = {
  isbn10: string
  isbn13: string
  title: string
  author: string
}

export function getCoverImageSearchValues(data: CoverImageSearchData): Record<CoverImageSearchField, string> {
  return {
    isbn: data.isbn13.trim() || data.isbn10.trim(),
    title: data.title.trim(),
    author: data.author.trim(),
  }
}

export function getDefaultCoverImageSearchFields(data: CoverImageSearchData): CoverImageSearchField[] {
  const values = getCoverImageSearchValues(data)
  if (values.isbn) return ['isbn']
  return (['title', 'author'] as const).filter((field) => Boolean(values[field]))
}

export function buildCoverImageSearchQuery(
  fields: CoverImageSearchField[],
  data: CoverImageSearchData,
) {
  const values = getCoverImageSearchValues(data)
  const terms = fields.map((field) => values[field]).filter(Boolean)
  return terms.length > 0 ? `${terms.join(' ')} book cover` : ''
}

export function combineCoverCandidates(
  baseCandidates: CoverCandidate[],
  embeddedSearchResults: CoverCandidate[],
) {
  const userAdded = baseCandidates.filter((candidate) => candidate.source === 'custom' || candidate.source === 'local')
  const providerCandidates = baseCandidates.filter((candidate) => candidate.source !== 'custom' && candidate.source !== 'local')

  return [...userAdded, ...embeddedSearchResults, ...providerCandidates].filter(
    (candidate, index, all) => all.findIndex((item) => item.url === candidate.url) === index,
  )
}
