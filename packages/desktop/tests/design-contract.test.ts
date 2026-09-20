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

describe("Tool part 卡片 v4", () => {
  const trig = '.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-trigger"]'
  test("折叠行 28px", () => expect(cssBlock(trig)).toContain("height: 28px"))
  test("折叠行文字 12.5px", () => expect(cssBlock(trig)).toContain("font-size: 12.5px"))
  const content = '.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-content"] > *'
  test("输出井 inset 背景", () => expect(cssBlock(content)).toContain("background: var(--bg-inset)"))
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
