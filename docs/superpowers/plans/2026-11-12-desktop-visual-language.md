# Desktop 视觉语言重校准 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在布局冻结的前提下，为 MAFW Desktop 落地一致的配色、控件样式、排印与动效，并修复 `--border`、0.5px 边框和语义色混用。

**Architecture:** 先建立 MAFW Desktop 作用域内的三层 token 与对比度契约，再按边框/表面 → 动作语义 → 排印/图标 → 动效的顺序迁移现有 CSS。v1/v2 只做 Desktop scoped mapping，不改 `@mafw/ui` 公开默认主题；每个任务先改失败测试再改实现。

**Tech Stack:** SolidJS、Electron、CSS custom properties、`bun:test`（Node test shim + `--conditions=browser`）、Monaco、xterm。

**Spec:** `docs/superpowers/specs/2026-11-12-desktop-visual-language-design.md`

## Global Constraints

- 布局冻结：不改栏宽、面板排列、路由、默认视图、响应式断点、组件 API。
- 不新增依赖、字体、动画库或主题通道。
- 不改 `@mafw/ui` 的公开默认主题；视觉覆盖限定在 MAFW Desktop 作用域。
- 深色主方向已批准；不得用大面积渐变、光晕、玻璃拟态制造层级。
- 正常文字/元信息 ≥ 4.5:1；focus 与输入/关键控件 strong 边界 ≥ 3:1。
- 普通分隔线不强制 3:1；只有输入与关键控件使用 strong。
- 动效：80 / 120 / 180 / 220 / 240 / 320ms；同区域最多一个循环状态。
- Desktop 测试命令必须带 `--conditions=browser`；每次交付报告新增测试数与全量通过数。
- 不 push、deploy、release；除非用户另行批准。
- 最终视觉验收保留人工确认，自动截图不能单独宣称通过。

## Review Focus

- **1366 宽与长文本：** 元信息升到 12px 后，项目页、Goal Eval、工具卡和会话条不得新增遮挡或横向溢出。
- **主题一致性：** 亮/暗切换后，v1/v2 菜单、tooltip、dialog、Monaco 选区不得残留反色或旧绿色。
- **动作/成功语义：** 绿色 success 不得被误染成交互蓝；实心确认按钮不得残留 accent 填充 + 白字。
- **数据密度：** 长路径、commit、podId、token 数在 12px mono/tabular 下仍可读、可截断并可完整查看。
- **减少动效：** 流式光标、运行点、phase bar、spinner 在系统 reduced-motion 下不得继续循环。

---

### Task 1: 双主题 token 与对比度契约

**Files:**
- Create: `packages/desktop/src/renderer/mafw/visual-language-css.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:3-311`
- Modify: `packages/desktop/src/renderer/mafw/theme-merge-css.test.ts:77-107`

**Interfaces:**
- Consumes: nothing.
- Produces: 三主题块中的 `--bg-*`、`--text-1..5`、`--accent`、`--action-primary-bg/fg/hover/active`、`--success`、`--success-soft`、`--warning`、`--danger`、`--border`、`--border-strong`、`--hairline`、`--r-*`；后续任务只消费这些 token。

- [ ] **Step 1: 写失败测试**

创建 `visual-language-css.test.ts`，复用 `theme-merge-css.test.ts` 的块解析方式，并加入：

```ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")
function block(selector: string): string { /* copy existing depth-aware helper */ }
function token(b: string, name: string): string {
  return b.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1]?.trim() ?? ""
}
function luminance(hex: string): number { /* sRGB WCAG formula */ }
function contrast(a: string, b: string): number { /* WCAG ratio */ }

const dark = block(".mafw-shell, body {")
const light = block('html[data-theme="light"] .mafw-shell,')
const sysLight = block("html:not([data-theme]) .mafw-shell,")
const themes = [["dark", dark], ["light", light], ["sysLight", sysLight]] as const

describe("visual language tokens", () => {
  test("all themes define action, border and radius semantics", () => {
    for (const [, b] of themes) {
      for (const key of ["--action-primary-bg", "--action-primary-fg", "--action-primary-bg-hover",
        "--action-primary-bg-active", "--border", "--border-strong", "--success", "--success-soft"]) {
        expect(token(b, key)).not.toBe("")
      }
      expect(token(b, "--hairline")).toBe("1px")
    }
  })

  test("approved dark palette", () => {
    expect(token(dark, "--bg-base")).toBe("#111315")
    expect(token(dark, "--accent")).toBe("#9DB4FF")
    expect(token(dark, "--action-primary-bg")).toBe("#E8EAEC")
    expect(token(dark, "--success")).toBe("#6FC79B")
  })

  test("approved light palette", () => {
    expect(token(light, "--bg-base")).toBe("#F6F7F8")
    expect(token(light, "--accent")).toBe("#2B54D8")
    expect(token(light, "--action-primary-bg")).toBe("#202226")
    expect(token(light, "--success")).toBe("#247A4D")
  })

  test("text contrast passes on every surface", () => {
    for (const [, b] of themes) {
      const surfaces = ["--bg-base", "--bg-inset", "--bg-raised", "--bg-overlay", "--bg-float"]
        .map((k) => token(b, k))
      for (const text of ["--text-3", "--text-4", "--text-5"].map((k) => token(b, k))) {
        for (const surface of surfaces) expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test("focus and control boundary meet 3:1", () => {
    for (const [, b] of themes) {
      expect(contrast(token(b, "--accent"), token(b, "--bg-base"))).toBeGreaterThanOrEqual(3)
      expect(contrast(token(b, "--border-strong"), token(b, "--bg-raised"))).toBeGreaterThanOrEqual(3)
    }
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/visual-language-css.test.ts`  
Expected: FAIL；缺少 `--action-primary-*`，亮色 `--bg-base` 仍为 `#FAF9F5`。

- [ ] **Step 3: 按 spec §4–§5 实现 token**

在 `mafw.css` 三个主题块同步写入 spec 的表值，保留现有 token 名称与顺序；新增：

- `--action-primary-bg` / `--action-primary-fg` / `--action-primary-bg-hover` / `--action-primary-bg-active`
- `--success-soft`
- `--border: var(--border-base)`
- `--border-strong` 使用 spec 的 strong 值，不再引用 `--text-5`
- `--hairline: 1px`
- 圆角职责值：`--r-sm: 6px`、`--r-md: 10px`、`--r-lg: 10px`、`--r-xl: 12px`

交互 hover/active：暗色 primary `#D7DBDF/#C6CCD2`，亮色 `#303338/#3C4046`。三主题块键集必须完全一致。

- [ ] **Step 4: 更新旧 token 断言**

`theme-merge-css.test.ts` 的 `success / border-strong` 断言改为按块比较 spec 值；删除 `--border` 白名单，保持悬空引用闭集测试。亮色系统块与手动亮色块值必须相同。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/visual-language-css.test.ts src/renderer/mafw/theme-merge-css.test.ts`  
Expected: PASS，所有 token 与对比度断言通过。

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/theme-merge-css.test.ts packages/desktop/src/renderer/mafw/visual-language-css.test.ts
git commit -m "feat(desktop): establish visual language tokens"
```

---

### Task 2: 边框、圆角、阴影与装饰清理

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/tests/design-contract.test.ts:274-298, 310-327, 379-394, 421-451`
- Modify: `packages/desktop/src/renderer/mafw/visual-language-css.test.ts`
- Modify: `packages/session-ui/src/components/basic-tool.css:173-186`
- Modify: `packages/session-ui/src/components/markdown.css:181`
- Modify: `packages/session-ui/src/components/message-part.css:45,370,967,1004`

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: 1px borders/rings, `r-*` scale, focus/composer visual behavior; no decorative content-card gradient or inset highlight.

- [ ] **Step 1: 追加失败测试**

```ts
test("no subpixel borders or ring shadows remain", () => {
  expect(css).not.toMatch(/(?:border(?:-[a-z]+)?|outline(?:-[a-z]+)?)\s*:[^;{}]*0\.5px/)
  expect(css).not.toMatch(/box-shadow:[^;{}]*0 0 0 (?:0\.5px|\.5px)/)
})

