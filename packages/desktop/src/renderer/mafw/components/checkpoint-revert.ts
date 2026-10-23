// Checkpoint 回滚纯逻辑：全 hunk 反转 patch、回滚目标集合、runtime-aware 文案。
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { Checkpoint } from "./checkpoint-model"

export interface RevertPatch {
  file?: string
  patch: string
  hunkIndices: number[]
}

/** 每个有 patch 的文件反转全部 hunk；0 hunk / 空 patch 跳过。 */
export function allHunksPatches(files: FileDiffEntry[]): RevertPatch[] {
  const out: RevertPatch[] = []
  for (const f of files ?? []) {
    const patch = typeof f?.patch === "string" ? f.patch : ""
    if (!patch.trim()) continue
    const count = patch.split("\n").filter((line) => line.startsWith("@@ ")).length
    if (count === 0) continue
    out.push({
      file: f.file,
      patch,
      hunkIndices: Array.from({ length: count }, (_, i) => i),
    })
  }
  return out
}

/** checkpoints 为 newest-first；返回目标行及其所有更新行（目标在最后）。 */
export function checkpointsToRewind(checkpoints: Checkpoint[], targetMessageID: string): Checkpoint[] {
  const idx = checkpoints.findIndex((c) => c.messageID === targetMessageID)
  if (idx < 0) return []
  return checkpoints.slice(0, idx + 1)
}

/** 回滚确认文案：runtime 语义不同，不能写死「可撤销」。 */
export function revertWarning(
  runtimeName: string | undefined,
  undoable: boolean,
  diffApi: boolean,
): string {
  if (runtimeName === "pi") {
    return "pi 回滚保留这条消息、只撤回其后的回复；文件不会回滚，且不可撤销。"
  }
  if (runtimeName === "opencode") {
    return undoable
      ? "撤回这条消息及其后内容；可通过撤销回滚恢复对话。"
      : "opencode 2.1 的回滚会 stage+commit，撤回这条消息及其后内容；不可撤销，请确认已提交/备份。"
  }
  return `当前 runtime 的回滚语义以运行时为准；请确认已备份。${diffApi ? "" : " 当前 runtime 不提供文件回滚。"}`
}
