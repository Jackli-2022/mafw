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

/** 取块内某 token 的 hex 值；找不到返回 null */
export function tokenHex(block: string, name: string): string | null {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))
  return m ? m[1].toUpperCase() : null
}

/** WCAG 相对亮度对比度 */
export function contrastHex(a: string, b: string): number {
  const lum = (hex: string) => {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)!
    const lin = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * lin(parseInt(m[1], 16)) + 0.7152 * lin(parseInt(m[2], 16)) + 0.0722 * lin(parseInt(m[3], 16))
  }
  const [la, lb] = [lum(a), lum(b)]
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

describe("token v5 — 暗色暖纸背景", () => {
  test("bg-base #100F0E", () => expect(dark).toContain("--bg-base: #100F0E"))
  test("bg-raised #161513", () => expect(dark).toContain("--bg-raised: #161513"))
  test("bg-overlay #1D1B18", () => expect(dark).toContain("--bg-overlay: #1D1B18"))
  test("bg-float #252320", () => expect(dark).toContain("--bg-float: #252320"))
  test("bg-inset #12110F", () => expect(dark).toContain("--bg-inset: #12110F"))
})

describe("token v5 — 亮色米纸背景（手动块）", () => {
  test("bg-base #FAF9F5", () => expect(light).toContain("--bg-base: #FAF9F5"))
  test("bg-raised #F3F1EB", () => expect(light).toContain("--bg-raised: #F3F1EB"))
  test("bg-overlay #FFFFFF", () => expect(light).toContain("--bg-overlay: #FFFFFF"))
  test("bg-inset #EFEDE7", () => expect(light).toContain("--bg-inset: #EFEDE7"))
})

describe("token v5 — 亮色系统块与手动块一致", () => {
  test.each(["--bg-base: #FAF9F5", "--bg-raised: #F3F1EB", "--bg-inset: #EFEDE7", "--accent: #17804C"])(
    "系统块含 %s", (s) => expect(sysLight).toContain(s),
  )
})

describe("token v5 — accent 绿重校准", () => {
  test("暗色 accent #4FD388", () => expect(dark).toContain("--accent: #4FD388"))
  test("暗色 accent-strong #67DE9B", () => expect(dark).toContain("--accent-strong: #67DE9B"))
  test("暗色 accent-text #8CE0B1", () => expect(dark).toContain("--accent-text: #8CE0B1"))
  test("暗色 accent alpha 基色 rgb(79,211,136)", () => {
    expect(dark).toContain("rgba(79,211,136,.12)")  // accent-soft
    expect(dark).toContain("rgba(79,211,136,.35)")  // accent-border
    expect(dark).not.toContain("70,220,130")
  })
  test("亮色 accent #17804C", () => expect(light).toContain("--accent: #17804C"))
  test("亮色 accent 对 bg-base 对比度 ≥4.5", () => {
    const accent = tokenHex(light, "--accent")!
    const bg = tokenHex(light, "--bg-base")!
    expect(contrastHex(accent, bg)).toBeGreaterThanOrEqual(4.5)
  })
  test("亮色 accent alpha 基色 rgb(23,128,76)", () => {
    expect(light).toContain("rgba(23,128,76,.10)")
    expect(light).toContain("rgba(23,128,76,.32)")
    expect(light).not.toContain("31,157,90")
  })
})

describe("token v5 — 暖色文字阶", () => {
  test("暗色 text-1 #EDECE9", () => expect(dark).toContain("--text-1: #EDECE9"))
  test("暗色 text-3 #8E8C86", () => expect(dark).toContain("--text-3: #8E8C86"))
  test("亮色 text-1 #1A1917", () => expect(light).toContain("--text-1: #1A1917"))
  test("亮色 text-3 #605D57", () => expect(light).toContain("--text-3: #605D57"))
})

