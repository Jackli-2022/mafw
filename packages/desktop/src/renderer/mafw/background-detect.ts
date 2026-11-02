// 前台 blocking 工作检测（纯函数，无 Solid/DOM）。
//
// 后台作业本身由 gateway 三源 jobs façade + canonical
// `background.job.updated` 提供（desktop 不再解析 tool part 元数据或 synthetic
// 消息推导后台行）。本模块只剩一个职责：找出「当前回合里仍在阻塞等待」的
// shell/subagent 工具，用于 work bar 的「全部转后台」提示。
import { toolNameOf } from "./tool-part"

export type BgType = "shell" | "subagent"

const TARGET_TOOLS = new Set(["shell", "subagent", "task"])

/** 最新一条未完成 assistant 消息中 running 的 shell/subagent part。 */
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
