import type { MenuItem, MenuModel } from "./types"

type ItemOptions = Partial<Omit<Extract<MenuItem, { type: "item" }>, "type" | "id" | "label">>
type SubmenuOptions = Partial<Pick<Extract<MenuItem, { type: "submenu" }>, "icon">>

export function item(id: string, label: string, opts: ItemOptions = {}): MenuItem {
  return { type: "item", id, label, ...opts }
}

export function sep(): MenuItem {
  return { type: "separator" }
}

export function submenu(id: string, label: string, items: MenuItem[], opts: SubmenuOptions = {}): MenuItem {
  return { type: "submenu", id, label, items, ...opts }
}

export function group(id: string, label: string, items: MenuItem[]): MenuItem {
  return { type: "group", id, label, items }
}

export function checkbox(id: string, label: string, checked: boolean): MenuItem {
  return { type: "checkbox", id, label, checked }
}

export function radio(id: string, label: string, checked: boolean): MenuItem {
  return { type: "radio", id, label, checked }
}

const MAX_PER_GROUP = 7
const MAX_SEPARATORS = 2

function validateItems(
  items: MenuItem[],
  depth: number,
  parentSubmenuId: string | undefined,
  errors: string[],
  seenIds: Set<string>,
): void {
  const lastSeparator = items.reduce((last, entry, index) => (entry.type === "separator" ? index : last), -1)

  let segment = 0
  const flush = () => {
    if (segment > MAX_PER_GROUP) errors.push(`too many items in group: ${segment}`)
    segment = 0
  }

  let separatorCount = 0
  items.forEach((entry, index) => {
    if (entry.type === "separator") {
      separatorCount++
      if (index === 0) errors.push("leading separator")
      if (index === items.length - 1) errors.push("trailing separator")
      const previous = items[index - 1]
      if (previous?.type === "separator") errors.push("consecutive separators")
      if (separatorCount > MAX_SEPARATORS) errors.push("too many separators")
      flush()
      return
    }

    segment++

    if (seenIds.has(entry.id)) errors.push(`duplicate id: ${entry.id}`)
    seenIds.add(entry.id)

    if (entry.type === "item") {
      if (entry.danger) {
        if (lastSeparator === -1) errors.push(`danger item requires a separator: ${entry.id}`)
        else if (index < lastSeparator) errors.push(`danger item before last separator: ${entry.id}`)
      }
      if (entry.confirms && !entry.label.endsWith("…")) {
        errors.push(`confirms label must end with …: ${entry.id}`)
      }
    }

    if (entry.type === "submenu") {
      if (depth >= 1) errors.push(`submenu depth > 1: ${parentSubmenuId ?? entry.id}`)
      if (entry.items.length === 0) errors.push(`empty submenu: ${entry.id}`)
      validateItems(entry.items, depth + 1, entry.id, errors, seenIds)
    }

    if (entry.type === "group") {
      validateItems(entry.items, depth, parentSubmenuId, errors, seenIds)
    }
  })

  flush()
}

export function validateMenu(model: MenuModel): string[] {
  const errors: string[] = []
  validateItems(model.items, 0, undefined, errors, new Set<string>())
  return errors
}
