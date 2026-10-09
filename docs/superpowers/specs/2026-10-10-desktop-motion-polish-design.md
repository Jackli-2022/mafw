# MAFW Desktop 动效抛光 v7（两级动效收口）— 设计文档

> 日期：2026-10-10
> 前置：`2026-09-28-desktop-v6-design.md`（发丝线/三级 elevation/字体分层）、`2026-09-21-desktop-aesthetic-v5-design.md`（暖纸 token v5 + 动效审计）
> 状态：设计已获用户整体批准（范围 E 五项全做 / 强度 C 两级体系 / 主题 A 不跨界 / 方案 1 增量语义 token / W2 rail 采用 createPresence）

## 1. 背景

v5 建 token/排版/动效，v6 做美学微精化。desktop 已有成熟设计系统（`.mafw-shell` 变量层，暖纸暗色 + 信号绿），**动效语言存在但未收口**：

- 有动效 token（`--dur-1..4` + `--ease`）但**无档位语义**：64 处 `transition` + 33 处 `animation` 里，表面级动画可能错用快档、微交互可能错用慢档；
- 循环动画（breathe/spin/shimmer/pulse/eq）时长硬编码，未建档；
- **布局过渡缺失**：rail/dock 折叠靠 `grid-template-columns` 切换 + 条件渲染（`MafwShell.tsx:1562/1687`），瞬时跳变；
- **微交互反馈稀疏**：全 CSS 仅 4 处 `:active`；
- **首帧动画**：`mafw-enter`（`mafw.css:395`）每 turn 挂载即播，历史批量加载会级联弹入；
- `prefers-reduced-motion` 已全局处理（`mafw.css:409`），保持。

用户诉求：**全面抛光界面与动画**。定位为「收口已有语言 + 补齐缺口」，非重做。

## 2. 目标 / 非目标

**目标**：
- W1 语义动效 token 层（fast / surface + standard / surface 双缓动），循环动画时长建档（对应缺口 3）
- W2 布局过渡：rail/dock 折叠展开平滑、tab/内容切换（缺口 1）
- W3 微交互：统一 hover/press/focus 手感（缺口 4）
- W4 首帧/流式：session-turn 进场去抖 + 流式光标缓动（缺口 5）
- W5 收口：错档 usage 迁移 + 契约测试 + 双主题人工验收

**非目标**：
- **不做主题切换过渡**（明↔暗保持瞬时硬切；用户决策 A——主流专业应用惯例，避免颜色走中间值发闷）
- 不引入 spring / 物理动画（纯 CSS transition/transition-property，合成器友好）
- 不动 v5/v6 颜色 token 值、不动三栏骨架、不动信息结构（thinking/tool 元数据行语义）
- 不引入动画库依赖
- 不改 gateway API

## 3. 设计

### W1 — 语义动效 token 层（基底）

在 `.mafw-shell` 变量层**新增**（旧 token 保留，W5 标 deprecated）：

```css
/* v7 两级动效（fast=微交互 / surface=表面级），无 spring */
--dur-fast: 140ms;                          /* hover/press/toggle/focus；吸收现 dur-1(120)/dur-2(160) */
--dur-surface: 280ms;                       /* 折叠/覆盖/进场/抽屉 */
--ease-standard: cubic-bezier(.25,0,0,1);   /* = 现 --ease，微交互落定 */
--ease-surface:  cubic-bezier(.16,1,.3,1);  /* 更强 easeOut，表面级落定 */
```

- **两级定义**：微交互（hover/press/toggle/focus/小淡入）= `--dur-fast` + `--ease-standard`；表面级（折叠/覆盖/进场/抽屉/modal）= `--dur-surface` + `--ease-surface`。
- **循环动画**（breathe/spin/shimmer/pulse/eq）时长**保持硬编码**（循环不属 token 尺度），在 `mafw.css` 动效区集中注释建档（名称 / 用途 / 时长 / 缓动）。
- motion token 与主题色无关：亮/暗两套 `.mafw-shell` 色块各自重复定义了一份 `--r-*`/`--dur-*`（v5 刻意「复制，勿引用选择器」，`design-contract.test.ts` 的「token v4」套件钉扎）。**v7 决策（执行中修正）**：保留该重复不变（去重会与既有不变量冲突，收益近零），仅在此前提下迁移错档 usage。

