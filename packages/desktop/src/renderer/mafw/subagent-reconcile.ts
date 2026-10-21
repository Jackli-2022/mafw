// 子代理对账（spec §4.1/§4.6）：children 快照补历史行 + running 行探针收敛
// 断线期间漏掉的终态（不留假活行）。
//
// fetch 注入 → 纯编排可单测；一切失败 fail-open（不收敛、不抛）：
// - children 抛错：跳过快照（路由错误返回的空数组不可作"已删除"证据）；
// - messages 抛错：跳过该行（含后续 getSession 甄别）；
// - 空历史时用 session.get 甄别"刚创建尚无消息" vs "已删除"——只有服务端
//   明确 error（not-found 形状 {error:'not found'}）才收敛为 aborted（静默）。
import type { TrackerEvent } from "./subagent-tracker"

export interface ReconcileFetchers {
  children(parentID: string): Promise<any>
  messages(childID: string, limit: number): Promise<any>
  getSession(childID: string): Promise<any>
}

export async function reconcileSubagentsOnce(opts: {
  activeSessionId: string | null
  runningChildIDs: string[]
  fetchers: ReconcileFetchers
  ingest: (ev: TrackerEvent) => void
}): Promise<void> {
  const { activeSessionId, runningChildIDs, fetchers, ingest } = opts

  if (activeSessionId) {
    try {
      const children = await fetchers.children(activeSessionId)
      ingest({ kind: "children-snapshot", parentID: activeSessionId, children: Array.isArray(children) ? children : [] })
    } catch { /* fail-open */ }
  }

  for (const childID of runningChildIDs) {
    try {
      const data: any = await fetchers.messages(childID, 1)
      const items = Array.isArray(data) ? data : data?.data
      const last = Array.isArray(items) ? items[items.length - 1] : undefined
      const info = last?.info || last
      if (info) {
        ingest({ kind: "child-last-message", childID, message: { role: info.role, time: info.time, error: info.error } })
        continue
      }
      const s: any = await fetchers.getSession(childID)
      if (s?.error) ingest({ kind: "session-deleted", sessionID: childID })
    } catch { /* fail-open */ }
  }
}
