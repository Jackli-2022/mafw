// 后台任务对账（spec §5）：`/api/shell` 快照补/校准运行中行 + 快照中消失的
// running 行经 `shell.get` 探针收敛（exited→completed/failed by exit code；
// timeout→failed；killed→cancelled；null/404→cancelled）。fetch 注入 → 纯编排可单测。
//
// location-scoped（reviewer Important 5）：v2 的 shell 路由按 directory 作用域，
// 调用方必须传当前会话的 directory；否则 worktree/异目录会话的活 shell 可能
// 不在快照里并被误判为已死。
//
// fail-open 契约（Gate Ruling A：REST 面是可选能力）：
// - listShells 抛错或响应形状异常（非数组）→ 整轮跳过，**零 ingest**——
//   绝不因快照失败把所有跟踪行误判为已死；
// - getShell 单行抛错 → 该行跳过；唯 HTTP 404（已删除）→ 收敛 cancelled；
// - 对账收敛的终态 source:"probe" → tracker 照常落终态，store 层不触发终态
//   回调（静默，spec §5.1）。
import type { BackgroundEvent } from "./background-tracker"

export interface BackgroundFetchers {
  listShells(directory?: string): Promise<any[]>
  getShell(id: string, directory?: string): Promise<any>
}

function isHttp404(e: unknown): boolean {
  return /^HTTP 404\b/.test(String((e as any)?.message ?? ""))
}

export async function reconcileBackgroundOnce(opts: {
  fetchers: BackgroundFetchers
  directory?: string
  trackedRunningShellIds(): string[]
  ingest: (ev: BackgroundEvent) => void
}): Promise<void> {
  let runningIds: Set<string> | null = null
  try {
    const shells = await opts.fetchers.listShells(opts.directory)
    if (!Array.isArray(shells)) return // 形状异常：fail-open（不 mass-probe）
    const mapped = shells.map((sh: any) => ({
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
      const sh = await opts.fetchers.getShell(id, opts.directory)
      if (!sh) {
        opts.ingest({ kind: "bg-terminal", id, terminal: "cancelled", source: "probe" })
        continue
      }
      if (sh.status === "running") continue
      const terminal = sh.status === "killed" ? "cancelled"
        : sh.status === "timeout" ? "failed"
          : typeof sh.exit === "number" && sh.exit !== 0 ? "failed"
            : "completed"
      opts.ingest({ kind: "bg-terminal", id, terminal, source: "probe" })
    } catch (e) {
      // SDK 已把 404 映射为 null；此处兜底非 SDK 调用方（直接 fetch 语义）
      if (isHttp404(e)) opts.ingest({ kind: "bg-terminal", id, terminal: "cancelled", source: "probe" })
    }
  }
}
