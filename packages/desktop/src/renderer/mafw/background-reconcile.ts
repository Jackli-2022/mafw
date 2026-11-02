// 后台作业对账（中性 jobs façade）。
//
// gateway 的 `background.jobs.list` 是三源合并后的权威快照（含终态行），
// 因此对账 = 拉一次快照、静默合并；不再逐行 probe 原生 shell，也不因
// 快照失败/形状异常伪造终态（fail-open，零 ingest）。
import type { BackgroundJob } from "./background-jobs"

export interface BackgroundJobFetchers {
  listJobs(sessionID: string): Promise<BackgroundJob[]>
}

export async function reconcileBackgroundOnce(opts: {
  sessionID: string | null | undefined
  fetchers: BackgroundJobFetchers
  ingest: (jobs: BackgroundJob[]) => void
}): Promise<void> {
  const sessionID = opts.sessionID
  if (!sessionID) return
  try {
    const jobs = await opts.fetchers.listJobs(sessionID)
    if (!Array.isArray(jobs) || jobs.length === 0) return
    opts.ingest(jobs)
  } catch {
    // 网络/503/旧 gateway：跳过本轮，绝不把跟踪行误判为已死。
  }
}
