// 后台作业 store：Solid 单例包裹中性 jobs reducer（模式同 subagent-store）。
//
// 数据来源只有两条中性面：
//   - canonical `background.job.updated` → `ingestBackgroundJob`（逐条，触发终态回调）
//   - `background.jobs.list` 快照 → `ingestBackgroundJobs`（静默，补历史/校准）
// 不再读 `/api/shell*` 原生 DTO，也不从消息部件推导作业。
import { createSignal } from "solid-js"
import {
  applyBackgroundJobEvent,
  collectNewTerminals,
  type BackgroundJob,
} from "./background-jobs"

const [jobs, setJobs] = createSignal<BackgroundJob[]>([])
const terminalCallbacks = new Set<(job: BackgroundJob) => void>()
/** 快照/水合期间抑制终态通知（历史完成不是 live 事件）。 */
let suppressTerminalNotify = false

/** 全部后台作业（全局；按 sessionID 过滤由消费方做）。 */
export function backgroundJobs(): BackgroundJob[] {
  return jobs()
}

export function ingestBackgroundJob(job: BackgroundJob): void {
  const prev = jobs()
  const next = applyBackgroundJobEvent(prev, job)
  if (next === prev) return
  const terminals = collectNewTerminals(prev, next)
  setJobs(next)
  if (suppressTerminalNotify) return
  for (const terminal of terminals) {
    for (const cb of terminalCallbacks) cb(terminal)
  }
}

/**
 * 快照批次摄取（jobs.list / reconcile / 历史水合）：静默合并。
 * 典型场景：首次打开后台面板或切会话——历史完成的作业不应弹「刚完成」。
 */
export function ingestBackgroundJobs(incoming: readonly BackgroundJob[]): void {
  if (!Array.isArray(incoming) || incoming.length === 0) return
  suppressTerminalNotify = true
  try {
    for (const job of incoming) ingestBackgroundJob(job)
  } finally {
    suppressTerminalNotify = false
  }
}

/** 终态回调（仅活跃 → 终态的转换；静默与否由通知层按 source/kind 过滤）。返回注销函数。 */
export function onBackgroundTerminal(cb: (job: BackgroundJob) => void): () => void {
  terminalCallbacks.add(cb)
  return () => { terminalCallbacks.delete(cb) }
}

/** 测试用：清零行与回调。 */
export function resetBackgroundStore(): void {
  setJobs([])
  terminalCallbacks.clear()
}
