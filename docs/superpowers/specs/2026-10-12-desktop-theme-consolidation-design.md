# Desktop 主题系统结构收敛 设计

日期：2026-10-12。状态：已批准（brainstorming 两决策：范围 A 纯结构收敛 / 选择器合并去重）。
前置调研：`docs/research/2026-10-12-desktop-theme-architecture-and-codeblock.md`（痛点清单 §4）。
范围纪律：**零视觉变化**——不增删颜色、不调色板、不动组件样式；纯结构与可测试性。

## 1. 背景与问题

mafw.css（~4900 行）的 token 定义存在 9 个手写重复定义点（3 作用域 `.mafw-shell` / `body` Portal 镜像 / `.mafw-picker-pop` × 3 主题态 暗色默认 / 亮色手动 / 亮色跟随系统）。「复制勿引用」是 2026-09-22 弹窗透明事故后的刻意不变量，由 design-contract.test.ts 钉**存在性**，但：

- 不钉跨块值一致性——9 块靠人肉同步，已观测到漂移风险（v7 动效 token 去重被测试反锁死而撤销）；
- 平铺消费 + fallback 链指向从未定义的 token（`--text-6`/`--success`/`--border-strong`）；
- 主题逻辑内联在 MafwShell（localStorage/matchMedia/双写 data-theme+data-color-scheme），不可单测；
- 主题信号曾有三套（data-theme / data-color-scheme / preload oc-2）——preload 同源化已于 2026-10-12 代码块修复中完成，本 spec 收敛剩余结构。

## 2. 设计

### 2.1 选择器合并：9 块 → 3 块

每个主题态只保留一个规则块，选择器列全部作用域：

```css
/* 暗色默认 */
.mafw-shell, body, .mafw-picker-pop { color-scheme: dark; …全量 token… }

/* 亮色手动 */
html[data-theme="light"] .mafw-shell,
html[data-theme="light"] body,
html[data-theme="light"] .mafw-picker-pop { color-scheme: light; …全量 token… }

/* 亮色跟随系统 */
@media (prefers-color-scheme: light) {
  html:not([data-theme]) .mafw-shell,
  html:not([data-theme]) body,
  html:not([data-theme]) .mafw-picker-pop { color-scheme: light; …全量 token… }
}
```

要点：
- 逗号选择器列表中每个选择器保持原有特异性，覆盖关系不变。
- `body` 作用域保留：`<Portal>` 弹层挂 document.body（2026-09-22 事故根因），不能丢。
- 实施第一步先验证 `.mafw-picker-pop` 独立块（mafw.css ~1580-1650）的 token 子集是否已完全被 body 块覆盖：若 picker 弹出层挂 body（portal），其独立块可整体删除、不进入合并选择器；若挂 shell 内同理。以代码证据为准，两可时保守保留进合并列表。
- 合并后「每主题 token 集合」= 现三块并集（含代码块 `--syntax-*` / `--color-background-stronger` 与 v6/v7 token）；键集以暗色块为准对齐另两块。
- body 块里的 token 会被 shell 继承，shell 自身定义更近故胜出——与今天行为一致。

### 2.2 主题逻辑抽模块 `src/renderer/mafw/theme.ts`

纯函数/窄副作用模块（DOM 操作注入或限定在模块内、逻辑可测）：

```ts
export type ThemeChoice = "light" | "dark" | null   // null = 跟随系统
export function readSavedTheme(storage: Pick<Storage,"getItem">): ThemeChoice
export function nextTheme(current: "light"|"dark"): "light"|"dark"
export function applyTheme(root: HTMLElement, choice: ThemeChoice, systemLight: boolean): void
//   saved → 写 data-theme + data-color-scheme；null → 移除 data-theme，按 systemLight 写 data-color-scheme
```

MafwShell 的 onMount/toggleTheme 改为薄壳调用 theme.ts；与 preload（public/oc-theme-preload.js）读写同一 `mafw-theme` 键的契约会话内注释互相引用。bun 单测覆盖：三态读取、两态循环、applyTheme 四分支（saved light / saved dark / null+系统亮 / null+系统暗）。

### 2.3 未定义 token 兜底别名（零视觉变化）

在合并后的主题块中补齐今天被引用但未定义的 token，别名值 = 现行 fallback 实际生效值：

| token | 全部主题块 | 现行 fallback 证据 |
|---|---|---|
| `--text-6` | `var(--text-5)` | mafw.css `var(--text-6, var(--text-5))` |
| `--success` | `#3fb950` | `var(--success, #3fb950)` —— 消费处不分主题，别名须等于该固定值 |
| `--border-strong` | `var(--text-5)` | `var(--border-strong, var(--text-5))` |

原则：别名值一律等于「当前实际渲染值」（fallback 链的生效结果），保证逐像素零变化。
`--text-interactive-base` 由上游 ui theme.css 提供（已定义），不处理。

### 2.4 契约测试升级

`tests/design-contract.test.ts` + 新 `src/renderer/mafw/theme-merge-css.test.ts`：

1. **作用域覆盖**：每个主题块的规则其选择器文本必须同时匹配 `.mafw-shell`、`body`、（若保留）`.mafw-picker-pop` 三个作用域——替代原「九块各自存在」断言。
2. **键集一致**：三个主题态块解析出的 token 键集合完全相等（防某主题漏 token）。
3. **v5 色板钉扎迁移**：现有精确 hex 断言（#100F0E/#FAF9F5/#4FD388 等）改指向合并块，值不变。
4. **悬空引用扫描**：静态提取 mafw.css 全部 `var(--x)` 引用，断言每个 `--x` 在 mafw.css 或上游（packages/ui theme.css、session-ui css）有定义；白名单机制留给刻意上游依赖。
5. theme.ts 的 bun 单测（§2.2 四分支）。

## 3. 非目标

- 三层 token（primitive/semantic/component）分层 —— 范围 B
- 组件内联硬编码色清理 + lint 拦截 —— 范围 B
- `@layer` 收口上游覆盖、text 对比度矩阵、Shiki createCssVariablesTheme —— 范围 C
- `light-dark()` 迁移 —— 调研结论：与既有 [data-theme] 资产冲突，不做
- ui/theme.css 的 OS-media 暗色块改 data-theme 门控 —— 代码块修复已在 mafw 侧就地覆盖，上游改造留后续

## 4. 验证

- `cd packages/desktop && bun test` 全绿（含新契约与 theme 单测）
- `npx electron-vite build` 绿
- 目视冒烟：亮/暗/跟随系统三态切换 + Config 弹窗（Portal）背景不透明 + 代码块两主题底色正确
