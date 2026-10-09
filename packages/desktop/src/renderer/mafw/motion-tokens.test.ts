import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "mafw.css"), "utf8")

/** 取 .mafw-shell 基础块（第一个不带 html[] 前缀的 .mafw-shell 规则）到 --font-ui 结束。 */
const shellBlock = css.slice(css.indexOf(".mafw-shell {"), css.indexOf("/* 亮色：手动覆盖"))

describe("v7 semantic motion tokens", () => {
  test("two-tier duration + easing tokens exist with the agreed values", () => {
    expect(shellBlock).toMatch(/--dur-fast:\s*140ms/)
    expect(shellBlock).toMatch(/--dur-surface:\s*280ms/)
    expect(shellBlock).toMatch(/--ease-standard:\s*cubic-bezier\(\.25,0,0,1\)/)
    expect(shellBlock).toMatch(/--ease-surface:\s*cubic-bezier\(\.16,1,\.3,1\)/)
  })

  test("legacy tokens are retained (deprecated aliases)", () => {
    expect(shellBlock).toMatch(/--dur-1:\s*120ms/)
    expect(shellBlock).toMatch(/--ease:\s*cubic-bezier\(\.25,0,0,1\)/)
  })
})

describe("rail column width transition", () => {
  test("shell drives the rail column with an animatable var", () => {
    expect(css).toMatch(/\.mafw-shell\s*\{[^}]*grid-template-columns:\s*var\(--rail-w/)
    expect(css).toMatch(/\.mafw-shell\s*\{[^}]*transition:\s*grid-template-columns\s+var\(--dur-surface\)\s+var\(--ease-surface\)/)
  })
  test("rail column clips overflow so content never reflows mid-animation", () => {
    expect(css).toMatch(/\.mafw-rail-col\s*\{[^}]*overflow:\s*hidden/)
  })
})

describe("dock column width transition", () => {
  test("body animates its grid columns", () => {
    expect(css).toMatch(/\.mafw-body\s*\{[^}]*transition:\s*grid-template-columns\s+var\(--dur-surface\)\s+var\(--ease-surface\)/)
  })
})
