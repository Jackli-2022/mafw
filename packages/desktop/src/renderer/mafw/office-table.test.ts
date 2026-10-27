import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { extractSheetRows } from "./office-table"

const sheet = (grid: (string | null)[][]) => ({
  eachRow(_opts: unknown, cb: (row: any) => void) {
    for (const row of grid) {
      cb({
        eachCell(_o: unknown, cellCb: (cell: any) => void) {
          for (const v of row) cellCb({ text: v === null ? "" : v, value: v })
        },
      })
    }
  },
})

describe("extractSheetRows（XLSX 表格抽取）", () => {
  test("基本行/单元格", () => {
    const r = extractSheetRows(sheet([["a", "b"], ["1", "2"]]))
    assert.deepEqual(r.rows, [["a", "b"], ["1", "2"]])
    assert.equal(r.truncated, false)
  })
  test("行/列上限 + 截断标记", () => {
    const grid = Array.from({ length: 5 }, (_, i) => Array.from({ length: 4 }, (_, j) => `${i}-${j}`))
    const r = extractSheetRows(sheet(grid), { maxRows: 2, maxCols: 2 })
    assert.deepEqual(r.rows, [["0-0", "0-1"], ["1-0", "1-1"]])
    assert.equal(r.truncated, true)
  })
  test("空单元格走空串", () => {
    const r = extractSheetRows(sheet([["a", null]]))
    assert.deepEqual(r.rows, [["a", ""]])
  })
})
