import { L } from "../labels"
import { item, submenu } from "../model"
import type { MenuItem, MenuModel } from "../types"

export interface FileTreeMenuTarget {
  rel: string
  kind: "file" | "dir"
  previewable: boolean
}

export function buildFileTreeMenu(target: FileTreeMenuTarget): MenuModel {
  const items: MenuItem[] = [item("fileTree.open", L.fileTree.open)]

  if (target.kind === "file" && target.previewable) {
    items.push(item("fileTree.preview", L.fileTree.preview))
  }

  items.push(
    item("fileTree.attach", L.fileTree.attach),
    item("fileTree.reveal", L.fileTree.reveal),
    submenu("fileTree.copy", L.fileTree.copy, [
      item("fileTree.copy.rel", L.filePath.copyRel),
      item("fileTree.copy.abs", L.filePath.copyAbs),
      item("fileTree.copy.name", L.filePath.copyName),
    ]),
  )

  return { surface: "file.tree", items }
}
