import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "mafw.css"), "utf8")

/** 样式契约：composer toolbar 靠这些规则保证窄宽不溢出（无法在 bun 里做真实布局，故断言规则存在）。 */
describe("composer toolbar overflow guards", () => {
  test("groups can shrink; the left group clips and the right (send) never shrinks", () => {
    expect(css).toMatch(/\.mafw-composer-left,\s*\.mafw-composer-right\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.mafw-composer-left\s*\{[^}]*overflow:\s*hidden/)
    expect(css).toMatch(/\.mafw-composer-right\s*\{[^}]*flex:\s*0 0 auto/)
  })

  test("tiered container queries hide low-priority items before high-priority ones", () => {
    const tiers = [...css.matchAll(/@container \(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]))
    expect(tiers).toContain(720)
    expect(tiers).toContain(620)
    expect(tiers).toContain(520)
    // 720 档先隐藏次要图标与 meta
    expect(css).toMatch(/@container \(max-width:\s*720px\)\s*\{[^@]*\.mafw-composer-optional/)
    // 520 档收掉上下文 pill
    expect(css).toMatch(/@container \(max-width:\s*520px\)\s*\{[^@]*\.mafw-context-pill/)
  })
})