### W2 — 布局过渡

**新增 UI 生命周期工具** `createPresence(open: Accessor<boolean>, exitMs: number)`（Solid，纯逻辑可测）：`open` 为真→挂载；由真转假→**保持挂载、置退出态，`exitMs` 后卸载**；只负责 DOM 生命周期，**不碰动画**（动画纯 CSS）。用于折叠面避免「静止仍常驻 + 子轮询空转」。

**Rail**：
- `.mafw-shell` 的 `grid-template-columns` 由 `auto 1fr` 改为 `var(--rail-w, 0px) 1fr` + `transition: grid-template-columns var(--dur-surface) var(--ease-surface)`；展开设 `--rail-w: <railWidth>px`，收起置 `0px`。
- 内层 `.mafw-rail-col { overflow: hidden }`；`.mafw-rail { width: var(--rail-w-open) }` **固定宽度 → 动画中裁切而非重排**（文字不回流）。
- `.mafw-rail-col` 保留为 grid 占位（顶行/main 仍落 column 2），静止收起态 **零宽**（满足既往要求）。
- Rail **内容**由 `createPresence(railOpen, 280)` 控制挂载：收起时先播宽度收起动画，动画结束卸载 → `ManagerCard`(15s)/`UsagePill`(60s) 轮询随之停止，**挂载语义与现状完全一致**（现在每次展开本就重挂载、重拉 projects）。
- 进场需处理：以 enter 初态（`--rail-w: 0`）挂载 → 次帧翻到目标态以触发 transition（`createPresence` 内 rAF/queueMicrotask 处理）。

**Dock**：
- `.mafw-body` 的 `grid-template-columns: 1fr <dockW>px` 加 `transition: grid-template-columns var(--dur-surface) var(--ease-surface)`；Chromium 可插值 `fr ↔ px`。
- `RightDock` 内容用 `createPresence` 淡入淡出 + 列宽收缩；关闭时列到 `0px`（等价现状）→ 卸载后 dock 内轮询停止。

**会话 tab / 内容切换**：active 态加 `--dur-fast` 过渡；非 chat 页内容淡入 `mafw-fade-in` 改走 surface 档。

**窄窗口自动折叠**（`layout-breakpoints.ts` 的 `railAutoAction`，<1200px）复用同一 `applyRailCollapsed` 路径，自动折叠同样平滑。

### W3 — 微交互反馈

审计**自绘**可交互元素（`@mafw/ui` V2 组件自带态的不动）：rail-session 行、dock 卡片、session tab、picker/列表行、菜单项、工具栏图标、rail-nav 项、Load-more 等。

- `:hover` 背景/前景过渡统一走 `--dur-fast` + `--ease-standard`；
- 补 `:active { background: var(--active); transform: translateY(.5px) }`（按压「下沉半像素」，无缩放抖动；对已含 `transform` 的元素改用 background 加深避免冲突）；
- `:focus-visible` 全局已有（`mafw.css:602`），仅补被 `outline:none` 覆盖处；
- 目标：`:active` 从 **4 处** 提升到覆盖主要交互面。

### W4 — 首帧 / 流式

- **session-turn 进场去抖**：`mafw-enter` 现每 turn 挂载即播，历史批量加载级联弹入。改为**只有新增/流式 turn 播进场**（历史加载批渲染时禁动画）。实现：turn 组件接 `animate` 布尔（由「是否为本次会话加载后新追加」驱动，纯逻辑可测）。
- **流式尾光标**：`--ease` → `--ease-standard`；reduced-motion 保持静态（已有）。
- thinking 折叠 / tool 完成态：**本轮只做过渡收口，不改信息结构**（避免与 v6 §3 语义撞车）。

### W5 — 收口 + 验收

