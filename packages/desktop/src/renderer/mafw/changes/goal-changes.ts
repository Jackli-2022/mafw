// Goal revision 变更集的纯映射与固定 revision 规则。
import type { PodWorktreeDiffFile } from "@mafw/sdk"
import type { FileDiffEntry } from "../components/DiffReviewPanel"
import type { GoalRef } from "./changes-context"

export function toFileDiffEntries(files: readonly PodWorktreeDiffFile[]): FileDiffEntry[] {
  return files.map((file) => ({
    file: file.file,
    patch: file.patch,
    additions: file.additions,
    deletions: file.deletions,
    status: file.status,
  }))
}

export function changeTotals(files: readonly FileDiffEntry[]): {
  files: number
  additions: number
  deletions: number
} {
  return files.reduce<{
    files: number
    additions: number
    deletions: number
  }>(
    (sum, file) => ({
      files: sum.files + 1,
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0),
    }),
    { files: 0, additions: 0, deletions: 0 },
  )
}

export function goalDiffErrorText(status: number | null): string {
  if (status === 404) return "这一版没有可预览的分支"
  if (status === 409) return "分支差异不可读"
  if (status === 503) return "当前 gateway 不支持分支差异预览"
  return "变更集加载失败"
}

export type GoalPin = { displayed: GoalRef | null; newerRevision: number | null }

/** 审 rev N 时后台出了 rev N+1：不静默替换，交给用户点“切换”。 */
export function pinGoalRevision(previous: GoalRef | null, incoming: GoalRef | null): GoalPin {
  if (previous && incoming && previous.goalId === incoming.goalId && incoming.revision > previous.revision) {
    return { displayed: previous, newerRevision: incoming.revision }
  }
  return { displayed: incoming, newerRevision: null }
}
