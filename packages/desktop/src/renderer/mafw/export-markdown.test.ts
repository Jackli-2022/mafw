import { describe, expect, test } from "bun:test"
import { buildSessionMarkdown } from "./export-markdown"

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
