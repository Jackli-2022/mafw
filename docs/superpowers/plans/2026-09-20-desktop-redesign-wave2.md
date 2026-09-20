# Desktop Redesign Wave 2（骨架重组：RightDock 融合 + Rail CTA + PageHeader）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地设计 spec（docs/superpowers/specs/2026-09-20-desktop-redesign-design.md）Wave 2：RightDock 五栏融合为四栏（usage+quota 合并，省一半轮询）、Rail New session 主 CTA 化 + UsagePill 细线进度条、指标行规范 + 模型条形图自绘、PageHeader 组件统一五页。

**Architecture:** 配额渲染（ProviderSection）从 QuotaDock 迁回 UsageDock——两个组件本来各 15s 轮询**同一端点** `sessions.usage()`，UsageDock 的 `apiData().providers` 早已携带配额数据，融合是纯渲染变更；tab 类型收敛到纯函数模块 `dock-tab.ts`（含 localStorage `quota→usage` 迁移）；PageHeader 新组件替换五页裸 `h2.mafw-page-title`。

**Tech Stack:** Electron + SolidJS + @mafw/ui v2 组件 + bun test

## Global Constraints

- 工作目录：命令在 `packages/desktop` 下执行（除 git 与版本 bump 在仓库根）
- 测试：`bun test tests/<file>` 单文件 / `bun test` 全量；**已知基线 455 pass / 1 fail**（silero 预存）
- mafw.css 行数预算 ≤ 4840 行（现 4298）
- 禁新增运行时依赖；UI 一律 @mafw/ui v2 组件；禁止裸 `<button>`/`<input>`（AGENTS.md §5.10）
- `QuotaDock.tsx` 删除后不得残留 import（tsgo 会报错兜底）
- 配额数据路径预算语义保留：providers 列表为空时配额分区显示自己的空态，**不静默吞掉**（展示路径预算上限教训）

---

### Task 1: dock-tab 纯函数（含 quota→usage 迁移）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/dock-tab.ts`
- Test: `packages/desktop/tests/dock-tab.test.ts`

**Interfaces:**
- Produces: `type DockTab = "tasks" | "trajectory" | "usage" | "notes"`；`DOCK_TABS: DockTab[]`；`normalizeDockTab(v: string | null | undefined, fallback?: DockTab): DockTab`（Task 2 的 MafwShell/RightDock 消费）

- [ ] **Step 1: 写失败测试**

```ts
// packages/desktop/tests/dock-tab.test.ts
import { describe, test, expect } from "bun:test"
import { normalizeDockTab, DOCK_TABS } from "../src/renderer/mafw/components/dock-tab"

describe("normalizeDockTab", () => {
  test("合法值直通", () => {
    expect(normalizeDockTab("tasks")).toBe("tasks")
    expect(normalizeDockTab("usage")).toBe("usage")
    expect(normalizeDockTab("notes")).toBe("notes")
  })
  test("quota 迁移到 usage（v4.13 五栏并四栏）", () => {
    expect(normalizeDockTab("quota")).toBe("usage")
  })
  test("非法值回退默认", () => {
    expect(normalizeDockTab("bogus")).toBe("usage")
  })
  test("null/undefined 回退", () => {
    expect(normalizeDockTab(null)).toBe("usage")
    expect(normalizeDockTab(undefined)).toBe("usage")
  })
  test("自定义 fallback", () => {
    expect(normalizeDockTab("bogus", "tasks")).toBe("tasks")
  })
})

describe("DOCK_TABS", () => {
  test("四栏且不含 quota", () => {
    expect(DOCK_TABS).toEqual(["tasks", "trajectory", "usage", "notes"])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/dock-tab.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/desktop/src/renderer/mafw/components/dock-tab.ts
export type DockTab = "tasks" | "trajectory" | "usage" | "notes"
export const DOCK_TABS: DockTab[] = ["tasks", "trajectory", "usage", "notes"]

/** 持久化 tab 值归一化：v4.13 五栏并四栏，quota 迁移到 usage */
export function normalizeDockTab(v: string | null | undefined, fallback: DockTab = "usage"): DockTab {
  if (v === "quota") return "usage"
  return (DOCK_TABS as string[]).includes(v || "") ? (v as DockTab) : fallback
}
```

