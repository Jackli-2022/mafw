// apply_patch 卡片只读规范形：摄取层已把 metadata.files 归一为
// `{file, patch?, before?, after?, additions, deletions, status}`（MafwDiff + 内容）。
// 这里不再识别 filePath/relativePath/type/diff 等历史字段。
import { normalize, type ViewDiff, type ViewDiffStatus } from "./session-diff"

export type ApplyPatchFile = {
  file: string
  status: ViewDiffStatus
  additions: number
  deletions: number
  movePath?: string
  view: ViewDiff
}

function viewStatus(value: unknown): ViewDiffStatus {
  if (value === "added" || value === "deleted" || value === "renamed") {
    return value === "renamed" ? "modified" : value
  }
  return "modified"
}

export function patchFile(raw: unknown): ApplyPatchFile | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return
  const value = raw as Record<string, unknown>
  const file = typeof value.file === "string" ? value.file : undefined
  if (!file) return
  const patch = typeof value.patch === "string" ? value.patch : undefined
  const before = typeof value.before === "string" ? value.before : undefined
  const after = typeof value.after === "string" ? value.after : undefined
  if (!patch && before === undefined && after === undefined && typeof value.movePath !== "string") return
  const additions = typeof value.additions === "number" ? value.additions : 0
  const deletions = typeof value.deletions === "number" ? value.deletions : 0
  return {
    file,
    status: viewStatus(value.status),
    additions,
    deletions,
    ...(typeof value.movePath === "string" ? { movePath: value.movePath } : {}),
    view: normalize({
      file,
      patch,
      before,
      after,
      additions,
      deletions,
      status: value.status as any,
    }),
  }
}

export function patchFiles(raw: unknown): ApplyPatchFile[] {
  if (!Array.isArray(raw)) return []
  return raw.map(patchFile).filter((file): file is ApplyPatchFile => !!file)
}
