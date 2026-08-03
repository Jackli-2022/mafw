# MAFW Desktop 界面美化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MAFW Desktop 按《MAFW界面美化-开发文档.md》v2 全量重构：四阶背景 + 品牌绿收口 + 六阶文字 + 双主题（跟随系统 + 手动覆盖）+ 全部分区改造。

**Architecture:** 纯 CSS 变量主题层（`.mafw-shell` 作用域，暗/亮两套值，`html[data-theme]` + `prefers-color-scheme` 双通道）+ 分区组件改造（Rail/TabStrip/MafwShell/TaskPanel）+ 硬编码色值迁移 + 动效/滚动条收尾。验证靠 `npm run build` + HMR 目检（视觉任务无单测基建）。

**Tech Stack:** SolidJS + Tailwind v4（CSS-first）+ `mafw.css` 自定义类 + `@opencode-ai/ui` v1/v2 组件。

**参考文档（在仓库内，执行时可查）:**
- `MAFW界面美化-开发文档.md`（权威规范，v2 含 §3.4 双主题）
- `任务列表面板组件-开发文档.md`（Tasks 面板内部规格）
- `docs/superpowers/specs/2026-08-03-mafw-ui-beautification-design.md`（本计划依据的 spec）

## Global Constraints

- 颜色一律走 CSS 变量：**禁止写死 hex 或 `bg-white/[.x]` 白透明度类**（文档 §6）
- 圆角只有 4 档：`6px / 10px / 16px / 999px`
- 动效全部 ≤300ms、无弹性回弹
- 数字（耗时/token/计数）一律 `font-variant-numeric: tabular-nums`
- 品牌绿 `--accent`（暗 `#3FD07A` / 亮 `#1F9D5A`）只用于：①状态点 ②Send ③激活指示
- 暗色默认；亮色 = `html[data-theme="light"]` 或 `@media (prefers-color-scheme: light)` 且无 `data-theme`
- v2 token 覆盖限定在 `.mafw-shell` 作用域下
- 每个任务结束 `git commit`

---

### Task 1: 主题变量层 + 切换按钮

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`（文件顶部新增主题层）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`（标题栏切换按钮 + 主题状态）
- Modify: `opencode-dev/packages/desktop/src/main/index.ts`（nativeTheme 同步）

**Interfaces:**
- Produces: CSS 变量 `--bg-base/raised/overlay/float`、`--accent/dim/text`、`--text-1..5`、`--on-accent`、`--hover/hover-strong/active/pill`、`--border-subtle`、`--shadow-float`、`--glow-accent`、`--scrollbar/scrollbar-hover`、`--selection`、`--focus-ring`、`--composer-focus/composer-halo`、`--tasks-glow`；`html[data-theme]` 机制；后续任务全部消费这些变量。

- [ ] **Step 1: 在 mafw.css 顶部加主题变量层**

在 `.mafw-shell {` 规则之前插入：

