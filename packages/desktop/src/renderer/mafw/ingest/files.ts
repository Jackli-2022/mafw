// 摄取层：文件 diff 多形状 → MAFW 规范视图（MafwDiff + before/after）。
//
// 渲染层只读 `metadata.files: CanonicalFileDiff[]`（以及会话 diff 数组）。
// 这里吸收 opencode v1/2.1 与 apply_patch 工具的字段命名差异：
// - 2.1 `metadata.files` = FileDiff.Info[]（file/patch/status/additions/deletions）
// - v1 `metadata.filediff`（单对象）/ `metadata.diff`（patch 字符串）
// - apply_patch 条目：filePath|relativePath、type ∈ add/update/delete/move、
//   patch|diff 二选一、before/after、movePath
import type { MafwDiff, MafwDiffStatus } from "@mafw/sdk"

export interface CanonicalFileDiff extends MafwDiff {
  file: string
  additions: number
  deletions: number
  status: MafwDiffStatus
  /** 整文件内容（legacy/full-context patch 使用；可缺省）。 */
  before?: string
  after?: string
  /** apply_patch move 的目标路径。 */
  movePath?: string
}

type ApplyPatchKind = "add" | "update" | "delete" | "move"

function statusOf(value: unknown): MafwDiffStatus | undefined {
  if (value === "add" || value === "added") return "added"
  if (value === "delete" || value === "deleted") return "deleted"
  if (value === "update" || value === "modified") return "modified"
  if (value === "move" || value === "renamed") return "renamed"
  if (value === "unknown") return "unknown"
  return undefined
}

function typeOf(value: unknown): ApplyPatchKind | undefined {
  if (value === "add" || value === "update" || value === "delete" || value === "move") return value
  return undefined
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

/** 单条 file diff（任一历史形状）→ 规范视图；无文件名/无内容时丢弃。 */
export function canonicalFileDiff(raw: unknown, fallbackFile?: string): CanonicalFileDiff | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const file =
    stringOf(value.file) ||
    stringOf(value.relativePath) ||
    stringOf(value.filePath) ||
    fallbackFile
  if (!file) return undefined
  const patch = stringOf(value.patch) ?? stringOf(value.diff)
  const before = stringOf(value.before)
  const after = stringOf(value.after)
  const movePath = stringOf(value.movePath)
  // move 条目可以没有内容（纯重命名）——只有既无内容又非 move 才丢弃。
  if (!patch && before === undefined && after === undefined && !movePath) return undefined
  const status = statusOf(value.status) ?? statusOf(value.type) ?? "modified"
  const additions = numberOrZero(value.additions)
  const deletions = numberOrZero(value.deletions)
  return {
    file,
    ...(patch ? { patch } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    additions,
    deletions,
    status,
    ...(movePath ? { movePath } : {}),
  }
}

function dedupe(files: CanonicalFileDiff[]): CanonicalFileDiff[] {
  const byFile = new Map<string, CanonicalFileDiff>()
  for (const file of files) byFile.set(file.file, file)
  return [...byFile.values()]
}

/**
 * 工具 `state.metadata` → 规范文件列表。
 * 优先级：files[]（数组）→ filediff（单对象）→ diff（patch 字符串 + 输入路径）。
 */
export function canonicalFileDiffList(metadata: unknown, fallbackFile?: string): CanonicalFileDiff[] {
  const value = (metadata ?? {}) as Record<string, unknown>
  const files = value.files
  if (Array.isArray(files)) {
    const normalized = dedupe(
      files
        .map((entry) => canonicalFileDiff(entry, fallbackFile))
        .filter((entry): entry is CanonicalFileDiff => !!entry),
    )
    if (normalized.length > 0) return normalized
  }
  const filediff = value.filediff
  if (filediff && typeof filediff === "object" && !Array.isArray(filediff)) {
    const single = canonicalFileDiff(filediff, fallbackFile)
    if (single) return [single]
  }
  const diff = stringOf(value.diff)
  if (diff && fallbackFile) {
    return [{ file: fallbackFile, patch: diff, additions: 0, deletions: 0, status: "modified" }]
  }
  return []
}
