import { describe, expect, test } from "bun:test"
import { lineRangeOf, buildAnnotationPrompt } from "./editor-annotation"

describe("lineRangeOf", () => {
  const doc = "l1\nl2\nl3" // 末尾无换行
  test("单行内选区 / 跨行选区 / 零宽 → null", () => {
    expect(lineRangeOf(doc, 0, 2)).toEqual({ startLine: 1, endLine: 1 })
    expect(lineRangeOf(doc, 3, 9)).toEqual({ startLine: 2, endLine: 3 })
    expect(lineRangeOf(doc, 4, 4)).toBeNull()
    expect(lineRangeOf(doc, 6, 8)).toEqual({ startLine: 3, endLine: 3 })
  })
})

describe("buildAnnotationPrompt", () => {
  test("格式逐字钉死（路径+行号+代码块+批注）", () => {
    expect(buildAnnotationPrompt("src/a.ts", 3, 5, "x()\ny()\nz()", "这里为什么要 await？")).toBe([
      "文件 `src/a.ts` 第 3-5 行：",
      "",
      "```",
      "x()",
      "y()",
      "z()",
      "```",
      "",
      "我的批注：这里为什么要 await？",
      "",
      "请结合批注查看这段代码并回应。",
    ].join("\n"))
  })
  test("单行范围不写成 M-N", () => {
    expect(buildAnnotationPrompt("a.ts", 3, 3, "x()", "问")).toContain("第 3 行：")
  })
})
