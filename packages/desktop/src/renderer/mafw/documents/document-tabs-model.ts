import type { DocumentTabView } from "../document-frame-model"

export type DocumentTabKind = "file" | "web" | "diff"

export type DocumentTabEntry = {
  id: string
  kind: DocumentTabKind
  view: DocumentTabView
}

export function fileDocumentTabId(root: string, rel: string): string {
  return `file:${root}\u0000${rel}`
}

export function webDocumentTabId(tabId: string): string {
  return `web:${tabId}`
}

/** Stable merge: surviving ids keep their old position; new ids append. */
export function mergeDocumentTabs(
  previous: readonly DocumentTabEntry[],
  incoming: readonly DocumentTabEntry[],
): DocumentTabEntry[] {
  const nextById = new Map(incoming.map((entry) => [entry.id, entry]))
  const merged: DocumentTabEntry[] = []
  for (const entry of previous) {
    const next = nextById.get(entry.id)
    if (!next) continue
    merged.push(next)
    nextById.delete(entry.id)
  }
  for (const entry of incoming) {
    if (!nextById.has(entry.id)) continue
    merged.push(entry)
    nextById.delete(entry.id)
  }
  return merged
}

/** Sync one kind while leaving the other kind's positions untouched. */
export function syncKindEntries(
  previous: readonly DocumentTabEntry[],
  kind: DocumentTabKind,
  incoming: readonly DocumentTabEntry[],
): DocumentTabEntry[] {
  const nextById = new Map(
    incoming.filter((entry) => entry.kind === kind).map((entry) => [entry.id, entry]),
  )
  const merged: DocumentTabEntry[] = []
  for (const entry of previous) {
    if (entry.kind !== kind) {
      merged.push(entry)
      continue
    }
    const next = nextById.get(entry.id)
    if (!next) continue
    merged.push(next)
    nextById.delete(entry.id)
  }
  for (const entry of incoming) {
    if (entry.kind !== kind || !nextById.has(entry.id)) continue
    merged.push(entry)
    nextById.delete(entry.id)
  }
  return merged
}

/** Closing the active tab: left neighbor, then right, then null. */
export function nextDocumentTabId(
  entries: readonly DocumentTabEntry[],
  closingId: string,
  activeId: string | null,
): string | null {
  if (activeId !== closingId) return activeId
  const index = entries.findIndex((entry) => entry.id === closingId)
  if (index < 0) return null
  return entries[index - 1]?.id ?? entries[index + 1]?.id ?? null
}

export function closeOtherTabIds(
  entries: readonly DocumentTabEntry[],
  keepId: string,
): string[] {
  return entries.filter((entry) => entry.id !== keepId).map((entry) => entry.id)
}

export function closeRightTabIds(
  entries: readonly DocumentTabEntry[],
  keepId: string,
): string[] {
  const index = entries.findIndex((entry) => entry.id === keepId)
  if (index < 0) return []
  return entries.slice(index + 1).map((entry) => entry.id)
}

export type DocumentDropPosition = "before" | "after"

/** Move one tab next to another; no-op keeps the original array reference. */
export function moveDocumentTab(
  entries: readonly DocumentTabEntry[],
  fromId: string,
  toId: string,
  position: DocumentDropPosition,
): DocumentTabEntry[] {
  if (fromId === toId) return entries as DocumentTabEntry[]
  const fromIndex = entries.findIndex((entry) => entry.id === fromId)
  if (fromIndex < 0) return entries as DocumentTabEntry[]
  if (!entries.some((entry) => entry.id === toId)) return entries as DocumentTabEntry[]

  const moved = entries[fromIndex]!
  const rest = entries.filter((entry) => entry.id !== fromId)
  const targetIndex = rest.findIndex((entry) => entry.id === toId)
  const insertAt = targetIndex + (position === "after" ? 1 : 0)
  const next = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)]
  return next.every((entry, index) => entry.id === entries[index]!.id)
    ? (entries as DocumentTabEntry[])
    : next
}

export function documentTabViews(
  entries: readonly DocumentTabEntry[],
  activeId: string | null,
): DocumentTabView[] {
  return entries.map((entry) => ({ ...entry.view, id: entry.id, active: entry.id === activeId }))
}