- [ ] **Step 4: 运行测试确认通过** → PASS（6 例）

- [ ] **Step 5: Commit**

```bash
git add src/renderer/mafw/components/dock-tab.ts tests/dock-tab.test.ts
git commit -m "feat(desktop): dock-tab module — 4-tab union with quota→usage migration"
```

---

### Task 2: RightDock 四栏 + UsageDock 融合配额（删 QuotaDock）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/RightDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/UsageDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:32-33,2036-2045,2302,2766-2768`
- Delete: `packages/desktop/src/renderer/mafw/components/QuotaDock.tsx`

**Interfaces:**
- Consumes: Task 1 的 `DockTab`/`normalizeDockTab`
- Produces: RightDock 四栏；UsageDock 新 props 不变（复用既有 `modelGroups`），内部新增配额分区

- [ ] **Step 1: RightDock.tsx 换类型 + 删配额 trigger**

类型行替换为从模块导入；trigger 列表删 quota 行：

```tsx
import { type DockTab } from "./dock-tab"
```
```tsx
              <TabsV2.Trigger value="tasks">📋 任务</TabsV2.Trigger>
              <TabsV2.Trigger value="trajectory">📊 轨迹</TabsV2.Trigger>
              <TabsV2.Trigger value="usage">📈 用量</TabsV2.Trigger>
              <TabsV2.Trigger value="notes">📝 便签</TabsV2.Trigger>
```
（删除本地 `type DockTab = ...` 定义行）

- [ ] **Step 2: MafwShell.tsx 接线改造**

1. import 区：删除 `import { QuotaDock } from "./components/QuotaDock"`，加 `import { type DockTab, normalizeDockTab } from "./components/dock-tab"`
2. signal 初始化（2037-2039）替换：

```tsx
  const [rightDockTab, setRightDockTab] = createSignal<DockTab>(
    normalizeDockTab(localStorage.getItem("mafw-right-dock-tab"), "tasks"))
```

3. `applyRightDock` 签名（2042）参数类型 `tab?: DockTab`
4. Rail 的 `onOpenUsage`（2302）：`applyRightDock(true, "quota")` → `applyRightDock(true, "usage")`
5. 删除 quota 渲染块（2766-2768，`<div style={{ display: rightDockTab() === "quota" ... }}>` 整块三行）

- [ ] **Step 3: UsageDock.tsx 迁回 ProviderSection + 配额分区**

1. 从 QuotaDock.tsx 复制 `fmtTime`/`pacingIcon`/`severityClass`/`ProviderSection` 四段进 UsageDock.tsx（放回原 278 行注释位置，替换该注释为 ProviderSection 本体）；删除 QuotaDock.tsx
2. UsageDock 组件内加 providerNames memo（QuotaDock 135-141 的逻辑）：

```tsx
  const providerNames = createMemo(() => {
    const m = new Map<string, string>()
    for (const g of props.modelGroups()) {
      if (g.provider && g.provider !== g.providerID) m.set(g.providerID, g.provider)
    }
    return m
  })
```

3. 在 `<ModelStatsSection .../>` 之后追加配额分区（hasData 外也要可见——放在 `<Show when={hasData()}>` 的 fallback 之外独立渲染。实现：把配额分区放到 fallback Show 之后、dock 根 div 内）：

```tsx
        <div class="mafw-usage-section">
          <div class="mafw-usage-section-title">配额</div>
          <Show when={(apiData()?.providers || []).length > 0} fallback={
            <div class="mafw-usage-empty">
              <div class="mafw-usage-empty-icon">⏳</div>
              <div class="mafw-usage-empty-text">暂无配额数据</div>
              <div class="mafw-usage-empty-hint">在配置页启用用量插件后此处显示配额窗口</div>
            </div>
          }>
            <For each={apiData()?.providers || []}>
              {(provider: any) => <ProviderSection provider={provider} displayName={providerNames().get(provider.name)} />}
            </For>
          </Show>
        </div>
```

