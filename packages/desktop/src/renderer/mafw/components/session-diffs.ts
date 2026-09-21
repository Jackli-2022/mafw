// 会话改动聚合（纯函数）：数据源 = message.summary.diffs（opencode 回合级快照，
// 每条带 patch/additions/deletions/status）。
// 为什么不用 GET session.diff：那是 VCS 当前态，提交后归零；summary.diffs 是历史
// 记录，回答的是"本次会话 agent 改了哪些文件"——也是 chat 回合 diffs 块的原数据源。
// 跨回合同文件后者覆盖前者（patch 以最近回合为准）。
import type { FileDiffEntry } from "./DiffReviewPanel"

export function aggregateSessionDiffs(messages: any[]): FileDiffEntry[] {
  const byFile = new Map<string, FileDiffEntry>()
  for (const m of messages) {
    const diffs = m?.summary?.diffs
    if (!Array.isArray(diffs)) continue
    for (const d of diffs) {
      if (!d || typeof d.file !== "string" || !d.file) continue
      byFile.set(d.file, {
        file: d.file,
        patch: typeof d.patch === "string" ? d.patch : undefined,
        additions: typeof d.additions === "number" ? d.additions : undefined,
        deletions: typeof d.deletions === "number" ? d.deletions : undefined,
        status: typeof d.status === "string" ? d.status : undefined,
      })
    }
  }
  return [...byFile.values()]
}