```css
/* ══ 主题变量层（作用域 .mafw-shell，暗色默认） ══ */
.mafw-shell {
  color-scheme: dark;
  /* 背景四阶（文档 §3.1） */
  --bg-base: #08080A;
  --bg-raised: #0D0D10;
  --bg-overlay: #131316;
  --bg-float: #18181C;
  --bg-hover: rgba(255,255,255,.03);
  --border-subtle: rgba(255,255,255,.055);
  /* 品牌绿（§3.2） */
  --accent: #3FD07A;
  --accent-dim: rgba(63,208,122,.12);
  --accent-text: #6FD89B;
  --on-accent: #08080A;
  /* 文字六阶（§3.3） */
  --text-1: #E2E2E6;
  --text-2: #C4C4CA;
  --text-3: #8C8C94;
  --text-4: #606068;
  --text-5: #44444B;
  /* 交互态 / 阴影 / 全局（§3.4–3.5） */
  --hover: rgba(255,255,255,.03);
  --hover-strong: rgba(255,255,255,.05);
  --active: rgba(255,255,255,.04);
  --pill: rgba(255,255,255,.05);
  --shadow-float: 0 8px 24px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.05);
  --glow-accent: 0 0 10px rgba(63,208,122,.28);
  --scrollbar: rgba(255,255,255,.09);
  --scrollbar-hover: rgba(255,255,255,.16);
  --selection: rgba(63,208,122,.2);
  --focus-ring: rgba(63,208,122,.4);
  --composer-focus: rgba(63,208,122,.35);
  --composer-halo: rgba(63,208,122,.09);
  --tasks-glow: radial-gradient(ellipse at right, rgba(63,208,122,.10), transparent 60%);
  /* v2 token 覆盖（限定本作用域，防泄漏到非 MAFW 区） */
  --v2-background-bg-base: #08080A;
  --v2-background-bg-layer-01: #131316;
  --v2-background-bg-layer-02: #18181C;
  --v2-border-border-muted: rgba(255,255,255,.055);
  --v2-text-text-base: #C4C4CA;
  --v2-text-text-muted: #8C8C94;
  --v2-text-text-faint: #606068;
}
/* 亮色：手动覆盖（html[data-theme]） */
html[data-theme="light"] .mafw-shell {
  color-scheme: light;
  --bg-base: #EFEFF2;
  --bg-raised: #FAFAFB;
  --bg-overlay: #F1F1F4;
  --bg-float: #FFFFFF;
  --bg-hover: rgba(0,0,0,.03);
  --border-subtle: rgba(0,0,0,.08);
  --accent: #1F9D5A;
  --accent-dim: rgba(31,157,90,.10);
  --accent-text: #177A48;
  --on-accent: #FFFFFF;
  --text-1: #17171B;
  --text-2: #34343B;
  --text-3: #5E5E66;
  --text-4: #8E8E96;
  --text-5: #B9B9BF;
  --hover: rgba(0,0,0,.04);
  --hover-strong: rgba(0,0,0,.06);
  --active: rgba(0,0,0,.05);
  --pill: rgba(0,0,0,.05);
  --shadow-float: 0 8px 24px rgba(0,0,0,.10), 0 0 0 1px rgba(0,0,0,.04);
  --glow-accent: 0 0 8px rgba(31,157,90,.30);
  --scrollbar: rgba(0,0,0,.15);
  --scrollbar-hover: rgba(0,0,0,.25);
  --selection: rgba(31,157,90,.18);
  --focus-ring: rgba(31,157,90,.35);
  --composer-focus: rgba(31,157,90,.45);
  --composer-halo: rgba(31,157,90,.10);
  --tasks-glow: radial-gradient(ellipse at right, rgba(31,157,90,.07), transparent 60%);
  --v2-background-bg-base: #EFEFF2;
  --v2-background-bg-layer-01: #F1F1F4;
  --v2-background-bg-layer-02: #FFFFFF;
  --v2-border-border-muted: rgba(0,0,0,.08);
  --v2-text-text-base: #34343B;
  --v2-text-text-muted: #5E5E66;
  --v2-text-text-faint: #8E8E96;
}
/* 亮色：跟随系统（无手动覆盖时） */
@media (prefers-color-scheme: light) {
  html:not([data-theme]) .mafw-shell {
    color-scheme: light;
    /* 与上面 [data-theme="light"] 完全相同的亮色变量块（复制，勿引用选择器） */
    --bg-base: #EFEFF2; --bg-raised: #FAFAFB; --bg-overlay: #F1F1F4; --bg-float: #FFFFFF;
    --bg-hover: rgba(0,0,0,.03); --border-subtle: rgba(0,0,0,.08);
    --accent: #1F9D5A; --accent-dim: rgba(31,157,90,.10); --accent-text: #177A48; --on-accent: #FFFFFF;
    --text-1: #17171B; --text-2: #34343B; --text-3: #5E5E66; --text-4: #8E8E96; --text-5: #B9B9BF;
    --hover: rgba(0,0,0,.04); --hover-strong: rgba(0,0,0,.06); --active: rgba(0,0,0,.05); --pill: rgba(0,0,0,.05);
    --shadow-float: 0 8px 24px rgba(0,0,0,.10), 0 0 0 1px rgba(0,0,0,.04);
    --glow-accent: 0 0 8px rgba(31,157,90,.30);
    --scrollbar: rgba(0,0,0,.15); --scrollbar-hover: rgba(0,0,0,.25);
    --selection: rgba(31,157,90,.18); --focus-ring: rgba(31,157,90,.35);
    --composer-focus: rgba(31,157,90,.45); --composer-halo: rgba(31,157,90,.10);
    --tasks-glow: radial-gradient(ellipse at right, rgba(31,157,90,.07), transparent 60%);
    --v2-background-bg-base: #EFEFF2; --v2-background-bg-layer-01: #F1F1F4; --v2-background-bg-layer-02: #FFFFFF;
    --v2-border-border-muted: rgba(0,0,0,.08);
    --v2-text-text-base: #34343B; --v2-text-text-muted: #5E5E66; --v2-text-text-faint: #8E8E96;
  }
}
```

