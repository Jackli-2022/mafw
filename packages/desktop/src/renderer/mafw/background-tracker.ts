// 后台任务 tracker：既有事件（part 元数据 / synthetic 完成 / shell 快照）→ 行状态机的纯 reducer。
//
// 语义契约（消费方依赖，勿轻改）：
// - tracker 是全局的（所有会话的后台任务一张表）；作用域过滤（按 activeSessionId
//   显示）由消费方负责；
// - 终态只落一次（幂等不回退）：首帧终态生效，后续事件（含重复观察）不回退；
// - 观察只建 running 行；快照只补缺失行，不降级、不产生终态（判定死亡靠对账探针）；
// - turn 来源的终态只收敛 subagent 行（子会话 turn 事件不适用于 shell）；
// - 终态行不存在时，携带 meta 的完成事件建终态行（重启后首见即完成态，保历史可见）。
export type BgType = "shell" | "subagent"
export type BgStatus = "running" | "completed" | "failed" | "cancelled"

export interface BackgroundRow {
  /** shell: shellID；subagent: 子会话 id */
  id: string
  type: BgType
  /** 父会话（作用域过滤键） */
  sessionID: string
  /** command / description */
  label: string
  status: BgStatus
  startedAt: number
  endedAt?: number
}

export type BackgroundEvent =
  | { kind: "bg-observed"; row: { id: string; type: BgType; sessionID: string; label: string } }
  | { kind: "bg-terminal"; id: string; terminal: "completed" | "failed" | "cancelled"; at?: number
      meta?: { type: BgType; sessionID: string; label: string }; source?: "synthetic" | "turn" | "probe" | "user" }
  | { kind: "bg-snapshot"; shells: Array<{ id: string; command: string; sessionID?: string }> }

const byStartedDesc = (a: BackgroundRow, b: BackgroundRow) => b.startedAt - a.startedAt

export function applyBackgroundEvent(
  rows: BackgroundRow[],
  ev: BackgroundEvent,
  now: number = Date.now(),
): BackgroundRow[] {
  switch (ev.kind) {
    case "bg-observed": {
      if (rows.some(r => r.id === ev.row.id)) return rows
      const row: BackgroundRow = {
        id: ev.row.id,
        type: ev.row.type,
        sessionID: ev.row.sessionID,
        label: ev.row.label,
        status: "running",
        startedAt: now,
      }
      return [...rows, row].sort(byStartedDesc)
    }
    case "bg-terminal": {
      const existing = rows.find(r => r.id === ev.id)
      if (existing) {
        // turn 来源只收敛 subagent 行；终态幂等不回退
        if (ev.source === "turn" && existing.type !== "subagent") return rows
        if (existing.status !== "running") return rows
        return rows.map(r => r.id === ev.id ? { ...r, status: ev.terminal, endedAt: ev.at ?? now } : r)
      }
      if (!ev.meta) return rows
      const at = ev.at ?? now
      return [...rows, {
        id: ev.id,
        type: ev.meta.type,
        sessionID: ev.meta.sessionID,
        label: ev.meta.label,
        status: ev.terminal,
        startedAt: at,
        endedAt: at,
      }].sort(byStartedDesc)
    }
    case "bg-snapshot": {
      const existing = new Set(rows.map(r => r.id))
      const added: BackgroundRow[] = []
      for (const sh of ev.shells) {
        if (!sh?.id || existing.has(sh.id)) continue
        added.push({
          id: sh.id,
          type: "shell",
          sessionID: sh.sessionID ?? "",
          label: sh.command ?? "",
          status: "running",
          startedAt: now,
        })
      }
      if (added.length === 0) return rows
      return [...rows, ...added].sort(byStartedDesc)
    }
  }
}

/** 新落终态的行（prev 存在且为 running、next 非 running）；snapshot/新建行不算。 */
export function collectNewTerminals(prev: BackgroundRow[], next: BackgroundRow[]): BackgroundRow[] {
  const prevById = new Map(prev.map(r => [r.id, r]))
  return next.filter(r => r.status !== "running" && prevById.get(r.id)?.status === "running")
}

/** 某会话的后台任务行（视图作用域过滤）。 */
export function rowsForSession(rows: BackgroundRow[], sid: string): BackgroundRow[] {
  return rows.filter(r => r.sessionID === sid)
}

/** 全局运行中计数（badge 用；含所有会话，与 P0-1 的全局徽标语义一致）。 */
export function countRunning(rows: BackgroundRow[]): number {
  return rows.filter(r => r.status === "running").length
}