test("composer uses one focus ring and 12px radius", () => {
  const base = block(".mafw-composer {")
  const focus = block(".mafw-composer:focus-within")
  expect(token(base, "border-radius")).toBe("var(--r-xl)")
  expect(focus).toContain("box-shadow: 0 0 0 2px")
  expect(focus).not.toContain("4px")
})

test("core content cards have no decorative gradient or inset highlight", () => {
  expect(block(".mafw-card {")).not.toContain("inset 0 1px 0")
  expect(block(".mafw-usage-model-bar-fill {")).not.toContain("linear-gradient")
})
```

- [ ] **Step 2: 确认失败**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/visual-language-css.test.ts`  
Expected: FAIL；仍有 0.5px、4px composer halo、usage 渐变。

- [ ] **Step 3: 迁移边框/圆角/阴影**

- 将 `mafw.css` 中 55 处字面 `0.5px` 边框/ring 按职责改为 1px；`box-shadow` 内非边框用途逐处判断，不机械改。
- `session-ui` 4 个文件中的 0.5px 边框同步改 1px。
- composer `:focus-within` 改为 2px accent ring，移除 `--composer-halo` 消费和 4px 柔焦。
- 内容卡片移除 inset 高光；浮层保留 spec 阴影。
- `.mafw-usage-model-bar-fill` 及核心进度统一为 `background: var(--success)`；删除核心装饰渐变和 glow。

- [ ] **Step 4: 更新冲突的旧视觉契约**

把 `design-contract.test.ts` 中锁死 0.5px、4px 柔焦、绿渐变、卡片内高光的断言改为本 spec 的 1px、2px ring、solid success、无内高光。只改确实冲突的断言，不删除行为覆盖。

- [ ] **Step 5: 跑定向与全量 Desktop 测试**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/visual-language-css.test.ts tests/design-contract.test.ts`  
Expected: PASS。  
Run: `npm run test:desktop`（仓库根目录）  
Expected: 全量 PASS，0 failed。

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/visual-language-css.test.ts packages/desktop/tests/design-contract.test.ts packages/session-ui/src/components/basic-tool.css packages/session-ui/src/components/markdown.css packages/session-ui/src/components/message-part.css
git commit -m "style(desktop): unify borders, radii and surfaces"
```

---

### Task 3: 主操作、交互与成功的语义分离

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/src/renderer/mafw/visual-language-css.test.ts`
- Modify: `packages/desktop/tests/design-contract.test.ts:264-298, 379-394`

**Interfaces:**
- Consumes: Task 1 action/success/accent tokens.
- Produces: Desktop scoped mapping `--v2-background-bg-contrast = var(--action-primary-bg)` 等；所有 ButtonV2 contrast、send、确认类动作共享主操作视觉；success/selection/focus 分离。

- [ ] **Step 1: 写失败测试**

```ts
test("desktop contrast buttons use action tokens without gradient", () => {
  const b = block('.mafw-shell [data-component="button-v2"][data-variant="contrast"] {')
  expect(b).toContain("background: var(--action-primary-bg)")
  expect(b).toContain("color: var(--action-primary-fg)")
  expect(b).not.toContain("linear-gradient")
  expect(b).not.toContain("text-shadow")
})

