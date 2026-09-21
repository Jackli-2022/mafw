# Desktop 美学 v5 · Wave 2（WelcomeHome/Dashboard bento 化 + ChatPane 双栏 hook）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 bento 网格基建；WelcomeHome 与 Dashboard KPI 行接入；ChatPane 主区留双栏扩展 hook。

**Architecture:** CSS 基建一套（`.mafw-bento` 4 列 grid + span 类，媒体查询降级），组件侧只是"包卡片+换 class"，卡内既有 class 全保留（既有 CSS 不失效）；ChatPane 双栏 hook = `data-layout="chat"` 属性 + flex→grid 等价转换（视觉零变化，像素验证兜底）。

**Tech Stack:** SolidJS JSX、CSS grid、bun test。

**Spec:** `docs/superpowers/specs/2026-09-21-desktop-aesthetic-v5-design.md`（§5）

## Global Constraints

- 跨列只允许 ∈ {1,2,4}（测试机械断言全 css 无 `span 3`）
- 「先规划，再执行」引导卡文案与功能不动（9-20 刚落地）
- 卡内既有 class 名全部保留；响应式：≤1100px 两列、≤640px 单列
- ChatPane hook 不得改变现有视觉（截图 + 像素采样验证）
- 测试命令：`bun test tests/design-contract.test.ts`（workdir `packages/desktop`）
- 每 Task 独立 commit；版本号 Wave 3 统一 bump

## 关键事实（探查结论）

- WelcomeHome.tsx 顶层 `.mafw-welcome`（L115，max-width:720 居中列）；区块：banner L116 / projects L123-142 / title L144 / actions L146-160 / goal-input L162-184 / goals L186-203 / badges L205-227 / sessions L229-247；CSS `.mafw-welcome-*` 在 mafw.css L2721-2787
- Dashboard.tsx：KPI 行内联 grid（L52-59，`repeat(4,1fr)` gap 12）+ `.mafw-kpi-card`（CSS L1799-1817）；goals 列表是 `.mafw-card`
- ChatPane.tsx：`.mafw-pane`（L1788）> `.mafw-chat-scroll-wrap`（L1789）+ phase bar（L1987-1994）+ `.mafw-input-area`（L1998）；CSS `.mafw-pane` L2812-2815 是 flex column
- `.mafw-chat`（CSS L521-531）flex column

---

### Task 1: design-contract Wave 2 期望（先失败）

**Files:**
- Modify: `packages/desktop/tests/design-contract.test.ts`（追加 describe 组；新增读 JSX 文件的断言）

- [ ] **Step 1: 追加失败测试**

```ts
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
  test("WelcomeHome 使用 bento board", () =>
    expect(read("src/renderer/mafw/components/WelcomeHome.tsx")).toContain('class="mafw-welcome mafw-bento"'))
  test("Dashboard KPI 行接入 bento", () =>
    expect(read("src/renderer/mafw/pages/Dashboard.tsx")).toContain('class="mafw-bento"'))
  test("ChatPane 主区带双栏 hook 属性", () =>
    expect(read("src/renderer/mafw/components/ChatPane.tsx")).toContain('data-layout="chat"'))
  test("ChatPane hook grid 等价转换", () => {
    const b = cssBlock(".mafw-pane[data-layout=\"chat\"] {")
    expect(b).toContain("grid-template-columns: minmax(0, 1fr)")
    expect(b).toContain("grid-template-rows: minmax(0, 1fr) auto auto")
  })
})
```

注：文件顶部已有 `readFileSync`/`join` import（design-contract.ts:2-3），`read` helper 就地定义即可。

- [ ] **Step 2: 跑测试确认失败** — `bun test tests/design-contract.test.ts`：新增 8 条 FAIL，存量 PASS
- [ ] **Step 3: Commit** `test(desktop): design-contract v5.2 expectations (bento grid + dual-pane hook)`

---

### Task 2: mafw.css bento 基建

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（PageHeader 规则组后、约 L1691 处新增 bento 段）

- [ ] **Step 1: 新增规则**

```css
/* ── Bento board（v5.2：概览页专用；跨列 ∈ {1,2,4}，一卡一问题） ── */
.mafw-bento {
  display: grid;
  grid-template-columns: repeat(4, minmax(0,1fr));
  gap: 12px;
  align-items: stretch;
}
.mafw-bento > * { min-width: 0; }
.mafw-bento-span-2 { grid-column: span 2; }
.mafw-bento-span-4 { grid-column: span 4; }
.mafw-bento-anchor { grid-column: span 2; grid-row: span 2; }
@media (max-width: 1100px) {
  .mafw-bento { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .mafw-bento-span-4, .mafw-bento-anchor { grid-column: span 2; }
}
@media (max-width: 640px) {
  .mafw-bento { grid-template-columns: minmax(0,1fr); }
  .mafw-bento-span-2, .mafw-bento-span-4, .mafw-bento-anchor { grid-column: span 1; grid-row: span 1; }
}
```

- [ ] **Step 2: 跑测试** — bento 基建组 PASS（组件接线组仍 FAIL）
- [ ] **Step 3: Commit** `feat(desktop): bento board grid infrastructure (4-col, spans 1/2/4, responsive)`

---

