// SSE session.diff 处理器：会话文件变更快照 → shell 的 session_diff store
// （DataProvider 通道，审阅面板数据源）。事件为终态快照（非增量）——直接整体替换。
// 多形状（数组 / {files} / 文件键映射）在摄取层收敛为 MafwDiff[]。
import type { SidHandler, ShellEventDeps } from "../dispatcher"
import { normalizeSessionDiffs } from "../../ingest/diffs"

export interface DiffDeps {
  trace(event: { type?: string }, channel: string): void
  setSessionDiff(sid: string, files: unknown[]): void
}

export const handleDiffEvent: SidHandler = (event, sid, deps) => {
  if (event.type !== "session.diff") return false
  deps.diff.trace(event, "chat:diff")
  deps.diff.setSessionDiff(sid, normalizeSessionDiffs(event.properties?.diff ?? event.diff))
  return true
}