注意：原 UsageDock 的 toolbar 配置按钮保留（同一入口）；QuotaDock 的 `mafw:usage-config-saved` 监听 UsageDock 已有。

- [ ] **Step 4: 全量测试 + typecheck + grep 残留**

Run: `bun test`（455+6 pass / 1 fail）
Run: `npm run typecheck` → exit 0
Run: `grep -r "QuotaDock" src/` → 无结果

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/mafw
git commit -m "feat(desktop): merge quota into usage dock — 4 tabs, one poller, quota→usage migration"
```

---

### Task 3: 指标行规范 + 模型条形图自绘 CSS

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（UsageDock 分区 ~3200-3450）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
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
```

- [ ] **Step 2: 运行确认失败**（4 例红）

- [ ] **Step 3: 实现**（在 UsageDock CSS 分区内改）

`.mafw-usage-row` 与 `.mafw-usage-value` 按规范重写（保持 flex 布局不变，只调字号/色/tabular）；条形图：

```css
.mafw-usage-model-bar {
  grid-area: bar;
  height: 4px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
}
.mafw-usage-model-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent));
  border-radius: 2px;
  transition: width var(--dur-3) var(--ease);
}
```

（`.mafw-usage-row`/`.mafw-usage-value` 若当前无独立规则块则新增；若有则按断言值修改——执行时先 grep 定位。）

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): usage metric rows spec + css-drawn model bars with green gradient"
```

---

### Task 4: Rail CTA 化 + UsagePill 细线进度条

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/UsagePill.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:292-296`（New session）、UsagePill 分区
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**

CSS（New session 按钮两规则替换）：

```css
.mafw-rail-new-btn { width: 100%; height: 30px; display: flex; align-items: center; justify-content: flex-start; gap: 6px; padding: 0 9px; border: 1px solid var(--accent-border); background: var(--accent-soft); color: var(--accent-text); border-radius: var(--r-md); font-size: 13px; font-weight: 500; cursor: pointer; transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.mafw-rail-new-btn:hover { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.mafw-rail-new-btn:active { background: var(--accent-strong); color: var(--on-accent); }
```

UsagePill.tsx：severity 已有计算（dot 用），抽出复用并加进度条（pill 根 div 末尾）：

```tsx
  const severity = createMemo(() => {
    const pct = hottest()?.window.pct ?? 0
    return pct >= 90 ? "critical" : pct >= 75 ? "high" : pct >= 50 ? "mid" : "low"
  })
```
```tsx
          <div class="mafw-usage-pill" onClick={() => props.onClick?.()}>
            <span class="mafw-usage-pill-dot" style={{ background: severityColor(severity()) }} />
            ...既有四行...
            <div class="mafw-usage-pill-progress" style={{ width: `${Math.min(h().window.pct, 100)}%`, background: severityColor(severity()) }} />
          </div>
```

CSS：

```css
.mafw-usage-pill { ...既有属性追加... position: relative; overflow: hidden; font-variant-numeric: tabular-nums; }
.mafw-usage-pill-progress { position: absolute; left: 0; bottom: 0; height: 2px; border-radius: 1px; opacity: .8; }
```

（severityColor 已存在于 UsagePill，critical/high/mid/low 四档直接复用。）

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/mafw/components/UsagePill.tsx src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): rail new-session CTA + usage pill hairline progress bar"
```

---

### Task 5: PageHeader 组件统一五页

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/PageHeader.tsx`
- Modify: `pages/Dashboard.tsx:49`、`pages/Memory.tsx:78`、`pages/ApprovalsPage.tsx:47`、`pages/TriagePage.tsx:46`、`pages/Automations.tsx:77`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:1540`（Page shared 分区）
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Produces: `PageHeader(props: { title: string; subtitle?: string; actions?: any })`

- [ ] **Step 1: 追加失败测试**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现组件**

```tsx
// packages/desktop/src/renderer/mafw/components/PageHeader.tsx
// @ts-nocheck
import { Show } from "solid-js"