describe("token v5 — v1/v2 兼容覆盖层跟随", () => {
  test("暗色 --background-base #100F0E", () => expect(dark).toContain("--background-base: #100F0E"))
  test("暗色 --v2-background-bg-base #100F0E", () => expect(dark).toContain("--v2-background-bg-base: #100F0E"))
  test("暗色 --v2-background-bg-layer-03 #2E2C27", () => expect(dark).toContain("--v2-background-bg-layer-03: #2E2C27"))
  test("亮色 --background-base #FAF9F5", () => expect(light).toContain("--background-base: #FAF9F5"))
  test("亮色 --v2-background-bg-layer-03 #EAE7E0", () => expect(light).toContain("--v2-background-bg-layer-03: #EAE7E0"))
})

describe("TabStrip 激活态 v4", () => {
  const sel = '.mafw-shell .mafw-tabstrip [role="tab"][data-selected]'
  test("激活底色 bg-overlay", () => expect(cssBlock(sel)).toContain("background: var(--bg-overlay)"))
  test("2px 底部 accent 指示条（::after scaleX 生长，双向可过渡）", () => {
    const after = cssBlock('.mafw-shell .mafw-tabstrip [role="tab"]::after')
    expect(after).toContain("height: 2px")
    expect(after).toContain("background: var(--accent)")
    expect(after).toContain("transform: scaleX(0)")
    expect(after).toContain("transition: transform")
    expect(cssBlock(sel + "::after")).toContain("transform: scaleX(1)")
  })
  test("轨迹按钮激活同构", () => {
    const b = cssBlock(".mafw-tabstrip-trajectory.active")
    expect(b).toContain("background: var(--bg-overlay)")
    expect(cssBlock(".mafw-tabstrip-trajectory.active::after")).toContain("transform: scaleX(1)")
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

describe("Tool part 卡片 v4（紧凑条目）", () => {
  const trig = '.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-trigger"]'
  test("折叠行 22px", () => expect(cssBlock(trig)).toContain("height: 22px"))
  test("折叠行文字 12px", () => expect(cssBlock(trig)).toContain("font-size: 12px"))
  const content = '.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-content"] > *'
  test("输出区透明背景 + 缩进", () => {
    expect(cssBlock(content)).toContain("background: transparent")
    expect(cssBlock(content)).toContain("margin-left: 4px")
  })
})

describe("Composer v4", () => {
  test("聚焦双层柔焦（1px accent-border + 4px accent-soft）", () => {
    const b = cssBlock(".mafw-composer:focus-within")
    expect(b).toContain("border-color: var(--accent-border)")
    expect(b).toContain("box-shadow: 0 0 0 4px var(--accent-soft)")
  })
  test("composer 圆角 r-xl", () => expect(cssBlock(".mafw-composer {")).toContain("border-radius: var(--r-xl)"))
  test("chat 面板圆角 r-xl", () => expect(cssBlock(".mafw-chat {")).toContain("border-radius: var(--r-xl)"))
  test("发送钮 hover 上移 + accent-strong", () => {
    const b = cssBlock('.mafw-composer [data-component="button-v2"].mafw-send:hover:not(.mafw-send-disabled)')
    expect(b).toContain("background: var(--accent-strong)")
    expect(b).toContain("transform: translateY(-1px)")
  })
  test("附件缩略图 20px", () => expect(cssBlock(".mafw-chip-thumb {")).toContain("width: 20px"))
})

describe("Sticky header + phase bar v4", () => {
  test("sticky header 实底 + hairline", () => {
    const b = cssBlock(".mafw-session-titlebar {")
    expect(b).toContain("background: var(--bg-raised)")
    expect(b).toContain("border-bottom: 1px solid var(--border-subtle)")
  })
  test("phase bar 28px", () => expect(cssBlock(".mafw-phase-bar {")).toContain("height: 28px"))
  test("phase dot 4px", () => expect(cssBlock(".mafw-phase-dot {")).toContain("width: 4px"))
})

describe("用量指标行 v4", () => {
  test("指标行 label 12px muted", () => {
    const b = cssBlock(".mafw-usage-row {")
    expect(b).toContain("font-size: 12px")
    expect(b).toContain("color: var(--text-3)")
  })
  test("指标值 13px tabular", () => {
    expect(cssBlock(".mafw-usage-value {")).toContain("font-size: 13px")
    expect(cssBlock(".mafw-usage-value {")).toContain("font-variant-numeric: tabular-nums")
  })
  test("模型条形图绿渐变填充", () =>
    expect(cssBlock(".mafw-usage-model-bar-fill {")).toContain("linear-gradient"))
  test("模型条形图细轨圆角", () => {
    const b = cssBlock(".mafw-usage-model-bar {")
    expect(b).toContain("height: 4px")
    expect(b).toContain("border-radius: 2px")
  })
})

describe("Rail CTA + UsagePill v4", () => {
  test("New session 主 CTA：accent-soft 底 + accent-border 描边", () => {
    const b = cssBlock(".mafw-rail-new-btn {")
    expect(b).toContain("background: var(--accent-soft)")
    expect(b).toContain("border: 1px solid var(--accent-border)")
  })
  test("New session hover 实心绿", () =>
    expect(cssBlock(".mafw-rail-new-btn:hover {")).toContain("background: var(--accent)"))
  test("UsagePill 细线进度条 2px", () =>
    expect(cssBlock(".mafw-usage-pill-progress {")).toContain("height: 2px"))
  test("UsagePill 数字 tabular", () =>
    expect(cssBlock(".mafw-usage-pill {")).toContain("font-variant-numeric: tabular-nums"))
})

describe("PageHeader v4", () => {
  test("页头 flex 两端布局", () => {
    const b = cssBlock(".mafw-page-header {")
    expect(b).toContain("display: flex")
    expect(b).toContain("justify-content: space-between")
  })
  test("副标题 12px muted", () => {
    const b = cssBlock(".mafw-page-subtitle {")
    expect(b).toContain("font-size: 12px")
    expect(b).toContain("color: var(--text-3)")
  })
})

describe("EmptyState v4", () => {
  test("glyph 井 inset 底圆形", () => {
    const b = cssBlock(".mafw-empty-state-glyph {")
    expect(b).toContain("background: var(--bg-inset)")
    expect(b).toContain("border-radius: 50%")
  })
  test("主文案 13px text-2", () => {
    const b = cssBlock(".mafw-empty-state-title {")
    expect(b).toContain("font-size: 13px")
    expect(b).toContain("color: var(--text-2)")
  })
  test("提示 12px text-4", () => {
    const b = cssBlock(".mafw-empty-state-hint {")
    expect(b).toContain("font-size: 12px")
    expect(b).toContain("color: var(--text-4)")
  })
  test("容器居中列", () => {
    const b = cssBlock(".mafw-empty-state {")
    expect(b).toContain("align-items: center")
    expect(b).toContain("padding: 48px 16px")
  })
})

describe("卡片 v4 配方", () => {
  test("mafw-card 顶部内侧高光 + r-lg", () => {
    const b = cssBlock(".mafw-card {")
    expect(b).toContain("inset 0 1px 0 rgba(255,255,255,.03)")
    expect(b).toContain("border-radius: var(--r-lg)")
  })
  test("mafw-card hover 边框提亮", () =>
    expect(cssBlock(".mafw-card:hover {")).toContain("border-color"))
  test("KPI value tabular", () =>
    expect(cssBlock(".mafw-kpi-card .mafw-kpi-value {")).toContain("font-variant-numeric: tabular-nums"))
  test("phase 徽标语义 class", () => {
    expect(cssBlock(".mafw-phase-badge-ok {")).toContain("background: var(--accent-soft)")
    expect(cssBlock(".mafw-phase-badge-fail {")).toContain("background: var(--danger-dim)")
    expect(cssBlock(".mafw-phase-badge-run {")).toContain("background: var(--bg-overlay)")
  })
})

describe("WelcomeHome v4", () => {
  test("标题 text-1 + 字重 600", () => {
    const b = cssBlock(".mafw-welcome-title {")
    expect(b).toContain("color: var(--text-1)")
    expect(b).toContain("font-weight: 600")
  })
  test("区块标题 12px text-3", () => {
    const b = cssBlock(".mafw-welcome-section-title {")
    expect(b).toContain("font-size: 12px")
    expect(b).toContain("color: var(--text-3)")
  })
  test("项目 chip 选中态 v4 信号色（无蓝色回退）", () => {
    const b = cssBlock(".mafw-welcome-project[data-selected]")
    expect(b).toContain("background: var(--accent-soft)")
    expect(b).not.toContain("#7698fd")
  })
})

describe("Rail 尾巴 v4", () => {
  test("切换器 hover 边框", () =>
    expect(cssBlock(".mafw-rail-switcher:hover {")).toContain("border-color: var(--border-subtle)"))
  test("ManagerCard hover 边框提亮", () =>
    expect(cssBlock(".mafw-manager-card:hover {")).toContain("border-color"))
})

describe("动效基建 v4", () => {
  test("reduced-motion 全局压制", () => {
    const i = css.indexOf("@media (prefers-reduced-motion: reduce)")
    expect(i).toBeGreaterThan(0)
    const seg = css.slice(i, i + 700)
    expect(seg).toContain("animation-duration: 0.01ms")
    expect(seg).toContain("transition-duration: 0.01ms")
    expect(seg).toContain("!important")
  })
  test("enter 动画 4px + token", () => {
    const b = cssBlock("@keyframes mafw-enter")
    expect(b).toContain("translateY(4px)")
    expect(cssBlock('.mafw-session-turn-container [data-component="session-turn"]')).toContain("var(--dur-3)")
  })
  test("tab 内容淡入 160ms", () =>
    expect(cssBlock(".mafw-content:not(.mafw-chat-content) > *")).toContain("mafw-fade-in"))
  test("dock 进场 200ms", () =>
    expect(cssBlock(".mafw-right-dock {")).toContain("mafw-dock-in"))
  test("模态 scale 进场", () =>
    expect(cssBlock(".mafw-confirm {")).toContain("mafw-modal-in"))
})

describe("动效 v4.1 — token 纪律与出场动画", () => {
  test("transition 一律走 --dur token（禁裸时长）", () => {
    const raw = css.match(/(?<!-)transition:[^;{}]*[\d.]+m?s/g) || []
    expect(raw).toEqual([])
  })
  test("禁 transition: all", () => {
    const all = css.match(/transition:\s*all[;\s]/g) || []
    expect(all).toEqual([])
  })
  test("picker 有出场态（.closing 淡出下沉）", () => {
    const b = cssBlock(".mafw-picker-pop.closing")
    expect(b).toContain("opacity: 0")
    expect(b).toContain("pointer-events: none")
  })
  test("confirm 有出场态（backdrop 淡出 + 卡片 settle）", () => {
    const b = cssBlock(".mafw-confirm-backdrop.mafw-confirm-out")
    expect(b).toContain("opacity: 0")
    expect(cssBlock(".mafw-confirm-backdrop.mafw-confirm-out .mafw-confirm")).toContain("transform: scale(.98)")
  })
  test("Welcome 入场级联（actions stagger 40ms 步进）", () => {
    expect(cssBlock(".mafw-welcome-title {")).toContain("animation: mafw-enter")
    expect(cssBlock(".mafw-welcome-actions > *")).toContain("animation: mafw-enter")
    expect(cssBlock(".mafw-welcome-actions > *:nth-child(2)")).toContain("animation-delay")
  })
})

describe("Skeleton v4 (v5.3 transform 化)", () => {
  test("shimmer keyframes 走 transform", () =>
    expect(cssBlock("@keyframes mafw-shimmer")).toContain("translateX"))
  test("skeleton 基础类（bg-inset 井）", () => {
    const b = cssBlock(".mafw-skeleton {")
    expect(b).toContain("background: var(--bg-inset)")
    expect(b).toContain("position: relative")
    expect(b).toContain("overflow: hidden")
  })
  test("扫光在 ::after 伪元素上", () =>
    expect(cssBlock(".mafw-skeleton::after")).toContain("animation: mafw-shimmer"))
  test("行组布局", () =>
    expect(cssBlock(".mafw-skeleton-rows {")).toContain("flex-direction: column"))
})

describe("token v5.3 — keyframes 属性纪律", () => {
  const kfBlocks = () => {
    const out: { name: string; body: string }[] = []
    const re = /@keyframes\s+([\w-]+)\s*\{((?:[^{}]|(?:\{[^{}]*\}))*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(css)) !== null) out.push({ name: m[1], body: m[2] })
    return out
  }
  test("全部 keyframes 只动画 opacity/transform", () => {
    const bad = kfBlocks().filter(({ body }) =>
      [...body.matchAll(/([a-z-]+)\s*:/g)]
        .map((x) => x[1])
        .filter((p) => !["from", "to", "opacity", "transform"].includes(p)).length > 0)
    expect(bad.map((b) => b.name)).toEqual([])
  })
  test("无 background-position / height 动画残留", () => {
    const offenders = kfBlocks().filter(({ body }) =>
      body.includes("background-position") || /(?:^|\{|\s|;)height\s*:/.test(body))
    expect(offenders.map((b) => b.name)).toEqual([])
  })
})

describe("token v5.1 — 双字体契约", () => {
  test("暗色块定义 --font-ui（引用 --font-family-sans）", () =>
    expect(dark).toMatch(/--font-ui:\s*var\(--font-family-sans/))
  test("暗色块定义 --font-data（引用 --font-family-mono）", () =>
    expect(dark).toMatch(/--font-data:\s*var\(--font-family-mono/))
  test("亮色块同步定义", () => {
    expect(light).toMatch(/--font-ui:\s*var\(--font-family-sans/)
    expect(light).toMatch(/--font-data:\s*var\(--font-family-mono/)
  })
  test("mafw-shell 应用 --font-ui", () =>
    expect(cssBlock(".mafw-shell {")).toContain("font-family: var(--font-ui)"))
  test("无硬编码 mono 栈（全部走 var(--font-data)）", () => {
    const raw = css.match(/font-family:\s*(ui-monospace|SFMono|monospace\s*;)/g) || []
    expect(raw).toEqual([])
  })
})

describe("token v5.1 — 消息排版", () => {
  test("列宽 720px", () => expect(dark).toContain("--msg-col-width: 720px"))
  test("text-part 内 markdown 16px / 行高 1.7", () => {
    const b = cssBlock('.mafw-shell [data-component="text-part"] [data-component="markdown"]')
    expect(b).toContain("font-size: 16px")
    expect(b).toContain("line-height: 1.7")
  })
})

describe("token v5.2 — 排版节奏（业界对齐）", () => {
  const md = '.mafw-shell [data-component="text-part"] [data-component="markdown"]'
  test("标题刻度大于 16px 正文：h1 20 / h2 17 / h3 16", () => {
    expect(cssBlock(`${md} h1`)).toContain("font-size: 20px")
    expect(cssBlock(`${md} h2`)).toContain("font-size: 17px")
    expect(cssBlock(`${md} h3`)).toContain("font-size: 16px")
  })
  test("段距 16px（≈0.6×行盒）", () => {
    expect(cssBlock(`${md} p`)).toContain("margin-bottom: 16px")
  })
  test("text-part 顶距 12px（不再是 24px 大裂谷）", () => {
    expect(cssBlock('.mafw-shell [data-component="text-part"] {')).toContain("margin-top: 12px")
  })
  test("宽屏列宽封顶 880px（不放 1000/1100）", () => {
    expect(css).not.toContain("--msg-col-width: 1000px")
    expect(css).not.toContain("--msg-col-width: 1100px")
    expect(css).toContain("--msg-col-width: 880px")
  })
})

describe("token v5.1 — streaming 尾光标", () => {
  const cursor = '.mafw-shell [data-component="markdown"][data-streaming="true"] > [data-markdown-block]:last-child > :last-child::after'
  // reduced-motion 块内的同选择器单行规则在前，真正的光标规则跟在 keyframes 之后
  const cursorRule = css.slice(css.indexOf("@keyframes mafw-caret-blink"))
  test("▌ 伪元素存在（accent 色 + blink 动画 1s）", () => {
    expect(cursorRule).toContain('content: "▌"')
    expect(cursorRule).toContain("color: var(--accent)")
    expect(cursorRule).toContain("animation: mafw-caret-blink 1s")
  })
  test("blink keyframes（opacity 0↔1）", () => {
    const b = cssBlock("@keyframes mafw-caret-blink")
    expect(b).toContain("opacity: 1")
    expect(b).toContain("opacity: 0")
  })
  test("reduced-motion 下静态显示", () => {
    const i = css.indexOf("@media (prefers-reduced-motion: reduce)")
    const seg = css.slice(i, i + 1200)
    expect(seg).toContain("mafw-caret-blink")
  })
})

describe("token v5.2 — bento 基建", () => {
  test("4 列 grid + gap", () => {
    const b = cssBlock(".mafw-bento {")
    expect(b).toContain("display: grid")
    expect(b).toContain("grid-template-columns: repeat(4, minmax(0,1fr))")
    expect(b).toContain("gap: 12px")
  })
  test("span 类只允许 1/2/4（anchor = 2x2）", () => {
    expect(cssBlock(".mafw-bento-span-2 {")).toContain("grid-column: span 2")
    expect(cssBlock(".mafw-bento-span-4 {")).toContain("grid-column: span 4")
    expect(cssBlock(".mafw-bento-anchor {")).toContain("grid-row: span 2")
    expect(css).not.toMatch(/grid-column:\s*span 3/)
  })
  test("响应式降级：≤1100px 两列、≤640px 单列", () => {
    expect(css).toContain("@media (max-width: 1100px)")
    expect(css).toContain("@media (max-width: 640px)")
  })
})

describe("token v5.2 — 组件接线", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8")
  test("WelcomeHome 保持居中单列（v4 语义，bento 不用于欢迎页）", () => {
    const b = cssBlock(".mafw-welcome {")
    expect(b).toContain("max-width: 720px")
    expect(b).toContain("align-items: center")
    expect(read("src/renderer/mafw/components/WelcomeHome.tsx")).not.toContain('class="mafw-welcome mafw-bento"')
  })
  test("Dashboard KPI 行接入 bento", () =>
    expect(read("src/renderer/mafw/pages/Dashboard.tsx")).toContain('class="mafw-bento"'))
  test("ChatPane 主区带双栏 hook 属性", () =>
    expect(read("src/renderer/mafw/components/ChatPane.tsx")).toContain('data-layout="chat"'))
  test("ChatPane hook grid 等价转换", () => {
    const b = cssBlock('.mafw-pane[data-layout="chat"] {')
    expect(b).toContain("grid-template-columns: minmax(0, 1fr)")
    expect(b).toContain("grid-template-rows: minmax(0, 1fr) auto auto")
  })
})

describe("DiffReviewPanel 抽屉化（业界对齐：无全屏遮罩）", () => {
  const panel = cssBlock(".mafw-diff-panel {")
  test("右侧钉边抽屉，不再 inset:0 全屏遮罩", () => {
    expect(panel).toContain("right: 0")
    expect(panel).not.toContain("inset: 0")
  })
  test("宽度 min(720px, 55%)——chat 保持可见", () => {
    expect(panel).toContain("width: min(720px, 55%)")
  })
  test("滑入动画 mafw-drawer-in", () => {
    expect(css).toContain("@keyframes mafw-drawer-in")
    expect(panel).toContain("mafw-drawer-in")
  })
})

describe("DiffReviewPanel 接线", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8")
  test("MafwShell：审阅改动 toggle（再点关闭）", () => {
    const src = read("src/renderer/mafw/MafwShell.tsx")
    expect(src).toContain("setDiffPanelFor(prev => prev === leaf.sid ? null : leaf.sid)")
  })
  test("ChatPane：composer 审阅按钮带改动计数徽标", () => {
    const src = read("src/renderer/mafw/components/ChatPane.tsx")
    expect(src).toContain("mafw-composer-badge")
    expect(src).toContain("diffCount")
  })
  test("徽标样式存在", () => {
    expect(cssBlock(".mafw-composer-badge {")).toContain("position: absolute")
  })
})
