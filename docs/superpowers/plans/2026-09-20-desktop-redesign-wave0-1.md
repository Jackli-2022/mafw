# Desktop Redesign Wave 0+1（Token v4 + 对话体验）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地设计 spec（docs/superpowers/specs/2026-09-20-desktop-redesign-design.md）的 Wave 0（token v4 基建）与 Wave 1（对话体验重设计）。

**Architecture:** CSS token 层增量升级（v3 变量名全保留，v4 新变量进入 `.mafw-shell` 作用域三块：暗色默认 / `[data-theme="light"]` / `prefers-color-scheme` media）；对话区改动分两类——纯 CSS scoped override（用户气泡/composer/tool 卡/sticky header）与新组件（ThinkingBlock 经 `registerPartComponent("reasoning")` 替换 session-ui 默认渲染）。所有 CSS 关键规则用"设计契约测试"（解析 mafw.css 断言规则存在）锁定，组件逻辑用纯函数单测。

**Tech Stack:** Electron + SolidJS + @mafw/ui（v2 组件）+ @mafw/session-ui + bun test

## Global Constraints

- 工作目录：所有命令在 `packages/desktop` 下执行（除 git 与版本 bump）
- 测试命令：`bun test tests/design-contract.test.ts`（单文件）/ `bun test`（全量）
- **已知基线**：全量 `bun test` = 369 pass / 1 fail（`src/renderer/mafw/voice/silero.test.ts` "subscriber throwing" 是**预先存在**的失败，与本计划无关，不要求修复）
- **v3 token 变量名全部保留**（`--bg-base`/`--accent`/`--warning` 等，v2 token 覆盖层依赖它们）
- mafw.css 行数预算 ≤ 4840 行（现 4209）
- 禁新增运行时依赖；UI 一律 @mafw/ui v2 组件（ButtonV2 + class 覆盖模式），禁止裸 `<button>`/`<input>`/裸 `title`（AGENTS.md §5.10）
- commit 走 conventional commits，scope 用 desktop
- CSS 仅在既有分区注释内改动，保持 `/* ── 分区名 ── */` 结构

---

### Task 1: 设计契约测试 — token v4 层（先写失败测试）

**Files:**
- Create: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Consumes: `src/renderer/mafw/mafw.css`（只读解析）
- Produces: 测试助手 `cssBlock(selector)` 供后续任务复用；V4/V3 token 常量清单

- [ ] **Step 1: 写失败测试**

```ts
// packages/desktop/tests/design-contract.test.ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/design-contract.test.ts`（workdir `packages/desktop`）
Expected: FAIL —— v4 token 断言与背景色断言全部失败（v3 守卫通过）

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/tests/design-contract.test.ts
git commit -m "test(desktop): design-contract token v4 assertions (red)"
```

---

### Task 2: Token v4 实现（暗/亮/media 三块 + v2 覆盖同步）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:2-148`（主题变量层）

**Interfaces:**
- Consumes: Task 1 的测试
- Produces: v4 token（`--bg-inset` `--accent-strong` `--accent-soft` `--accent-border` `--info` `--r-sm/md/lg/xl` `--dur-1..4` `--ease`）供 Task 3-8 使用

- [ ] **Step 1: 暗色块（文件首块 `.mafw-shell {`）改背景值 + 增 token**

把暗色块内四行背景值替换（在 `--bg-base: #070709;` 等行上原地改）：

```css
  --bg-base: #09090B;
  --bg-raised: #101014;
  --bg-overlay: #17171D;
  --bg-float: #1F1F27;
```

在 `--on-accent: #070709;` 行后追加（同缩进两空格）：

```css
  --on-accent: #09090B;
  --bg-inset: #0D0D10;
  --accent-strong: #5CE896;
  --accent-soft: rgba(70,220,130,.12);
  --accent-border: rgba(70,220,130,.35);
  --info: #6CA6F1;
```

（注意 `--on-accent` 原值 `#070709` 同步改为 `#09090B`。）

在暗色块末尾 `--v2-text-text-faint` 行之后、闭合 `}` 之前追加：

```css
  /* v4 尺度 token（radius / motion） */
  --r-sm: 6px;
  --r-md: 8px;
  --r-lg: 10px;
  --r-xl: 14px;
  --dur-1: 120ms;
  --dur-2: 160ms;
  --dur-3: 200ms;
  --dur-4: 240ms;
  --ease: cubic-bezier(.25,0,0,1);
```