test("send and success semantics are distinct", () => {
  expect(block('.mafw-composer [data-component="button-v2"].mafw-send {'))
    .toContain("background: var(--action-primary-bg)")
  expect(block(".mafw-phase-badge-ok {")).toContain("background: var(--success-soft)")
  expect(css).not.toMatch(/var\(--accent-success/)
})

test("desktop maps every v2 state surface to MAFW semantics", () => {
  for (const [, b] of themes) for (const key of [
    "--v2-background-bg-contrast", "--v2-text-text-contrast", "--v2-border-border-base",
    "--v2-border-border-focus", "--v2-state-fg-success", "--v2-state-fg-danger",
    "--v2-icon-icon-base", "--v2-icon-icon-muted",
  ]) expect(token(b, key)).not.toBe("")
})
```

- [ ] **Step 2: 确认失败**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/visual-language-css.test.ts`  
Expected: FAIL；contrast 仍用渐变，send 仍用 accent，v2 映射不全。

- [ ] **Step 3: 实现动作语义**

- 在三个主题块补齐 v2 contrast/border/text/state/icon 映射；v1 只补仍被 MAFW 消费的断链 token。
- 在 `mafw.css` 增加 scoped contrast 按钮规则：solid action background、action foreground、无 gradient/text-shadow、focus 走 accent ring。
- `.mafw-send` 用 action token；disabled 用 `--bg-inset`/`--text-5`。
- 审计 `rg -n "var\\(--accent" mafw.css`：交互/选中/focus/运行保留 accent；成功、通过、完成、success progress 改 `--success`；实心确认动作改 action token。
- `--selection`、`--focus-ring`、`--composer-focus`、`--accent-*` 跟随 accent；Monaco 选区随 `--selection` 变蓝。
- `--composer-halo`、`--glow-accent` 不再被核心控件消费，alias 可保留但值为 `none`/透明。

- [ ] **Step 4: 更新旧“绿色 = 选中”断言**

把 `design-contract` 中 phase ok、welcome selected、user bubble 等断言改为 accent 语义；将成功 badge 改为 success 语义。不要改变布局尺寸断言。

- [ ] **Step 5: 跑测试**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/visual-language-css.test.ts tests/design-contract.test.ts`  
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/visual-language-css.test.ts packages/desktop/tests/design-contract.test.ts
git commit -m "style(desktop): separate action, interaction and success colors"
```

---

### Task 4: 排印、图标与会话 UI 可读性

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/src/renderer/mafw/components/SessionStrip.tsx:188,219`
- Modify: `packages/session-ui/src/{components,v2/components}/*.css` 中列出的 11px/0.5px 元信息
- Modify: `packages/desktop/src/renderer/mafw/visual-language-css.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sessionstrip-css.test.ts`（如断言文本字形）

**Interfaces:**
- Consumes: Task 1–3 tokens.
- Produces: 核心元信息最低 12px；数据文本 mono/tabular；会话关闭/新建使用已注册 SVG 图标。

- [ ] **Step 1: 写失败测试**

```ts
const CORE_META = [
  ".mafw-data-part-badge {", ".mafw-data-part-name {", ".mafw-card-meta {",
  ".mafw-tool-meta-label {", ".mafw-execute-count {", ".mafw-work-chip {",
  ".mafw-work-filter-count {", ".mafw-rw-overview-meta {", ".mafw-rw-overview-label {",
]

test("core metadata is at least 12px", () => {
  for (const selector of CORE_META) {
    const b = block(selector)
    expect(b).not.toBe("")
    expect(b).not.toMatch(/font-size:\s*(?:9|9\.5|10|10\.5|11|11\.5)px/)
  }
})

test("session chrome uses registered icons", () => {
  const src = readFileSync(join(import.meta.dirname, "components", "SessionStrip.tsx"), "utf8")
  expect(src).not.toContain(">✕<")
  expect(src).not.toContain(">+<")
  expect(src).toContain('icon="close"')
  expect(src).toContain('icon="plus"')
})
```

- [ ] **Step 2: 确认失败**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/visual-language-css.test.ts`  
Expected: FAIL；9/9.5/10.5/11px 与字形按钮仍存在。

- [ ] **Step 3: 调整核心排印与图标**

- 将上述核心 selector 的有意义元信息提升到 12px；纯装饰计数可保留更小，但不得承载唯一信息。
- 数据类文本补齐 `font-family: var(--font-data)` 与 `tabular-nums`。
- SessionStrip 关闭/新建改用 `<ButtonV2 icon="close" ...>` / `icon="plus"`，保留原 class、尺寸与 aria-label；若现有 CSS 依赖文本宽度，用图标尺寸替代，不改 tab 高度。
- `session-ui` 中列出的 11px 元信息改 12px；0.5px 在 Task 2 已改 1px。

- [ ] **Step 4: 检查截断与阅读宽度**

对项目 Goal 标题、Goal Eval、工具名/参数、podId/path 增加或确认 `min-width: 0`、`overflow: hidden`、`text-overflow: ellipsis`（单行）或 `overflow-wrap:anywhere`（多行）。不得通过扩大栏宽解决。

- [ ] **Step 5: 跑定向与全量测试**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/visual-language-css.test.ts src/renderer/mafw/sessionstrip-css.test.ts`  
Expected: PASS。  
Run: `npm run test:desktop`  
Expected: 全量 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw packages/session-ui/src
git commit -m "style(desktop): improve metadata type and session icons"
```

---

### Task 5: 动效 token、循环状态与 reduced-motion

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/src/renderer/mafw/motion-tokens.test.ts`
- Modify: `packages/desktop/tests/design-contract.test.ts:421-451`
- Modify: `packages/desktop/src/renderer/mafw/visual-language-css.test.ts`

**Interfaces:**
- Consumes: Task 1–4 tokens/styles.
- Produces: `--dur-press/fast/select/enter/surface/progress`，统一 easing，单一循环状态语言，reduced-motion 全覆盖。

- [ ] **Step 1: 改写失败测试**

在 `motion-tokens.test.ts` 中把旧断言改为：

```ts
test("approved motion tokens", () => {
  expect(shellBlock).toMatch(/--dur-press:\s*80ms/)
  expect(shellBlock).toMatch(/--dur-fast:\s*120ms/)
  expect(shellBlock).toMatch(/--dur-select:\s*180ms/)
  expect(shellBlock).toMatch(/--dur-enter:\s*220ms/)
  expect(shellBlock).toMatch(/--dur-surface:\s*240ms/)
  expect(shellBlock).toMatch(/--dur-progress:\s*320ms/)
  expect(shellBlock).toMatch(/--ease-standard:\s*cubic-bezier\(\.2,\s*\.8,\s*\.2,\s*1\)/)
})
```

在 `visual-language-css.test.ts` 增加：

```ts
test("ready state is static and phase uses one loop", () => {
  expect(block(".mafw-titlebar-dot.ready")).not.toContain("animation")
  expect(block(".mafw-titlebar-dot.ready")).not.toContain("glow-accent")
  expect(block(".mafw-phase-searching .mafw-phase-text")).not.toContain("animation")
})

test("reduced motion stops loops but keeps status text", () => {
  const reduce = block("@media (prefers-reduced-motion: reduce)")
  expect(reduce).toContain("animation-duration: 0.01ms")
  expect(reduce).toContain("animation-iteration-count: 1")
  expect(css).toContain('data-streaming="true"')
})
```

- [ ] **Step 2: 确认失败**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/motion-tokens.test.ts src/renderer/mafw/visual-language-css.test.ts`  
Expected: FAIL；仍为 140/280ms，ready 点仍在呼吸并有 glow。

- [ ] **Step 3: 实现动效 token 与循环纪律**

- 三主题块加入新 duration token；`--dur-1..4` 保留为 120/160/200/240 deprecated alias。
- 标准曲线改为 `cubic-bezier(.2,.8,.2,1)`；surface 进入继续用既有 `--ease-surface`。
- `.mafw-titlebar-dot.ready` 去掉 glow 和 animation；starting/reconnecting 只在真实过渡中使用。
- phase searching 只保留 dot 一个循环，删除 text 的第二循环；writing 点改用 accent，不把成功色用于运行。
- 审查所有 `animation: ... infinite`：只允许真实 running/recording/streaming/voice/waiting 状态；禁止同区域 spinner + shimmer。
- progress width transition 用 `--dur-progress`；hover/press/enter 使用对应 token。
- 更新 `design-contract` 中旧 160/200ms 断言为语义 token 或新的精确值。

- [ ] **Step 4: 跑测试**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/motion-tokens.test.ts src/renderer/mafw/visual-language-css.test.ts tests/design-contract.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/motion-tokens.test.ts packages/desktop/src/renderer/mafw/visual-language-css.test.ts packages/desktop/tests/design-contract.test.ts
git commit -m "style(desktop): unify motion and live-state feedback"
```

---

### Task 6: 真实 Desktop 集成验收与文档

**Files:**
- Modify: `docs/architecture/desktop.md`（视觉系统现状段）
- Create (artifacts, gitignored): `.mafw/qa/visual-language-2026-11-12/*.png`
- Verify only: Monaco/terminal/chat/project/Goal detail

**Interfaces:**
- Consumes: Task 1–5 全部交付。
- Produces: 双主题真实截图、全量门禁结果、人工视觉检查点。

- [ ] **Step 1: 跑完整自动门禁**

Run: `npm run test:desktop`  
Expected: 全量 PASS，记录 passed/failed 数量与新增测试数。  
Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`  
Expected: exit 0。  
Run: `cd packages/desktop && npx electron-vite build`  
Expected: build 成功，无 CSS 错误。

- [ ] **Step 2: 验证真实 Desktop**

通过现有 automation-server 和 GUI：

1. 亮色/暗色各截项目页、Goal 详情、Chat、工作台（Monaco/终端）、至少一个 popover。
2. 至少检查 1366 宽与当前 2560×1380；若环境不能自动 resize，使用现有窗口能力或请用户手动调整，不新增主进程端点。
3. 实测 hover、focus、tab、展开、运行→完成、reduced-motion。
4. 检查长路径、commit、podId、token 数、中文长句；不得横向溢出或文字遮挡。
5. 若 dev CSS 未更新，按 `packages/desktop/AGENTS.md` 执行 `touch` CSS 或重启 `npm run dev`，再重截。

- [ ] **Step 3: 更新架构文档**

在 `docs/architecture/desktop.md` 增加“Visual language”现状段：三层 token、动作/交互/成功分离、1px 边框、12px 元信息、motion token 与 reduced-motion 规则。不要写日期式发布记录；发布记录另放 `docs/releases/`。

- [ ] **Step 4: 自检变更范围**

Run: `git diff --stat`  
Expected: 仅 Desktop、session-ui 视觉 CSS、相关测试、架构文档；`packages/ui/src` 无改动；无布局、路由、gateway、runtime 文件。

Run: `git diff -- packages/desktop/src/renderer/mafw/mafw.css | rg "grid-template-columns|--msg-col-width|width:"`  
Expected: 只出现既有布局行的重排/未改动依据；不得新增布局宽度变更。

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/desktop.md packages/desktop packages/session-ui
git commit -m "docs(desktop): document visual language and verify themes"
```

- [ ] **Step 6: 人工视觉 gate**

向用户展示亮/暗真实截图与新增测试数、全量通过数、commit hash。明确“自动门禁通过，等待人工视觉确认”。用户确认前不得宣称 Wave 4 完成。

---

## Plan Self-Review

- **Spec coverage:** token/对比度（T1）、边框/圆角/阴影/装饰（T2）、动作/交互/成功与 v1/v2 scoped（T3）、排印/图标/session-ui（T4）、动效/reduced-motion（T5）、真实 GUI/文档/人工 gate（T6）。
- **Step scan:** 每步有单一产物或验证命令；未留下 TBD / “适当处理”。
- **Type consistency:** token 名称、selector、测试文件路径前后一致；新增 action tokens 由 T1 产生、T3 消费。
- **Review Focus:** 五项均有 owning test 或 T6 的显式 GUI 检查；长文本溢出在 T4 Step 4/T6 Step 2。
- **Proportion:** 计划只锁定决策、测试和迁移边界；具体 CSS 值引用 spec 表，不转录实现全文。
