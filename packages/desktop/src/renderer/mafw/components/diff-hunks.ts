// diff hunk 展示解析（纯函数，desktop 侧）：把 unified diff 的 patch 拆成
// hunk 块供审阅面板逐块勾选。与 gateway 的 invert 逻辑解耦（各自测试）。
// 下标约定：返回数组下标 = 回退请求里的 hunkIndices（0-based）。

export interface DiffHunk {
  header: string
  lines: string[]
  /** 反转前 old 侧行数（header -n,m 的 m，缺省 1） */
  oldCount: number
  /** 反转前 new 侧行数（header +n,m 的 m，缺省 1） */
  newCount: number
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/** 把单个文件的 unified patch 拆为 header + hunks；无 @@ → 空 hunks。 */
export function splitHunks(patch: string): { header: string[]; hunks: DiffHunk[] } {
  const header: string[] = []
  const hunks: DiffHunk[] = []
  if (!patch) return { header, hunks }
  let current: DiffHunk | null = null
  for (const line of patch.split('\n')) {
    const m = HUNK_RE.exec(line)
    if (m) {
      current = {
        header: line,
        lines: [],
        oldCount: m[2] === undefined ? 1 : parseInt(m[2], 10),
        newCount: m[4] === undefined ? 1 : parseInt(m[4], 10),
      }
      hunks.push(current)
      continue
    }
    if (current) current.lines.push(line)
    else header.push(line)
  }
  return { header, hunks }
}

/** hunk 增删行数（+/- 前缀行计数；展示徽标用）。 */
export function hunkStats(lines: string[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.startsWith('+')) added++
    else if (l.startsWith('-')) removed++
  }
  return { added, removed }
}