暗色块内 v1/v2 覆盖值同步换新背景（原地替换这些行）：

```css
  --background-base: #09090B;
  --background-weak: #101014;
  --background-stronger: #101014;
  --surface-base: #17171D;
  --surface-raised-base: #1F1F27;
  --v2-background-bg-base: #09090B;
  --v2-background-bg-layer-01: #17171D;
  --v2-background-bg-layer-02: #1F1F27;
```

- [ ] **Step 2: 亮色手动块（`html[data-theme="light"] .mafw-shell`）追加 token**

在亮色块 `--on-accent: #FFFFFF;` 行后追加：

```css
  --bg-inset: #F2F2F5;
  --accent-strong: #178048;
  --accent-soft: rgba(31,157,90,.10);
  --accent-border: rgba(31,157,90,.32);
  --info: #3B6FC4;
```

在亮色块末尾（`--v2-text-text-faint: #8E8E96;` 之后、`}` 之前）追加与暗色相同的 `--r-*` / `--dur-*` / `--ease` 组（值完全一致）。

- [ ] **Step 3: 亮色系统跟随块（`@media (prefers-color-scheme: light)` 内）追加同样 token**

在该块的 `--v2-text-text-faint: #8E8E96;` 行后追加：

```css
    --bg-inset: #F2F2F5;
    --accent-strong: #178048;
    --accent-soft: rgba(31,157,90,.10);
    --accent-border: rgba(31,157,90,.32);
    --info: #3B6FC4;
    --r-sm: 6px; --r-md: 8px; --r-lg: 10px; --r-xl: 14px;
    --dur-1: 120ms; --dur-2: 160ms; --dur-3: 200ms; --dur-4: 240ms;
    --ease: cubic-bezier(.25,0,0,1);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/design-contract.test.ts`
Expected: PASS（全部断言）

- [ ] **Step 5: 全量回归 + 行数预算检查**

Run: `bun test`（Expected: 369+44 pass / 1 pre-existing fail）
Run: `Select-String -LiteralPath "src\renderer\mafw\mafw.css" -Pattern '.' | Measure-Object -Line`（预期 < 4840）

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): token v4 — blue-tinted bg scale, accent signal set, radius/motion tokens, dual theme"
```

---

### Task 3: TabStrip 激活态升级

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:360-383`（TabStrip 分区）
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `--bg-overlay`/`--accent` token
- Produces: 无（纯视觉）

- [ ] **Step 1: 追加失败测试**（design-contract.test.ts 末尾）

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/design-contract.test.ts`
Expected: FAIL（新 describe 3 例）

- [ ] **Step 3: 实现** — 替换 `.mafw-shell .mafw-tabstrip [role="tab"][data-selected]` 规则（含 icon 行一并保留）：

```css
.mafw-shell .mafw-tabstrip [role="tab"][data-selected] {
  background: var(--bg-overlay);
  color: var(--text-1);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.mafw-shell .mafw-tabstrip [role="tab"][data-selected] svg { color: var(--accent); }
```

替换 `.mafw-tabstrip-trajectory.active` 规则：

```css
.mafw-tabstrip-trajectory.active {
  background: var(--bg-overlay);
  color: var(--text-1);
  box-shadow: inset 0 -2px 0 var(--accent);
}
```

- [ ] **Step 4: 运行测试确认通过**（`bun test tests/design-contract.test.ts` → PASS）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): tabstrip active state — overlay bg + 2px accent underline"
```

---

### Task 4: 用户消息气泡 accent 化

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:881-891`（scoped session-ui overrides 分区）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("用户气泡 v4", () => {
  const sel = '[data-color-scheme] body[data-new-layout] .mafw-shell [data-component="user-message"] [data-slot="user-message-text"]'
  test("accent-soft 底 + accent-border 描边", () => {
    const b = cssBlock(sel)
    expect(b).toContain("background: var(--accent-soft)")
    expect(b).toContain("border: 1px solid var(--accent-border)")
  })
  test("圆角 10/10/4/10", () => expect(cssBlock(sel)).toContain("border-radius: 10px 10px 4px 10px"))
})
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现** — 替换该规则体：

```css
[data-color-scheme] body[data-new-layout] .mafw-shell [data-component="user-message"] [data-slot="user-message-text"] {
  border-radius: 10px 10px 4px 10px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  padding: 10px 14px;
  font-size: 14px;
  color: var(--text-1);
}
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): user bubble — accent-soft surface with accent border, 10px radius"
```

---

### Task 5: ThinkingBlock 思考折叠组件

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/thinking-label.ts`（纯函数）
- Create: `packages/desktop/src/renderer/mafw/components/ThinkingBlock.tsx`（Solid 组件 + 注册）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（调用注册）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（thinking 样式，加在 scoped session-ui overrides 分区尾部）
- Test: `packages/desktop/tests/thinking-label.test.ts`

