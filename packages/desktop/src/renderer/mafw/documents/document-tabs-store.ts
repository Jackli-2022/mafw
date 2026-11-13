import { createEffect, createRoot, createSignal } from "solid-js"
import type { DocumentTabView } from "../document-frame-model"
import {
  closeOtherTabIds,
  closeRightTabIds,
  fileDocumentTabId,
  moveDocumentTab as moveDocumentTabEntry,
  syncKindEntries,
  webDocumentTabId,
  type DocumentDropPosition,
  type DocumentTabEntry,
  type DocumentTabKind,
} from "./document-tabs-model"
import {
  flushDocumentListPersistence,
  loadDocumentListSnapshot,
  saveDocumentListSnapshot,
} from "./document-list-persistence"
import { browserDocuments, browserDocumentTitle } from "./browser-documents"

const [entries, setEntries] = createSignal<DocumentTabEntry[]>([])
const [activeId, setActiveId] = createSignal<string | null>(null)
const [closeRequests, setCloseRequests] = createSignal<readonly string[]>([])

let worldId: string | null = null
let savedOrder: string[] = []
let desiredActiveId: string | null = null

export function documentTabs(): DocumentTabEntry[] {
  return entries()
}

export function activeDocumentTabId(): string | null {
  return activeId()
}

export function activeDocumentTab(): DocumentTabEntry | null {
  const id = activeId()
  return id ? (entries().find((entry) => entry.id === id) ?? null) : null
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

function syncWebTabs(views: readonly DocumentTabView[]): void {
  const incoming = views.map((view) => ({
    id: webDocumentTabId(view.id),
    kind: "web" as const,
    view: { ...view, active: false },
  }))
  applyKind("web", incoming)
}

function syncBrowserDocuments(): void {
  syncWebTabs(browserDocuments().map((doc) => ({
    id: doc.id,
    label: browserDocumentTitle(doc),
    title: doc.url,
    icon: "globe",
    active: false,
  })))
}

function applyKind(kind: DocumentTabKind, incoming: DocumentTabEntry[]): void {
  const previous = entries()
  const next = applySavedOrder(syncKindEntries(previous, kind, incoming))
  if (sameEntries(previous, next)) return
  pruneSavedOrder(previous, next)
  setEntries(next)
  const current = activeId()
  if (current && !next.some((entry) => entry.id === current)) setActiveId(null)
  if (!activeId() && desiredActiveId && next.some((entry) => entry.id === desiredActiveId)) {
    setActiveId(desiredActiveId)
    desiredActiveId = null
  }
  persistOrder()
}

function applySavedOrder(items: readonly DocumentTabEntry[]): DocumentTabEntry[] {
  if (savedOrder.length === 0) return items as DocumentTabEntry[]
  const rank = new Map(savedOrder.map((id, index) => [id, index]))
  const ordered = items
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const a = rank.get(left.entry.id) ?? Number.MAX_SAFE_INTEGER
      const b = rank.get(right.entry.id) ?? Number.MAX_SAFE_INTEGER
      return a === b ? left.index - right.index : a - b
    })
    .map((item) => item.entry)
  return ordered.every((entry, index) => entry.id === items[index]!.id)
    ? (items as DocumentTabEntry[])
    : ordered
}

/** 只剪掉「上一轮存在、这一轮消失」的 id；尚未同步到的 id 暂时保留。 */
function pruneSavedOrder(previous: readonly DocumentTabEntry[], next: readonly DocumentTabEntry[]): void {
  if (savedOrder.length === 0) return
  const previousIds = new Set(previous.map((entry) => entry.id))
  const nextIds = new Set(next.map((entry) => entry.id))
  savedOrder = savedOrder.filter((id) => nextIds.has(id) || !previousIds.has(id))
}

function persistOrder(): void {
  if (!worldId) return
  const order = [
    ...savedOrder,
    ...entries().map((entry) => entry.id).filter((id) => !savedOrder.includes(id)),
  ]
  saveDocumentListSnapshot(worldId, { version: 1, order, activeId: activeId() })
}

/** 按 world 加载顺序；在 store 首次同步前调用即可，未同步的 id 会等到对应 body。 */
export function configureDocumentListWorld(nextWorldId: string): void {
  if (nextWorldId === worldId) return
  if (worldId) flushDocumentListPersistence(worldId)
  worldId = nextWorldId
  const snapshot = loadDocumentListSnapshot(nextWorldId)
  savedOrder = snapshot.order
  desiredActiveId = snapshot.activeId
  const next = applySavedOrder(entries())
  if (!sameEntries(entries(), next)) setEntries(next)
  const current = activeId()
  if (current && !next.some((entry) => entry.id === current)) setActiveId(null)
  if (!activeId() && desiredActiveId && next.some((entry) => entry.id === desiredActiveId)) {
    setActiveId(desiredActiveId)
    desiredActiveId = null
  }
}

export function moveDocumentTab(fromId: string, toId: string, position: DocumentDropPosition): void {
  const previous = entries()
  const next = moveDocumentTabEntry(previous, fromId, toId, position)
  if (next === previous) return
  savedOrder = [
    ...next.map((entry) => entry.id),
    ...savedOrder.filter((id) => !next.some((entry) => entry.id === id)),
  ]
  setEntries(next)
  persistOrder()
}

function sameEntries(a: readonly DocumentTabEntry[], b: readonly DocumentTabEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!
    const right = b[i]!
    if (left.id !== right.id || left.kind !== right.kind) return false
    const lv = left.view
    const rv = right.view
    if (
      lv.id !== rv.id ||
      lv.label !== rv.label ||
      lv.title !== rv.title ||
      lv.icon !== rv.icon ||
      lv.active !== rv.active ||
      lv.dirty !== rv.dirty ||
      lv.preview !== rv.preview ||
      lv.readOnly !== rv.readOnly
    ) return false
  }
  return true
}

export function activateDocumentTab(id: string): void {
  if (!entries().some((entry) => entry.id === id)) return
  if (activeId() === id) return
  setActiveId(id)
  desiredActiveId = null
  persistOrder()
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
  worldId = null
  savedOrder = []
  desiredActiveId = null
}

// web tab 状态归 browser-documents 所有；document store 只做视图同步，不再由 body 手写。
createRoot(() => {
  createEffect(syncBrowserDocuments)
})
