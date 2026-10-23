// 后台任务检测：既有 SSE 事件/历史水合数据 → BackgroundEvent（纯函数，无 Solid/DOM）。
//
// 数据契约（opencode v2.1.0 实证 + 源码钉扎，见 docs/research/2026-10-22-background-wire-probe.md）：
// - 出现：工具 part `state.status:"completed"` + `state.metadata.status:"running"`
//   （前台 blocking 的 part 是 state.status:"running"，绝不能误判为后台）；
// - 完成：synthetic 消息 `metadata.source: "shell"|"subagent"`。
//   wire 形状以源码为据，检测写宽容判定（type==="synthetic" 或 缺 role 且
//   metadata.source 存在）——实证未覆盖的字段差异按"完成"方向兜底。
import type { BackgroundEvent, BgType } from "./background-tracker"
import { toolNameOf } from "./tool-part"

const TARGET_TOOLS = new Set(["shell", "subagent", "task"])

function subagentID(metadata: any): string | undefined {
  const value = metadata?.sessionID ?? metadata?.sessionId ?? metadata?.childSessionID
  return typeof value === "string" && value ? value : undefined
}

/** 工具 part → bg-observed；前台/非目标/形状不足 → null。 */
export function detectBackgroundPart(part: any, sessionID: string): BackgroundEvent | null {
  if (!part || part.type !== "tool") return null
  const tool = toolNameOf(part)
  if (!tool || !TARGET_TOOLS.has(tool)) return null
  const state = part.state
  if (state?.status !== "completed" || state?.metadata?.status !== "running") return null
  const type: BgType = tool === "shell" ? "shell" : "subagent"
  const id = type === "shell" ? state.metadata.shellID : subagentID(state.metadata)
  if (typeof id !== "string" || !id) return null
  const label = type === "shell" ? state.input?.command : state.input?.description
  return {
    kind: "bg-observed",
    row: { id, type, sessionID, label: typeof label === "string" ? label : "" },
  }
}

/** synthetic 完成消息 → bg-terminal（宽容判定）；其余 → null。 */
export function detectSyntheticTerminal(info: any, sessionID: string): BackgroundEvent | null {
  if (!info || typeof info !== "object") return null
  const isSynthetic = info.type === "synthetic" || (!info.role && info.metadata?.source)
  if (!isSynthetic) return null
  const md = info.metadata ?? {}
  const source = md.source
  if (source !== "shell" && source !== "subagent") return null
  const id = source === "shell"
    ? (typeof md.shellID === "string" ? md.shellID : md.jobID)
    : md.childID
  if (typeof id !== "string" || !id) return null
  // 失败语义（bundle 实证）：后台命令非零退出走 metadata.exit（不是 state:"error"），
  // signal/timeout 同理——"完成"只留给真正干净的退出。
  const terminal: "completed" | "failed" | "cancelled" =
    md.state === "cancelled" ? "cancelled"
      : md.state === "error" || md.error != null ? "failed"
        : typeof md.exit === "number" && md.exit !== 0 ? "failed"
          : md.signal ? "failed"
            : md.timeout === true ? "failed"
              : "completed"
  const label = md.command ?? md.description ?? info.description
  // 行创建判别（reviewer #13）：后台 shell 完成总带 jobID；用户手动 shell 的 synthetic
  // 没有 jobID——那种只收敛已追踪行，不新建行（防 dock 噪音）。
  const canCreateRow = source === "subagent" || typeof md.jobID === "string"
  const meta = canCreateRow
    ? { type: source, sessionID, label: typeof label === "string" ? label : "" }
    : undefined
  return { kind: "bg-terminal", id, terminal, source: "synthetic", meta }
}

/**
 * 历史水合回放：items=[{info, parts}]（可乱序）→ 按 time.created 升序的事件流。
 * 与 live 事件幂等（tracker 的重复观察/终态不回退规则兜底）。
 */
export function scanHistoryForBackground(items: any[], sessionID: string): BackgroundEvent[] {
  if (!Array.isArray(items)) return []
  const ordered = [...items].sort((a, b) =>
    (a?.info?.time?.created ?? 0) - (b?.info?.time?.created ?? 0))
  const out: BackgroundEvent[] = []
  for (const item of ordered) {
    for (const part of item?.parts ?? []) {
      const ev = detectBackgroundPart(part, sessionID)
      if (ev) out.push(ev)
    }
    const done = detectSyntheticTerminal(item?.info, sessionID)
    if (done) out.push(done)
  }
  return out
}

/** 前台 blocking 工作：最新一条未完成 assistant 消息中 running 的 shell/subagent part。 */
export function findBlockingWork(
  messages: any[],
  parts: Record<string, any[]>,
): Array<{ type: BgType; label: string }> {
  if (!Array.isArray(messages)) return []
  let latest: any = null
  for (const m of messages) {
    if (m?.role === "assistant") latest = m
  }
  if (!latest || typeof latest.time?.completed === "number") return []
  const out: Array<{ type: BgType; label: string }> = []
  for (const part of parts?.[latest.id] ?? []) {
    if (part?.type !== "tool") continue
    const tool = toolNameOf(part)
    if (!tool || !TARGET_TOOLS.has(tool)) continue
    if (part.state?.status !== "running") continue
    const type: BgType = tool === "shell" ? "shell" : "subagent"
    const label = type === "shell" ? part.state?.input?.command : part.state?.input?.description
    out.push({ type, label: typeof label === "string" ? label : "" })
  }
  return out
}