export function PageHeader(props: { title: string; subtitle?: string; actions?: any }) {
  return (
    <div class="mafw-page-header">
      <div class="mafw-page-header-text">
        <h2 class="mafw-page-title">{props.title}</h2>
        <Show when={props.subtitle}>
          <div class="mafw-page-subtitle">{props.subtitle}</div>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="mafw-page-header-actions">{props.actions}</div>
      </Show>
    </div>
  )
}
```

- [ ] **Step 4: CSS（Page shared 分区，.mafw-page-title 附近）**

```css
.mafw-page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.mafw-page-header-text { min-width: 0; }
.mafw-page-title { margin-bottom: 2px; }
.mafw-page-subtitle {
  font-size: 12px;
  color: var(--text-3);
  font-weight: 400;
}
.mafw-page-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
```

（`.mafw-page-title` 的 `margin-bottom: 16px` 改为 2px——间距由 header 容器承担。）

- [ ] **Step 5: 五页接入**（每页 import PageHeader，h2 替换）

| 页 | 替换 |
|---|---|
| Dashboard.tsx:49 | `<PageHeader title="Goals" subtitle="目标编排总览" />` |
| Memory.tsx:78 | `<PageHeader title="Memory" subtitle="谐波记忆检索与便签板" />` |
| ApprovalsPage.tsx:47 | `<PageHeader title="Approvals" subtitle="待审批的工具调用" />` |
| TriagePage.tsx:46 | `<PageHeader title="Triage" subtitle="自动化扫描结果确认" />` |
| Automations.tsx:77 | `<PageHeader title="Automations" subtitle="定时与事件驱动任务" />`（去掉原 `style={{ margin: 0 }}`） |

- [ ] **Step 6: 运行测试 + typecheck**

Run: `bun test tests/design-contract.test.ts` → PASS
Run: `npm run typecheck` → exit 0

- [ ] **Step 7: Commit**

```bash
git add src/renderer/mafw/components/PageHeader.tsx src/renderer/mafw/pages src/renderer/mafw/mafw.css tests/design-contract.test.ts
git commit -m "feat(desktop): unified PageHeader across five pages"
```

---

### Task 6: 全量验证 + 构建 + 版本 bump + 视觉验收

- [ ] **Step 1: 全量测试** → `bun test`（预期 455 + 6 dock-tab + 4 指标行 + 4 CTA/pill + 2 PageHeader = 471 pass / 1 预存 fail，新增 16）
- [ ] **Step 2: typecheck + 构建** → `npm run typecheck` exit 0；`npx electron-vite build` exit 0
- [ ] **Step 3: 行数预算** → mafw.css ≤ 4840
- [ ] **Step 4: 版本 bump** → 根 package.json `4.13.0` → `4.14.0`，commit `chore: bump version 4.14.0 (desktop redesign wave 2)`
- [ ] **Step 5: 视觉验收（人工门禁）** → 用户重启 desktop 后检查：RightDock 四栏 + 用量 tab 内配额分区、Rail 绿色 CTA 按钮、pill 底部细进度条、五页 PageHeader；双主题各一遍
- [ ] **Step 6: 交付汇报** → 版本 + commit + 新增测试数 + 全量通过数

---

## Self-Review 记录

- **Spec 覆盖**：RightDock 融合（spec §2 核心项）→ Task 1-2；指标行规范 + 条形图自绘 → Task 3；Rail New session CTA + UsagePill 细线化 → Task 4；PageHeader 统一 → Task 5；验收/版本 → Task 6。spec §2 的"项目切换器 hover 边框"与"manager 星标精化"经评估为微小项（当前 hover 已有 bg 反馈、ManagerCard 已有独立卡片），合并进 Task 4 顺手处理或延后到 Wave 3 页面打磨——**决定：Task 4 只做 CTA+pill 两项，切换器边框加一行 border transparent→subtle（低成本），manager 星标延后**。
- **占位符扫描**：无 TBD；所有代码步骤含完整代码；Task 3 的 .mafw-usage-row 现状留了 grep 定位说明（执行时按断言值改）。
- **类型一致性**：`DockTab`/`normalizeDockTab` 签名 Task 1 定义 = Task 2 消费；`severityColor` 复用 UsagePill 既有函数；PageHeader props 五页统一。
