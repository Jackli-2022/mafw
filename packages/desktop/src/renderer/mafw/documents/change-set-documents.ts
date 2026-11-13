// 改动集文档：一个 tab 对应一个讨论 turn 或一个 Goal revision。
// 与旧 diff 单文件 tab 的区别：文件导航由 tab 自己的 toolbar 下拉承担。
import { createSignal } from "solid-js"
import type { Scope } from "../focus/focus-model"
import type { FileDiffEntry } from "../components/DiffReviewPanel"

export type ChangeSetSource =
  | { kind: "session"; sessionID: string; turnID: string | null; title: string }
  | { kind: "goal"; podId: string; goalId: string; revision: number; title: string }

export type ChangeSetDocument = {
  id: string
  source: ChangeSetSource
  label: string
  root: string | null
  scope: Scope
  files: FileDiffEntry[]
  activeFile: string | null
  anchorLine?: number
}

export type OpenChangeSetInput = {
  source: ChangeSetSource
  label?: string
  root: string | null
  scope: Scope
  files?: readonly FileDiffEntry[]
  activeFile?: string | null
  anchorLine?: number
}

export function changeSetSourceKey(source: ChangeSetSource): string {
  return source.kind === "session"
    ? `session:${source.sessionID}:${source.turnID ?? "all"}`
    : `goal:${source.podId}:${source.goalId}:${source.revision}`
}

export function changeSetDocumentId(source: ChangeSetSource): string {
  return `changeset:${changeSetSourceKey(source)}`
}

export function changeSetDefaultLabel(source: ChangeSetSource): string {
  return source.kind === "goal"
    ? `改动 · Goal ${source.title} · rev ${source.revision}`
    : `改动 · ${source.title}`
}

const [documents, setDocuments] = createSignal<ChangeSetDocument[]>([])
const [activeId, setActiveId] = createSignal<string | null>(null)

export function changeSetDocuments(): ChangeSetDocument[] {
  return documents()
}

export function activeChangeSetDocumentId(): string | null {
  return activeId()
}

export function activeChangeSetDocument(): ChangeSetDocument | null {
  const id = activeId()
  return id ? (documents().find((doc) => doc.id === id) ?? null) : null
}

export function setActiveChangeSetDocument(id: string): void {
  if (documents().some((doc) => doc.id === id)) setActiveId(id)
}

/** 首个文件：保持用户选中的文件；文件消失时退回首项。 */
export function pickChangeSetFile(
  files: readonly FileDiffEntry[],
  preferred: string | null | undefined,
): string | null {
  const names = files.map((file) => file.file ?? "").filter(Boolean)
  if (preferred && names.includes(preferred)) return preferred
  return names[0] ?? null
}

export function openChangeSetDocument(input: OpenChangeSetInput): ChangeSetDocument {
  const id = changeSetDocumentId(input.source)
  const current = documents()
  const existing = current.find((doc) => doc.id === id)
  const incoming = input.files ? [...input.files] : []
  const files = incoming.length > 0 ? incoming : (existing?.files ?? [])
  const activeFile = pickChangeSetFile(
    files,
    input.activeFile ?? existing?.activeFile ?? null,
  )
  const next: ChangeSetDocument = {
    id,
    source: input.source,
    label: input.label ?? changeSetDefaultLabel(input.source),
    root: input.root,
    scope: input.scope,
    files,
    activeFile,
    ...(input.anchorLine !== undefined
      ? { anchorLine: input.anchorLine }
      : existing?.anchorLine !== undefined
        ? { anchorLine: existing.anchorLine }
        : {}),
  }
  if (existing) {
    setDocuments(current.map((doc) => (doc.id === id ? next : doc)))
  } else {
    setDocuments([...current, next])
  }
  setActiveId(id)
  return next
}

export function updateChangeSetDocument(
  id: string,
  patch: Partial<Pick<ChangeSetDocument, "files" | "activeFile" | "label" | "root" | "scope" | "anchorLine">>,
): void {
  setDocuments((current) =>
    current.map((doc) => {
      if (doc.id !== id) return doc
      const files = patch.files ? [...patch.files] : doc.files
      return {
        ...doc,
        ...patch,
        files,
        activeFile: pickChangeSetFile(files, patch.activeFile ?? doc.activeFile),
      }
    }),
  )
}

export function setActiveChangeSetFile(id: string, rel: string): void {
  setDocuments((current) =>
    current.map((doc) => {
      if (doc.id !== id) return doc
      if (doc.activeFile === rel) return doc
      return { ...doc, activeFile: rel }
    }),
  )
}

export function closeChangeSetDocument(id: string): void {
  const current = documents()
  const index = current.findIndex((doc) => doc.id === id)
  if (index < 0) return
  const next = current.filter((doc) => doc.id !== id)
  setDocuments(next)
  if (activeId() !== id) return
  setActiveId(next[index - 1]?.id ?? next[index]?.id ?? null)
}

export function clearChangeSetDocuments(): void {
  setDocuments([])
  setActiveId(null)
}

export function resetChangeSetDocumentsForTests(): void {
  clearChangeSetDocuments()
}
