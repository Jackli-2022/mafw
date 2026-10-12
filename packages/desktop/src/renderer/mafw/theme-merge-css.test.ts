import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "mafw.css"), "utf8")

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

describe("合并块保留代码块主题令牌", () => {
  test("暗色块", () => {
    expect(dark).toContain("--color-background-stronger: var(--background-stronger)")
    expect(dark).toContain("--syntax-string: #00ceb9")
  })
  test("亮色手动块", () => {
    expect(light).toContain("--syntax-string: #006656")
  })
})
