// T2-1 Task 9: 服务端检查点 → 时间线行纯逻辑（overlay 服务端模式的数据面）。
import type { CheckpointRestoreResult, CheckpointScope, SessionCheckpoint } from "@mafw/sdk"

export interface ServerCheckpointRow {
  checkpoint: SessionCheckpoint
  timeLabel: string
  kindBadge: "自动" | "手动"
  filesAvailable: boolean
  filesLabel: "代码+对话" | "仅对话"
}

function timeLabelOf(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return "时间未知"
  return new Date(t).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** newest-first（服务端已倒序；这里兜底排序并做行映射）。 */
export function toServerRows(checkpoints: SessionCheckpoint[]): ServerCheckpointRow[] {
  return [...(checkpoints ?? [])]
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .map((checkpoint) => {
      const filesAvailable = typeof checkpoint.snapshotTree === "string" && checkpoint.snapshotTree.length > 0
      return {
        checkpoint,
        timeLabel: timeLabelOf(checkpoint.createdAt),
        kindBadge: checkpoint.kind === "manual" ? "手动" : "自动",
        filesAvailable,
        filesLabel: filesAvailable ? "代码+对话" : "仅对话",
      }
    })
}

/** 三态恢复的确认文案（runtime-aware；opencode 2.1 = stage+commit 不可逆）。 */
export function restoreWarning(
  scope: CheckpointScope,
  runtimeName: string | undefined,
  undoable: boolean,
): string {
  if (scope === "session") {
    return "只截断历史（保留到该消息为止），不动文件；opencode 2.1 的 commit 不可逆，请确认已备份。"
  }
  if (scope === "files") {
    return "只回滚文件到该检查点状态，对话保留；若工作区存在回合外手工修改，恢复会整体拒绝（不部分应用）。"
  }
  if (runtimeName === "pi") {
    return "当前 runtime 的「全部」只截断对话，文件不会回滚，且不可撤销。"
  }
  return undoable
    ? "截断历史并回滚文件；可通过撤销回滚恢复对话。"
    : "截断历史并回滚文件；opencode 2.1 的 commit 不可逆，请确认已提交/备份。"
}

/** restore 响应 → overlay 顶部 notice 行；无残留且未降级 → null。 */
export function leftoverNotice(result: CheckpointRestoreResult): string[] | null {
  const lines: string[] = []
  if (result.filesSkipped) {
    lines.push("该检查点没有文件状态，本次仅截断对话（文件未回滚）。")
  }
  const leftovers = result.leftoverUntracked ?? []
  if (leftovers.length > 0) {
    lines.push(`以下 untracked 文件不在该检查点记录中，已保留未删除：${leftovers.join("、")}`)
  }
  return lines.length > 0 ? lines : null
}
