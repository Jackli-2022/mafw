// 后台作业对账（中性 jobs façade）。
// gateway 的 `background.jobs.list` 是三源合并后的权威快照（含终态行），
// 因此对账 = 拉一次快照、静默合并；不再逐行 probe 原生 shell，也不因
// 快照失败/形状异常伪造终态（fail-open，零 ingest）。
//
// 空快照的语义（review minor）：成功返回的空数组 = 「该会话当前没有任何作业」，
// 必须清掉本地该会话的跟踪行——否则 gateway 重启/作业被清理后，桌面会永远显示
// 一条并不存在的 running。失败/畸形形状仍然零副作用（不能把失败当「没有作业」）。
import type { BackgroundJob } from "./background-jobs"

export interface BackgroundJobFetchers {
  listJobs(sessionID: string): Promise<BackgroundJob[]>
}

export async function reconcileBackgroundOnce(opts: {
  sessionID: string | null | undefined
  fetchers: BackgroundJobFetchers
  ingest: (jobs: BackgroundJob[]) => void
  /** 快照为空时清掉该会话的本地行（省略 = 保留，旧行为）。 */
  clear?: (sessionID: string) => void
}): Promise<void> {
  const sessionID = opts.sessionID
  if (!sessionID) return
  try {
    const jobs = await opts.fetchers.listJobs(sessionID)
    if (!Array.isArray(jobs)) return
    if (jobs.length === 0) {
      opts.clear?.(sessionID)
      return
    }
    opts.ingest(jobs)
  } catch {
    // 网络/503/无 gateway：跳过本轮，绝不把跟踪行误判为已死。
  }
}
