// 瞬态 diff 文档：统一文档条的一等 tab，不持久化 patch。
import { createSignal } from "solid-js"
import type { Scope } from "../focus/focus-model"

export type DiffSource =
  | { kind: "session"; sessionID: string }
  | { kind: "goal"; podId: string; goalId: string; revision: number }

export type DiffDocument = {
  id: string
  source: DiffSource
  root: string
  scope: Scope
  rel: string
  patch: string
  additions: number
  deletions: number
  status?: string
  anchorLine?: number
  reviewItemId?: string
  title: string
}

export type OpenDiffInput = Omit<DiffDocument, "id" | "title"> & { title?: string }

export function diffSourceKey(source: DiffSource): string {
  return source.kind === "session"
    ? `session:${source.sessionID}`
    : `goal:${source.podId}:${source.goalId}:${source.revision}`
}

export function diffDocumentId(source: DiffSource, rel: string): string {
  return `diff:${diffSourceKey(source)}:${rel}`
}

const [documents, setDocuments] = createSignal<DiffDocument[]>([])
const [activeId, setActiveId] = createSignal<string | null>(null)

export function diffDocuments(): DiffDocument[] {
  return documents()
}

export function activeDiffDocumentId(): string | null {
  return activeId()
}

export function activeDiffDocument(): DiffDocument | null {
  const id = activeId()
  return id ? (documents().find((doc) => doc.id === id) ?? null) : null
}

export function setActiveDiffDocument(id: string): void {
  if (documents().some((doc) => doc.id === id)) setActiveId(id)
}

export function openDiffDocument(input: OpenDiffInput): DiffDocument {
  const id = diffDocumentId(input.source, input.rel)
  const next: DiffDocument = {
    ...input,
    id,
    title: input.title ?? `${input.rel} · 改动`,
  }
  const current = documents()
  const index = current.findIndex((doc) => doc.id === id)
  if (index >= 0) {
    const replaced = current.map((doc) => (doc.id === id ? next : doc))
    setDocuments(replaced)
  } else {
    setDocuments([...current, next])
  }
  setActiveId(id)
  return next
}

export function updateDiffDocument(
  id: string,
  patch: Partial<Pick<DiffDocument, "patch" | "additions" | "deletions" | "anchorLine" | "reviewItemId">>,
): void {
  setDocuments((current) =>
    current.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)),
  )
}

export function closeDiffDocument(id: string): void {
  const current = documents()
  const index = current.findIndex((doc) => doc.id === id)
  if (index < 0) return
  const next = current.filter((doc) => doc.id !== id)
  setDocuments(next)
  if (activeId() !== id) return
  setActiveId(next[index - 1]?.id ?? next[index]?.id ?? null)
}

export function clearDiffDocuments(): void {
  setDocuments([])
  setActiveId(null)
}

export function resetDiffDocumentsForTests(): void {
  clearDiffDocuments()
}
