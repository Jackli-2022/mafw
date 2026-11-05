import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")
const sessionTurn = readFileSync(
  join(import.meta.dirname, "../../../../session-ui/src/components/session-turn.tsx"),
  "utf8",
)

/** 样式契约（2026-11-05，用户裁决「Lore = 产品的声音」）：
 *  每个 assistant 回合的开头有一个 16px Lore 圆标，走左侧 28px 留白（Claude 式），
 *  回合内部的工具卡/续写不再重复；标记纯装饰（CSS 伪元素，无 alt/无角色语义）。
 *  只在桌面壳层做，session-ui 结构保持 runtime 中立。 */
describe("chat Lore mark", () => {
  const gutter = css.match(
    /\.mafw-session-turn-container \[data-slot="session-turn-assistant-content"\]\s*\{([^}]*)\}/,
  )?.[1]
  const mark = css.match(
    /\.mafw-session-turn-container \[data-slot="session-turn-assistant-content"\]::before\s*\{([^}]*)\}/,
  )?.[1]

  test("assistant 正文整体让出 28px 左侧留白", () => {
    expect(gutter).toBeDefined()
    expect(gutter).toMatch(/padding-left:\s*28px/)
  })

  test("Lore 标记是 16px 圆形，钉在留白里（绝对定位，不参与 flex 列）", () => {
    expect(mark).toBeDefined()
    expect(mark).toMatch(/content:\s*""/)
    expect(mark).toMatch(/position:\s*absolute/)
    expect(mark).toMatch(/left:\s*0/)
    expect(mark).toMatch(/width:\s*16px/)
    expect(mark).toMatch(/height:\s*16px/)
    expect(mark).toMatch(/border-radius:\s*50%/)
    expect(mark).toMatch(/lead-avatar-20\.png/)
  })

  test("回合以正文开头时，标记对齐第一行文字（而非贴着容器顶）", () => {
    const aligned = css.match(
      /\[data-slot="session-turn-assistant-content"\]:has\(> \[data-component="text-part"\]:first-child\)::before\s*\{([^}]*)\}/,
    )?.[1]
    expect(aligned).toBeDefined()
    expect(aligned).toMatch(/top:\s*18px/)
  })

  test("标记资源存在且只被桌面壳层消费（session-ui 不感知 Lore）", () => {
    expect(existsSync(join(import.meta.dirname, "assets/lore/lead-avatar-20.png"))).toBe(true)
    expect(sessionTurn.toLowerCase()).not.toContain("lore")
    expect(sessionTurn).not.toContain("lead-avatar")
  })

  test("回合级流程卡 / 审批汇总与回复正文同一条左边界", () => {
    const cards = css.match(
      /\.mafw-session-turn-container :is\(\.mafw-turn-cards, \.mafw-approval-summary\)\s*\{([^}]*)\}/,
    )?.[1]
    expect(cards).toBeDefined()
    expect(cards).toMatch(/padding-left:\s*28px/)
  })
})
