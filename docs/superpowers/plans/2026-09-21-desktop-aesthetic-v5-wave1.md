# Desktop 美学 v5 · Wave 1（双字体契约 + 消息排版 + streaming 光标）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 制度化双字体契约（--font-ui/--font-data + tabular-nums）、消息正文对齐业界（16px/1.7、列宽 720px）、streaming 尾光标（▌ + reduced-motion 静态）、UI 字号三阶审计。

**Architecture:** 全部是 token/CSS/1 行组件属性改动。字体 token 定义在 mafw.css 变量层并引用 packages/ui 既有 `--font-family-sans/mono`（像素零变化、只立契约）；消息排版用 desktop scoped override 打在 `[data-component="text-part"]` 内（不波及 reasoning 块）；光标 = session-ui Markdown 根元素加 `data-streaming` 属性（1 行）+ desktop CSS `::after` 伪元素。

**Tech Stack:** CSS custom properties、SolidJS（session-ui 源码直用，无需构建）、bun test（desktop）。

**Spec:** `docs/superpowers/specs/2026-09-21-desktop-aesthetic-v5-design.md`（§3 §4）

## Global Constraints

- 只动 4 个文件：`packages/desktop/src/renderer/mafw/mafw.css`、`packages/desktop/tests/design-contract.test.ts`、`packages/session-ui/src/components/markdown.tsx`、（审计中发现的 mafw.css 内联字号）
- `--font-ui` 必须解析为 `var(--font-family-sans, ...系统栈)`、`--font-data` 解析为 `var(--font-family-mono, ...等宽栈)`——复用 packages/ui 既有变量，**不引入字体文件、不改变现有像素**
- 16px 排版只打在 `[data-component="text-part"]` 内的 markdown（reasoning/思考块维持 14px）
- 光标只在 `data-streaming="true"` 时出现（part 完成自动消失）；`prefers-reduced-motion: reduce` 下不闪
- 测试命令：`bun test tests/design-contract.test.ts`（workdir `packages/desktop`）；session-ui 无需单独构建
- 每 Task 独立 commit；版本号 Wave 3 统一 bump

## 关键事实（探查结论，实施者必读）

- Markdown 根元素：`packages/session-ui/src/components/markdown.tsx:504-514`，`<div data-component="markdown" ref={setRoot}>`；每个 markdown 块被包在 `<div data-markdown-block style="display:contents">` 里作为根的直接子元素（markdown.tsx:563-572）
- assistant 正文当前 14px：`packages/session-ui/src/components/markdown.css:16` 用 `var(--font-size-base)`（packages/ui theme.css = 14px）；desktop 无任何覆盖
- text part 渲染：`packages/session-ui/src/components/message-part.tsx:1802-1809`，流式走 `PacedMarkdown`（已传 `streaming`），完成态 fallback 硬编码 `streaming={false}` → 光标随完成自动消失，无需改 message-part
- mafw.css 中硬编码 mono 栈的站点（改为 var(--font-data)）：642、663、666、1524、2173、2277、2895、4015、4349、4468、4482、4496、4502、4504 行（以实施时 `git grep -n "ui-monospace\|font-family: monospace" -- ...mafw.css` 全量结果为准）

---

### Task 1: design-contract 增加 Wave 1 期望（先失败）

**Files:**
- Modify: `packages/desktop/tests/design-contract.test.ts`（文件末尾追加 describe 组；复用既有 `cssBlock`）

**Interfaces:**
- Produces: 无新导出；仅断言组

- [ ] **Step 1: 追加失败测试**

```ts
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

describe("token v5.1 — streaming 尾光标", () => {
  const cursor = '.mafw-shell [data-component="markdown"][data-streaming="true"] > [data-markdown-block]:last-child > :last-child::after'
  test("▌ 伪元素存在", () => {
    const b = cssBlock(cursor)
    expect(b).toContain('content: "▌"')
    expect(b).toContain("color: var(--accent)")
    expect(b).toContain("animation: mafw-caret-blink")
  })
  test("blink keyframes（opacity 0↔1，1s）", () => {
    const b = cssBlock("@keyframes mafw-caret-blink")
    expect(b).toContain("opacity: 1")
    expect(b).toContain("opacity: 0")
    expect(b).toContain("1s")
  })
  test("reduced-motion 下静态显示", () => {
    const i = css.indexOf("@media (prefers-reduced-motion: reduce)")
    const seg = css.slice(i, i + 1200)
    expect(seg).toContain("mafw-caret-blink")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/design-contract.test.ts`（workdir `packages/desktop`）