- 全量把「错档」使用迁移到语义 token（表面用 `--dur-1`、微交互用 `--dur-3` 等改正）；`--dur-1..4` / `--ease` 标 `@deprecated` 保留别名，供未迁移处回退。
- ~~两主题 token 块去重 motion 段~~（**执行中撤销**：与 v5「复制，勿引用选择器」不变量 + `design-contract.test.ts` token v4 套件冲突）。
- 契约测试（沿用 `composer-toolbar-css.test.ts` 模式，纯文本读 CSS）：
  1. 语义 token 存在且值正确；
  2. 无新增硬编码时长（白名单仅循环动画集合）；
  3. `createPresence` 纯逻辑测试（挂载/延迟卸载/取消）；
  4. enter 门控纯逻辑测试。

## 4. 实施波次

| Wave | 内容 | 验收物 |
|---|---|---|
| W1 | 语义 token 层 + 循环动画建档 | token 契约测试 + 双主题构建 |
| W2 | `createPresence` + rail/dock 布局过渡 + tab/内容 | presence 单测 + 结构断言 + 手动过渡验收 |
| W3 | 微交互 hover/press/focus | `:active` 覆盖面断言 + 手动验收 |
| W4 | session-turn 进场门控 + 光标缓动 | 门控单测 + 手动验收 |
| W5 | 错档迁移 + token 去重 + 契约测试 + 人工验收 | 全量测试绿 + 双主题人工确认 |

每波独立 commit + 版本号 + 新增测试数与全量通过数汇报（用户惯例）。

## 5. 落地文件映射

| 区域 | 文件 |
|---|---|
| W1 token | `packages/desktop/src/renderer/mafw/mafw.css`（变量层 + 动效注释区） |
| W2 presence | `packages/desktop/src/renderer/mafw/components/presence.ts`（新）+ `presence.test.ts` |
| W2 rail/dock | `MafwShell.tsx`（rail/dock 挂载改 createPresence + grid 变量）、`mafw.css`（`.mafw-shell` / `.mafw-body` / `.mafw-rail-col` / `.mafw-rail`） |
| W3 微交互 | `mafw.css`（自绘交互元素 `:hover`/`:active` 面） |
| W4 首帧 | `ChatPane.tsx`（turn `animate` 门控）、`mafw.css`（enter / caret） |
| W5 测试 | `mafw/motion-tokens.test.ts`（新）、`components/presence.test.ts`（新，与 `composer-toolbar-css.test.ts` 并列） |
| 文档 | 本 spec + `AGENTS.md` §5.5 补 v7 动效条目 |

## 6. 测试与验收

- `cd packages/desktop && bun test`（新增 token 契约 + presence + enter 门控用例）+ `npx electron-vite build` + `npx tsgo -b`。
- **视觉验收由用户目视**（本环境视觉工具不可用、模型不支持图像输入）：双主题各截图归档，人工确认过渡顺滑、无抖动、按压手感一致。
- 性能护栏：只动 `width` / `grid-template-columns` / `opacity` / `transform`；折叠面加 `contain: layout` 隔离；reduced-motion 下全部降级（已全局覆盖）。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 折叠面常驻 → 子轮询空转 | `createPresence` 退出动画后卸载（ManagerCard/UsagePill timer 随卸载停止） |
| 宽/grid 过渡触发布局抖动 | 内层固定宽裁切（不回流）；`contain: layout`；只动可插值属性 |
| 大量 transition 回归 | 增量语义层、旧 token 保留别名；每波 build+test 门禁 |
| enter 去抖改错（该动的没动） | 门控逻辑单测（历史批 vs 新增 turn） |
| 我无法目视 | 用户目视验收 + 截图归档 |
| `grid-template-columns` 过渡非合成器加速 | 仅两列布局、280ms、桌面端可接受；必要时降级为不动画（保功能） |

## 8. 明确不纳入（YAGNI）

- 主题切换 crossfade / View Transitions API
- spring / 物理动画 / 动画库
- v5/v6 颜色 token 值变更、三栏骨架、信息结构（thinking/tool 元数据行）
- 玻璃拟态、新字体引入
- TUI 侧对齐（本轮仅 desktop）
