# Desktop 美学 v5 · Wave 3（动效审计收尾 + 版本号 bump）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清零 keyframes 属性纪律违规（只动画 transform/opacity），版本号 bump 至 4.13.0，输出 v5 全波次终报。

**Architecture:** 三处违规（mafw-shimmer / mafw-phase-sweep 动 background-position、mafw-eq 动 height）全部 CSS 级修复：shimmer 改 ::after 伪元素 translateX 模式；phase 文字扫光替换为既有 phase-pulse（删装饰扫光）；eq 改 scaleY。加全局 keyframes 属性 allowlist 测试作永久守卫。已验证合规项：linear 仅存在于 gradient、>240ms 仅 token 定义、出场 120ms < 入场 200ms、reduced-motion 全局守卫 + caret 静态行齐全。

**Tech Stack:** CSS、bun test、npm version。

**Spec:** `docs/superpowers/specs/2026-09-21-desktop-aesthetic-v5-design.md`（§6 §7）

## Global Constraints

- keyframes 只允许动画 `opacity` / `transform`（全局 allowlist 测试，永久守卫）
- shimmer 改造后 `.mafw-skeleton` 基础背景（bg-inset）与圆角不变，视觉等价（扫光方向/节奏不变）
- phase-sweep 删除后该元素改用既有 `mafw-phase-pulse`，不改 DOM
- eq 改造后视觉等价（3↔10px 高度呼吸 → scaleY(0.3)↔scaleY(1) × 固定 10px 高）
- 既有 v4 shimmer 断言需同步改写（它们钉住了旧实现）
- 测试命令：`bun test tests/design-contract.test.ts`（workdir `packages/desktop`）

---

### Task 1: design-contract v5.3 期望（先失败）

**Files:**
- Modify: `packages/desktop/tests/design-contract.test.ts`（改写 v4 shimmer 断言 + 追加 v5.3 describe）

- [ ] **Step 1: 改写 v4 shimmer 三条断言**（"Skeleton v4" describe）：

```ts
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
```

- [ ] **Step 2: 追加 v5.3 describe**：

```ts
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
    expect(css).not.toMatch(/@keyframes[\s\S]*?background-position/)
    expect(css).not.toMatch(/@keyframes mafw-eq[\s\S]*?\bheight:/)
  })
})
```

注：`background-position` 断言须在 Task 2/3 修复后转绿；第一遍跑必然红（shimmer/sweep/eq 仍违规）。

- [ ] **Step 3: 跑测试确认失败** — 新增断言红（shimmer/sweep/eq 三处点名），存量绿
- [ ] **Step 4: Commit** `test(desktop): design-contract v5.3 expectations (keyframes property allowlist)`

---

### Task 2: shimmer transform 化

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（.mafw-skeleton 与 @keyframes mafw-shimmer）

- [ ] **Step 1: 重写**：

```css
.mafw-skeleton {
  position: relative;
  overflow: hidden;
  background: var(--bg-inset);
  border-radius: var(--r-sm);
}
.mafw-skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, var(--hover-strong), transparent);
  animation: mafw-shimmer 1.2s var(--ease) infinite;
}
@keyframes mafw-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

- [ ] **Step 2: 跑测试** — shimmer 相关断言绿；keyframes 纪律组仍红（sweep/eq）
- [ ] **Step 3: Commit** `feat(desktop): shimmer sweep moved to compositor (pseudo-element translateX)`

---

### Task 3: phase-sweep 与 eq 修复

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（phase sweep 规则约 L1113、@keyframes mafw-phase-sweep L1076、mafw-tts-eq L2943-2946）

- [ ] **Step 1: phase sweep → pulse**——找到含 `animation: mafw-phase-sweep 2s linear infinite` 的规则（background-clip:text 渐变文字扫光），整体替换为：

```css
  animation: mafw-phase-pulse 1.2s var(--ease) infinite;
```

同时删除该规则内的 `background-size/-webkit-background-clip/background-clip/-webkit-text-fill-color` 与渐变 background 行（恢复 `color: var(--text-3)` 正常文字渲染——以该规则原文为准逐行清理），并删除 `@keyframes mafw-phase-sweep`。

- [ ] **Step 2: eq → scaleY**：

```css
.mafw-tts-eq i { width: 2px; height: 10px; border-radius: 1px; background: currentColor; transform-origin: center; animation: mafw-eq 0.8s ease-in-out infinite; }
@keyframes mafw-eq { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
```

（若 `.mafw-tts-eq i` 原 nth-child 有 height 差异，把差异改为 scaleY 幅度或统一幅度；保持容器 flex 对齐不变。）

- [ ] **Step 3: 跑测试** — `bun test` 全量绿（keyframes allowlist 全通过）
- [ ] **Step 4: Commit** `feat(desktop): motion discipline — phase sweep to pulse, TTS eq bars to scaleY`

---

### Task 4: 版本号 bump + 终报

**Files:**
- Modify: `package.json`（root version）、`packages/desktop/package.json`

- [ ] **Step 1: 版本 4.12.0 → 4.13.0**（两处 package.json + `packages/desktop/package.json` 一致的版本字段）
- [ ] **Step 2: CSS 行数核对**——`Get-Content packages/desktop/src/renderer/mafw/mafw.css | Measure-Object -Line`，对照预算 4209×1.08≈4546，终报如实记录
- [ ] **Step 3: Commit** `chore: bump version 4.13.0 (desktop aesthetic v5 — warm paper palette + bento + type/motion discipline)`
- [ ] **Step 4: 终报**（用户惯例格式）：
  - v5 全波次 commit 清单 + 本版本起始 commit 哈希
  - 累计新增测试数（Wave 0 +30 / Wave 1 +10 / Wave 2 +8 / Wave 3 约 +3）与最终全量通过数
  - 待用户目视清单（WelcomeHome bento / Goals KPI / 亮色主题 / 流式光标 / TTS 均衡条与 phase 呼吸观感）
