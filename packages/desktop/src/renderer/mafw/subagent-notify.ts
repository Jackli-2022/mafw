// 子代理终态通知：应用内 toast 文案（纯逻辑，无 DOM）。
//
// OS 通知只来自事务层（main process 的 presence 轮询：「需要你」+ Goal 结果）。
// 子代理完成属于工作台进度，不再发系统通知；窗口隐藏时用户回来可在
// 「执行 › 子代理」看到结果。
//
// 规则：completed/failed → toast；aborted/其余 → 静默（null）。每个子代理
// 至多一次终态通知由 collectNewTerminals 的「running→终态」转换语义保证。
import type { SubagentRow } from "./subagent-tracker"

export function buildTerminalNotice(row: SubagentRow): string | null {
  if (row.status !== "completed" && row.status !== "failed") return null
  const done = row.status === "completed"
  return `${done ? "子代理完成" : "子代理失败"}：${row.title}`
}
