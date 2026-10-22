// 后台任务对账（spec §5）：`/api/shell` 快照补/校准运行中行 + 快照中消失的
// running 行经 `shell.get` 探针收敛（exited→completed/failed by exit code；
// 404→cancelled）。fetch 注入 → 纯编排可单测。
//
// fail-open 契约（Gate Ruling A：REST 面是可选能力）：
// - listShells 抛错（401/反代不可达/网络）→ 整轮跳过，**零 ingest**——
//   绝不因快照失败把所有跟踪行误判为已死；
// - getShell 单行抛错 → 该行跳过，其余继续；
// - 对账收敛的终态 source:"probe" → tracker 照常落终态，但 store 层不触发
//   终态回调（静默，spec §5.1）——通知只认 live synthetic/turn 来源。
import type { BackgroundEvent } from "./background-tracker"

export interface BackgroundFetchers {
  listShells(): Promise<any[]>
  getShell(id: string): Promise<any>
}

export async function reconcileBackgroundOnce(opts: {
  fetchers: BackgroundFetchers
  trackedRunningShellIds(): string[]
  ingest: (ev: BackgroundEvent) => void
}): Promise<void> {
  let runningIds: Set<string> | null = null
  try {
    const shells = await opts.fetchers.listShells()
    const mapped = (Array.isArray(shells) ? shells : []).map((sh: any) => ({
      id: String(sh?.id ?? ""),
      command: typeof sh?.command === "string" ? sh.command : "",
      sessionID: typeof sh?.metadata?.sessionID === "string" ? sh.metadata.sessionID : undefined,
    })).filter(s => s.id)
    if (mapped.length > 0) opts.ingest({ kind: "bg-snapshot", shells: mapped })
    runningIds = new Set(mapped.map(s => s.id))
  } catch {
    runningIds = null // REST 不可达：跳过本轮探针，fail-open
  }
  if (!runningIds) return

  for (const id of opts.trackedRunningShellIds()) {
    if (runningIds.has(id)) continue // 仍活着
    try {
      const sh = await opts.fetchers.getShell(id)
      if (!sh) {
        opts.ingest({ kind: "bg-terminal", id, terminal: "cancelled", source: "probe" })
        continue
      }
      if (sh.status === "running") continue
      const terminal = typeof sh.exit === "number" && sh.exit !== 0 ? "failed" : "completed"
      opts.ingest({ kind: "bg-terminal", id, terminal, source: "probe" })
    } catch { /* 单行 fail-open */ }
  }
}
