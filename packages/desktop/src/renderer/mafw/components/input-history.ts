// Composer ↑/↓ input history. One instance per PaneInner; pure state
// machine so it is testable without SolidJS.
export function createInputHistory(max = 50) {
  let entries: string[] = []
  let cursor = -1 // -1 = at live input

  return {
    push(text: string) {
      const t = text.trim()
      cursor = -1
      if (!t) return
      if (entries[entries.length - 1] === t) return
      entries.push(t)
      if (entries.length > max) entries = entries.slice(entries.length - max)
    },
    up(_current: string): string | null {
      if (entries.length === 0) return null
      const next = cursor < 0 ? entries.length - 1 : cursor - 1
      if (next < 0) return null
      cursor = next
      return entries[next]
    },
    down(): string | null {
      if (cursor < 0) return null
      if (cursor >= entries.length - 1) {
        cursor = -1
        return ""
      }
      cursor = cursor + 1
      return entries[cursor]
    },
  }
}
