# Desktop 主题架构审计 + 代码块主题脱节根因 + 业界对标

日期：2026-10-12。三路调研合并：①desktop 主题/字体颜色架构盘点；②chatview 代码块「白主题黑背景」根因定位；③业界代码高亮主题同步与设计 token 架构调研。

## 1. 现状架构（desktop 主题系统）

### 1.1 定义与加载链

```
oc-theme-preload.js（public/，index.html:14 同步）
  └─ 无条件写 documentElement.dataset.theme="oc-2" + data-color-scheme + #080808 底色
@mafw/ui styles → @mafw/session-ui styles → mafw.css（最后加载，同优先级赢）
mafw.css（4751 行，唯一定义点）：
  .mafw-shell {…}                                    暗色默认块（:2-99）
  html[data-theme="light"] .mafw-shell               手动亮色块（:101-180，压缩排版）
  @media prefers-color-scheme:light → html:not([data-theme]) .mafw-shell   系统亮色块（:183-226）
  body 三主题镜像块（Portal 弹层用，:234-390）
  .mafw-picker-pop 三主题块（第四个作用域，:1580-1650）
```

**同一 token 集有 ≈9 个手写重复定义点**（3 作用域 × 3 主题态）。「复制勿引用」是刻意不变量（根因：`<Portal>` 挂 document.body，token 只在 .mafw-shell 则 var() 解析失败弹窗透明，2026-09-22 事故），由 `design-contract.test.ts` 钉存在性——但**只钉存在性不钉跨块值一致性**（bg-float 同值仅钉 2 例）。

### 1.2 token 消费与字体颜色

- **平铺消费，无 primitive→semantic→component 分层**；组件直用 `var(--text-1)`。
- fallback 链指向未定义 token：`var(--text-6, var(--text-5))`（mafw.css:848，`--text-6` 从未定义）、`var(--success, #3fb950)`（:586）、`var(--border-strong, ...)`（:728/759/808）——消费方不知道 token 由哪层提供。
- 文字五阶（暗）：text-1 `#EDECE9` / 2 `#D1CFCA` / 3 `#8E8C86` / 4 `#5E5C57` / 5 `#42403C`（:30-34）。**对比度测试只有一条**（亮色 accent≥4.5）；text-4/5 在亮色的可读性无保障。
- **组件内联硬编码色 ~40 处**：ConnBanner、tool-cards/shared warn/err、UsageDock 图表 9 色、TtsPicker 8 渐变、TriagePage severity、EventInspector、Config #b91c1c、mafw.css 内部 mafw-tag-* / trajectory 紫 / 窗口关闭红。无 lint/测试拦截。

### 1.3 主题切换：三套信号并存

1. `html[data-theme]`（light/dark/删除=跟随系统）——MafwShell.tsx:713-747，localStorage `mafw-theme`；
2. `data-color-scheme`（上游 v2/session-ui 的主题门，必须双写）；
3. preload 的 `data-theme="oc-2"`（读另一套 localStorage 键 `opencode-color-scheme`），MafwShell 必须删除它否则系统跟随变死代码——**竞态温床**。
4. 上游 `packages/ui/src/styles/theme.css:360` 的 v1 token 暗色值由 **OS 级 `@media (prefers-color-scheme: dark)`** 门控——**不响应 app 内主题切换**（架构级盲区，见 §2）。

### 1.4 上游覆盖风险

mafw.css 在 `.mafw-shell` 重声明 v1/v2 同名 token（:49-70）+ 对 session-ui 用户气泡靠特异性魔术数（:1119-1122 注释「(0,5,1) beats (0,4,1)」）——**上游选择器一变即静默失效**。

## 2. 代码块「白主题黑背景」根因

### 2.1 渲染链路

```
SessionTurn → <Markdown>（packages/session-ui/src/components/markdown.tsx:355）
  → markdown-stream 分块（fenced code 拆出）
  → 代码块高亮 = Shiki（非 hljs/prism），主题对象 "OpenCode"（packages/ui/src/context/marked.tsx:9-378）
    · 流式：Web Worker codeToTokens → span 内联 color:var(--syntax-*)；pre 只有 class，无内联背景
    · 非流式：codeToHtml → pre 内联 background-color:var(--color-background-stronger)
  → pre 背景唯一定义：session-ui markdown.css:175-182 `.shiki { background: var(--color-background-stronger) }`
```

变量链：`--color-background-stronger` → `--background-stronger`（ui tailwind/colors.css:9，`@theme` 发到 `:root,:host`）→ desktop 按主题覆盖（mafw.css:52 暗 `#161513` / :142 亮 `#F3F1EB`）。

**没有任何写死的暗色 hex**（已验证打包产物）。`--syntax-*` 定义在 ui/theme.css:313-345（亮，:root 默认）/ :584-602（暗，OS 级 media）——**desktop mafw.css 从未定义 `--syntax-*`**。

### 2.2 根因假设（按嫌疑排序，需 DevTools 实测确认）

1. **黑底**：`--background-stronger` 在 pre 上解析到 `:root` 暗值 `#151515`（theme.css:368）。这只发生在 ①pre 逃出 `.mafw-shell`/`body` 作用域（Portal）；②`data-theme` 状态异常——preload 残留 `oc-2` 时 `html[data-theme="light"]` 与 `html:not([data-theme])` **两套亮色块都不命中**，shell 落回暗色默认。
2. **语法色脱节（同链已证实的盲区）**：OS 暗 + app 强制亮时，`--syntax-*` 走 OS media 的暗色板（浅色系字），亮背景下可读性崩。
3. desktop 侧无人修过（无 .shiki/pre 覆盖；marked.tsx 自 baseline 未动）。

