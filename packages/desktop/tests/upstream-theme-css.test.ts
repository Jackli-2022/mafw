import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// packages/desktop/tests → ../../ = packages/
const uiV1 = readFileSync(join(import.meta.dir, "..", "..", "ui", "src", "styles", "theme.css"), "utf8")
const sessionPart = readFileSync(
  join(import.meta.dir, "..", "..", "session-ui", "src", "components", "message-part.css"),
  "utf8",
)

// 根因（2026-10-12）：v1 主题 token（及 tailwind/colors.css 在 :root 冻结的 280 个
// --color-* 别名）由 OS 级 @media 门控，不响应 app 主题；desktop 的 preload/theme.ts
// 必写 html[data-color-scheme]，故 theme token 必须由该属性 app 驱动（v2 已是此模式）。
describe("上游 v1 主题 app 驱动（data-color-scheme）", () => {
  test("不再有 active 的 prefers-color-scheme: dark 块", () => {
    expect(uiV1).not.toMatch(/^\s*@media \(prefers-color-scheme: dark\)/m)
  })
  test("暗色 token 由 [data-color-scheme=\"dark\"] 门控", () => {
    expect(uiV1).toContain('[data-color-scheme="dark"]')
    expect(uiV1).toMatch(/\[data-color-scheme="dark"\][\s\S]{0,6000}--text-weak:/)
  })
})

describe("session-ui 主题相关 OS media 亦 app 驱动", () => {
  test("message-part.css 无 active prefers-color-scheme 块", () => {
    expect(sessionPart).not.toMatch(/^\s*@media \(prefers-color-scheme: dark\)/m)
  })
})