Expected: 新增 3 个 describe 共 10 条全 FAIL，存量 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/tests/design-contract.test.ts
git commit -m "test(desktop): design-contract v5.1 expectations (font contract + message type + streaming caret)"
```

---

### Task 2: 字体 token 定义与应用

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（暗色块约 :47 前后、亮色手动块与系统块各加两行；`.mafw-shell` 规则体加 font-family）

**Interfaces:**
- Produces: `--font-ui`、`--font-data` 两个变量（Task 3/4/5 消费）

- [ ] **Step 1: 三个主题块各加两行**（值三处一致）：

```css
  --font-ui: var(--font-family-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  --font-data: var(--font-family-mono, ui-monospace, "Cascadia Code", Consolas, Menlo, monospace);
```

暗色块加在 `--ease` 行后；亮色手动块加在对应 `--ease` 行后；系统亮色块以压缩格式追加在同一注释行下方。

- [ ] **Step 2: `.mafw-shell` 规则体加应用行**（`color-scheme: dark;` 之后）：

```css
  font-family: var(--font-ui);
```

（`--font-ui` 解析到 packages/ui 的 `--font-family-sans`，与现状继承值一致，像素零变化。）

- [ ] **Step 3: 跑测试** — `bun test tests/design-contract.test.ts`：字体契约组 PASS（硬编码扫描仍 FAIL，Task 3 清）
- [ ] **Step 4: Commit** `feat(desktop): font contract tokens --font-ui/--font-data applied to shell`

---

### Task 3: mono 站点收敛 + tabular-nums 补齐

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（关键事实表列出的 14 处 + 扫描补漏）

- [ ] **Step 1: 全量扫描**

Run: `git grep -n "ui-monospace\|font-family: monospace" -- packages/desktop/src/renderer/mafw/mafw.css`
Expected: ≤14 处（关键事实清单）

- [ ] **Step 2: 逐处替换**

`font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;` → `font-family: var(--font-data);`
`font-family: var(--font-mono, ui-monospace, ...);` → `font-family: var(--font-data);`
`font-family: monospace;` → `font-family: var(--font-data);`

- [ ] **Step 3: tabular-nums 补齐审计**

Run: `git grep -n "tabular-nums" -- packages/desktop/src/renderer/mafw/mafw.css`
对承载**数值**的规则（成本/百分比/计数徽标/耗时）补 `font-variant-numeric: tabular-nums;`；纯文本规则不动。逐条判定，预期新增 ≤6 处。

- [ ] **Step 4: 跑测试** — 字体契约组全 PASS（含硬编码扫描清零）
- [ ] **Step 5: Commit** `feat(desktop): mono sites consolidated onto --font-data + tabular-nums sweep`

---

### Task 4: 消息排版（16px/1.7 + 720px）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（:5 列宽；§4.5 scoped 段加覆盖规则）

- [ ] **Step 1: 列宽** — :5 `--msg-col-width: 760px` → `720px`（宽屏分档 880/1000/1100 不动）

- [ ] **Step 2: scoped 覆盖**（加在 §4.5 段内、user 气泡规则附近）：

```css
/* v5.1 消息正文：16px/1.7（业界 AI 对话标准），reasoning 块不波及 */
.mafw-shell [data-component="text-part"] [data-component="markdown"] {
  font-size: 16px;
  line-height: 1.7;
}
```

- [ ] **Step 3: 跑测试** — 消息排版组 PASS
- [ ] **Step 4: Commit** `feat(desktop): message body 16px/1.7 + 720px reading column (industry standard)`

---

### Task 5: streaming 尾光标

**Files:**
- Modify: `packages/session-ui/src/components/markdown.tsx:505-513`（根 div 加 1 行）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（motion 段加 keyframes + cursor 规则 + reduced-motion 行）

- [ ] **Step 1: session-ui 根元素加属性**（markdown.tsx:506 `data-component="markdown"` 行后）：

```tsx
      data-streaming={local.streaming ? "true" : undefined}
```

- [ ] **Step 2: desktop CSS**（motion 段，mafw-dock-in 附近追加）：

```css
/* v5.1 streaming 尾光标：仅流式中的 markdown 根渲染 ▌（完成即消失） */
@keyframes mafw-caret-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.mafw-shell [data-component="markdown"][data-streaming="true"] > [data-markdown-block]:last-child > :last-child::after {
  content: "▌";
  color: var(--accent);
  margin-left: 2px;
  animation: mafw-caret-blink 1s var(--ease) infinite;
}
```

- [ ] **Step 3: reduced-motion**——在既有 `@media (prefers-reduced-motion: reduce)` 块内追加：

```css
  .mafw-shell [data-component="markdown"][data-streaming="true"] > [data-markdown-block]:last-child > :last-child::after { animation: none; }
```

- [ ] **Step 4: 跑测试** — streaming 光标组 PASS；`bun test` 全量绿
- [ ] **Step 5: Commit** `feat(desktop): streaming block caret (accent ▌, removed on completion, reduced-motion safe)`

---

### Task 6: 字号三阶审计（UI chrome）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（仅明确 outlier）

- [ ] **Step 1: 列出全部字号**

Run: `git grep -n "font-size" -- packages/desktop/src/renderer/mafw/mafw.css`

- [ ] **Step 2: 三阶判定**——允许集：12–13px（label/辅助）、14px（UI 主力）、20–28px（页面标题）、16px（消息正文轨）、11px 与 12.5px/10px（mono 数据与既有验收值：tool 触发条 12.5px、diff 11px、徽标 10px 保留）。**只改**明显违反且非既有验收契约的 chrome 字号（如 15px 的 titlebar/qtitle 降到 14px），每处先确认不在 design-contract 断言里。预期改动 ≤4 处；若无违例则记录"零改动"。

- [ ] **Step 3: 跑测试** — `bun test` 全量绿（不得破坏既有断言）
- [ ] **Step 4: Commit** `feat(desktop): UI type scale audit — chrome labels consolidated to 3-tier`（零改动则并入 Task 7 commit）

---

### Task 7: 视觉门禁 + 汇报

- [ ] **Step 1: dev 桌面热更验证**——dev 实例在跑（vite 热更），streaming 状态需实际发一条消息观察 ▌；直连 automation API 截图（参考：读 `~/.config/mafw/desktop-automation.json` 端口 + Bearer secret，GET /screenshot）
- [ ] **Step 2: Media Agent 辅助验证**——截图问：正文是否明显大于侧栏文字（16 vs 14）、光标块是否存在且为绿色、mono 是否用于数据区
- [ ] **Step 3: 亮色主题同套验证**（点标题栏 ☀ 或 light 截图）
- [ ] **Step 4: 汇报**——commit 列表、新增测试数（10 条）、bun test 全量通过数

## Self-Review 记录

- **Spec 覆盖**：§3 字体契约（Task 2/3/6）、§4 排版+光标（Task 4/5）✅；§5/§6 属 Wave 2/3
- **Placeholder 扫描**：无 TBD；关键事实表给出行号，替换规则逐字给出
- **类型一致性**：cursor 选择器在 Task 1 测试与 Task 5 CSS 逐字一致（`.mafw-shell [data-component="markdown"][data-streaming="true"] > [data-markdown-block]:last-child > :last-child::after`）
- **已知风险**：①`> :last-child::after` 对表格/代码块同样追加（可接受，业界同做法）；②PacedMarkdown 降速渲染时光标跟随末块（预期行为）；③`data-streaming` 属性是 session-ui 1 行改动，无独立测试（desktop CSS 断言 + 人工流式验证兜底）
