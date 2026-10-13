import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "mafw.css"), "utf8")

/** 样式契约：session strip 对齐业界 tab 条（Chrome/VS Code/Firefox）——
 *  永不出现可见滚动条；tab 收缩到最小宽后由内滚（滚轮横向化）承接溢出；
 *  溢出时右端 ⋯ 菜单列出全部会话。结构：wrapper（不滚）> scroll（滚）+ 固定按钮。 */
describe("sessionstrip industry-tab contract", () => {
  const strip = css.match(/^\.mafw-sessionstrip\s*\{([^}]*)\}/m)![1]
  const scroll = css.match(/^\.mafw-sessionstrip-scroll\s*\{([^}]*)\}/m)![1]

  test("wrapper 不滚（溢出检测与 ⋯ 按钮定位依赖稳定的 clientWidth）", () => {
    expect(strip).toMatch(/min-width:\s*0/)
    expect(strip).toMatch(/flex:\s*1 1 auto/)
    expect(strip).not.toMatch(/overflow-x/)
  })

  test("scroll 层滚动条隐藏（Firefox scrollbar-width:none + webkit display:none）", () => {
    expect(scroll).toMatch(/scrollbar-width:\s*none/)
    expect(css).toMatch(/\.mafw-sessionstrip-scroll::-webkit-scrollbar\s*\{\s*display:\s*none/)
  })

  test("scroll 层内滚能力 + 只占内容宽（0 1 auto：+ 紧跟末位 tab，Chrome 语义）", () => {
    expect(scroll).toMatch(/overflow-x:\s*auto/)
    expect(scroll).toMatch(/min-width:\s*0/)
    expect(scroll).toMatch(/flex:\s*0 1 auto/)
  })

  test("⋯ 溢出按钮固定不滚、不收缩", () => {
    const btn = css.match(/^\.mafw-session-overflow\s*\{([^}]*)\}/m)![1]
    expect(btn).toMatch(/flex-shrink:\s*0/)
  })

  test("tab 可收缩到最小宽下限（flex-shrink:1 + min-width 地板 ≥96px 保标题可读）", () => {
    const tab = css.match(/^\.mafw-session-tab\s*\{([^}]*)\}/m)![1]
    expect(tab).toMatch(/flex-shrink:\s*1/)
    const min = Number(tab.match(/min-width:\s*(\d+)px/)?.[1])
    // 地板必须盖住固定件（padding20+dot8+close~16+gap12≈56px）+ ≥40px 可读标题
    expect(min).toBeGreaterThanOrEqual(96)
  })

  test("tab 标题是收缩的牺牲位（min-width:0，先挤标题再挤 tab）", () => {
    const title = css.match(/^\.mafw-session-title\s*\{([^}]*)\}/m)![1]
    expect(title).toMatch(/min-width:\s*0/)
    expect(title).toMatch(/text-overflow:\s*ellipsis/)
  })
})