- [ ] **Step 2: MafwShell 加主题切换按钮**

`MafwShell.tsx`：
- 顶部 state：`const [theme, setTheme] = createSignal<string | null>(null)`（null = 跟随系统）
- 在现有 `onMount`（SSE 连接那个）之外新增一个 `onMount`：

```tsx
onMount(() => {
  const saved = localStorage.getItem('mafw-theme')
  if (saved) {
    document.documentElement.dataset.theme = saved
    setTheme(saved)
  }
})
const toggleTheme = () => {
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const cur = document.documentElement.dataset.theme || (mq.matches ? 'light' : 'dark')
  const next = cur === 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = next
  localStorage.setItem('mafw-theme', next)
  setTheme(next)
}
```

- 标题栏（`.mafw-titlebar` 内、gateway 状态点之后）加按钮：

```tsx
<button
  type="button"
  class="mafw-theme-toggle"
  onClick={toggleTheme}
  aria-label="Toggle theme"
  title="切换主题"
>
  {theme() === 'light' ? '☀' : '☾'}
</button>
```

- 加 CSS（mafw.css，放在标题栏区块内）：

```css
.mafw-theme-toggle {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-4);
  font-size: 13px;
  line-height: 1;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.12s, background 0.12s;
}
.mafw-theme-toggle:hover { color: var(--text-2); background: var(--hover); }
```

- [ ] **Step 3: 主进程 nativeTheme 同步**

`opencode-dev/packages/desktop/src/main/index.ts`：`import { app, nativeTheme } from "electron"`（若未导入），在 `app.whenReady()` 之前加：

```ts
nativeTheme.themeSource = "system"
```

- [ ] **Step 4: 构建验证**

Run: `cd opencode-dev/packages/desktop && npm run build`
Expected: 构建通过（无 TS/CSS 错误）。HMR 后目检：暗色默认；系统切亮色自动变亮；点按钮在亮/暗间切换；刷新后保持（localStorage）。

