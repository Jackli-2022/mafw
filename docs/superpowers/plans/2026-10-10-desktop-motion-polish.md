# MAFW Desktop 动效抛光 v7 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 desktop 已有动效语言收口为两级体系（fast 140ms / surface 280ms），补齐 rail/dock 布局过渡、微交互按压反馈、首帧去抖，且零 spring、纯 CSS transition。

**Architecture:** 先建语义 token 基底（W1），再分别落在布局过渡（W2，新增 `createPresence` 生命周期工具 + grid 列宽过渡）、微交互（W3）、首帧/流式（W4），最后全文迁移错档 usage + 去重 token + 契约测试（W5）。每波独立可测、独立 commit。

**Tech Stack:** SolidJS + Electron 42（Chromium 136）；CSS 自定义属性 + `transition` + `@container`；bun:test（`packages/desktop`，纯逻辑与 CSS 文本契约）；electron-vite 构建。

参考 spec：`docs/superpowers/specs/2026-10-10-desktop-motion-polish-design.md`

## Global Constraints

- **UI 组件**：禁止新增裸 `<button>`/`<input>`/裸 `title`；一律用 `@opencode-ai/ui/v2/*`（`ButtonV2`/`TextInputV2`/`TooltipV2` 等）。`TooltipV2` 用 `value` prop。`ButtonV2` variant ∈ {neutral,danger,contrast,ghost,ghost-muted,loading}，size ∈ {small,normal,large}。
- **动效**：纯 CSS `transition`/`@keyframes`；**禁止** spring、动画库、`--ease-*` 之外的物理曲线。
- **reduced-motion**：`.mafw-shell` 全局降级块（`mafw.css:409`）保持不动，新增动画自动被覆盖。
- **可动画属性**：只动 `width` / `grid-template-columns` / `opacity` / `transform` / 颜色类；禁止动 `height`（除既有 grid-rows 折叠）与 `filter`。
- **令牌**：颜色 token 值不动；`--dur-1..4` / `--ease` 保留为 deprecated 别名。
- **测试/构建门禁**：每 task 后 `cd packages/desktop && bun test`；每 wave 末 `npx electron-vite build` + `npx tsgo -b`。
- **提交**：每 wave 独立 commit；消息格式 `feat(desktop): ...` / `refactor(desktop): ...`；**只 `git add` 本任务的明确文件**，绝不 stage 他人 WIP（当前工作树遗留 `.superpowers/sdd/task-1-brief.md`、`tool-cards/{index.ts,index.test.ts,registered-tools.ts}`）。
- **汇报**：每 wave 末尾记录 新增用例数 + 全量通过数。

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/desktop/src/renderer/mafw/mafw.css` | 动效 token 层 + 所有过渡/动画规则 | 改 |
| `packages/desktop/src/renderer/mafw/components/presence.ts` | 折叠面挂载生命周期（纯逻辑 + Solid 包装） | 新建 |
| `packages/desktop/src/renderer/mafw/components/presence.test.ts` | presence 单测 | 新建 |
| `packages/desktop/src/renderer/mafw/MafwShell.tsx` | rail/dock 挂载 + grid 列宽接线 | 改 |
| `packages/desktop/src/renderer/mafw/chat/turn-enter.ts` | turn 进场门控纯逻辑 | 新建 |
| `packages/desktop/src/renderer/mafw/chat/turn-enter.test.ts` | turn-enter 单测 | 新建 |
| `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` | turn 进场接线 | 改 |
| `packages/desktop/src/renderer/mafw/motion-tokens.test.ts` | token + 过渡 + `:active` 契约测试 | 新建 |

---

## W1 — 语义动效 token 层

### Task 1: 新增语义 motion token + 循环动画建档

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:71-91`（dark 默认 `.mafw-shell` 的 `--r-*`/`--dur-*` 段）
- Test: `packages/desktop/src/renderer/mafw/motion-tokens.test.ts`（新建）

**Interfaces:**
- Produces: CSS 自定义属性 `--dur-fast` (140ms)、`--dur-surface` (280ms)、`--ease-standard` (= `cubic-bezier(.25,0,0,1)`)、`--ease-surface` (= `cubic-bezier(.16,1,.3,1)`)，作用域 `.mafw-shell`，供 W2–W5 全部 task 使用。

- [ ] **Step 1: 写失败测试**

