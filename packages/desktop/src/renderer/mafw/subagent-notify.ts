// 子代理终态通知：文案构造 + OS 通知限频门（纯逻辑，无 DOM）。
//
// 规则（spec §4.5）：completed/failed → toast 恒发 + hidden 时 OS 通知；
// aborted/其余 → 静默（null）。每子代理至多一次终态通知由 collectNewTerminals
// 的「running→终态」转换语义保证；本模块只负责文案与 OS 层的限频。
import type { SubagentRow } from "./subagent-tracker"

export interface TerminalNotice {
  toast: string
  os?: { title: string; body: string }
}

export function buildTerminalNotice(row: SubagentRow, opts: { hidden: boolean }): TerminalNotice | null {
  if (row.status !== "completed" && row.status !== "failed") return null
  const done = row.status === "completed"
  const toast = `${done ? "子代理完成" : "子代理失败"}：${row.title}`
  if (!opts.hidden) return { toast }
  return { toast, os: { title: done ? "MAFW：子代理完成" : "MAFW：子代理失败", body: row.title } }
}

/**
 * 全局限频门（并发子代理齐完成时防通知洪泛，Claude #11716 前车之鉴）：
 * windowMs 窗口内只放行第一条，超出窗口的再次放行。
 * 返回的谓词带状态（闭包记 lastAllowed），一个门实例对应一个通知通道。
 */
export function createNotifyGate(windowMs = 10_000): (now: number) => boolean {
  let lastAllowed = -Infinity
  return (now: number) => {
    if (now - lastAllowed < windowMs) return false
    lastAllowed = now
    return true
  }
}

/**
 * 回合完成 OS 通知（notifyIdle）的决策（spec §4.5/§6，行为变更的回归钉扎）：
 * 被 tracker 追踪的子会话 → 旧泛化通道让位（由 subagents 新通道通知）；
 * 其余保持既有语义：窗口隐藏 + 60s 节流。
 */
export function shouldNotifyIdle(opts: {
  trackedChild: boolean
  hidden: boolean
  lastNotifyAt: number
  now: number
  throttleMs?: number
}): boolean {
  if (opts.trackedChild) return false
  if (!opts.hidden) return false
  return opts.now - opts.lastNotifyAt > (opts.throttleMs ?? 60_000)
}
