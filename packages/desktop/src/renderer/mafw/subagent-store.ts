// 子代理 tracker 的 Solid 单例薄包装（模式同 goals-rev / session-store）：
// 模块级 signal 持有全部行，ingest 应用纯 reducer，并把「running→终态」的
// 新落终态行回调给注册者（每行至多一次，由 collectNewTerminals 的转换语义
// 保证；aborted 也回调，静默与否由通知层过滤）。
//
// 语义：tracker 全局（所有父会话的行都在这里）；面板按 activeSessionId
// 过滤显示、通知按全量行触发——作用域过滤属于消费方职责。
import { createSignal } from "solid-js"
import { applySubagentEvent, collectNewTerminals, type SubagentRow, type TrackerEvent } from "./subagent-tracker"

const [rows, setRows] = createSignal<SubagentRow[]>([])
const terminalCallbacks = new Set<(row: SubagentRow) => void>()

/** 全部追踪中的子代理行（全局；按 parentID 过滤由消费方做）。 */
export function subagentRows(): SubagentRow[] {
  return rows()
}

export function ingestSubagentEvent(ev: TrackerEvent, now?: number): void {
  const prev = rows()
  const next = applySubagentEvent(prev, ev, now)
  if (next === prev) return
  const terminals = collectNewTerminals(prev, next)
  setRows(next)
  for (const row of terminals) {
    for (const cb of terminalCallbacks) cb(row)
  }
}

/** 终态回调（含 aborted；静默与否由通知层按 status 过滤）。返回注销函数。 */
export function onSubagentTerminal(cb: (row: SubagentRow) => void): () => void {
  terminalCallbacks.add(cb)
  return () => { terminalCallbacks.delete(cb) }
}

/** 测试用：清零行与回调。 */
export function resetSubagentStore(): void {
  setRows([])
  terminalCallbacks.clear()
}
