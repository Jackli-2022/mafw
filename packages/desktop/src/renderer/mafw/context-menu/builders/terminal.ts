import { L } from "../labels"
import { item, sep } from "../model"
import type { MenuModel } from "../types"

export interface TerminalMenuTarget {
  hasSelection: boolean
  canClose: boolean
}

export function buildTerminalMenu(target: TerminalMenuTarget): MenuModel {
  return {
    surface: "terminal",
    items: [
      item("terminal.copy", L.terminal.copy, target.hasSelection
        ? {}
        : { disabled: true, disabledReason: "没有选中内容" }),
      item("terminal.paste", L.terminal.paste),
      item("terminal.selectAll", L.terminal.selectAll),
      item("terminal.clear", L.terminal.clear),
      item("terminal.openExternal", L.terminal.openExternal),
      sep(),
      item("terminal.close", L.terminal.close, {
        danger: true,
        ...(target.canClose ? {} : { disabled: true, disabledReason: "终端未连接" }),
      }),
    ],
  }
}