- [ ] **Step 5: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/mafw.css opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx opencode-dev/packages/desktop/src/main/index.ts
git commit -m "feat(desktop): theme variable layer + light/dark toggle + nativeTheme sync"
```

---

### Task 2: 硬编码色值迁移（全局收口）

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/TaskPanel.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/pages/Dashboard.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/pages/Graph.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/pages/TriagePage.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/MafwToolCards.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: Task 1 的 `--accent/*`、`--text-*`、`--bg-*` 变量。
- Produces: 全局无硬编码 hex/白透明度。

- [ ] **Step 1: 替换组件内硬编码色值**

逐个文件替换（`rgba(232,99,107,0.15)`/`#e8636b` 等语义色保留为 --icon-* 系或原值——语义色（错误红/警告黄/信息蓝）不在品牌绿收口范围，保留原值；**只替换品牌绿/背景/文字类**）：

- `Rail.tsx:122-124`：`var(--icon-success-base, #2bc94a)` → `var(--accent)`（server 图标 + Manager 徽章底色）；徽章文字 `#fff` → `var(--on-accent)`。徽章本身 Task 4 会重构，此处仅换变量。
- `TaskPanel.tsx:78`：辉光 `var(--icon-success-base, #2bc94a)` → `var(--accent)`；行 139/142 priority 用 `var(--icon-warning-base, #e8b84b)` 保留（语义色）。
- `Dashboard.tsx:74-75`：`rgba(43,201,74,0.12)`/`#2bc94a` → `var(--accent-dim)`/`var(--accent-text)`。
- `Graph.tsx`：状态色是语义色（PLAN/EXECUTE/REVIEW 蓝紫黄、ARCHIVE 绿红），**保留**；仅若出现 `#2bc94a` 处（L15/21/112 的 ARCHIVE_SUCCESS）→ `var(--accent)`。
- `TriagePage.tsx:27-29`：语义色保留。
- `MafwToolCards.tsx:131-132`：语义色保留。

- [ ] **Step 2: 替换 mafw.css 内硬编码**

`mafw.css`：
- L286-288 状态点：`var(--icon-success-base, #2bc94a)` → `var(--accent)`；warning/critical 保留语义色。
- L75 manager 左条：`var(--icon-success-base, #2bc94a)` → `var(--accent)`。
- 所有 `background: var(--background-base)` / `var(--surface-*)` / `var(--text-*)` 保留（token 引用），但 Task 3-7 会逐步换成新的 `--bg-*`/`--text-*`。

- [ ] **Step 3: 白透明度类清理**

全仓 grep `bg-white/` 与 `rgba(255,255,255,.` 中**非变量**用法，替换为 `var(--hover)`/`var(--pill)`/`var(--bg-*)` 对应变量。

Run: `cd opencode-dev/packages/desktop/src/renderer/mafw && grep -rn "bg-white/\|rgba(255,255,255" --include="*.tsx" --include="*.css" .`
Expected: 仅剩 `--tasks-glow`/`--bg-hover`/`--border-subtle` 等变量内的白透明度（合法）。

- [ ] **Step 4: 构建 + Commit**

Run: `npm run build`（desktop）→ 通过后：
```bash
git add opencode-dev/packages/desktop/src/renderer/mafw
git commit -m "refactor(desktop): migrate hardcoded colors to theme variables"
```

---

### Task 3: 标题栏 + 顶部导航（§4.1 / §4.2）

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/TabStrip.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`（标题栏绿点）

**Interfaces:**
- Consumes: Task 1 变量。
- Produces: `.mafw-titlebar`（38px、绿点 glow）、`.mafw-tabstrip` 内部 tab 的 pill 组 + 计数徽章结构。

- [ ] **Step 1: 标题栏 CSS（§4.1）**

`mafw.css` 替换 `.mafw-titlebar` 块：

```css
.mafw-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 38px;
  background: var(--bg-base);
  -webkit-app-region: drag;
  user-select: none;
}
.mafw-titlebar button, .mafw-titlebar .mafw-theme-toggle { -webkit-app-region: no-drag; }
```

MafwShell 标题栏内 MAFW 字标样式改为 `font-size: 13px; font-weight: 600; color: var(--text-2)`；状态点 `.mafw-status-dot.ready` 加 `box-shadow: var(--glow-accent)` + 脉动（2s，仅 ready/connected）：

```css
.mafw-status-dot.ready {
  background: var(--accent);
  box-shadow: var(--glow-accent);
  animation: blink 2s infinite;
}
```

- [ ] **Step 2: 导航 pill 组（§4.2）**

`TabStrip.tsx` 当前用 `TabsV2.List`——改为在 `mafw.css` 中样式化（不改组件结构，除非现有结构不满足）。在 mafw.css 加：

```css
.mafw-tabstrip {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 44px;
  padding: 0 8px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
}
.mafw-tabstrip [role="tab"] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-4);
  transition: color 0.12s, background 0.12s;
}
.mafw-tabstrip [role="tab"]:hover { color: var(--text-2); }
.mafw-tabstrip [role="tab"][data-selected] {
  background: var(--accent-dim);
  color: var(--text-1);
}
.mafw-tabstrip [role="tab"][data-selected] svg { color: var(--accent); }
```

检查 `TabStrip.tsx` 的实际 DOM（`TabsV2` 是否用 `data-selected` 属性；若无，改用现有激活 class 选择器），确保选择器命中。

- [ ] **Step 3: 构建 + Commit**

Run: `npm run build` → 目检导航 pill 组。Commit：
```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/mafw.css opencode-dev/packages/desktop/src/renderer/mafw/components/TabStrip.tsx opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): titlebar glow + nav pill group"
```

---

### Task 4: 侧栏重构（§4.3）

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: Task 1 变量。
- Produces: `.mafw-rail`（264px）、HISTORY 分组头、agent 图标位、选中指示条、Manager 徽章降级、日期分组、底部状态条结构。

- [ ] **Step 1: 侧栏容器 + 分组头（CSS）**

`mafw.css` 替换 rail 相关块：

```css
.mafw-rail {
  width: 264px;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
}
.mafw-rail-section {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 6px;
  color: var(--text-4);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  cursor: pointer;
  user-select: none;
  border-bottom: none;
}
```

- [ ] **Step 2: 会话行（agent 图标位 + 选中指示条 + Manager 降级）**

`Rail.tsx` 会话行改结构：
- 行首加 20px 方形 agent 图标位：`<span class="mafw-agent-icon">{角色首字符}</span>`，CSS `width:20px;height:20px;border-radius:6px;background:var(--bg-overlay);color:var(--text-3);font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0`
- 移除亮绿 Manager pill：改行尾 11px `--text-4` 纯文字 "Manager"（或 `--bg-overlay` 小徽章，圆角 999）
- 选中态 CSS：

```css
.mafw-rail-item-label.active {
  background: var(--hover);
  color: var(--text-1);
  box-shadow: inset 2px 0 0 var(--accent);
}
```

- [ ] **Step 3: 日期分组 + 底部状态条**

`Rail.tsx`：会话 >20 条时按 `time.created` 插入"今天/昨天/7月"分组标题（`<div class="mafw-rail-date-group">`，CSS 11px `--text-5` sticky）。Rail 底部已有 Settings 区——保留，另在 rail 底部加状态条（`connected :3000` 12px tabular `--text-4` + 6px `--accent` 呼吸点；断线 `#E5484D`）。状态来自 `window.api.mafw.gateway.info()`（已有 gwReady 逻辑）。

- [ ] **Step 4: 构建 + Commit**

Run: `npm run build` → 目检。Commit：
```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): sidebar rebuild - indicator bar, agent icon, manager badge, date groups"
```

---

### Task 5: 会话 Tab 小卡 + 聊天主区（§4.4 / §4.5）

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: Task 1 变量。
- Produces: 会话 tab 小卡、聊天 760px 列、sticky Agent 头（实底）、工具块卡片化（scoped session-ui 覆盖）。

- [ ] **Step 1: 会话 Tab 小卡（§4.4）**

`mafw.css` 替换 sessionstrip/session-tab 块：

```css
.mafw-sessionstrip {
  display: flex;
  gap: 4px;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: var(--bg-base);
  overflow-x: auto;
  flex-shrink: 0;
}
.mafw-session-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 10px;
  font-size: 13px;
  color: var(--text-4);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.mafw-session-tab:hover { background: var(--hover); color: var(--text-2); }
.mafw-session-tab.active { background: var(--bg-overlay); color: var(--text-1); }
```

`MafwShell.tsx` 会话 tab 内加 agent 色点：`<span class="mafw-agent-dot" style={{ background: "var(--accent)" }} />`（CSS 8px 圆）。

- [ ] **Step 2: 聊天主区布局（§4.5）**

`mafw.css`：
- `.mafw-chat` 底 → `var(--bg-raised)`；移除 8px margin 面板感？**保持面板结构**（rounded 16 + shadow-float）但底 `--bg-raised`；消息列 max-width 760px：

```css
.mafw-session-turn-container {
  flex: 1; overflow-y: auto; min-height: 0;
  padding: 0 32px;
}
.mafw-session-turn-container [data-component="session-turn"] {
  height: auto;
  max-width: 760px;
  margin-inline: auto;
}
```

- 消息间距：`user→agent 24px / 同角色 8px`——通过覆盖 session-ui 完成（下方 Step 3 scoped 块一并处理）或接受 session-ui 现有间距（24px turn 间距已有），把 turn 间距 12px → 24px：

```css
.mafw-session-turn-container [data-component="session-turn"] + [data-component="session-turn"] {
  margin-top: 24px;
}
```

- [ ] **Step 3: Sticky Agent 头（实底，防穿透）**

`MafwShell.tsx` 现有 `.mafw-session-titlebar` 改为 Agent 头结构：圆形头像位（`--accent-dim` + glyph）+ 名称 15px/600 `--text-1` + 右侧状态（运行中绿点 + "Running" `--accent-text`）。CSS：

```css
.mafw-session-titlebar {
  position: sticky;
  top: 0;
  z-index: 30;
  margin: 0 -32px;
  padding: 10px 32px 14px;
  background: var(--bg-raised);              /* 实底防穿透 */
  border-bottom: 1px solid var(--border-subtle);
}
.mafw-agent-avatar {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--accent-dim);
  color: var(--accent-text);
  font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 4: 工具块卡片化（scoped 覆盖 session-ui）**