### Task 3: WelcomeHome bento 化

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx`（L115-247 重组为卡片网格）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（L2721-2787 welcome 段调整）

- [ ] **Step 1: JSX 重组**（顶层改 `class="mafw-welcome mafw-bento"`，各区块包卡）：

```
anchor 卡（.mafw-welcome-card mafw-bento-anchor）：title + actions + goal-input（「今天要做什么？」锚点卡）
projects 卡（.mafw-welcome-card mafw-bento-span-2）：projects 区块原样移入
badges 卡（.mafw-welcome-card mafw-bento-span-2）：badges 区块
goals 卡（.mafw-welcome-card mafw-bento-span-2）：goals 区块（含 section-title）
sessions 卡（.mafw-welcome-card mafw-bento-span-2）：sessions 区块
```

规则：区块**内部 DOM 与 class 一律不动**，只在外面包 `<div class="mafw-welcome-card mafw-bento-span-2">`；banner 保持卡外（断连横幅通栏）。网格流向：anchor(2×2) + projects(span2) 占满前两行，badges(span2) 补 anchor 右侧第二行，goals+sessions 第三行。

- [ ] **Step 2: CSS 调整**（welcome 段）：

```css
.mafw-welcome { max-width: 1040px; padding: 32px 24px; gap: 12px; align-items: stretch; }  /* 覆盖居中列 */
.mafw-welcome-card {
  background: var(--bg-overlay);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.mafw-welcome-card .mafw-welcome-section-title { margin: 0; }  /* 卡内标题不再额外留白 */
```

原 `.mafw-welcome` 的 flex column 居中布局由 bento grid 取代；`-actions`/`-goal-input` 等内部规则继续生效（卡内上下文）。anchor 卡内 title 字号提升为 24px（页面标题档）：`.mafw-welcome-card.mafw-bento-anchor .mafw-welcome-title { font-size: 24px; }`

- [ ] **Step 3: 跑测试** — 组件接线组 WelcomeHome 断言 PASS；`bun test` 全量绿
- [ ] **Step 4: Commit** `feat(desktop): WelcomeHome bento board (anchor + 4 cards, copy preserved)`

---

### Task 4: Dashboard KPI bento 化

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Dashboard.tsx:52-59`

- [ ] **Step 1: 内联 grid 换 bento**：

```tsx
<div class="mafw-bento" style={{ "margin-bottom": "24px" }}>
```

（`repeat(4,1fr)`/gap 12 由 .mafw-bento 提供，视觉等价；四个 KPI 卡默认 span 1。goals 列表卡不动。）

- [ ] **Step 2: 跑测试** — Dashboard 断言 PASS；全量绿
- [ ] **Step 3: Commit** `feat(desktop): Dashboard KPI row onto bento board`

---

### Task 5: ChatPane 双栏 hook

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:1788`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（.mafw-pane 规则后新增）

- [ ] **Step 1: 属性**：`<div class="mafw-pane" data-layout="chat" onClick={props.onFocus}>`

- [ ] **Step 2: CSS（flex→grid 等价转换）**：

```css
/* v5.2 双栏 hook：当前单列（与 flex 版视觉等价）；未来工件栏把 columns 改为
   minmax(0,1fr) 360px 即得 chat+artifact 双栏，无需动组件 */
.mafw-pane[data-layout="chat"] {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto auto;
}
```

子项对应：scroll-wrap=行1（minmax(0,1fr) 顶替 flex:1）、phase-bar=行2、input-area=行3。

- [ ] **Step 3: 像素级验证**——dev 热更后直连 automation API 截图，采样 `.mafw-pane` 区域两处像素与改动前对照（相对基准：改动前截图 screenshot-1789974125694.png 采样值 (22,21,19)/(29,27,24) 量级）；布局断裂（内容溢出/滚动失效）则回退为注释级 hook 并在 commit message 记录
- [ ] **Step 4: 跑测试** — ChatPane 断言 PASS；全量绿
- [ ] **Step 5: Commit** `feat(desktop): chat pane dual-column hook (data-layout + grid equivalence)`

---

### Task 6: 截图门禁 + 汇报

- [ ] **Step 1: 直连 automation API 截 WelcomeHome（新会话空态）与 Dashboard，Media Agent 验证：bento 卡片对齐、4 列网格、锚点卡 2×2、无溢出**
- [ ] **Step 2: 窗口 ≤1100px 缩窄验证两列降级（automation 无 resize 端点则记录跳过，靠媒体查询逻辑保证）**
- [ ] **Step 3: 汇报**——commit 列表、新增测试数（8 条）、bun test 全量通过数

## Self-Review 记录

- **Spec 覆盖**：§5 bento（Task 2/3/4）、双栏 hook（Task 5）✅；§6 动效审计属 Wave 3
- **Placeholder 扫描**：无 TBD；JSX 重组给出区块→卡片映射表
- **类型一致性**：`mafw-bento`/`mafw-welcome-card`/`data-layout="chat"` 命名在测试、CSS、JSX 三处一致
- **已知风险**：①flex→grid 等价转换若有边际破坏 → 回退注释级 hook（Task 5 Step 3 已写明）；②WelcomeHome 变宽后空态观感变化 → 截图门禁人工确认；③`.mafw-welcome` 原 align-items:center 对 chips 居中的影响 → 卡内项目 chips 改为卡内左对齐（bento 语义下更自然），截图确认
