import type { MenuItem, MenuModel } from "./types"

type ItemOf<T extends MenuItem["type"]> = Extract<MenuItem, { type: T }>

export type RenderRow =
  | { kind: "item"; item: ItemOf<"item"> }
  | { kind: "separator" }
  | { kind: "submenu"; item: ItemOf<"submenu"> }
  | { kind: "group"; item: ItemOf<"group">; rows: RenderRow[] }
  | { kind: "checkbox"; item: ItemOf<"checkbox"> }
  | { kind: "radio"; item: ItemOf<"radio"> }

function toRow(entry: MenuItem): RenderRow {
  switch (entry.type) {
    case "separator":
      return { kind: "separator" }
    case "submenu":
      return { kind: "submenu", item: entry }
    case "group":
      return { kind: "group", item: entry, rows: toRows(entry.items) }
    case "checkbox":
      return { kind: "checkbox", item: entry }
    case "radio":
      return { kind: "radio", item: entry }
    case "item":
      return { kind: "item", item: entry }
  }
}

function toRows(items: MenuItem[]): RenderRow[] {
  return items.map(toRow)
}

export function toRenderRowsFromItems(items: MenuItem[]): RenderRow[] {
  return toRows(items)
}

export function toRenderRows(model?: MenuModel | null): RenderRow[] {
  return model ? toRows(model.items) : []
}
