import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatBytes, formatDate, formatDisplayMessagePaths, formatDisplayPath, sanitizeDisplayText } from './format.ts'

test('formatDate handles missing, invalid, and valid dates', () => {
  assert.equal(formatDate(), 'Unknown')
  assert.equal(formatDate(''), 'Unknown')
  assert.equal(formatDate('not-a-date'), 'not-a-date')

  const formatted = formatDate('2023-05-20')
  assert.notEqual(formatted, '2023-05-20')
  assert.ok(formatted.length > 0)
})

test('formatBytes clamps invalid values and formats binary units', () => {
  assert.equal(formatBytes(-1), '0 B')
  assert.equal(formatBytes(Number.NaN), '0 B')
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(100), '100 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 * 1024), '1.0 MB')
  assert.equal(formatBytes(1024 * 1024 * 1.2), '1.2 MB')
  assert.equal(formatBytes(1024 ** 3), '1.0 GB')
  assert.equal(formatBytes(1024 ** 4), '1.0 TB')
  assert.equal(formatBytes(1024 ** 5), '1024 TB')
})

test('formatDisplayPath removes Windows extended-length prefixes', () => {
  assert.equal(formatDisplayPath(), '')
  assert.equal(formatDisplayPath('C:\\Books\\Today.pdf'), 'C:\\Books\\Today.pdf')
  assert.equal(
    formatDisplayPath('\\\\?\\E:\\Books\\bookcrawler-2025-11-21-18-33-08\\Today-matters.pdf'),
    'E:\\Books\\bookcrawler-2025-11-21-18-33-08\\Today-matters.pdf',
  )
  assert.equal(formatDisplayPath('\\\\?\\D:\\Programs\\Calibre2\\Library2'), 'D:\\Programs\\Calibre2\\Library2')
  assert.equal(formatDisplayPath('\\\\?\\UNC\\server\\share\\Book.pdf'), '\\\\server\\share\\Book.pdf')
})

test('formatDisplayMessagePaths removes embedded Windows extended-length prefixes', () => {
  assert.equal(
    formatDisplayMessagePaths('Scanning: \\\\?\\E:\\Books\\Today.pdf'),
    'Scanning: E:\\Books\\Today.pdf',
  )
  assert.equal(
    formatDisplayMessagePaths('Processing \\\\?\\UNC\\server\\share\\Books.csv...'),
    'Processing \\\\server\\share\\Books.csv...',
  )
})

test('sanitizeDisplayText removes unsafe control text and noisy replacements', () => {
  assert.equal(sanitizeDisplayText(), undefined)
  assert.equal(sanitizeDisplayText(''), undefined)
  assert.equal(sanitizeDisplayText('Hello World'), 'Hello World')
  assert.equal(sanitizeDisplayText('Hello\n\tWorld  '), 'Hello World')
  assert.equal(sanitizeDisplayText('  Trim Me  '), 'Trim Me')
  assert.equal(sanitizeDisplayText('A\x01B\x1FC\x7FD'), 'A B C D')
  assert.equal(sanitizeDisplayText('\uFFFDabc'), undefined)
  assert.equal(sanitizeDisplayText('\uFFFDabcde'), '\uFFFDabcde')
  assert.equal(sanitizeDisplayText('\x01\x02 \x03'), undefined)
})
