// 摄取层：会话/回合 diff 多形状 → MafwDiff[]（渲染层只读数组）。
//
// 形状来源：
// - SSE `session.diff`：数组或 `{ [file]: diff }` 映射；
// - `/sessions/:id/diff`：`{ files: [...] }`；
// - message.summary.diffs：数组。
// 统一补 `file` 必填、数值缺省 0、状态折叠到 MAFW 五态。
import type { MafwDiff, MafwDiffStatus } from "@mafw/sdk"

export function canonicalDiffStatus(value: unknown): MafwDiffStatus | undefined {
  if (value === "added" || value === "modified" || value === "deleted" || value === "renamed" || value === "unknown") {
    return value
  }
  if (value === "add" || value === "create" || value === "new") return "added"
  if (value === "delete" || value === "remove") return "deleted"
  if (value === "update" || value === "edit" || value === "change") return "modified"
  if (value === "move") return "renamed"
  return undefined
}

function canonicalDiff(raw: unknown, fallbackFile?: string): MafwDiff | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const file =
    (typeof value.file === "string" && value.file) ||
    (typeof value.path === "string" && value.path) ||
    (typeof value.relativePath === "string" && value.relativePath) ||
    fallbackFile
  if (!file) return undefined
  const patch = typeof value.patch === "string" ? value.patch : undefined
  const status = canonicalDiffStatus(value.status) ?? canonicalDiffStatus(value.type)
  return {
    file,
    ...(patch ? { patch } : {}),
    additions: typeof value.additions === "number" ? value.additions : 0,
    deletions: typeof value.deletions === "number" ? value.deletions : 0,
    ...(status ? { status } : {}),
  }
}

/** 任意 diff 载荷 → 规范数组（未知形状 → []）。 */
export function normalizeSessionDiffs(raw: unknown): MafwDiff[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => canonicalDiff(entry))
      .filter((entry): entry is MafwDiff => !!entry)
  }
  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>
    if (Array.isArray(value.files)) return normalizeSessionDiffs(value.files)
    // `{ [file]: diff }` 映射：file 键作为兜底路径。
    const out: MafwDiff[] = []
    for (const [file, entry] of Object.entries(value)) {
      const diff = canonicalDiff(entry, file)
      if (diff) out.push(diff)
    }
    return out
  }
  return []
}
