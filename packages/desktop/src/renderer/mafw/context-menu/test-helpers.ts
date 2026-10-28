import type { MenuItem, MenuModel } from "./types"

export function ids(model: MenuModel): string[] {
  const out: string[] = []
  const walk = (items: MenuItem[]) => {
    for (const entry of items) {
      if (entry.type === "separator") continue
      out.push(entry.id)
      if (entry.type === "submenu" || entry.type === "group") walk(entry.items)
    }
  }
  walk(model.items)
  return out
}
