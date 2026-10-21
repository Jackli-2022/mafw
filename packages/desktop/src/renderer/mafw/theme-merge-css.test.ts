import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

function block(selector: string): string {
  const i = css.indexOf(selector)
  if (i === -1) return ""
  const open = css.indexOf("{", i)
  let depth = 1
  let j = open + 1
  while (j < css.length && depth > 0) {
    if (css[j] === "{") depth++
    if (css[j] === "}") depth--
    j++
  }
  return css.slice(open + 1, j - 1)
}

const dark = block(".mafw-shell, body {")
const light = block('html[data-theme="light"] .mafw-shell,')
const sysLight = block("html:not([data-theme]) .mafw-shell,")

describe("主题块合并 — 选择器覆盖 shell + body 双作用域", () => {
  test("暗色默认块", () => expect(css).toContain(".mafw-shell, body {"))
  test("亮色手动块", () => {
    expect(css).toContain('html[data-theme="light"] .mafw-shell,')
    expect(css).toContain('html[data-theme="light"] body {')
  })
  test("亮色跟随系统块", () => {
    expect(css).toContain("html:not([data-theme]) .mafw-shell,")
    expect(css).toContain("html:not([data-theme]) body {")
  })
})

describe("主题块合并 — 三主题态 token 键集一致", () => {
  const keys = (b: string) => [...b.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort()
  test("dark == light == sysLight", () => {
    expect(keys(light)).toEqual(keys(dark))
    expect(keys(sysLight)).toEqual(keys(dark))
  })
})

describe("picker-pop token 块已删除（经 Portal 挂 body，从 body 继承同值）", () => {
  test("不存在携带 token 的 picker 规则", () => {
    expect(css).not.toContain(".mafw-picker-pop {\n  color-scheme")
    expect(css).not.toContain('html[data-theme="light"] .mafw-picker-pop')
    expect(css).not.toContain("html:not([data-theme]) .mafw-picker-pop")
  })
})

describe("宽屏消息列覆盖 — 三主题态同宽", () => {
  const wide = block("@media (min-width: 1500px)")
  test("覆盖亮色手动选择器（否则高优先级的亮色主题块 720px 永远压住 880px）", () => {
    expect(wide).toContain('html[data-theme="light"] .mafw-shell')
  })
  test("覆盖亮色跟随系统选择器", () => {
    expect(wide).toContain("html:not([data-theme]) .mafw-shell")
  })
  test("覆盖暗色默认选择器", () => {
    expect(wide).toContain(".mafw-shell")
    expect(wide).toContain("--msg-col-width: 880px")
  })
})

describe("合并块保留代码块主题令牌", () => {
  test("暗色块", () => {
    expect(dark).toContain("--color-background-stronger: var(--background-stronger)")
    expect(dark).toContain("--syntax-string: #00ceb9")
  })
  test("亮色手动块", () => {
    expect(light).toContain("--syntax-string: #006656")
  })
})

describe("悬空 token 兜底别名（值 = 现行 fallback 生效值，零视觉变化）", () => {
  for (const [name, b] of [["暗色", dark], ["亮色手动", light], ["亮色系统", sysLight]] as const) {
    test(`${name}块定义 --text-6 / --success / --border-strong`, () => {
      expect(b).toContain("--text-6: var(--text-5)")
      expect(b).toContain("--success: #3fb950")
      expect(b).toContain("--border-strong: var(--text-5)")
    })
  }
})

describe("悬空引用扫描 — mafw.css 引用的 token 必须有定义", () => {
  test("var(--x) 引用闭集", () => {
    const upstream = [
      "../../../../ui/src/styles/theme.css",
      "../../../../ui/src/styles/tailwind/colors.css",
      "../../../../ui/src/v2/styles/theme.css",
      "../../../../session-ui/src/components/markdown.css",
    ]
      .map((p) => readFileSync(join(import.meta.dirname, p), "utf8"))
      .join("\n")
    const defined = new Set(
      [...(css + "\n" + upstream).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    )
    const referenced = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])
    const missing = [...new Set(referenced.filter((t) => !defined.has(t)))]
    // --border（NoteCard 3831/3832）无 fallback：当前声明失效 → 不渲染边框。
    // 定义它会凭空显示边框（视觉变化），故记债白名单，留后续单独修。
    const allowed = new Set(["--border"])
    expect(missing.filter((t) => !allowed.has(t))).toEqual([])
  })
})
