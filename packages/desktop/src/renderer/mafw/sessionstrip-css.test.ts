import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

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

  test("窄 tab 先藏关闭钮保标题（Chrome 语义，container query）", () => {
    expect(css).toMatch(/^\.mafw-session-tab\s*\{[^}]*container-type:\s*inline-size/m)
    // 窄（≤120px）非活跃 tab：× 消失，标题拿回宽度
    expect(css).toMatch(/@container\s*\(max-width:\s*120px\)\s*\{[^@]*\.mafw-session-tab:not\(\.active\)\s+\.mafw-session-close\s*\{\s*display:\s*none/)
    // 悬停换回 ×（藏圆点）——Chrome 窄 tab 悬停语义
    expect(css).toMatch(/@container\s*\(max-width:\s*120px\)\s*\{[^@]*\.mafw-session-tab:not\(\.active\):hover\s+\.mafw-session-close\s*\{\s*display:\s*flex/)
    expect(css).toMatch(/@container\s*\(max-width:\s*120px\)\s*\{[^@]*\.mafw-session-tab:not\(\.active\):hover\s+\.mafw-agent-dot\s*\{\s*display:\s*none/)
  })

  // 左侧品牌位（2026-10-23，设计裁决 B2：线框暖灰 monogram + 小字标）
  test("品牌位固定不收缩（在滚动层之外，tab 滚动不带走 logo）", () => {
    const brand = css.match(/^\.mafw-sessionstrip-brand\s*\{([^}]*)\}/m)?.[1]
    expect(brand).toBeDefined()
    expect(brand).toMatch(/flex:\s*none/)
    expect(brand).toMatch(/align-items:\s*center/)
    const src = readFileSync(join(import.meta.dirname, "components/SessionStrip.tsx"), "utf8")
    const brandIdx = src.indexOf("mafw-sessionstrip-brand")
    const scrollIdx = src.indexOf("mafw-sessionstrip-scroll")
    expect(brandIdx).toBeGreaterThan(-1)
    expect(brandIdx).toBeLessThan(scrollIdx)
  })

  test("B2 配色走主题 token（暗/亮主题自动适配）：M 与字标暖灰线框", () => {
    const mark = css.match(/^\.mafw-sessionstrip-brand-mark\s*\{([^}]*)\}/m)?.[1]
    expect(mark).toBeDefined()
    expect(mark).toMatch(/border:\s*1\.5px solid var\(--text-2\)/)
    expect(mark).toMatch(/color:\s*var\(--text-2\)/)
    expect(mark).toMatch(/border-radius:\s*5px/)
    const word = css.match(/^\.mafw-sessionstrip-brand-word\s*\{([^}]*)\}/m)?.[1]
    expect(word).toBeDefined()
    expect(word).toMatch(/color:\s*var\(--text-3\)/)
    expect(word).toMatch(/letter-spacing:/)
  })

  // 分段 2：窄窗口只留标志；分段 3：点击回 Welcome
  test("窄窗口（≤900px）隐藏字标，只留 18px 标志", () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)\s*\{[^@]*\.mafw-sessionstrip-brand-word\s*\{\s*display:\s*none/)
  })

  test("点击 logo 回 Welcome 页（SessionStrip onHome → MafwShell setShowWelcome）", () => {
    const strip = readFileSync(join(import.meta.dirname, "components/SessionStrip.tsx"), "utf8")
    expect(strip).toMatch(/onHome/)
    expect(strip).toMatch(/onClick=\{props\.onHome\}/)
    const shell = readFileSync(join(import.meta.dirname, "MafwShell.tsx"), "utf8")
    expect(shell).toMatch(/onHome=\{/)
    expect(shell).toMatch(/setShowWelcome\(true\)/)
  })
})
