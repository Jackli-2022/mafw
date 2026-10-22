// 编辑器 diff 模式判定：当前打开文件是否在会话 diff 中（无 → 「改动」入口隐藏）。
// pi runtime 下 diffs 恒 undefined → 自然降级（Gate Ruling A 惯例）。
import type { FileDiffEntry } from "./components/DiffReviewPanel"

export function diffEntryFor(diffs: FileDiffEntry[] | undefined, rel: string): FileDiffEntry | null {
  return diffs?.find(d => d.file === rel) ?? null
}