**Interfaces:**
- Consumes: `registerPartComponent`（`@mafw/session-ui/message-part`）、`Markdown`（`@mafw/session-ui/markdown`）、`useData`（`@mafw/session-ui/context`）、`readPartText`（`@mafw/session-ui/message-part-text`）
- Produces: `thinkingLabel(opts)` / `thinkingDurationSec(time, now?)`；`registerThinkingBlock()`（幂等，覆盖 `PART_MAPPING["reasoning"]`）

- [ ] **Step 1: 写纯函数失败测试**

```ts
// packages/desktop/tests/thinking-label.test.ts
import { describe, test, expect } from "bun:test"
import { thinkingLabel, thinkingDurationSec } from "../src/renderer/mafw/components/thinking-label"

describe("thinkingLabel", () => {
  test("流式中", () => expect(thinkingLabel({ streaming: true, durationSec: null })).toBe("思考中…"))
  test("完成带时长", () => expect(thinkingLabel({ streaming: false, durationSec: 12 })).toBe("已思考 12s"))
  test("完成无时长", () => expect(thinkingLabel({ streaming: false, durationSec: null })).toBe("已思考"))
})

describe("thinkingDurationSec", () => {
  test("start/end 计算", () => expect(thinkingDurationSec({ start: 1000, end: 13000 })).toBe(12))
  test("未结束用 now", () => expect(thinkingDurationSec({ start: 0 }, 5000)).toBe(5))
  test("缺 start 返回 null", () => expect(thinkingDurationSec(undefined)).toBeNull())
  test("最小 1s", () => expect(thinkingDurationSec({ start: 1000, end: 1200 })).toBe(1))
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/thinking-label.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

```ts
// packages/desktop/src/renderer/mafw/components/thinking-label.ts
export function thinkingLabel(opts: { streaming: boolean; durationSec: number | null }): string {
  if (opts.streaming) return "思考中…"
  if (opts.durationSec == null) return "已思考"
  return `已思考 ${opts.durationSec}s`
}