Create `packages/desktop/src/renderer/mafw/motion-tokens.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/motion-tokens.test.ts`
Expected: FAIL（`--dur-fast` 未定义）。

- [ ] **Step 3: 加 token**

在 `mafw.css` 的 `.mafw-shell` dark 块、紧跟 `--ease: cubic-bezier(.25,0,0,1);`（第 80 行）之后插入：

```css
  /* v7 两级动效（fast=微交互 / surface=表面级），无 spring；dur-1..4/ease 为 deprecated 别名 */
  --dur-fast: 140ms;
  --dur-surface: 280ms;
  --ease-standard: cubic-bezier(.25,0,0,1);
  --ease-surface: cubic-bezier(.16,1,.3,1);
  /* 循环动画时长（不属 token 尺度，集中建档）：mafw-breathe 2s|1s · mafw-spin 1s · mafw-think-spin 1.2s
     · mafw-phase-pulse 1.2s|0.8s · mafw-shimmer 1.2s · mafw-eq 0.8s · mafw-voice-pulse 1.5s */
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/motion-tokens.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 全量测试 + 提交**

Run: `cd packages/desktop && bun test`
Expected: 全绿（874 + 2）。

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/motion-tokens.test.ts
git commit -m "feat(desktop): v7 semantic motion tokens (fast/surface + standard/surface easing)"
```

---

## W2 — 布局过渡

### Task 2: `createPresence` 挂载生命周期工具

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/presence.ts`
- Test: `packages/desktop/src/renderer/mafw/components/presence.test.ts`

**Interfaces:**
- Produces:
  - `export const SURFACE_MS = 280` — 与 `--dur-surface` 对齐的 JS 常量（CSS 不能读回，故双写）。
  - `export type PresenceAction = "mount" | "hold" | "schedule-unmount"`
  - `export function presenceStep(prevOpen: boolean, nextOpen: boolean, present: boolean): PresenceAction` — 纯函数（可测；Solid 的 `createEffect` 在 bun 的裸 `createRoot` 下不 flush，故把决策抽为纯 fn）。
  - `export function createPresence(open: () => boolean, exitMs?: number): () => boolean` — Solid 包装，返回是否应渲染；由开转闭时保持 `exitMs` 后卸载。

- [ ] **Step 1: 写失败测试**

Create `packages/desktop/src/renderer/mafw/components/presence.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { presenceStep, SURFACE_MS } from "./presence"

describe("presenceStep (pure)", () => {
  test("mount when opening", () => {
    expect(presenceStep(false, true, false)).toBe("mount")
    expect(presenceStep(false, true, true)).toBe("mount")
  })
  test("schedule unmount only on the falling edge while still present", () => {
    expect(presenceStep(true, false, true)).toBe("schedule-unmount")
  })
  test("hold when already closing or unchanged-closed", () => {
    expect(presenceStep(true, false, false)).toBe("hold")
    expect(presenceStep(false, false, true)).toBe("hold")
  })
})