`mafw.css` 加 scoped 覆盖（作用于 session-ui 工具块容器）：

```css
.mafw-session-turn-container [data-component="tool-part-wrapper"] {
  background: var(--bg-overlay);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  overflow: hidden;
}
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot*="header"],
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-component*="accordion"] > [data-slot*="trigger"] {
  height: 32px;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
}
```

先跑 `npm run build` 后在 DevTools 里检查实际工具块 DOM（`data-component`/`data-slot` 属性），把选择器对准真实结构；工具块子行：`[data-slot*="content"] > * { border-left: 2px solid var(--border-subtle); }`。

- [ ] **Step 5: 构建 + Commit**

Run: `npm run build` → 目检。Commit：
```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): session tab cards + chat 760px column + agent header + tool block cards"
```

---

### Task 6: Tasks 悬浮 + Composer（§4.6 / §4.7）

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/TaskPanel.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: Task 1 变量、Task 5 的 760px 列。
- Produces: Tasks 悬浮于输入框上方、5s 折叠摘要（状态保持）、Composer 浮层 + Send 主按钮。

- [ ] **Step 1: Tasks 悬浮定位 + 辉光变量**

`MafwShell.tsx`：TaskPanel 从内容流内嵌改为悬浮——包一层绝对定位容器（相对 `.mafw-chat`）：

