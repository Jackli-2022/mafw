// CSV/TSV 解析（RFC4180 子集 + 分隔符嗅探，2026-10-27 文件预览增补）。
// 纯函数：引号字段、`""` 转义、引号内换行、CRLF/BOM；带行/列/单元格上限防大文件打爆 DOM。
export type CsvDelimiter = "," | ";" | "\t"

export type CsvParseOptions = {
  maxRows?: number
  maxCols?: number
  maxCell?: number
}

export type CsvParseResult = {
  rows: string[][]
  delimiter: CsvDelimiter
  /** 任一行/列/单元格触发上限 */
  truncated: boolean
}

const DEFAULTS = { maxRows: 500, maxCols: 50, maxCell: 200 }

/** 前 10 行（引号外）计数取最大；全零 → 逗号。 */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 }
  let inQuotes = false
  let lines = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (ch === "\n") {
      lines++
      if (lines >= 10) break
      continue
    }
    if (ch === "," || ch === ";" || ch === "\t") counts[ch]++
  }
  const ordered = (Object.entries(counts) as [CsvDelimiter, number][]).sort((a, b) => b[1] - a[1])
  return ordered[0][1] > 0 ? ordered[0][0] : ","
}

export function parseCsv(text: string, opts: CsvParseOptions = {}): CsvParseResult {
  const maxRows = opts.maxRows ?? DEFAULTS.maxRows
  const maxCols = opts.maxCols ?? DEFAULTS.maxCols
  const maxCell = opts.maxCell ?? DEFAULTS.maxCell
  const src = text.replace(/^\uFEFF/, "")
  const delimiter = detectDelimiter(src)

  const rows: string[][] = []
  let truncated = false
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  const pushCell = () => {
    if (row.length >= maxCols) {
      truncated = true
      cell = ""
      return
    }
    if (cell.length > maxCell) {
      truncated = true
      cell = cell.slice(0, maxCell)
    }
    row.push(cell)
    cell = ""
  }
  const pushRow = () => {
    pushCell()
    if (row.some((c) => c.length > 0)) {
      if (rows.length < maxRows) rows.push(row)
      else truncated = true
    }
    row = []
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      pushCell()
      i++
      continue
    }
    if (ch === "\r") {
      pushRow()
      i += src[i + 1] === "\n" ? 2 : 1
      continue
    }
    if (ch === "\n") {
      pushRow()
      i++
      continue
    }
    cell += ch
    i++
  }
  pushRow()

  return { rows, delimiter, truncated }
}
