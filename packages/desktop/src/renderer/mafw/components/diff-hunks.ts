// diff hunk 展示解析（纯函数，desktop 侧）：把 unified diff 的 patch 拆成
// hunk 块供审阅面板逐块勾选。与 gateway 的 invert 逻辑解耦（各自测试）。
// 下标约定：返回数组下标 = 回退请求里的 hunkIndices（0-based）。

export interface DiffHunk {
  header: string
  lines: string[]
  /** new 侧起始行（header +n 的 n；批注锚点用） */
  newStart: number
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
        newStart: parseInt(m[3], 10),
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

/**
 * 选中文件兜底（两栏抽屉用）：当前选中仍在列表则保留，否则回退第一个；
 * 空列表返回 null。文件标识 = f.file ?? "(unknown)"（与面板 keyed 口径一致）。
 */
export function pickSelectedFile(files: string[], current: string | null): string | null {
  if (files.length === 0) return null
  if (current && files.includes(current)) return current
  return files[0]
}

/**
 * W0-3：hunk 内第 idx 行的 new 侧行号（行级评论锚点）。
 * "+" / " " 行返回 new 侧行号；"-" 行（删除行没有 new 侧位置）与越界返回 null。
 */
export function lineNewNumber(h: DiffHunk, idx: number): number | null {
  if (idx < 0 || idx >= h.lines.length) return null
  let n = h.newStart
  for (let i = 0; i < h.lines.length; i++) {
    const l = h.lines[i]
    if (l.startsWith('-')) continue
    if (i === idx) return n
    n++
  }
  return null
}

/**
 * W0-3：行级评论回喂的 prompt 组装——比 hunk 级更精确，只引用被点击的一行
 * （去 +/- 前缀），让 agent 直接定位到具体行。
 */
export function buildLineCommentPrompt(
  file: string,
  lineNo: number,
  lineText: string,
  comment: string,
): string {
  const code = lineText.replace(/^[+\- ]/, "")
  return [
    `文件 \`${file}\` 第 ${lineNo} 行需要修正：`,
    "",
    "```",
    code,
    "```",
    "",
    `我的意见：${comment}`,
    "",
    "请按上述意见修改该行。",
  ].join("\n")
}

/** 行级评论回喂的 prompt 组装（opencode onLineComment 模式的纯函数核）。
 *  hunk 行数截断 40 行防巨型 prompt；评论原样嵌入。 */
export function buildDiffCommentPrompt(
  file: string,
  hunkHeader: string,
  hunkLines: string[],
  comment: string,
): string {
  const CAP = 40
  const truncated = hunkLines.length > CAP
  const body = hunkLines.slice(0, CAP).join("\n") + (truncated ? "\n…（其余行截断）" : "")
  return [
    `文件 \`${file}\` 的这处改动需要修正：`,
    "",
    "```diff",
    hunkHeader,
    body,
    "```",
    "",
    `我的意见：${comment}`,
    "",
    "请按上述意见修改该文件。",
  ].join("\n")
}