```tsx
<Show when={currentSessionID() && (todos[currentSessionID()] || []).length > 0}>
  <div class="mafw-tasks-float">
    <TaskPanel ... />
  </div>
</Show>
```

CSS（mafw.css）：

```css
.mafw-chat { position: relative; }
.mafw-tasks-float {
  position: absolute;
  left: 50%;
  bottom: 104px;              /* 输入框上方约 12px */
  transform: translateX(-50%);
  width: min(760px, calc(100% - 64px));
  z-index: 40;
  animation: mafw-slide-in 200ms ease-out;
}
@keyframes mafw-slide-in {
  from { transform: translateX(-50%) translateY(8px); opacity: 0; }
  to   { transform: translateX(-50%) translateY(0); opacity: 1; }
}
```

消息列表底部预留 padding：`.mafw-session-turn-container { padding-bottom: 140px; }`（面板高 + 12px 余量）。

`TaskPanel.tsx`：辉光改 `var(--tasks-glow)`；容器改 `background: var(--bg-float); box-shadow: var(--shadow-float); border: 1px solid var(--border-subtle);`。

- [ ] **Step 2: 5s 折叠摘要 + 状态保持**

`TaskPanel.tsx`：
- 折叠摘要状态信号 `const [collapsed, setCollapsed] = createSignal(false)`（已有）
- 全部完成时：`createEffect(() => { if (done() === total() && total() > 0) { timer = setTimeout(() => setCollapsed(true), 5000) } ... })`（onCleanup 清 timer；折叠后点击 header 重新展开）
- 摘要行渲染：collapsed 时 header 显示 `✓ {done()} tasks · {formatDuration(elapsedMs())}`
- 状态按 session 记忆：MafwShell 侧 `const [tasksCollapsed, setTasksCollapsed] = createStore<Record<string, boolean>>({})`，把 collapsed 提升为受控 prop（`collapsed={tasksCollapsed[sid]}` + `onToggleCollapse`）——或组件内 keyed by sessionID 保持。采用**组件内 `createMemo` + sessionID 变化时重置**：切换 session 时折叠状态不跨 session 泄漏即可（简单方案：`onMount` 内读取，切 session 时用 `createEffect` 重置）。

- [ ] **Step 3: Composer（§4.7）**

`mafw.css` 替换 inputbar 块：

```css
.mafw-inputbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 12px;
  background: var(--bg-float);
  border-top: 1px solid var(--border-subtle);
}
.mafw-inputbar:focus-within [data-component="textarea-v2"] {
  outline-color: var(--composer-focus);
  box-shadow: 0 0 0 3px var(--composer-halo);
}
.mafw-inputbar .mafw-input {
  flex: 1; width: auto; align-self: stretch;
  background: var(--bg-float);
}
.mafw-inputbar [data-slot="textarea-v2-textarea"] {
  min-height: 52px; max-height: 200px;
}
```

