import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  a1Ref,
  anchorBlockLines,
  describeAnchor,
  jsonPathOf,
  letterboxRect,
  normalizeRect,
} from "./annotation-anchor"

describe("describeAnchor（批注卡标签）", () => {
  test("四类标签", () => {
    assert.equal(describeAnchor({ kind: "cell", ref: "B2", value: "1200" }), "B2")
    assert.equal(describeAnchor({ kind: "jsonPath", path: "$.server.port", valueSummary: "8080" }), "$.server.port")
    assert.equal(describeAnchor({ kind: "region", x: 0.12, y: 0.34, w: 0.2, h: 0.1 }), "区域 12%,34%")
    assert.equal(describeAnchor({ kind: "quote", quote: "这是一段被引用的文字内容" }), "节选「这是一段被引用的文…」")
  })
})

describe("anchorBlockLines（发送文本块位置行）", () => {
  test("quote 带渲染预览标注与引用块", () => {
    const lines = anchorBlockLines("docs/a.md", { kind: "quote", quote: "原文一段" })
    assert.equal(lines[0], "文件 `docs/a.md` 节选（渲染预览）：")
    assert.ok(lines.includes("> 原文一段"))
  })
  test("jsonPath 带路径与当前值", () => {
    const lines = anchorBlockLines("config.json", { kind: "jsonPath", path: "$.server.port", valueSummary: "8080" })
    assert.deepEqual(lines, ["文件 `config.json` 路径 `$.server.port`（当前值：`8080`）："])
  })
  test("cell 带 sheet（缺省不含工作表段）", () => {
    assert.deepEqual(anchorBlockLines("book.xlsx", { kind: "cell", sheet: "销售", ref: "B2", value: "1200" }), [
      "文件 `book.xlsx` 工作表「销售」单元格 `B2`（当前值：`1200`）：",
    ])
    assert.deepEqual(anchorBlockLines("data.csv", { kind: "cell", ref: "C3", value: "x" }), [
      "文件 `data.csv` 单元格 `C3`（当前值：`x`）：",
    ])
  })
  test("region 带百分比与附件提示；有 slide 带页码", () => {
    assert.deepEqual(anchorBlockLines("a.png", { kind: "region", x: 0.12, y: 0.34, w: 0.2, h: 0.1 }), [
      "图片 `a.png` 区域 (12%, 34%, 20%×10%)：截图见附件",
    ])
    assert.deepEqual(anchorBlockLines("deck.pptx", { kind: "region", x: 0, y: 0.5, w: 0, h: 0, slide: 3 }), [
      "文件 `deck.pptx` 第 3 页 (0%, 50%)：",
    ])
  })
})

describe("jsonPathOf", () => {
  test("标识符键 / 数组索引 / 特殊键转义", () => {
    assert.equal(jsonPathOf([]), "$")
    assert.equal(jsonPathOf(["a", "b", 0]), "$.a.b[0]")
    assert.equal(jsonPathOf(["a.b"]), '$."a.b"')
    assert.equal(jsonPathOf(["a b"]), '$."a b"')
    assert.equal(jsonPathOf([0]), "$[0]")
    assert.equal(jsonPathOf(['say "hi"']), '$."say \\"hi\\""')
  })
})

describe("a1Ref", () => {
  test("1-based 行列 → A1", () => {
    assert.equal(a1Ref(1, 1), "A1")
    assert.equal(a1Ref(2, 2), "B2")
    assert.equal(a1Ref(10, 26), "Z10")
    assert.equal(a1Ref(1, 27), "AA1")
    assert.equal(a1Ref(1, 52), "AZ1")
  })
})

describe("normalizeRect", () => {
  test("px → 0-1；反向拖拽归一", () => {
    assert.deepEqual(normalizeRect(10, 20, 110, 70, 200, 100), { x: 0.05, y: 0.2, w: 0.5, h: 0.5 })
    assert.deepEqual(normalizeRect(110, 70, 10, 20, 200, 100), { x: 0.05, y: 0.2, w: 0.5, h: 0.5 })
  })
  test("越界 clamp + 最小尺寸", () => {
    const r = normalizeRect(-10, -10, 150, 50, 200, 100)
    assert.equal(r.x, 0)
    assert.equal(r.y, 0)
    assert.equal(r.w, 0.75)
    assert.equal(r.h, 0.5)
    const tiny = normalizeRect(10, 10, 11, 11, 200, 100)
    assert.equal(tiny.w, 0.005)
    assert.equal(tiny.h, 0.01)
  })
})

describe("letterboxRect（object-fit:contain 渲染盒）", () => {
  test("宽图 → 上下黑边", () => {
    assert.deepEqual(letterboxRect(400, 200, 200, 200), { left: 0, top: 50, w: 200, h: 100 })
  })
  test("高图 → 左右黑边", () => {
    assert.deepEqual(letterboxRect(200, 400, 200, 200), { left: 50, top: 0, w: 100, h: 200 })
  })
  test("同比例 → 全盒", () => {
    assert.deepEqual(letterboxRect(100, 100, 300, 300), { left: 0, top: 0, w: 300, h: 300 })
  })
})
