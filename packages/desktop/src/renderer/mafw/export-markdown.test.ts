import { describe, expect, test } from "bun:test"
import { buildSessionMarkdown, extractExportTurns } from "./export-markdown"

describe("extractExportTurns（C1 导出/复制共用）", () => {
  test("消息+part 文本拼接、role/time 透传", () => {
    const turns = extractExportTurns([
      { role: "user", text: "你好", id: "m1", time: { created: 123 } },
      { role: "assistant", text: "", id: "m2", parts: [{ type: "text", text: "回答A" }, { type: "reasoning", text: "内部" }] },
    ] as any)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toEqual({ role: "user", text: "你好", time: 123 })
    expect(turns[1].role).toBe("assistant")
    expect(turns[1].text).toContain("回答A")
    expect(turns[1].text).toContain("内部") // 全部 part 文本拼接（导出历史全量口径）
    expect(turns[1].time).toBeUndefined()
  })
  test("空消息数组 → 空数组", () => {
    expect(extractExportTurns([])).toEqual([])
  })
})

describe("session markdown export", () => {
  test("renders header with title and turns in order", () => {
    const md = buildSessionMarkdown({
      title: "重构讨论",
      turns: [
        { role: "user", text: "帮我重构登录" },
        { role: "assistant", text: "好的，方案如下…" },
      ],
    })
    expect(md.startsWith("# 重构讨论")).toBe(true)
    expect(md).toContain("## 你")
    expect(md).toContain("帮我重构登录")
    expect(md).toContain("## Assistant")
    expect(md).toContain("好的，方案如下…")
    expect(md.indexOf("## 你")).toBeLessThan(md.indexOf("## Assistant"))
  })

  test("falls back to a default title", () => {
    const md = buildSessionMarkdown({ title: "", turns: [{ role: "user", text: "hi" }] })
    expect(md.startsWith("# MAFW 会话")).toBe(true)
  })

  test("skips empty turns and escapes nothing exotic", () => {
    const md = buildSessionMarkdown({
      title: "t",
      turns: [
        { role: "user", text: "" },
        { role: "assistant", text: "仅有一条" },
      ],
    })
    expect(md).not.toContain("## 你")
    expect(md).toContain("仅有一条")
  })

  test("includes timestamps as list metadata when present", () => {
    const md = buildSessionMarkdown({
      title: "t",
      turns: [{ role: "user", text: "x", time: 1789300000000 }],
    })
    expect(md).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  test("no turns still yields a valid document", () => {
    const md = buildSessionMarkdown({ title: "空会话", turns: [] })
    expect(md).toContain("# 空会话")
    expect(md).toContain("（空）")
  })
})
