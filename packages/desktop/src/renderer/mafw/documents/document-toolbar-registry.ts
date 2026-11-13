// 文档 toolbar 的 slot 注册：body 拥有动作，document 层只负责渲染 active 的一份。
import { createSignal, type JSX } from "solid-js"
import type { DocumentTabKind } from "./document-tabs-model"

export type DocumentToolbarSlots = {
  ariaLabel: string
  leading?: () => JSX.Element
  center?: () => JSX.Element
  trailing?: () => JSX.Element
}

export type DocumentToolbarProvider = () => DocumentToolbarSlots

const empty = (): Record<DocumentTabKind, DocumentToolbarProvider | null> => ({
  file: null,
  web: null,
  changeset: null,
  scene: null,
})

const [providers, setProviders] = createSignal(empty())

export function registerDocumentToolbar(
  kind: DocumentTabKind,
  provider: DocumentToolbarProvider,
): () => void {
  setProviders((previous) => ({ ...previous, [kind]: provider }))
  return () => {
    setProviders((previous) =>
      previous[kind] === provider ? { ...previous, [kind]: null } : previous,
    )
  }
}

export function documentToolbarProvider(kind: DocumentTabKind): DocumentToolbarProvider | null {
  return providers()[kind]
}

export function resetDocumentToolbarRegistryForTests(): void {
  setProviders(empty())
}
