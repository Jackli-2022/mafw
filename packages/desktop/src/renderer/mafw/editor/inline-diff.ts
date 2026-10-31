// 内联 diff 行范围（2026-10-31）：把 unified patch 的 +/- 行映射到 new 侧行号，
// 供 CodeMirror 行装饰（只读视觉提示）与上一处/下一处导航。
//
// 语义：
// - 新增行（+）合并为连续范围；
// - 删除行（-）没有 new 侧位置，标在“删除发生处”的当前行；若该行同时被新增
//   覆盖（普通修改行），只保留新增标记，避免红绿叠加；
// - 只读，不改变文档、不引入 keep/undo 双态（回退仍走审阅面板的 revertDiff）。
import { splitHunks } from "../components/diff-hunks"

export type InlineDiffRange = {
  from: number
  to: number
  kind: "add" | "del"
}

export function inlineDiffRanges(patch: string | null | undefined): InlineDiffRange[] {
  if (!patch) return []
  const { hunks } = splitHunks(patch)
  const out: InlineDiffRange[] = []
  for (const hunk of hunks) {
    let n = hunk.newStart
    let addStart: number | null = null
    let addEnd = 0
    const flushAdd = () => {
      if (addStart === null) return
      out.push({ from: addStart, to: addEnd, kind: "add" })
      addStart = null
    }
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        if (addStart === null) addStart = n
        addEnd = n
        n++
        continue
      }
      flushAdd()
      if (line.startsWith(" ")) { n++; continue }
      if (line.startsWith("-")) {
        // 删除没有 new 侧位置：标在删除发生处（后续新增若覆盖该行会被过滤）
        out.push({ from: n, to: n, kind: "del" })
      }
    }
    flushAdd()
  }

  const adds = out.filter((r) => r.kind === "add")
  const dels = out.filter((r) => r.kind === "del")
    .filter((d) => !adds.some((a) => d.from >= a.from && d.from <= a.to))
  return [...adds, ...dels].sort((a, b) => a.from - b.from || (a.kind === "add" ? -1 : 1))
}
