import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")
const sessionTurn = readFileSync(
  join(import.meta.dirname, "../../../../session-ui/src/components/session-turn.tsx"),
  "utf8",
)
const messagePart = readFileSync(
  join(import.meta.dirname, "../../../../session-ui/src/components/message-part.tsx"),
  "utf8",
)

function rule(selector: string) {
  const start = css.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf("}", start))
}

/** 样式契约（2026-11-16，用户裁决 A 案）：
 *  Lore 身份放在 assistant 回复内容里，而不是窗口标题栏：
 *  回复上方一行 `[Lore 头像] Lore · 时间`，正文不缩进；用户消息在气泡下方常显时间。
 *  session-ui 只提供通用 `data-turn-time`，不感知 Lore。 */
describe("chat Lore mark", () => {
  test("assistant 回合上方是 Lore 身份行，正文不再走 28px 左栏", () => {
    const content = rule(
      '.mafw-session-turn-container [data-slot="session-turn-assistant-content"] {',
    )
    expect(content).toMatch(/position:\s*relative/)
    expect(content).toMatch(/padding-top:\s*22px/)
    expect(content).toMatch(/padding-left:\s*0/)
  })

  test("身份行显示 Lore + 通用回合时间，头像 16px 钉在左上", () => {
    const mark = rule(
      '.mafw-session-turn-container [data-slot="session-turn-assistant-content"]::before {',
    )
    expect(mark).toMatch(/content:\s*"Lore"/)
    expect(mark).toMatch(/position:\s*absolute/)
    expect(mark).toMatch(/top:\s*0/)
    expect(mark).toMatch(/height:\s*18px/)
    expect(mark).toMatch(/padding-left:\s*22px/)
    expect(mark).toMatch(/lead-avatar-20\.png/)
    expect(mark).toMatch(/background-size:\s*16px 16px/)

    const withTime = rule(
      '.mafw-session-turn-container [data-slot="session-turn-assistant-content"][data-turn-time]::before {',
    )
    expect(withTime).toMatch(/attr\(data-turn-time\)/)
  })

  test("正文第一段不再叠一次 12px 顶距（身份行下方 4px 起排）", () => {
    const first = rule(
      '.mafw-session-turn-container [data-slot="session-turn-assistant-content"] > [data-component="text-part"]:first-child {',
    )
    expect(first).toMatch(/margin-top:\s*0/)
  })

  test("session-ui 只暴露通用回合时间，不感知 Lore", () => {
    expect(sessionTurn).toContain("data-turn-time={assistantTime() || undefined}")
    expect(sessionTurn).toMatch(/timeStyle:\s*"short"/)
    expect(sessionTurn.toLowerCase()).not.toContain("lore")
    expect(sessionTurn).not.toContain("lead-avatar")
  })

  test("Lore 标记资源存在且只被桌面壳层消费", () => {
    expect(existsSync(join(import.meta.dirname, "assets/lore/lead-avatar-20.png"))).toBe(true)
  })

  test("用户消息时间常显，操作按钮在原位 hover 覆盖时间", () => {
    const copy = rule(
      '.mafw-shell [data-component="user-message"] [data-slot="user-message-copy-wrapper"] {',
    )
    expect(copy).toMatch(/position:\s*relative/)
    expect(copy).toMatch(/opacity:\s*1/)

    const actions = rule(
      '.mafw-shell [data-component="user-message"] [data-slot="user-message-actions"] {',
    )
    expect(actions).toMatch(/position:\s*absolute/)
    expect(actions).toMatch(/right:\s*0/)
    expect(actions).toMatch(/opacity:\s*0/)

    const reveal = rule(
      '.mafw-shell [data-component="user-message"]:hover [data-slot="user-message-actions"] {',
    )
    expect(reveal).toMatch(/opacity:\s*1/)

    const hideTime = rule(
      '.mafw-shell [data-component="user-message"]:hover [data-slot="user-message-meta-wrap"] {',
    )
    expect(hideTime).toMatch(/opacity:\s*0/)

    expect(messagePart).toContain('<span data-slot="user-message-actions">')
    expect(messagePart).toMatch(/when=\{text\(\) \|\| stamp\(\)/)
  })

  test("回合级流程卡 / 审批汇总与回复正文同一条左边界", () => {
    const cards = rule(
      '.mafw-session-turn-container :is(.mafw-turn-cards, .mafw-approval-summary) {',
    )
    expect(cards).toMatch(/padding-left:\s*0/)
  })
})
