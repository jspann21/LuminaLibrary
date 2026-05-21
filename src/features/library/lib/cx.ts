export function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ')
}
