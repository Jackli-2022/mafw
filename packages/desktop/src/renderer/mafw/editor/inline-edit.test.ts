import { describe, expect, test } from "bun:test"
import { buildInlineEditPrompt } from "./inline-edit"

describe("buildInlineEditPrompt", () => {
  test("pins file, line range, selection, instruction and edit boundaries", () => {
    const prompt = buildInlineEditPrompt({
      rel: "src/parser.ts",
      startLine: 12,
      endLine: 18,
      code: "const x = 1\nreturn x",
      instruction: "改成 async 函数，保持行为不变",
    })
    expect(prompt).toContain("src/parser.ts")
    expect(prompt).toContain("L12")
    expect(prompt).toContain("L18")
    expect(prompt).toContain("const x = 1")
    expect(prompt).toContain("改成 async 函数")
    expect(prompt).toContain("直接修改文件")
    expect(prompt).toContain("不要提交 git")
  })
})
