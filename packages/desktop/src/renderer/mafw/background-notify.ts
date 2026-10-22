// 后台任务终态通知：文案构造（纯逻辑，无 DOM）。
//
// 规则（spec §6.3）：completed/failed → toast 恒发 + hidden 时 OS 通知；
// cancelled/running → 静默。OS 限频门复用 subagent-notify 的 createNotifyGate，
// 且接线层与子代理通知共享同一实例（两类合计 10s 一条）。
// 本 builder 不做 kind 区分：subagent 行的通知抑制在接线层（P0-1 通道负责）。
import type { BackgroundRow } from "./background-tracker"

export interface BackgroundNotice {
  toast: string
  os?: { title: string; body: string }
}

export function buildBackgroundNotice(row: BackgroundRow, opts: { hidden: boolean }): BackgroundNotice | null {
  if (row.status !== "completed" && row.status !== "failed") return null
  const done = row.status === "completed"
  const subject = (row.label || row.id).slice(0, 80)
  const toast = `${done ? "后台任务完成" : "后台任务失败"}：${subject}`
  if (!opts.hidden) return { toast }
  return { toast, os: { title: done ? "MAFW：后台任务完成" : "MAFW：后台任务失败", body: subject } }
}
