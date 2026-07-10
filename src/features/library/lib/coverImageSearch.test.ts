import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCoverImageSearchQuery,
  combineCoverCandidates,
  getDefaultCoverImageSearchFields,
  getCoverImageSearchValues,
} from './coverImageSearch.ts'

const book = {
  isbn10: ' 0441172717 ',
  isbn13: '9780441172719',
  title: ' Dune ',
  author: 'Frank Herbert',
}

test('cover image search prefers ISBN-13 and defaults to an ISBN-only search', () => {
  assert.equal(getCoverImageSearchValues(book).isbn, '9780441172719')
  assert.deepEqual(getDefaultCoverImageSearchFields(book), ['isbn'])
  assert.equal(buildCoverImageSearchQuery(['isbn'], book), '9780441172719 book cover')
})

test('cover image search can combine selected metadata fields', () => {
  assert.equal(
    buildCoverImageSearchQuery(['title', 'author'], book),
    'Dune Frank Herbert book cover',
  )
})

test('cover image search falls back to title and author when ISBN is missing', () => {
  const withoutIsbn = { ...book, isbn10: '', isbn13: '' }
  assert.deepEqual(getDefaultCoverImageSearchFields(withoutIsbn), ['title', 'author'])
  assert.equal(buildCoverImageSearchQuery([], withoutIsbn), '')
})

test('user-added covers appear before embedded search results', () => {
  const candidates = combineCoverCandidates(
    [
      { url: 'https://example.com/custom.jpg', source: 'custom' },
      { url: 'https://example.com/open-library.jpg', source: 'open_library' },
    ],
    [
      { url: 'https://example.com/brave-1.jpg', source: 'brave' },
      { url: 'https://example.com/brave-2.jpg', source: 'brave' },
    ],
  )

  assert.deepEqual(candidates.map((candidate) => candidate.source), [
    'custom',
    'brave',
    'brave',
    'open_library',
  ])
})
