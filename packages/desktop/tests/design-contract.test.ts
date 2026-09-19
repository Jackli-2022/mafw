import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")

/** 取选择器（首次出现）的规则体；找不到返回空串 */
export function cssBlock(selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) return ""
  const open = css.indexOf("{", start)
  let depth = 1
  let i = open + 1
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++
    if (css[i] === "}") depth--
    i++
  }
  return css.slice(open + 1, i - 1)
}

const dark = cssBlock(".mafw-shell {")
const light = cssBlock('html[data-theme="light"] .mafw-shell')
const sysLight = cssBlock("html:not([data-theme]) .mafw-shell")

const V4_TOKENS = [
  "--bg-inset", "--accent-strong", "--accent-soft", "--accent-border", "--info",
  "--r-sm", "--r-md", "--r-lg", "--r-xl",
  "--dur-1", "--dur-2", "--dur-3", "--dur-4", "--ease",
]
const V3_GUARD = [
  "--bg-base", "--bg-raised", "--bg-overlay", "--bg-float",
  "--accent", "--accent-dim", "--accent-text", "--on-accent",
  "--warning", "--danger", "--danger-dim", "--danger-text",
  "--text-1", "--text-2", "--text-3", "--text-4", "--text-5",
]

describe("token v4 — 暗色默认块", () => {
  test.each(V4_TOKENS)("定义 %s", (t) => expect(dark).toContain(`${t}:`))
})

describe("token v4 — 亮色手动块", () => {
  test.each(V4_TOKENS)("定义 %s", (t) => expect(light).toContain(`${t}:`))
})

describe("token v4 — 亮色跟随系统块", () => {
  test.each(V4_TOKENS)("定义 %s", (t) => expect(sysLight).toContain(`${t}:`))
})

describe("token v3 回归守卫（变量名必须保留）", () => {
  test.each(V3_GUARD)("保留 %s", (t) => expect(dark).toContain(`${t}:`))
})

describe("token v4 — 暗色背景换冷蓝调", () => {
  test("bg-base #09090B", () => expect(dark).toContain("--bg-base: #09090B"))
  test("bg-raised #101014", () => expect(dark).toContain("--bg-raised: #101014"))
  test("bg-overlay #17171D", () => expect(dark).toContain("--bg-overlay: #17171D"))
  test("bg-inset #0D0D10", () => expect(dark).toContain("--bg-inset: #0D0D10"))
})

describe("TabStrip 激活态 v4", () => {
  const sel = '.mafw-shell .mafw-tabstrip [role="tab"][data-selected]'
  test("激活底色 bg-overlay", () => expect(cssBlock(sel)).toContain("background: var(--bg-overlay)"))
  test("2px 底部 accent 指示条", () =>
    expect(cssBlock(sel)).toContain("box-shadow: inset 0 -2px 0 var(--accent)"))
  test("轨迹按钮激活同构", () => {
    const b = cssBlock(".mafw-tabstrip-trajectory.active")
    expect(b).toContain("background: var(--bg-overlay)")
    expect(b).toContain("box-shadow: inset 0 -2px 0 var(--accent)")
  })
})

describe("用户气泡 v4", () => {
  const sel = '[data-color-scheme] body[data-new-layout] .mafw-shell [data-component="user-message"] [data-slot="user-message-text"]'
  test("accent-soft 底 + accent-border 描边", () => {
    const b = cssBlock(sel)
    expect(b).toContain("background: var(--accent-soft)")
    expect(b).toContain("border: 1px solid var(--accent-border)")
  })
  test("圆角 10/10/4/10", () => expect(cssBlock(sel)).toContain("border-radius: 10px 10px 4px 10px"))
})
