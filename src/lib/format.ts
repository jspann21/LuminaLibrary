export function formatDate(value?: string): string {
  if (!value) return 'Unknown'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toLocaleDateString()
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value < 10 && index > 0 ? 1 : 0)} ${units[index]}`
}

export function formatDisplayPath(path?: string): string {
  if (!path) return ''
  return path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/i, '')
}

export function formatDisplayMessagePaths(message: string): string {
  return message.replace(/\\\\\?\\UNC\\/gi, '\\\\').replace(/\\\\\?\\/g, '')
}

export function sanitizeDisplayText(value?: string): string | undefined {
  if (!value) return undefined
  const normalized = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F\s]+/g, ' ')
    .trim()
  if (!normalized) return undefined
  const replacementCount = (normalized.match(/\uFFFD/g) ?? []).length
  if (replacementCount > 0 && replacementCount * 4 >= normalized.length) return undefined
  return normalized
}
