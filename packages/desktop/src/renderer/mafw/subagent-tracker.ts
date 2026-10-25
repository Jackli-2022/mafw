// 子代理 tracker：既有 canonical SSE 事件 → 行状态机的纯 reducer（无 Solid 依赖）。
//
// 语义契约（消费方依赖，勿轻改）：
// - tracker 是全局的（所有父会话的子代理行都在一张表里）；作用域过滤（按
//   activeSessionId 显示、通知范围）由消费方负责；
// - 运行态只信事件：children-snapshot 只补历史行（completed）、不把未知态标
//   running、不回退已有行——保证不出现假活行；
// - 终态只落一次（幂等）：首帧终态生效，后续事件不回退；
// - turn.aborted / session.deleted 也落终态（aborted）——防僵尸行；
// - now 参数仅供测试注入（缺省 Date.now()）。
export type SubagentStatus = "running" | "completed" | "failed" | "aborted"

export interface SubagentRow {
  childID: string
  parentID: string
  depth?: number
  title: string
  agent: string
  status: SubagentStatus
  startedAt: number
  endedAt?: number
}

export type TrackerEvent =
  | { kind: "session-created"; info: { id: string; parentID: string; title?: string; agent?: string; depth?: number } }
  | { kind: "session-updated"; sessionID: string; title: string }
  | { kind: "turn-terminal"; sessionID: string; terminal: "completed" | "failed" | "aborted" }
  | { kind: "session-deleted"; sessionID: string }
  | { kind: "children-snapshot"; parentID: string; children: Array<{ id: string; title?: string; depth?: number; time?: { created?: number; updated?: number } }> }
  | { kind: "child-last-message"; childID: string; message: { role: string; time?: { completed?: number }; error?: unknown } | null }

const DEFAULT_AGENT = "子代理"

/** opencode 子会话标题形如 "<description> @<agent>"；取尾部 @ 段，缺省「子代理」。 */
export function parseAgentFromTitle(title: string): string {
  const paren = /\(@([^\s)]+)\s+subagent\)/i.exec(title)
  if (paren) return paren[1]
  const m = /@([^\s@]+)\s*$/.exec(title)
  return m ? m[1] : DEFAULT_AGENT
}

const byStartedDesc = (a: SubagentRow, b: SubagentRow) => b.startedAt - a.startedAt

export function applySubagentEvent(rows: SubagentRow[], ev: TrackerEvent, now: number = Date.now()): SubagentRow[] {
  switch (ev.kind) {
    case "session-created": {
      const { id, parentID, title, agent, depth } = ev.info
      if (!parentID || rows.some(r => r.childID === id)) return rows
      const t = title ?? ""
      const row: SubagentRow = {
        childID: id,
        parentID,
        depth: typeof depth === "number" ? depth : 1,
        title: t,
        agent: agent || parseAgentFromTitle(t),
        status: "running",
        startedAt: now,
      }
      return [...rows, row].sort(byStartedDesc)
    }
    case "session-updated": {
      return rows.map(r => r.childID === ev.sessionID ? { ...r, title: ev.title, agent: parseAgentFromTitle(ev.title) } : r)
    }
    case "turn-terminal": {
      return rows.map(r => (r.childID === ev.sessionID && r.status === "running")
        ? { ...r, status: ev.terminal, endedAt: now }
        : r)
    }
    case "session-deleted": {
      return rows.map(r => (r.childID === ev.sessionID && r.status === "running")
        ? { ...r, status: "aborted" as const, endedAt: now }
        : r)
    }
    case "children-snapshot": {
      const existing = new Set(rows.map(r => r.childID))
      const added: SubagentRow[] = []
      for (const c of ev.children) {
        if (!c?.id || existing.has(c.id)) continue
        const startedAt = c.time?.created ?? now
        const t = c.title ?? ""
        added.push({
          childID: c.id,
          parentID: ev.parentID,
          depth: typeof c.depth === "number" ? c.depth : 1,
          title: t,
          agent: parseAgentFromTitle(t),
          status: "completed",
          startedAt,
          endedAt: c.time?.updated ?? startedAt,
        })
      }
      if (added.length === 0) return rows
      return [...rows, ...added].sort(byStartedDesc)
    }
    case "child-last-message": {
      const msg = ev.message
      if (!msg || msg.role !== "assistant") return rows
      const completed = msg.time?.completed
      const errName = typeof (msg.error as any)?.name === "string" ? (msg.error as any).name : undefined
      // 中止类错误静默落 aborted（spec §4.5）：即使缺 time.completed 也收敛
      // （opencode 的 abort 消息常无 completed 且被 sealUnfinishedAssistantMessages
      // 才补章——probe 不能依赖它，reviewer Imp2）。
      const aborted = errName === "MessageAbortedError" || errName === "Aborted"
      let terminal: SubagentStatus
      let endedAt: number
      if (aborted) {
        terminal = "aborted"
        endedAt = typeof completed === "number" ? completed : now
      } else if (typeof completed === "number") {
        terminal = msg.error ? "failed" : "completed"
        endedAt = completed
      } else if (msg.error) {
        terminal = "failed"
        endedAt = now
      } else {
        return rows
      }
      return rows.map(r => (r.childID === ev.childID && r.status === "running")
        ? { ...r, status: terminal, endedAt }
        : r)
    }
  }
}

/** 新落终态的行（prev 存在且为 running、next 非 running）；snapshot 补的历史行不算。 */
export function collectNewTerminals(prev: SubagentRow[], next: SubagentRow[]): SubagentRow[] {
  const prevById = new Map(prev.map(r => [r.childID, r]))
  return next.filter(r => r.status !== "running" && prevById.get(r.childID)?.status === "running")
}

/** 任意已追踪的子代理会话（childID）判定——notifyIdle 抑制用。 */
export function isTrackedChildSession(rows: SubagentRow[], sid: string): boolean {
  return rows.some(r => r.childID === sid)
}

/** 需要查最后一条消息自愈的运行中子代理。 */
export function childrenNeedingProbe(rows: SubagentRow[]): string[] {
  return rows.filter(r => r.status === "running").map(r => r.childID)
}
