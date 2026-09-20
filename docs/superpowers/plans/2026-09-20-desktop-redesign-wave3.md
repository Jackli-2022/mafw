# Desktop Redesign Wave 3（全页面打磨 + 空状态）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地设计 spec Wave 3：EmptyState 组件（CSS glyph + 文案 + 可选 CTA）替换五页裸文本空态；Dashboard 卡片 v4 配方化（含 goal 标题化与 phase 徽标语义 class）；WelcomeHome 排版精化；Rail 尾巴（切换器 hover 边框 + ManagerCard hover 提亮）。

**Architecture:** EmptyState 是纯展示组件（无数据接线），action 槽能力齐备但本波不新增跨页 handler（遵守"不改功能语义"约束）；Dashboard goal 卡从裸 goalId 改为 `title || goalId`；phase 徽标从内联硬编码 rgba 改语义 class（复用 v4 token）；全部视觉改动用 design-contract 测试锁定。

**Tech Stack:** Electron + SolidJS + @mafw/ui v2 + bun test

## Global Constraints

- 工作目录：命令在 `packages/desktop` 下（git 与版本 bump 在仓库根）
- 基线：`bun test` = 471 pass / 1 fail（silero 预存）
- mafw.css ≤ 4840 行（现 4194）
- 禁裸 `<button>`/`<input>`；UI 用 @mafw/ui v2 组件
- 空态文案中文（与现 UI 语言一致）；Loading 态保持 LoaderV2 不动（skeleton 属 Wave 4）

---

### Task 1: EmptyState 组件

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/EmptyState.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（Page shared 分区，.mafw-empty 附近）
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Produces: `EmptyState(props: { glyph: string; title: string; hint?: string; action?: any })`

- [ ] **Step 1: 追加失败测试**

```ts
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
```

- [ ] **Step 2: 运行确认失败**（4 例红）

- [ ] **Step 3: 实现组件**

```tsx
// packages/desktop/src/renderer/mafw/components/EmptyState.tsx
// @ts-nocheck
import { Show } from "solid-js"

export function EmptyState(props: { glyph: string; title: string; hint?: string; action?: any }) {
  return (
    <div class="mafw-empty-state">
      <div class="mafw-empty-state-glyph" aria-hidden="true">{props.glyph}</div>
      <div class="mafw-empty-state-title">{props.title}</div>
      <Show when={props.hint}>
        <div class="mafw-empty-state-hint">{props.hint}</div>
      </Show>
      <Show when={props.action}>
        <div class="mafw-empty-state-action">{props.action}</div>
      </Show>
    </div>
  )
}
```

- [ ] **Step 4: CSS（.mafw-empty 规则之后）**

```css
.mafw-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 16px;
  text-align: center;
}
.mafw-empty-state-glyph {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--text-4);
  margin-bottom: 6px;
}
.mafw-empty-state-title { font-size: 13px; font-weight: 500; color: var(--text-2); }
.mafw-empty-state-hint { font-size: 12px; color: var(--text-4); max-width: 280px; }
.mafw-empty-state-action { margin-top: 8px; }
```

- [ ] **Step 5: 测试通过 + Commit**

```bash
git add src/renderer/mafw/components/EmptyState.tsx src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): EmptyState component — glyph well + title + hint + action slot"
```

---

### Task 2: 五页空态接入

**Files:**
- Modify: `pages/Dashboard.tsx:66`、`pages/Memory.tsx:172`、`pages/ApprovalsPage.tsx:55`、`pages/TriagePage.tsx:54`、`pages/Automations.tsx:119`

- [ ] **Step 1: 各页替换**（每页 import EmptyState，裸 div 换组件）

| 页 | 替换为 |
|---|---|
| Dashboard | `<EmptyState glyph="◎" title="还没有 Goal" hint="让 Manager 为你编排第一个目标，或从欢迎页快速创建" />` |
| Memory | `<EmptyState glyph="⌕" title="没有匹配的记忆" hint="换个关键词，或先用 BM25 默认检索试试" />` |
| Approvals | `<EmptyState glyph="✓" title="没有待审批项" hint="需要确认的工具调用会出现在这里" />` |
| Triage | `<EmptyState glyph="⚖" title="没有待确认项" hint="自动化扫描的结果会出现在这里" />` |
| Automations | `<EmptyState glyph="⏱" title="还没有自动化规则" hint="添加定时或事件驱动的任务规则" />` |

（各页 import 行加在既有组件 import 之后；Loading 分支不动。）

- [ ] **Step 2: 全量测试 + typecheck** → `bun test`（471+4 pass / 1 fail）；`npm run typecheck` exit 0

- [ ] **Step 3: Commit**

```bash
git add src/renderer/mafw/pages
git commit -m "feat(desktop): five pages adopt EmptyState (glyph + title + hint)"
```

---

### Task 3: Dashboard 卡片 v4 配方 + goal 标题化 + phase 徽标语义化

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Dashboard.tsx:68-84`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:1616-1655`（Page shared 卡片区）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: CSS 实现**

`.mafw-card` 重写（现 1616-1628 区域）：

```css
.mafw-card {
  background: var(--bg-overlay);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease);
}
.mafw-card:hover { background: var(--bg-overlay); border-color: var(--text-5); }
```

（保留 .mafw-card-title/.mafw-card-meta 现有规则。）

KPI value 加 `font-variant-numeric: tabular-nums;`；新增 phase 徽标 class：