### 2.3 修复面

- **一处收敛**：mafw.css 主题块补齐 `--syntax-*` + 代码块 token，语法色跟 app 主题而非 OS；同时兜底一切解析到 :root 的场景。
- **根治**：ui/theme.css:360 的 OS-media 暗色块改为同时响应 `html[data-theme="dark"]`/`[data-color-scheme="dark"]`；或 Shiki 主题对象改用双主题变量模式（§3）。
- 不改 markdown.css 的 `.shiki` 规则（它已经是对的 token 引用）。

## 3. 业界对标

### 3.1 代码高亮 × 主题同步（Shiki 三模式，https://shiki.style/guide/dual-themes）

| 模式 | 原理 | 特点 |
|---|---|---|
| `themes:{light,dark}` 默认 | span 输出 `color:#light;--shiki-dark:#dark` | 需 CSS 激活暗色（含 !important） |
| `defaultColor:false` | 只输出 `--shiki-light/--shiki-dark` 变量 | 完全 CSS 控制、N 主题可扩、无 !important |
| `defaultColor:'light-dark()'` | 生成 `color: light-dark(#l,#d)` | 零维护，要求 `:root{color-scheme:light dark}` |
| `createCssVariablesTheme()` | 颜色全映射 `--shiki-token-*` | **高亮色完全由 app token 供给，天然同步**；粒度粗（~10 类） |

hljs/Prism 无运行时双主题概念：换 `<link>` / 双主题合并进 media 选择器 / 手写 CSS 变量版主题。

编辑器/客户端：VS Code 与 Zed 都是「语法 scope 层与颜色层分离，换主题=换查表」；GitHub 用 Primer CSS 变量 + `data-color-mode` 三属性驱动；**ChatGPT/Claude/Cursor 代码块背景 = 独立 elevated 面 token（抬升一档，不与 app bg 同色），明暗两端分别校准，非同一套色反色**。

### 3.2 设计 token 架构（事实标准 = 三层）

- MD3：ref.palette → sys.color → comp；Primer：Base → Functional（响应 color mode）→ Component；SLDS：global → component hooks；Radix Themes：12 步色阶明暗同名。
- 共同结论：**组件只消费 semantic/component 层，primitive 永不直用；切换主题 = 切换 [data-theme] 下变量值，组件 CSS 零改动**。
- Style Dictionary/Tokens Studio 价值在多端+Figma 同步——单端 Electron 过度工程；**手写 CSS 变量 + [data-theme] 作用域（Primer 交付形态本质如此）够用**。
- `light-dark()`：Baseline 2024，Chrome 123+（Electron ≥30 可用），但只响应 color-scheme、与既有 [data-theme] 体系混用易乱——适合绿场，不适合增量改造。
- diff 着色业界做法：`color-mix(in oklab, var(--success) 15%, transparent)` 半透明层，明暗自动成立。

### 3.3 推荐方向

- **A（主修）**：Shiki `themes:{light,dark}` + `defaultColor:false` + `[data-theme]` 变量切换。单 HTML 双主题、切换零重渲染。成本：改 marked.tsx 主题对象 + ~10 行 CSS。缺点：HTML 体积翻倍。
- **B（最简、与 token 系统深度融合）**：`createCssVariablesTheme()`，语法色全来自 app token。着色丰富度弱于现成主题，但「融入设计语言」最强、零 override。
- **C（暂缓）**：全 token 迁 `light-dark()`——消灭三重重复，但与现有资产冲突大，仅在新 token 层重构时评估。
- **token 架构**：保留手写 CSS 变量 + `[data-theme]`，把「9 处重复」收敛为「primitive 单点 + 每主题一份 semantic 覆盖表」，component 只引 semantic；用构建期生成（小脚本）或 `:where()`/选择器合并消灭重复块，同步放宽 design-contract 的存在性钉扎为「值一致性」钉扎。

## 4. 痛点 → 重构机会对照

| 痛点 | 证据 | 重构方向 |
|---|---|---|
| 9 个手写重复定义点，人肉同步 | mafw.css 三作用域×三主题 | 生成式：单一源（TS/JSON）→ 构建期展开三作用域；或选择器合并（`.mafw-shell, body, .mafw-picker-pop` 共块）+ Portal 变量穿透验证 |
| 平铺消费、fallback 指向未定义 token | --text-6/--success/--border-strong | 三层收敛 + 契约测试改为「引用的 token 必须已定义」静态扫描 |
| 三套主题信号并存 + preload 竞态 | data-theme/data-color-scheme/oc-2 | 收敛为单一 data-theme + color-scheme 属性派生；preload 与 MafwShell 用同一 localStorage 键 |
| 上游覆盖靠特异性魔术数 | mafw.css:1119-1122 | @layer 收口第三方样式（`@layer upstream, mafw`），优先级声明式 |
| ~40 处内联硬编码色 | §1.2 | token 化 + stylelint `color-no-hex` 类规则/契约测试 |
| text-4/5 对比度无保障 | 仅 accent 一条测试 | design-contract 对 text-1..5 × 常用 bg 组合做 WCAG 对比度矩阵 |
| 代码块主题脱节 | §2 | 方向 A/B + `--syntax-*` 收口进 mafw token 块 + ui/theme.css OS-media 改响应 data-theme |
