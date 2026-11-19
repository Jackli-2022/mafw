// Pure diff-card model shared by the presenter and the body components.
// No Solid hooks and no JSX, so bun/node tests can import it directly.
import type { ToolMeta } from "./tool-presentation"

export interface DiffMetadataFile {
  file: string
  patch?: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
  status?: string
}

/** 摄取层契约：`metadata.files` 已是规范文件 diff 数组（renderer 不再猜形状）。 */
export function canonicalMetadataFiles(metadata: any): DiffMetadataFile[] {
  const files = metadata?.files
  if (!Array.isArray(files)) return []
  return files.filter((f: any) => f && typeof f === "object" && typeof f.file === "string" && f.file)
}

/** Line count for a write body; a trailing newline does not invent a line. */
export function contentLineCount(text: unknown): number {
  if (typeof text !== "string" || text.length === 0) return 0
  let lines = 1
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) lines += 1
  if (text.endsWith("\n")) lines -= 1
  return lines
}

/** Collapsed-row `+N` / `-M`; zero sides stay off the row. */
export function diffMeta(additions: number, deletions: number): ToolMeta[] | undefined {
  const add = Math.max(0, Math.trunc(additions) || 0)
  const del = Math.max(0, Math.trunc(deletions) || 0)
  if (add === 0 && del === 0) return undefined
  const meta: ToolMeta[] = []
  if (add > 0) meta.push({ text: `+${add}`, tone: "ok" })
  if (del > 0) meta.push({ text: `-${del}`, tone: "err" })
  return meta
}
