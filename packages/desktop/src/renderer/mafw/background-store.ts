// 后台任务 tracker 的 Solid 单例薄包装（模式同 subagent-store / goals-rev）：
// 模块级 signal 持有全部行（tracker 全局；作用域过滤在消费方），
// ingest 应用纯 reducer，并把「running→终态」的新落终态行回调给注册者。
//
// 通知职责切分：本 store 回调**所有**终态（含 subagent 行）；接线层只对
// type === "shell" 发通知——subagent 终态归 P0-1 子代理通道（防双响）。
import { createSignal } from "solid-js"
import { applyBackgroundEvent, collectNewTerminals, type BackgroundEvent, type BackgroundRow } from "./background-tracker"

const [rows, setRows] = createSignal<BackgroundRow[]>([])
const terminalCallbacks = new Set<(row: BackgroundRow) => void>()

/** 全部后台任务行（全局；按 sessionID 过滤由消费方做）。 */
export function backgroundRows(): BackgroundRow[] {
  return rows()
}

export function ingestBackgroundEvent(ev: BackgroundEvent, now?: number): void {
  const prev = rows()
  const next = applyBackgroundEvent(prev, ev, now)
  if (next === prev) return
  const terminals = collectNewTerminals(prev, next)
  setRows(next)
  // 对账收敛（probe）静默：行照常落终态，但不触发通知回调（spec §5.1）
  if (ev.kind === "bg-terminal" && ev.source === "probe") return
  for (const row of terminals) {
    for (const cb of terminalCallbacks) cb(row)
  }
}

/** 终态回调（含 cancelled；静默与否由通知层按 status/type 过滤）。返回注销函数。 */
export function onBackgroundTerminal(cb: (row: BackgroundRow) => void): () => void {
  terminalCallbacks.add(cb)
  return () => { terminalCallbacks.delete(cb) }
}

/** 测试用：清零行与回调。 */
export function resetBackgroundStore(): void {
  setRows([])
  terminalCallbacks.clear()
}
