import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { detectDelimiter, parseCsv } from "./csv-parse"

describe("detectDelimiter", () => {
  test("逗号 / 分号 / 制表符嗅探", () => {
    assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",")
    assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";")
    assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t")
  })
  test("引号内的分隔符不参与嗅探", () => {
    assert.equal(detectDelimiter('name,desc\n"a;b;c;d",x'), ",")
  })
  test("无分隔符 → 默认逗号", () => {
    assert.equal(detectDelimiter("hello world"), ",")
    assert.equal(detectDelimiter(""), ",")
  })
})

describe("parseCsv（RFC4180）", () => {
  test("基本行列", () => {
    const r = parseCsv("a,b\n1,2")
    assert.deepEqual(r.rows, [["a", "b"], ["1", "2"]])
    assert.equal(r.delimiter, ",")
    assert.equal(r.truncated, false)
  })
  test("引号字段 + 转义引号", () => {
    const r = parseCsv('a,"b,c"\n"x""y",z')
    assert.deepEqual(r.rows, [["a", "b,c"], ['x"y', "z"]])
  })
  test("引号内换行保留", () => {
    const r = parseCsv('a,"line1\nline2"')
    assert.deepEqual(r.rows, [["a", "line1\nline2"]])
  })
  test("CRLF 与 BOM", () => {
    const r = parseCsv("\uFEFFa,b\r\n1,2\r\n")
    assert.deepEqual(r.rows, [["a", "b"], ["1", "2"]])
  })
  test("分号/制表符自动嗅探", () => {
    assert.deepEqual(parseCsv("a;b\n1;2").rows, [["a", "b"], ["1", "2"]])
    assert.deepEqual(parseCsv("a\tb\n1\t2").rows, [["a", "b"], ["1", "2"]])
  })
  test("行列不齐原样保留（渲染层补齐）", () => {
    assert.deepEqual(parseCsv("a,b,c\n1,2").rows, [["a", "b", "c"], ["1", "2"]])
  })
  test("空文本 → 空 rows", () => {
    assert.deepEqual(parseCsv("").rows, [])
    assert.deepEqual(parseCsv("\n\n").rows, [])
  })
  test("上限：行/单元格截断标记", () => {
    const r = parseCsv("a,b\n1,2\n3,4", { maxRows: 2, maxCell: 2 })
    assert.equal(r.rows.length, 2)
    assert.equal(r.truncated, true)
    const r2 = parseCsv("abcdef,b\n1,2", { maxCell: 3 })
    assert.equal(r2.rows[0][0], "abc")
    assert.equal(r2.truncated, true)
  })
  test("列上限", () => {
    const r = parseCsv("a,b,c\n1,2,3", { maxCols: 2 })
    assert.deepEqual(r.rows[0], ["a", "b"])
    assert.equal(r.truncated, true)
  })
  test("默认上限存在（防御大文件）", () => {
    const rows = Array.from({ length: 900 }, (_, i) => `r${i},x`).join("\n")
    const r = parseCsv(rows)
    assert.ok(r.rows.length <= 500)
    assert.equal(r.truncated, true)
  })
})