describe("SURFACE_MS", () => {
  test("mirrors the CSS surface tier", () => {
    expect(SURFACE_MS).toBe(280)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/presence.test.ts`
Expected: FAIL（`./presence` 不存在）。

- [ ] **Step 3: 写实现**

Create `packages/desktop/src/renderer/mafw/components/presence.ts`:

```ts
import { createEffect, createSignal, onCleanup } from "solid-js"

/** Must mirror `--dur-surface` in mafw.css (CSS can't be read back at runtime). */
export const SURFACE_MS = 280

export type PresenceAction = "mount" | "hold" | "schedule-unmount"

/** Pure transition: what should happen when `open` moves from prevOpen to nextOpen? */
export function presenceStep(prevOpen: boolean, nextOpen: boolean, present: boolean): PresenceAction {
  if (nextOpen) return "mount"
  if (prevOpen && present) return "schedule-unmount"
  return "hold"
}

/**
 * Solid lifecycle for a collapsible surface: mount when open; on close keep
 * mounted for `exitMs` (so the CSS exit transition can run), then unmount.
 * Purely DOM lifecycle — animation is CSS.
 */
export function createPresence(open: () => boolean, exitMs: number = SURFACE_MS): () => boolean {
  const [present, setPresent] = createSignal(open())
  let timer: ReturnType<typeof setTimeout> | null = null
  let prevOpen = open()
  let initialized = false

  createEffect(() => {
    const nextOpen = open()
    if (!initialized) { initialized = true; prevOpen = nextOpen; return }
    const action = presenceStep(prevOpen, nextOpen, present())
    prevOpen = nextOpen
    if (action === "mount") {
      if (timer) { clearTimeout(timer); timer = null }
      setPresent(true)
    } else if (action === "schedule-unmount") {
      if (timer) { clearTimeout(timer); timer = null }
      timer = setTimeout(() => { timer = null; setPresent(false) }, exitMs)
    }
  })

  onCleanup(() => { if (timer) clearTimeout(timer) })
  return present
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/presence.test.ts`
Expected: PASS（4 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/components/presence.ts packages/desktop/src/renderer/mafw/components/presence.test.ts
git commit -m "feat(desktop): createPresence lifecycle helper for collapsible surfaces"
```

---

### Task 3: Rail 列宽过渡（grid 变量 + createPresence）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:1560-1634`（rail col 渲染）与 shell 根 `style`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:433-441`（`.mafw-shell`）、`:502-514`（`.mafw-rail-col`/`.mafw-rail`）
- Test: `packages/desktop/src/renderer/mafw/motion-tokens.test.ts`（追加契约）

**Interfaces:**
- Consumes: `createPresence`, `SURFACE_MS`（Task 2）；`--dur-surface`/`--ease-surface`（Task 1）。
- Produces: `.mafw-shell` 的 `--rail-w` 内联变量（`0px` | `${railWidth()}px`）；`.mafw-shell { grid-template-columns: var(--rail-w, 264px) 1fr }`。

- [ ] **Step 1: 写失败契约测试**

在 `motion-tokens.test.ts` 追加：

```ts
describe("rail column width transition", () => {
  test("shell drives the rail column with an animatable var", () => {
    expect(css).toMatch(/\.mafw-shell\s*\{[^}]*grid-template-columns:\s*var\(--rail-w/)
    expect(css).toMatch(/\.mafw-shell\s*\{[^}]*transition:\s*grid-template-columns\s+var\(--dur-surface\)\s+var\(--ease-surface\)/)
  })
  test("rail column clips overflow so content never reflows mid-animation", () => {
    expect(css).toMatch(/\.mafw-rail-col\s*\{[^}]*overflow:\s*hidden/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/motion-tokens.test.ts`
Expected: FAIL（`.mafw-shell` 仍是 `grid-template-columns: auto 1fr`）。

- [ ] **Step 3: 改 CSS**

`mafw.css` `.mafw-shell`（433-441）把 `grid-template-columns: auto 1fr;` 改为：

```css
  grid-template-columns: var(--rail-w, 264px) 1fr;
  --rail-w: 264px;
  transition: grid-template-columns var(--dur-surface) var(--ease-surface);
```

`.mafw-rail-col`（503）追加 `overflow: hidden;`（裁切发生在列上）：

```css
.mafw-rail-col { grid-row: 1 / -1; display: flex; min-height: 0; overflow: hidden; }
```

`.mafw-rail-wrap` 规则改为**不随列收窄而压缩**（`flex: 0 0 auto`），使 wrap 保持固定宽、由列裁切（裁切而非重排）：

```css
.mafw-rail-wrap { position: relative; min-width: 0; height: 100%; overflow: hidden; display: flex; flex-direction: column; flex: 0 0 auto; }
```

（`.mafw-rail { width: 100% }` 相对固定宽的 wrap 不变，故动画中文字不回流。**不要**改 `.mafw-rail` 的宽度。）

- [ ] **Step 4: 改 MafwShell 接线**

顶部 import 区（`import { isNarrowViewport, railAutoAction } from "./layout-breakpoints"` 附近）加：

```ts
import { createPresence, SURFACE_MS } from "./components/presence"
```

在 `applyRailCollapsed` 定义之后加：

```ts
const railPresent = createPresence(() => !railCollapsed(), SURFACE_MS)
```

shell 根 `<div class="mafw-shell" ...>`（1545）加内联变量：

```tsx
<div class="mafw-shell" classList={{ maximized: winMaximized() }} style={{ "--rail-w": railCollapsed() ? "0px" : `${railWidth()}px` }}>
```

rail col 渲染（1560-1634）把 `{railCollapsed() ? null : ( ... )}` 改为：

```tsx
      <div class="mafw-rail-col">
        <Show when={railPresent()}>
          <div class="mafw-rail-wrap" style={{ width: `${railWidth()}px` }}>
            {/* ...原 Rail + ResizeHandle 内容原样保留... */}
          </div>
        </Show>
      </div>
```

（`<Show>` 已在文件中 import；内部 Rail/ResizeHandle 块不动。）

- [ ] **Step 5: 运行契约测试 + 全量**

Run: `cd packages/desktop && bun test src/renderer/mafw/motion-tokens.test.ts && bun test`
Expected: 契约 4 用例 PASS；全量绿。

- [ ] **Step 6: 构建门禁**

Run: `cd packages/desktop && npx electron-vite build`
Expected: 成功（renderer/main/preload 三段）。

- [ ] **Step 7: 提交**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/motion-tokens.test.ts
git commit -m "feat(desktop): animate rail collapse via grid var + createPresence"
```

---

### Task 4: Dock 列宽过渡（grid 过渡 + createPresence）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:1841-1909`（dock-slot 渲染）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-body` 加 transition；`.mafw-dock-slot` 加 overflow）
- Test: `packages/desktop/src/renderer/mafw/motion-tokens.test.ts`（追加）

**Interfaces:**
- Consumes: `createPresence`, `SURFACE_MS`（Task 2）。
- Produces: `.mafw-body { transition: grid-template-columns var(--dur-surface) var(--ease-surface) }`；dock 内容经 `createPresence(() => rightDockOpen())`。

- [ ] **Step 1: 写失败契约测试**

追加：

```ts
describe("dock column width transition", () => {
  test("body animates its grid columns", () => {
    expect(css).toMatch(/\.mafw-body\s*\{[^}]*transition:\s*grid-template-columns\s+var\(--dur-surface\)\s+var\(--ease-surface\)/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/motion-tokens.test.ts`
Expected: FAIL。

- [ ] **Step 3: 改 CSS**

`.mafw-body`（500）追加 transition：

```css
.mafw-body { display: grid; grid-template-columns: 1fr; overflow: hidden; min-height: 0; transition: grid-template-columns var(--dur-surface) var(--ease-surface); }
```

（`.mafw-dock-slot` 已有 `overflow: hidden`（`mafw.css:2757`）与 `.mafw-body` 的 `overflow: hidden` 已足够裁切，无需新增规则。）

- [ ] **Step 4: 改 MafwShell 接线**

在 `railPresent` 之后加：

```ts
const dockPresent = createPresence(() => rightDockOpen(), SURFACE_MS)
```

dock 渲染（1841-1909）把外层 `<Show when={rightDockOpen()}>` 改为 `<Show when={dockPresent()}>`（内部 `<Show when={connDown()}>` / `RightDock` / `ResizeHandle` 原样保留）。占位无运算处不动。

- [ ] **Step 5: 运行 + 构建 + 提交**

Run: `cd packages/desktop && bun test && npx electron-vite build`
Expected: 全绿 + 构建成功。

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/motion-tokens.test.ts
git commit -m "feat(desktop): animate dock collapse via grid transition + createPresence"
```

---

### Task 5: 内容/tab 切换走 surface 档

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:627`（非 chat 页首帧淡入）、`:683`（session tab）、`:2749`（dock-in）

**Interfaces:**
- Consumes: `--dur-surface` / `--ease-surface`（Task 1）。

- [ ] **Step 1: 改 CSS 三处**

- `mafw.css:627` `.mafw-content:not(.mafw-chat-content) > * { animation: mafw-fade-in var(--dur-2) var(--ease); }` → `animation: mafw-fade-in var(--dur-surface) var(--ease-surface);`
- `mafw.css:683` `.mafw-session-tab { ... transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }` → 保留 `--dur-fast` 档（微交互，W3 统一处理，本步不动）
- `mafw.css:2749` `.mafw-right-dock { animation: mafw-dock-in var(--dur-3) var(--ease); }` → `animation: mafw-dock-in var(--dur-surface) var(--ease-surface);`

- [ ] **Step 2: 契约测试（surface 档覆盖 content/dock）**

追加：

```ts
describe("surface-tier entrances use surface tokens", () => {
  test("content first-paint and dock entrance use surface tokens", () => {
    expect(css).toMatch(/\.mafw-content:not\(\.mafw-chat-content\)\s*>\s*\*\s*\{[^}]*var\(--dur-surface\)/)
    expect(css).toMatch(/mafw-dock-in var\(--dur-surface\) var\(--ease-surface\)/)
  })
})
```

- [ ] **Step 3: 运行 + 提交**

Run: `cd packages/desktop && bun test`
Expected: 全绿。

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/motion-tokens.test.ts
git commit -m "refactor(desktop): route content/dock entrances through surface motion tier"
```

---

## W3 — 微交互反馈

### Task 6: 统一 hover/press 手感（自绘交互面）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（自绘交互元素）
- Test: `packages/desktop/src/renderer/mafw/motion-tokens.test.ts`（追加 `:active` 覆盖面断言）

**Interfaces:**
- Consumes: `--dur-fast` / `--ease-standard` / `--active`（`--active` 已存在）。

**目标元素**（自绘、非 V2 组件）：`.mafw-rail-session`、`.mafw-rail-settings-bar`、`.mafw-rail-nav-item`、`.mafw-rail-new`、`.mafw-session-tab`、`.mafw-menu-item`（若存在）、`.mafw-tts-row`、`.mafw-changes-row`、`.mafw-diff-file-row`、`.mafw-lane-*` 行、`.mafw-rail-load-more`。

- [ ] **Step 1: 写失败测试**

追加（断言覆盖数 ≥ 8，且含 rail-session / session-tab）：

```ts
describe("micro-interaction press feedback", () => {
  test("primary self-drawn controls define a press state", () => {
    expect(css).toMatch(/\.mafw-rail-session:active/)
    expect(css).toMatch(/\.mafw-session-tab:active\s*\{/)
    expect(css).toMatch(/\.mafw-rail-nav-item:active/)
    expect(css).toMatch(/\.mafw-changes-row:active/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/motion-tokens.test.ts`
Expected: FAIL（当前 `:active` 仅 4 处，且 rail-session/tab 无 `:active`）。

- [ ] **Step 3: 加按压态 + 统一 hover 时长**

在 `mafw.css` 对应元素规则附近追加一组规则（下沉半像素，不缩放）：

```css
/* v7 微交互：按压下沉半像素（无缩放抖动），hover/press 统一 fast 档 */
.mafw-rail-session:active,
.mafw-rail-settings-bar:active,
.mafw-rail-nav-item:active,
.mafw-rail-new:active,
.mafw-tts-row:active,
.mafw-changes-row:active,
.mafw-rail-load-more:active { background: var(--active); }
.mafw-session-tab:active { background: var(--active); transform: translateY(.5px); }
.mafw-rail-session:active { transform: translateY(.5px); }
```

并把上述元素既有 `:hover` 的 `transition` 中 `var(--dur-1) var(--ease)` 改 `var(--dur-fast) var(--ease-standard)`（`--dur-1` 与 `--dur-fast` 值相近，此处统一到新档）。

- [ ] **Step 4: 运行 + 提交**

Run: `cd packages/desktop && bun test`
Expected: 全绿（`:active` 契约 PASS）。

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/motion-tokens.test.ts
git commit -m "feat(desktop): unified hover/press feedback on self-drawn controls"
```

---

## W4 — 首帧 / 流式

### Task 7: session-turn 进场去抖（只新 tail 播进场）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/turn-enter.ts`
- Test: `packages/desktop/src/renderer/mafw/chat/turn-enter.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:1170-1172`（anchor classList）+ 顶部 import + 一个新 effect
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:395`（把 blanket 规则改为按类）

**Interfaces:**
- Produces:
  - `export function tailIdOf(turns: { id: string }[]): string | null`
  - `export function shouldAnimateTail(prevTail: string | null, nextTail: string | null): boolean`

- [ ] **Step 1: 写失败测试**

Create `packages/desktop/src/renderer/mafw/chat/turn-enter.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { shouldAnimateTail, tailIdOf } from "./turn-enter"

describe("tailIdOf", () => {
  test("null for empty, last id otherwise", () => {
    expect(tailIdOf([])).toBe(null)
    expect(tailIdOf([{ id: "a" }, { id: "b" }])).toBe("b")
  })
})

describe("shouldAnimateTail", () => {
  test("only true when a non-null tail changes", () => {
    expect(shouldAnimateTail(null, "a")).toBe(false)   // 首次水合
    expect(shouldAnimateTail("a", "a")).toBe(false)     // tail 未变（流式更新/翻旧页）
    expect(shouldAnimateTail("a", "b")).toBe(true)      // 追加新 turn
    expect(shouldAnimateTail("a", null)).toBe(false)    // 清空
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/chat/turn-enter.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `packages/desktop/src/renderer/mafw/chat/turn-enter.ts`:

```ts
/** Newest turn id (turns are ordered oldest→newest). */
export function tailIdOf(turns: { id: string }[]): string | null {
  return turns.length ? turns[turns.length - 1].id : null
}

/** Animate only when a previously-known tail is replaced by a different one
 *  (new appended turn). Hydration (prev=null) and paging older turns don't animate. */
export function shouldAnimateTail(prevTail: string | null, nextTail: string | null): boolean {
  return prevTail !== null && nextTail !== null && nextTail !== prevTail
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/chat/turn-enter.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 改 CSS**

`mafw.css:395` 删除 blanket 规则：

```css
.mafw-session-turn-container [data-component="session-turn"] { animation: mafw-enter var(--dur-3) var(--ease); }
```

新增：

```css
.mafw-turn-animate { animation: mafw-enter var(--dur-surface) var(--ease-surface); }
```

- [ ] **Step 6: 改 ChatPane 接线**

顶部 import（`solid-js` 已含 `createEffect`/`createSignal`）加：

```ts
import { shouldAnimateTail, tailIdOf } from "../chat/turn-enter"
```

在 `visibleTurns`（940 行附近）定义后加：

```ts
const [animateTurnId, setAnimateTurnId] = createSignal<string | null>(null)
let prevTailId: string | null = null
createEffect(on(() => props.sessionID, () => { prevTailId = null; setAnimateTurnId(null) }, { defer: true }))
createEffect(() => {
  const next = tailIdOf(visibleTurns())
  if (shouldAnimateTail(prevTailId, next)) setAnimateTurnId(next)
  prevTailId = next
})
```

（若 `on` 未 import，从 `solid-js` 补 `on`。）

anchor（1172）加 classList：

```tsx
<div class="mafw-turn-anchor" data-turn-id={msg.id} classList={{ "mafw-turn-animate": animateTurnId() === msg.id }}>
```

- [ ] **Step 7: 运行 + 提交**

Run: `cd packages/desktop && bun test && npx electron-vite build`
Expected: 全绿 + 构建成功。

```bash
git add packages/desktop/src/renderer/mafw/chat/turn-enter.ts packages/desktop/src/renderer/mafw/chat/turn-enter.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): gate turn enter animation to appended tails (no history cascade)"
```

---

### Task 8: 流式尾光标缓动 token 化

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:429`

- [ ] **Step 1: 改 CSS**

`mafw.css:429` `.mafw-shell [data-component="markdown"][data-streaming="true"] ...::after { ... animation: mafw-caret-blink 1s var(--ease) infinite; }` → `animation: mafw-caret-blink 1s var(--ease-standard) infinite;`

- [ ] **Step 2: 契约测试**

追加：

```ts
test("streaming caret uses standard easing token", () => {
  expect(css).toMatch(/mafw-caret-blink 1s var\(--ease-standard\)/)
})
```

- [ ] **Step 3: 运行 + 提交**

Run: `cd packages/desktop && bun test`
Expected: 全绿。

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/motion-tokens.test.ts
git commit -m "refactor(desktop): caret easing via standard token"
```

---

## W5 — 收口 + 验收

### Task 9: 迁移错档 usage + 去重主题块 motion token

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（迁移若干 transition；`[data-theme="light"]` 与 `@media (prefers-color-scheme: light)` 块删 motion 重复定义）

- [ ] **Step 1: 迁移明显错档**

按规则处理（表面级 → surface；微交互 → fast）：
- 入口动画（`mafw-modal-in` / `mafw-picker-in` / `mafw-drawer-in` / `mafw-usage-wb-in` / `mafw-enter` 已部分处理）用 `var(--dur-surface) var(--ease-surface)`。
- 覆盖层容器 transition（`.mafw-picker-pop`、modal、drawer 的 opacity/transform）用 surface 档。
- 纯 hover/press 用 `var(--dur-fast) var(--ease-standard)`。

对 `mafw.css` 中 `.mafw-diff-panel`（4716，`animation: mafw-drawer-in var(--dur-3) var(--ease)`）→ `var(--dur-surface) var(--ease-surface)`；`.mafw-picker-pop`/modal（1804/1645 附近）同理改 surface 档。

- [ ] **Step 2: 去重主题块 motion token**

删除 `[data-theme="light"]` 块（158-162）与 `@media (prefers-color-scheme: light)` 块（205-207）中的：

```css
  --dur-1: 120ms; --dur-2: 160ms; --dur-3: 200ms; --dur-4: 240ms;
  --ease: cubic-bezier(.25,0,0,1);
```

（这些值已由 `.mafw-shell` 基础块提供，主题只需覆盖颜色；`--r-*` 同理但不在本轮范围，保留。）新增 motion token 亦然：只在基础块定义。

- [ ] **Step 3: 契约测试（no leakage / no new literals）**

追加：

```ts
describe("v7 closing (dedupe + tier discipline)", () => {
  test("light theme blocks no longer redefine legacy motion tokens", () => {
    const light1 = css.slice(css.indexOf("html[data-theme=\"light\"] .mafw-shell"), css.indexOf("/* 亮色：跟随系统"))
    const light2 = css.slice(css.indexOf("@media (prefers-color-scheme: light)"))
    expect(light1).not.toMatch(/--dur-1:/)
    expect(light2).not.toMatch(/--ease:/)
  })
  test("drawer entrance uses surface tier", () => {
    expect(css).toMatch(/mafw-drawer-in var\(--dur-surface\) var\(--ease-surface\)/)
  })
})
```

- [ ] **Step 4: 运行 + 构建 + tsgo**

Run: `cd packages/desktop && bun test && npx electron-vite build`
Expected: 全绿 + 构建成功。

Run: `cd packages/desktop && npx tsgo -b`
Expected: 仅既有 3 处他人报错（`tool-cards/automation.tsx:30`、`tool-cards/python.tsx:115`、`ui/src/context/marked.tsx:535`），本任务文件 0 报错。

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/motion-tokens.test.ts
git commit -m "refactor(desktop): migrate tier mismatches + dedupe motion tokens across themes"
```

---

### Task 10: 文档 + 人工验收

**Files:**
- Modify: `AGENTS.md`（§5.5 desktop 段追加 v7 动效条目）

- [ ] **Step 1: 更新 AGENTS.md §5.5**

在 §5.5 小窗口响应式条目后追加一段（单行）：

```
- **v7 动效收口**（2026-10-10，spec `docs/superpowers/specs/2026-10-10-desktop-motion-polish-design.md`）：两级动效 token（`--dur-fast` 140ms / `--dur-surface` 280ms + `--ease-standard`/`--ease-surface`，无 spring）；`components/presence.ts` `createPresence` 折叠面「过渡期挂载、静止卸载」（停 ManagerCard 15s/UsagePill 60s 轮询）；rail/dock 列宽 `grid-template-columns` 过渡 + `--rail-w` 变量裁切；`:active` 按压下沉半像素；turn 进场门控（`chat/turn-enter.ts` 只新 tail 播 `mafw-enter`，历史水合不弹）；token 契约测试 `motion-tokens.test.ts`；循环动画时长集中建档
```

- [ ] **Step 2: 人工双主题验收（用户目视）**

`mafw restart-agent`（或重启 electron）后，用户目视确认：
1. rail 折叠/展开平滑（无跳变），收起终态零宽；
2. dock 开合平滑；
3. rail 会话行 / tab 按压有下沉反馈；
4. 切换会话时历史不整体弹入，新发消息的 turn 有进场；
5. 明暗切换仍瞬时（无 crossfade）。

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md §5.5 — desktop v7 motion polish"
```

---

## 自审（spec 覆盖）

| spec 项 | 对应 task |
|---|---|
| W1 语义 token + 循环建档 | Task 1 |
| W2 rail/dock 布局过渡 + createPresence | Task 2, 3, 4, 5 |
| W3 微交互 hover/press/focus | Task 6 |
| W4 首帧去抖 + 光标缓动 | Task 7, 8 |
| W5 迁移 + 去重 + 契约测试 + 验收 | Task 9, 10 |
| 非目标（无 spring / 主题硬切 / 不动信息结构） | 全局约束 + 无相关 task |
