// 内容打开历史：只记录文件/scope 位置，不负责打开动作本身。
import { sameContentScope, type ContentScope } from "./content-scope"

export type ContentHistoryEntry = {
  scope: ContentScope
  rel: string | null
  label: string
}

export const MAX_CONTENT_HISTORY = 20

function sameLocation(a: ContentHistoryEntry, b: ContentHistoryEntry): boolean {
  return sameContentScope(a.scope, b.scope) && a.rel === b.rel
}

export function pushContentHistory(
  history: readonly ContentHistoryEntry[],
  entry: ContentHistoryEntry,
): ContentHistoryEntry[] {
  const last = history[history.length - 1]
  if (last && sameLocation(last, entry)) return history.slice()
  const next = [...history, entry]
  return next.length > MAX_CONTENT_HISTORY
    ? next.slice(next.length - MAX_CONTENT_HISTORY)
    : next
}

export function popContentHistory(history: readonly ContentHistoryEntry[]): {
  entry: ContentHistoryEntry | null
  rest: ContentHistoryEntry[]
} {
  if (history.length === 0) return { entry: null, rest: [] }
  return {
    entry: history[history.length - 1] ?? null,
    rest: history.slice(0, -1),
  }
}