`MafwShell.tsx` 输入框：
- Send 按钮改 `--accent` 底 + `var(--on-accent)` 文字：给 ButtonV2 传 style `{ background: "var(--accent)", color: "var(--on-accent)" }`（variant 改为默认/ghost 覆盖，或保留 contrast 并覆盖样式）；空输入时 `opacity: .4`（disabled 时加 class `.mafw-send-disabled`）
- Stop 按钮（■）同位置，样式同 Send 但方形 icon
- 快捷键提示：输入框聚焦时右下淡显 `Enter 发送 · Shift+Enter 换行`（11px `--text-5`，纯文本）——放在 `.mafw-inputbar` 内一个 `span.mafw-keyhint`（`opacity:0`，`:focus-within` 时 `opacity:1`）

```css
.mafw-keyhint {
  font-size: 11px;
  color: var(--text-5);
  opacity: 0;
  transition: opacity 0.12s;
  flex-shrink: 0;
}
.mafw-inputbar:focus-within .mafw-keyhint { opacity: 1; }
```

- [ ] **Step 4: 构建 + Commit**

Run: `npm run build` → 目检（Tasks 悬浮对齐、Send 绿、聚焦光晕、快捷键提示、亮色下 5s 折叠摘要）。Commit：
```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/TaskPanel.tsx opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): tasks float + composer redesign + send accent button"
```

---

### Task 7: 全局收尾（§4.8 + §5 动效）

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: Task 1 变量。

- [ ] **Step 1: 滚动条 / 选中 / 焦点环**

`mafw.css` 全局块（作用域 `.mafw-shell` 下）：

```css
.mafw-shell * { scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent; }
.mafw-shell *::-webkit-scrollbar { width: 8px; height: 8px; }
.mafw-shell *::-webkit-scrollbar-track { background: transparent; }
.mafw-shell *::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 4px; }
.mafw-shell *::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); }
.mafw-shell ::selection { background: var(--selection); }
.mafw-shell :focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
```

**注意**：删除之前"隐藏滚动条"规则（Task 之前的 `.mafw-rail::-webkit-scrollbar { display: none }` 等），统一为上面的细滚动条（文档 §4.8 要求可见细条）。

- [ ] **Step 2: 动效规范**

`mafw.css` 动效块（hover 120ms、折叠 200ms、进入 200ms、状态点呼吸 2s 已有 blink；确认无 >300ms 动画、无回弹）。为消息/任务行进入加：

```css
@keyframes mafw-enter {
  from { transform: translateY(8px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
```

- [ ] **Step 3: 数字 tabular-nums 全量**

`mafw.css` 全局：`.mafw-shell { font-variant-numeric: tabular-nums; }`（覆盖所有数字）。

- [ ] **Step 4: 构建 + 全量验收**

Run: `npm run build` → 按《MAFW界面美化-开发文档.md》§7 验收清单逐项目检（含双主题 6 项：亮色四阶背景、默认跟随系统、localStorage 覆盖重启保持、亮色交互清晰——**明暗两主题各跑一遍**，亮色重点看 hover/选中/焦点环辨识度）。

- [ ] **Step 5: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): global scrollbar/selection/focus + motion + tabular-nums"
```

---

## Self-Review

- **Spec 覆盖**：主题机制（Task 1）、v2 作用域（Task 1 变量限定 .mafw-shell）、迁移（Task 2）、标题栏/导航（Task 3）、侧栏（Task 4）、会话 Tab/聊天/工具块（Task 5）、Tasks 悬浮 + 折叠状态 + Composer（Task 6）、全局 + nativeTheme + 双主题验收（Task 1 Step 3 + Task 7）。全部 spec 项有对应任务。✓
- **占位符扫描**：无 TBD/TODO；工具块 DOM 选择器在 Step 4 标注"先 build 后对准真实结构"——这是实现指引而非占位（session-ui DOM 需运行时确认）。✓
- **类型一致性**：`--accent/--on-accent/--text-1..5/--bg-*` 变量名在 Task 1 定义、Task 2-7 一致消费；`formatDuration`（TaskPanel 已有）在 Task 6 复用。✓