export function thinkingDurationSec(
  time: { start?: number; end?: number } | undefined,
  now: number = Date.now(),
): number | null {
  if (!time || typeof time.start !== "number") return null
  const end = typeof time.end === "number" ? time.end : now
  return Math.max(1, Math.round((end - time.start) / 1000))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/thinking-label.test.ts` → PASS

- [ ] **Step 5: 实现组件**

```tsx
// packages/desktop/src/renderer/mafw/components/ThinkingBlock.tsx
// @ts-nocheck
import { createMemo, createSignal, Show } from "solid-js"
import { registerPartComponent } from "@mafw/session-ui/message-part"
import { Markdown } from "@mafw/session-ui/markdown"
import { useData } from "@mafw/session-ui/context"
import { readPartText } from "@mafw/session-ui/message-part-text"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { thinkingDurationSec, thinkingLabel } from "./thinking-label"

/** 幂等注册：覆盖 session-ui 默认 reasoning 渲染为 dsh 式可折叠块 */
export function registerThinkingBlock() {
  registerPartComponent("reasoning", ThinkingBlock)
}

export function ThinkingBlock(props: { part: any; message: any }) {
  const data = useData()
  const part = () => props.part
  const streaming = createMemo(
    () => props.message.role === "assistant" && typeof props.message.time?.completed !== "number",
  )
  const text = createMemo(() => readPartText(data.store.part_text_accum_delta, part()))
  const label = createMemo(() =>
    thinkingLabel({ streaming: streaming(), durationSec: thinkingDurationSec(part().time) }),
  )
  const [open, setOpen] = createSignal(false)
  return (
    <Show when={text()}>
      <div class="mafw-thinking">
        <ButtonV2
          variant="ghost"
          class="mafw-thinking-head"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open() ? "true" : "false"}
        >
          <span class="mafw-thinking-glyph" aria-hidden="true">✻</span>
          <span class="mafw-thinking-label">{label()}</span>
          <Show when={!streaming()}>
            <span class="mafw-thinking-caret" aria-hidden="true">{open() ? "▾" : "▸"}</span>
          </Show>
        </ButtonV2>
        <Show when={streaming() || open()}>
          <div class="mafw-thinking-body">
            <Markdown text={text()} cacheKey={part().id} streaming={streaming()} />
          </div>
        </Show>
      </div>
    </Show>
  )
}
```

- [ ] **Step 6: MafwShell 注册**

在 `MafwShell.tsx` 顶部 import 区（`registerMafwToolCards` import 附近）加：

```tsx
import { registerThinkingBlock } from "./components/ThinkingBlock"
```

在组件内 `registerMafwToolCards()` 调用语句（onMount 内，用 grep 定位 `registerMafwToolCards(`）之后紧挨着加：

```tsx
registerThinkingBlock()
```

- [ ] **Step 7: CSS（scoped session-ui overrides 分区尾部，`.mafw-chat-empty` 规则之前插入）**

```css
/* Thinking block (dsh-style collapsible reasoning) */
.mafw-thinking { margin: 2px 0; }
.mafw-thinking .mafw-thinking-head {
  height: 26px;
  padding: 0 4px;
  gap: 6px;
  color: var(--text-4);
  font-size: 12px;
  font-weight: 400;
}
.mafw-thinking .mafw-thinking-head:hover { color: var(--text-2); background: var(--hover); }
.mafw-thinking-glyph { font-size: 11px; color: var(--text-5); }
.mafw-thinking-caret { font-size: 9px; opacity: .7; }
.mafw-thinking-body {
  margin: 2px 0 6px;
  padding: 10px 12px;
  background: var(--bg-inset);
  border-left: 2px solid var(--accent-border);
  border-radius: 0 var(--r-md) var(--r-md) 0;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.55;
}
.mafw-thinking-body p { margin: 0 0 8px; }
.mafw-thinking-body p:last-child { margin-bottom: 0; }
```

- [ ] **Step 8: 全量测试 + typecheck**

Run: `bun test`（Expected: 之前基线 + thinking-label 7 例）
Run: `npm run typecheck`（Expected: 无新增错误）

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/thinking-label.ts packages/desktop/src/renderer/mafw/components/ThinkingBlock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/thinking-label.test.ts
git commit -m "feat(desktop): collapsible thinking block replaces inline reasoning (dsh-style)"
```

---

### Task 6: Tool part 卡片精化（28px 行 + inset 输出井）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:895-910`（scoped session-ui overrides 分区）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("Tool part 卡片 v4", () => {
  const trig = '.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-trigger"]'
  test("折叠行 28px", () => expect(cssBlock(trig)).toContain("height: 28px"))
  test("折叠行文字 12.5px", () => expect(cssBlock(trig)).toContain("font-size: 12.5px"))
  const content = '.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-content"] > *'
  test("输出井 inset 背景", () => expect(cssBlock(content)).toContain("background: var(--bg-inset)"))
})
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现** — 替换 trigger 与 content 规则：

```css
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-trigger"] {
  height: 28px;
  padding: 0 10px;
  color: var(--text-3);
  font-size: 12.5px;
  font-weight: 500;
  transition: color var(--dur-1) var(--ease), background var(--dur-1) var(--ease);
}
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-trigger"]:hover {
  color: var(--text-1);
  background: var(--hover);
}
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-content"] > * {
  border-left: 2px solid var(--border-subtle);
  background: var(--bg-inset);
}
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): tool cards — 28px collapsed row, hover lift, inset output well"
```

---

### Task 7: Composer v4（柔焦/圆角/发送钮微动效）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:983-1180`（InputBar + chips 分区）、`:405-415`（`.mafw-chat` 圆角）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**

1. `.mafw-chat` 规则 `border-radius: 16px;` → `border-radius: var(--r-xl);`
2. `.mafw-composer` 规则 `border-radius: 16px;` → `border-radius: var(--r-xl);`
3. 替换 `.mafw-composer:focus-within` 与 `.mafw-composer-dragging` 的柔焦：

