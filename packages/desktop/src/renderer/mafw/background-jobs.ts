// 后台作业中性模型（Task 3 `MafwBackgroundJob`）的纯 reducer。
//
// desktop 不再自行从 tool part / synthetic 消息推导后台行——gateway 三源统一
// façade（runtime shell / mafw-task / subagent）是唯一事实源，桌面只做：
//   canonical `background.job.updated` → 按稳定 id upsert，
//   `background.jobs.list` 快照 → 静默合并（补历史、校准状态）。
//
// 语义契约：
// - 终态不回退：迟到的 running 事件不得把已完成作业变回运行中（gateway 同一规则）；
// - 活跃行优先，其余按 updated 降序（与 gateway `sortBackgroundJobs` 一致）；
// - 只有「运行中 → 终态」的转换算新终态（通知用）。
import type { MafwBackgroundJob } from "@mafw/sdk"

export type BackgroundJob = MafwBackgroundJob

const TERMINAL_STATUSES = new Set<string>(["completed", "failed", "cancelled"])

function updatedAt(job: BackgroundJob): number {
  return job.time?.updated ?? job.time?.completed ?? job.time?.created ?? 0
}

export function isTerminalJobStatus(status: string | undefined): boolean {
  return !!status && TERMINAL_STATUSES.has(status)
}

export function isActiveJobStatus(status: string | undefined): boolean {
  return status === "running" || status === "input_required"
}

export function jobLabel(job: BackgroundJob): string {
  return job.title || job.command || job.id
}

export function jobSort(jobs: BackgroundJob[]): BackgroundJob[] {
  return [...jobs].sort((a, b) => {
    const aActive = isActiveJobStatus(a.status) ? 0 : 1
    const bActive = isActiveJobStatus(b.status) ? 0 : 1
    if (aActive !== bActive) return aActive - bActive
    const delta = updatedAt(b) - updatedAt(a)
    if (delta !== 0) return delta
    return a.id.localeCompare(b.id)
  })
}

/** 单条 canonical 事件 → 新快照（按稳定 id 去重，终态不回退）。 */
export function applyBackgroundJobEvent(jobs: BackgroundJob[], job: BackgroundJob): BackgroundJob[] {
  if (!job || typeof job.id !== "string" || !job.id) return jobs
  if (typeof job.sessionID !== "string" || !job.sessionID) return jobs
  const index = jobs.findIndex((row) => row.id === job.id)
  if (index < 0) return jobSort([...jobs, job])
  const current = jobs[index]
  if (isTerminalJobStatus(current.status) && !isTerminalJobStatus(job.status)) return jobs
  const next = jobs.slice()
  next[index] = job
  return jobSort(next)
}

/** 快照合并（jobs.list / reconcile / 历史水合）：逐条 upsert，不删除本地已见行。 */
export function mergeBackgroundJobs(jobs: BackgroundJob[], incoming: readonly BackgroundJob[]): BackgroundJob[] {
  if (!Array.isArray(incoming) || incoming.length === 0) return jobs
  return incoming.reduce<BackgroundJob[]>((acc, job) => applyBackgroundJobEvent(acc, job), jobs)
}

/**
 * 权威空快照 → 清掉该会话的跟踪行（review minor：gateway 重启/作业被清理后
 * 本地不能永远显示一条不存在的 running）。只按会话收敛，不碰其他会话。
 */
export function clearSessionBackgroundJobs(jobs: BackgroundJob[], sessionID: string): BackgroundJob[] {
  if (!sessionID) return jobs
  const next = jobs.filter((job) => job.sessionID !== sessionID)
  return next.length === jobs.length ? jobs : next
}

/** 新落终态的行（prev 为活跃、next 终态）；新建行/快照行不计。 */
export function collectNewTerminals(prev: BackgroundJob[], next: BackgroundJob[]): BackgroundJob[] {
  const prevById = new Map(prev.map((job) => [job.id, job]))
  return next.filter((job) => {
    const before = prevById.get(job.id)
    return !!before && isActiveJobStatus(before.status) && isTerminalJobStatus(job.status)
  })
}

export function jobsForSession(jobs: BackgroundJob[], sessionID: string): BackgroundJob[] {
  if (!sessionID) return []
  return jobs.filter((job) => job.sessionID === sessionID)
}

export function countRunningJobs(jobs: BackgroundJob[]): number {
  return jobs.filter((job) => isActiveJobStatus(job.status)).length
}
