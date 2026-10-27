// Office 表格抽取（xlsx，2026-10-27 G9）：与 exceljs 解耦的纯逻辑，便于单测上限/截断。
export type SheetTable = { rows: string[][]; truncated: boolean }

type FakeRow = { eachCell(opts: { includeEmpty: boolean }, cb: (cell: { text?: string; value?: unknown }) => void): void }
type FakeWorksheet = { eachRow(opts: { includeEmpty: boolean }, cb: (row: FakeRow) => void): void }

export function extractSheetRows(
  worksheet: FakeWorksheet,
  opts: { maxRows?: number; maxCols?: number } = {},
): SheetTable {
  const maxRows = opts.maxRows ?? 200
  const maxCols = opts.maxCols ?? 50
  const rows: string[][] = []
  let truncated = false
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length >= maxRows) {
      truncated = true
      return
    }
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (cells.length >= maxCols) {
        truncated = true
        return
      }
      const v = cell.text ?? (cell.value === null || cell.value === undefined ? "" : String(cell.value))
      cells.push(v)
    })
    if (cells.length > 0) rows.push(cells)
  })
  return { rows, truncated }
}
