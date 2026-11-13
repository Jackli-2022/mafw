// 子代理对账（spec §4.1/§4.6）：children 快照补历史行 + running 行探针收敛
// 断线期间漏掉的终态（不留假活行）。
//
// fetch 注入 → 纯编排可单测；一切失败 fail-open（不收敛、不抛）：
// - children 抛错：跳过快照（路由错误返回的空数组不可作"已删除"证据）；
// - messages 抛错：跳过该行（含后续 getSession 甄别）；
// - 空历史时用 session.get 甄别"刚创建尚无消息" vs "已删除"——服务端明确缺失
//   才收敛为 aborted（静默）。兼容两代 wire：E10-3+ 返回 404（SDK `request()`
//   对非 2xx 抛错，electron IPC 再包一层消息），旧 gateway 返回 200
//   `{error:'not found'}`。非 404 的失败（网络/500）仍 fail-open，不误判删除。
import type { TrackerEvent } from "./subagent-tracker"
import { ingestHistoryPage } from "./ingest/messages"

export interface ReconcileFetchers {
  children(parentID: string): Promise<any>
  messages(childID: string, limit: number): Promise<any>
  getSession(childID: string): Promise<any>
}

/** `session.get` 的"会话不存在"判定（跨 wire 代际）。 */
export function isSessionNotFoundError(err: unknown): boolean {
  const status = (err as any)?.status
  if (status === 404) return true
  const msg = err instanceof Error ? err.message : String(err ?? "")
  return /\b404\b/.test(msg) && /not found/i.test(msg)
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
      const page = ingestHistoryPage(Array.isArray(items) ? items : [], { sessionID: childID })
      const last = page.messages[page.messages.length - 1]
      if (last) {
        ingest({ kind: "child-last-message", childID, message: { role: last.role, time: last.time, error: last.error } })
        continue
      }
    } catch { continue } // messages 抛错：跳过该行（不查 get、不收敛）

    let missing = false
    try {
      const s: any = await fetchers.getSession(childID)
      missing = !!s?.error // 旧 gateway：200 {error:'not found'}
    } catch (err) {
      missing = isSessionNotFoundError(err) // E10-3+：404 → SDK/IPC 抛错
    }
    if (missing) ingest({ kind: "session-deleted", sessionID: childID })
  }
}
