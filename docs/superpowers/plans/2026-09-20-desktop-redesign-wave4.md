# Desktop Redesign Wave 4（微动效收尾）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 spec §4 动效体系最后四项：`prefers-reduced-motion` 全局兜底、tab 内容淡入 160ms、RightDock 进场、模态 scale 进场；新消息 enter 微调（4px + token）；Skeleton shimmer 组件替换五页 LoaderV2 loading。

**Architecture:** 纯 CSS 动效 + 一个 Skeleton 展示组件；tab 切换淡入利用 Solid 三元链重挂载特性（`.mafw-content:not(.mafw-chat-content) > *` 首帧动画）；reduced-motion 用 0.01ms 压制（非 display:none，保留终态帧）。

**Tech Stack:** CSS keyframes + SolidJS + bun test

## Global Constraints

- 工作目录 `packages/desktop`（git/版本在根）；基线 484 pass / 1 fail（silero 预存）
- mafw.css ≤ 4840 行（现 4222）
- 动效只用 transform/opacity（合成层）；无回弹无视差
- 波次结束后 spec 四波全部完成，交付总结含全项目数据

---

### Task 1: 动效基建（reduced-motion + enter 微调 + tab 淡入 + dock/模态进场）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（Motion 分区 + RightDock + ConfirmOverlay 分区）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
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
```

- [ ] **Step 2: 运行确认失败**（5 例红）

- [ ] **Step 3: 实现**

Motion 分区（§5 处）追加：

```css
@keyframes mafw-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes mafw-dock-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes mafw-modal-in {
  from { opacity: 0; transform: scale(.98); }
  to   { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .mafw-shell, .mafw-shell *, .mafw-shell *::before, .mafw-shell *::after,
  .mafw-picker-pop, .mafw-picker-pop *, .mafw-picker-pop *::before, .mafw-picker-pop *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

`.mafw-session-turn-container [data-component="session-turn"]` 的 animation 行改为 `animation: mafw-enter var(--dur-3) var(--ease);`；`@keyframes mafw-enter` 的 `translateY(8px)` → `translateY(4px)`。

Chat Layout 分区追加：

```css
.mafw-content:not(.mafw-chat-content) > * { animation: mafw-fade-in var(--dur-2) var(--ease); }
```

RightDock 分区：`.mafw-right-dock` 追加 `animation: mafw-dock-in var(--dur-3) var(--ease);`
ConfirmOverlay 分区：`.mafw-confirm` 追加 `animation: mafw-modal-in var(--dur-4) var(--ease);`

- [ ] **Step 4: 测试通过 + Commit**

```bash
git add src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): motion base — reduced-motion guard, tab fade, dock/modal enter"
```

---

### Task 2: Skeleton shimmer + 五页 loading 接入

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/Skeleton.tsx`
- Modify: `pages/Dashboard.tsx`、`pages/Memory.tsx`、`pages/ApprovalsPage.tsx`、`pages/TriagePage.tsx`、`pages/Automations.tsx`（各 loading 分支）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（Page shared 分区）
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Produces: `Skeleton(props: { w?: string; h?: string; r?: string })`；`SkeletonRows(props: { rows?: number; h?: string })`（便捷行组）

- [ ] **Step 1: 追加失败测试**

```ts
describe("Skeleton v4", () => {
  test("shimmer keyframes 存在", () =>
    expect(cssBlock("@keyframes mafw-shimmer")).toContain("background-position"))
  test("skeleton 基础类", () => {
    const b = cssBlock(".mafw-skeleton {")
    expect(b).toContain("background: var(--bg-inset)")
    expect(b).toContain("animation: mafw-shimmer")
  })
  test("行组布局", () =>
    expect(cssBlock(".mafw-skeleton-rows {")).toContain("flex-direction: column"))
})
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现组件**

```tsx
// packages/desktop/src/renderer/mafw/components/Skeleton.tsx
// @ts-nocheck
import { For } from "solid-js"

export function Skeleton(props: { w?: string; h?: string; r?: string }) {
  return (
    <div
      class="mafw-skeleton"
      style={{
        width: props.w || "100%",
        height: props.h || "14px",
        ...(props.r ? { "border-radius": props.r } : {}),
      }}
    />
  )
}

export function SkeletonRows(props: { rows?: number; h?: string }) {
  const n = () => props.rows || 3
  return (
    <div class="mafw-skeleton-rows">
      <For each={Array.from({ length: n() })}>
        {() => <Skeleton h={props.h || "40px"} />}
      </For>
    </div>
  )
}
```

CSS：

```css
@keyframes mafw-shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}
.mafw-skeleton {
  background: var(--bg-inset) linear-gradient(90deg, transparent, var(--hover-strong), transparent) no-repeat;
  background-size: 200px 100%;
  border-radius: var(--r-sm);
  animation: mafw-shimmer 1.2s var(--ease) infinite;
}
.mafw-skeleton-rows { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
```

（shimmer 用 background-position 合成成本可接受——每页最多 7 块且短暂停留。）

- [ ] **Step 4: 五页 loading 分支替换**（各页 import；loading 三元的第一支换成 Skeleton）

- Dashboard：KPI 骨架 + 行骨架——

```tsx
        {loading() ? (
          <div>
            <div style={{ display: "grid", "grid-template-columns": "repeat(4, 1fr)", gap: 12, "margin-bottom": 24 }}>
              {[0, 1, 2, 3].map(() => <div class="mafw-skeleton" style={{ height: "64px", "border-radius": "var(--r-lg)" }} />)}
            </div>
            <SkeletonRows rows={3} h="52px" />
          </div>
        ) : goals().length === 0 ? (
```

（import { SkeletonRows } from "../components/Skeleton"；LoaderV2 import 若不再用则移除。）

- Memory / ApprovalsPage / TriagePage / Automations：loading 三元第一支 `<div style={{...}}><LoaderV2 .../><span class="mafw-empty">Loading...</span></div>` 整体替换为 `<SkeletonRows rows={3} h="52px" />`；LoaderV2 import 移除（若无其他使用点）。

- [ ] **Step 5: 全量测试 + typecheck** → `bun test`；`npm run typecheck` exit 0

- [ ] **Step 6: Commit**

```bash
git add src/renderer/mafw/components/Skeleton.tsx src/renderer/mafw/pages src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): skeleton shimmer loading across five pages"
```

---

### Task 3: 终验 + 版本 bump + 视觉验收 + 全项目总结

- [ ] **Step 1:** `bun test`（预期 484 + 5 + 3 = 492 pass / 1 预存 fail，新增 8）
- [ ] **Step 2:** `npm run typecheck`；`npx electron-vite build`；mafw.css ≤ 4840 行
- [ ] **Step 3:** 根 package.json `4.15.0` → `4.16.0`，commit `chore: bump version 4.16.0 (desktop redesign wave 4 — complete)`
- [ ] **Step 4:** 视觉验收（用户重启 desktop）：tab 切换淡入、dock 打开滑入、确认弹窗 scale 进场、Goals 页骨架屏、（可选）系统开启"减弱动态效果"验证全静止
- [ ] **Step 5:** 全项目交付总结（四波汇总：版本 4.12.0→4.16.0、总 commit 数、总新增测试数、CSS 行数变化）

---

## Self-Review 记录

- **Spec 覆盖**：动效清单七项——消息进入(Task 1 微调)/tab 淡入(Task 1)/hover 120ms(Wave 2-3 已做)/dock 伸缩(Task 1 进场)/模态(Task 1)/状态点 pulse(已有 breathe)/skeleton(Task 2)；reduced-motion(Task 1)。
- **占位符扫描**：无 TBD；全部代码完整。
- **类型一致性**：`Skeleton`/`SkeletonRows` props 定义 = 五页消费一致。
