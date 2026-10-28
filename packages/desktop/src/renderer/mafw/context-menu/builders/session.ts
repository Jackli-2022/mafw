import { L } from "../labels"
import { item, sep } from "../model"
import type { MenuItem, MenuModel } from "../types"

export interface SessionMenuTarget {
  id: string
  title: string
  kind: "row" | "tab"
  canFork?: boolean
  canDelete?: boolean
}

export function buildSessionMenu(target: SessionMenuTarget): MenuModel {
  const items: MenuItem[] = [
    item("session.open", L.session.open),
    item("session.rename", L.session.rename),
    item(
      "session.fork",
      L.session.fork,
      target.canFork === false
        ? { disabled: true, disabledReason: "当前运行时不支持分叉" }
        : {},
    ),
    item("session.export", L.session.export),
    item("session.copyId", L.session.copyId),
    sep(),
  ]

  if (target.kind === "tab") {
    items.push(item("session.closeTab", L.session.closeTab))
    return { surface: "session.tab", items }
  }

  items.push(
    item("session.delete", L.session.delete, {
      danger: true,
      confirms: true,
      ...(target.canDelete === false
        ? { disabled: true, disabledReason: "会话正在运行" }
        : {}),
    }),
  )
  return { surface: "session.row", items }
}
