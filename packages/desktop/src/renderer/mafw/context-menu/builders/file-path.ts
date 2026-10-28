import { L } from "../labels"
import { item, submenu } from "../model"
import type { MenuItem, MenuModel } from "../types"

export interface FilePathMenuTarget {
  root: string
  rel: string
  inRoot: boolean
  canOpenEditor: boolean
}

export function buildFilePathMenu(target: FilePathMenuTarget): MenuModel {
  const items: MenuItem[] = [item("filePath.attach", L.filePath.attach)]

  if (target.inRoot && target.canOpenEditor) {
    items.push(item("filePath.openEditor", L.filePath.openEditor))
  }

  items.push(
    submenu("filePath.openWith", L.filePath.openWith, [
      item("filePath.openWith.default", L.filePath.openDefault),
      item("filePath.openWith.vscode", L.filePath.vscode),
      item("filePath.openWith.cursor", L.filePath.cursor),
      item("filePath.openWith.zed", L.filePath.zed),
    ]),
    item("filePath.reveal", L.filePath.reveal),
    submenu("filePath.copy", L.filePath.copy, [
      item("filePath.copy.abs", L.filePath.copyAbs),
      item("filePath.copy.rel", L.filePath.copyRel),
      item("filePath.copy.name", L.filePath.copyName),
    ]),
  )

  return { surface: "file.path", items }
}
