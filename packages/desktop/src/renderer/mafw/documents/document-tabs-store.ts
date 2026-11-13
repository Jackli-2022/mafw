import { createSignal } from "solid-js"
import type { DocumentTabView } from "../document-frame-model"
import {
  closeOtherTabIds,
  closeRightTabIds,
  fileDocumentTabId,
  syncKindEntries,
  webDocumentTabId,
  type DocumentTabEntry,
  type DocumentTabKind,
} from "./document-tabs-model"

const [entries, setEntries] = createSignal<DocumentTabEntry[]>([])
const [activeId, setActiveId] = createSignal<string | null>(null)
const [closeRequests, setCloseRequests] = createSignal<readonly string[]>([])

export function documentTabs(): DocumentTabEntry[] {
  return entries()
}

export function activeDocumentTabId(): string | null {
  return activeId()
}

export function activeDocumentTabKind(): DocumentTabKind | null {
  const id = activeId()
  return id ? (entries().find((entry) => entry.id === id)?.kind ?? null) : null
}

export function syncFileTabs(root: string, views: readonly DocumentTabView[]): void {
  const incoming = views.map((view) => ({
    id: fileDocumentTabId(root, view.id),
    kind: "file" as const,
    view: { ...view, active: false },
  }))
  applyKind("file", incoming)
}

export function syncWebTabs(views: readonly DocumentTabView[]): void {
  const incoming = views.map((view) => ({
    id: webDocumentTabId(view.id),
    kind: "web" as const,
    view: { ...view, active: false },
  }))
  applyKind("web", incoming)
}

function applyKind(kind: DocumentTabKind, incoming: DocumentTabEntry[]): void {
  const next = syncKindEntries(entries(), kind, incoming)
  setEntries(next)
  const current = activeId()
  if (current && !next.some((entry) => entry.id === current)) setActiveId(null)
}

export function activateDocumentTab(id: string): void {
  if (!entries().some((entry) => entry.id === id)) return
  setActiveId(id)
}

export function requestCloseDocumentTab(id: string): void {
  setCloseRequests((prev) => (prev.includes(id) ? prev : [...prev, id]))
}

export function pendingCloseRequests(): readonly string[] {
  return closeRequests()
}

export function consumeCloseRequest(id: string): void {
  setCloseRequests((prev) => prev.filter((item) => item !== id))
}

export function closeOtherDocumentTabs(id: string): void {
  for (const target of closeOtherTabIds(entries(), id)) requestCloseDocumentTab(target)
}

export function closeDocumentTabsToRight(id: string): void {
  for (const target of closeRightTabIds(entries(), id)) requestCloseDocumentTab(target)
}

export function resetDocumentTabsForTests(): void {
  setEntries([])
  setActiveId(null)
  setCloseRequests([])
}