```css
.mafw-phase-badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mafw-phase-badge-ok { background: var(--accent-soft); color: var(--accent-text); }
.mafw-phase-badge-fail { background: var(--danger-dim); color: var(--danger-text); }
.mafw-phase-badge-run { background: var(--bg-overlay); color: var(--text-2); border: 1px solid var(--border-subtle); }
```

注意亮色：`inset 0 1px 0 rgba(255,255,255,.03)` 高光在亮色下不可见但无害（保持单一规则，不分支）。

- [ ] **Step 4: Dashboard.tsx goal 卡改造**

goal 卡内容（68-84 区域）：

```tsx
          goals().map(g => (
            <MafwContextMenu items={goalMenu(g)}>
              <div class="mafw-card">
                <div>
                  <div class="mafw-card-title">{g.title || g.goalId}</div>
                  <div class="mafw-card-meta">Wave {g.currentWave}/{g.totalWaves} · Loop {g.loop}</div>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: 8, "margin-left": "auto" }}>
                  <span class={`mafw-phase-badge ${
                    g.phase === "COMPLETED" || g.phase === "ARCHIVED" ? "mafw-phase-badge-ok"
                    : g.phase === "FAILED" ? "mafw-phase-badge-fail"
                    : "mafw-phase-badge-run"
                  }`}>{g.phase}</span>
                  <span style={{ "font-size": 11, color: "var(--text-base)" }}>{g.updatedAt ? new Date(g.updatedAt).toLocaleString() : ""}</span>
                </div>
              </div>
            </MafwContextMenu>
          ))
```

（变化：title||goalId；徽标从内联 style 改 class。）

- [ ] **Step 5: 测试通过 + Commit**

```bash
git add src/renderer/mafw/pages/Dashboard.tsx src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): v4 card recipe, goal titles, semantic phase badges"
```

---

### Task 4: WelcomeHome 排版精化（CSS-only）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（Welcome home 分区 2445 起）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("WelcomeHome v4", () => {
  test("标题 text-1 + 大字重", () => {
    const b = cssBlock(".mafw-welcome-title {")
    expect(b).toContain("color: var(--text-1)")
    expect(b).toContain("font-weight: 600")
  })
  test("区块标题 12px muted 大写字距", () => {
    const b = cssBlock(".mafw-welcome-section-title {")
    expect(b).toContain("font-size: 12px")
    expect(b).toContain("color: var(--text-3)")
  })
})
```

- [ ] **Step 2: 运行确认失败**（grep 定位现值后按断言调整字号/色；现 title 若为 26px/700 保持字号只改色与字重为断言值）

- [ ] **Step 3: 实现 + 微调**（同分区顺手：`.mafw-welcome` 行距/区块间距用 `--r-*`/一致 gap；项目 chip `data-selected` 选中态用 `accent-soft` 底）

- [ ] **Step 4: 测试通过 + Commit**

```bash
git add src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): welcome home typography refinement"
```

---

### Task 5: Rail 尾巴（切换器边框 + ManagerCard hover）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（Rail 分区 + Manager card 分区）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("Rail 尾巴 v4", () => {
  test("切换器 hover 边框", () =>
    expect(cssBlock(".mafw-rail-switcher:hover {")).toContain("border-color: var(--border-subtle)"))
  test("ManagerCard hover 边框提亮", () =>
    expect(cssBlock(".mafw-manager-card:hover {")).toContain("border-color"))
})
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**

```css
.mafw-rail-switcher { ...既有属性...; border: 1px solid transparent; border-radius: var(--r-md); }
.mafw-rail-switcher:hover { background: var(--hover); color: var(--text-1); border-color: var(--border-subtle); }
```

（.mafw-manager-card 若无 border 则加 `border: 1px solid var(--border-subtle); border-radius: var(--r-lg);`，hover 时 `border-color: var(--text-5);`——先 grep 现状再改。）

- [ ] **Step 4: 测试通过 + Commit**

```bash
git add src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): rail switcher hover border + manager card hover lift"
```

---

### Task 6: 全量验证 + 构建 + 版本 bump + 视觉验收

- [ ] **Step 1:** `bun test`（预期 471 + 4 + 4 + 4 + 2 + 2 = 487 pass / 1 预存 fail，新增 16）
- [ ] **Step 2:** `npm run typecheck` exit 0；`npx electron-vite build` exit 0
- [ ] **Step 3:** mafw.css ≤ 4840 行
- [ ] **Step 4:** 根 package.json `4.14.0` → `4.15.0`，commit `chore: bump version 4.15.0 (desktop redesign wave 3)`
- [ ] **Step 5:** 视觉验收（用户重启 desktop）：五页空态（可临时清数据查看或直接看 Triage/Approvals 空态）、Dashboard 卡片、欢迎页、Rail hover；双主题
- [ ] **Step 6:** 交付汇报（版本 + commit + 新增测试数 + 全量通过数）

---

## Self-Review 记录

- **Spec 覆盖**：空状态（spec §4）→ Task 1-2（NotesDock/UsageDock 配额空态已有，无需动）；页面打磨 → Task 3-4；Wave 2 遗留（切换器边框/manager 提亮）→ Task 5；WelcomeHome 排版 → Task 4。skeleton/reduced-motion 属 Wave 4。
- **占位符扫描**：无 TBD；Task 4/5 对"grep 现状再改"给出明确断言值，执行时按断言落地。
- **类型一致性**：EmptyState props 在 Task 1 定义 = Task 2 消费；phase badge class 名 Task 3 CSS = TSX。