```css
.mafw-composer:focus-within {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.mafw-composer-dragging {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 4px var(--accent-soft);
  background: color-mix(in srgb, var(--accent-dim) 40%, var(--bg-float));
}
```

4. 发送钮：基础规则追加 transition；替换 hover 规则：

```css
.mafw-composer [data-component="button-v2"].mafw-send {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--on-accent);
  border-color: transparent;
  transition: background var(--dur-1) var(--ease), transform var(--dur-1) var(--ease);
}
.mafw-composer [data-component="button-v2"].mafw-send:hover:not(.mafw-send-disabled) {
  background: var(--accent-strong);
  transform: translateY(-1px);
}
```

5. `.mafw-chip-thumb` 的 `width: 18px; height: 18px;` → `width: 20px; height: 20px;`

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): composer v4 — soft dual-ring focus, accent-strong send with micro-lift"
```

---

### Task 8: Sticky header 减负 + Phase bar 降噪

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:648-656`（Sticky Agent header 分区）、`:929-947`（Phase indicator 分区）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("Sticky header + phase bar v4", () => {
  test("sticky header 实底 + hairline", () => {
    const b = cssBlock(".mafw-session-titlebar {")
    expect(b).toContain("background: var(--bg-raised)")
    expect(b).toContain("border-bottom: 1px solid var(--border-subtle)")
  })
  test("phase bar 28px", () => expect(cssBlock(".mafw-phase-bar {")).toContain("height: 28px"))
  test("phase dot 4px", () => expect(cssBlock(".mafw-phase-dot {")).toContain("width: 4px"))
})
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**

替换 `.mafw-session-titlebar`：

```css
.mafw-session-titlebar {
  position: sticky;
  top: 0;
  z-index: 30;
  margin: 0 -32px;
  padding: 8px 32px 10px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-subtle);
}
```

`.mafw-phase-bar` 的 `height: 32px;` → `height: 28px;`；`.mafw-phase-dot` 的 `width: 6px; height: 6px;` → `width: 4px; height: 4px;`

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): sticky header solid bg + hairline, phase bar de-noised"
```

---

### Task 9: 全量验证 + 构建 + 版本 bump

**Files:**
- Modify: `package.json`（根，version 4.12.0 → 4.13.0）

- [ ] **Step 1: 全量测试**

Run: `bun test`（workdir `packages/desktop`）
Expected: 369 + 49(token: 15×3块+4背景值) + 7(thinking) + 3(tabstrip) + 2(bubble) + 3(toolcard) + 5(composer) + 3(header) = 441 pass / 1 pre-existing fail（数字按实际微调，报告新增数=72）

- [ ] **Step 2: Typecheck + 构建**

Run: `npm run typecheck`（packages/desktop）
Run: `npx electron-vite build`（packages/desktop；Expected: exit 0）

- [ ] **Step 3: 版本 bump**

根 `package.json` `"version": "4.12.0"` → `"version": "4.13.0"`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump version 4.13.0 (desktop redesign wave 0+1)"
```

- [ ] **Step 5: 视觉验收（人工门禁）**

请用户 `bun dev` 启动 desktop（或重启已运行实例），然后：

```bash
# 经 mafw_desktop_screenshot 截暗色 + 切亮色各一张
```

检查清单：Tab 激活态指示条 / 用户气泡绿调 / 思考折叠行 / composer 柔焦 / 双主题各查一遍。发现问题记录到 Wave 2 前修复。

- [ ] **Step 6: 交付汇报**

按用户惯例汇报：版本号 + commit 哈希 + 新增测试数 + 全量通过数。

---

## Self-Review 记录

- **Spec 覆盖**：Wave 0（token v4）→ Task 1-2；Wave 1 对话区六项（消息流气泡/思考折叠/tool cards/composer/sticky header/phase bar/TabStrip）→ Task 3-8；验收与版本 → Task 9。spec 中 "part 间 12px" 经评估为 session-ui 内部布局（flex 强改有回归风险）不纳入本波，记录在 Wave 2 重估。
- **占位符扫描**：无 TBD/TODO；所有 CSS/TSX/TS 步骤含完整代码。
- **类型一致性**：`thinkingLabel`/`thinkingDurationSec` 签名在 Task 5 测试与实现一致；`registerThinkingBlock` 与 MafwShell 调用一致；token 名与 Task 3-8 引用一致。
