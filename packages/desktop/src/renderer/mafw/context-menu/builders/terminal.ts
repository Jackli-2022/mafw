import { L } from "../labels"
import { item, sep } from "../model"
import type { MenuModel } from "../types"

export interface TerminalMenuTarget {
  hasSelection: boolean
  canClose: boolean
  canKill?: boolean
  isLocal?: boolean
}

export function buildTerminalMenu(target: TerminalMenuTarget): MenuModel {
  const items = [
    item("terminal.copy", L.terminal.copy, target.hasSelection
      ? {}
      : { disabled: true, disabledReason: "没有选中内容" }),
    item("terminal.paste", L.terminal.paste),
    item("terminal.selectAll", L.terminal.selectAll),
    item("terminal.clear", L.terminal.clear),
  ]
  // SSH sessions have no local cwd to open; legacy callers omit isLocal.
  if (target.isLocal !== false) items.push(item("terminal.openExternal", L.terminal.openExternal))
  items.push(sep())
  items.push(item("terminal.close", L.terminal.close, {
    danger: true,
    ...(target.canClose ? {} : { disabled: true, disabledReason: "终端未连接" }),
  }))
  if (target.canKill) {
    items.push(item("terminal.kill", L.terminal.kill, { danger: true }))
  }
  return { surface: "terminal", items }
}
