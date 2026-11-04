import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

/** 样式契约：composer toolbar 靠这些规则保证窄宽不溢出（无法在 bun 里做真实布局，故断言规则存在）。 */
describe("composer toolbar overflow guards", () => {
  test("groups can shrink; the left group clips and the right (send) never shrinks", () => {
    expect(css).toMatch(/\.mafw-composer-left,\s*\.mafw-composer-right\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.mafw-composer-left\s*\{[^}]*overflow:\s*hidden/)
    expect(css).toMatch(/\.mafw-composer-right\s*\{[^}]*flex:\s*0 0 auto/)
  })

  test("tiered container queries hide low-priority items before high-priority ones", () => {
    const tiers = [...css.matchAll(/@container \(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]))
    expect(tiers).toContain(620)
    expect(tiers).toContain(520)
    // 620 档先收上下文 pill（状态指示优先级最低）
    expect(css).toMatch(/@container \(max-width:\s*620px\)\s*\{[^@]*\.mafw-context-pill/)
    // 520 档收掉 ＋（附件/截屏/引用入口在 ⋯ 菜单里仍有）
    expect(css).toMatch(/@container \(max-width:\s*520px\)\s*\{[^@]*\.mafw-composer-attach/)
  })

  test("tier overrides come after the base rules they override (source-order cascade)", () => {
    // 容器查询不提升特异性：同特异性时后写的规则胜出。若基础规则在档位块之后，
    // display:none 会被 base display 覆盖（2026-11-04 冒烟实证：ctx pill 窄窗未隐藏）。
    const tier620 = css.indexOf("@container (max-width: 620px)")
    expect(tier620).toBeGreaterThan(css.indexOf(".mafw-context-pill {"))
    expect(tier620).toBeGreaterThan(css.indexOf(".mafw-composer-meta {"))
  })
})
