# MAFW 工作台界面美化 — 设计开发文档

> 基于当前 MAFW Desktop 界面截图的整体视觉重构方案。
> 本文档 = 现状诊断 → 设计方向 → Design Tokens → 分区改造规格 → 动效 → 实现要点 → 验收清单。
> Tasks 面板部分沿用《任务列表面板组件-开发文档》，本文不再重复其内部规格。

---

## 1. 现状诊断

从截图提取的当前色板与问题：

| 现有值 | 用途 | 问题 |
|---|---|---|
| `#101010` | 侧栏 / 导航 / 全局底色 | **全局一个灰度平铺**，侧栏、导航、聊天区之间没有层级，靠 1px 灰线硬切 |
| `#151515` | 标题栏 | 与下方区域几乎无区分，窗口感弱 |
| `#316746` | 侧栏选中态 | 选中=整条绿底，过重；且与 Manager 徽章是两套绿，**品牌绿不统一** |
| `#5DC63B` | Manager 徽章 | 亮绿 pill 在暗色列表里非常跳，4 个连用导致侧栏视觉噪音 |
| `#AEAEAE` | 正文 | 正文与次要文字几乎同色，**字层级只有一档** |
| `#242624` | Tasks 面板 | 浮在聊天区上方但与输入框无呼应，像游离元素 |
| `#191919` | Send 按钮 | 与输入框底色差太小，可用性弱（看着像禁用） |

核心问题归纳为四条：

1. **无层级**：背景只有 `#101010` 一档，所有分区靠描边分隔，信息密度高的页面显得"平且闷"。
2. **绿色滥用**：品牌绿出现在选中条、4 个徽章、状态点、标题点，到处都是高亮 = 没有高亮。
3. **字阶塌陷**：标题、正文、次要、辅助文字拉不开差距，长会话的可扫读性差。
4. **组件孤岛**：Tasks 面板、输入框、聊天气泡各自为政，圆角/间距/阴影不成体系。

---

## 2. 设计方向

**"深色分层 + 单点品牌绿"**

- **Elevation 分层**：用 4 级背景高度替代描边分隔（base → raised → overlay → float），层级靠明度差，不靠线。
- **绿色收口**：品牌绿只保留 3 处语义用途 —— ① 连接/运行状态 ② 主操作（Send）③ 当前激活指示（nav/会话）。徽章、选中底一律改用中性色 + 左侧 2px 绿条。
- **字阶拉开**：建立 6 级文字色阶，正文提白、辅助压暗，长文本可扫读。
- **圆角与间距成体系**：8px 间距网格，圆角只有 6 / 10 / 16 / 999 四档。

---

## 3. Design Tokens

### 3.1 背景层级（Elevation）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-base` | `#070709` | 窗口底色（标题栏、侧栏最底层） |
| `--bg-raised` | `#0E0E12` | 主内容区（聊天区、面板页） |
| `--bg-overlay` | `#16161B` | 卡片、用户气泡、悬浮块 |
| `--bg-float` | `#1F1F26` | 输入框、popover、AskCard/PermissionCard |
| `--bg-hover` | `rgba(255,255,255,.04)` | 行 hover |
| `--border-subtle` | `rgba(255,255,255,.07)` | 仅用于必要的分隔（导航下缘、卡片描边） |

> 明度阶梯：07 → 0E → 16 → 1F，**每级 7–9% 明度差**（v2 曾收窄到 5%，实际落地层级不可辨，v3 重新拉开）。分隔线大幅减少，让层级靠"面"表达。

### 3.2 品牌绿（收口后）

| Token | 值 | 用途 |
|---|---|---|
| `--accent` | `#46DC82` | 状态点、主按钮、激活指示条 |
| `--accent-dim` | `rgba(70,220,130,.13)` | 激活态底色（nav pill、会话行） |
| `--accent-text` | `#7FE3A6` | 需要绿色的文字（如 connected 状态） |

> 从 `#5DC63B` 演进至 `#46DC82`：深底色上保持足够辨识度（v2 的 `#3FD07A` 偏闷），同色族统一选中态/徽章/状态点。

### 3.3 文字色阶（6 级）

| Token | 值 | 用途 |
|---|---|---|
| `--text-1` | `#ECECF0` | 页面标题、会话标题 |
| `--text-2` | `#CFCFD6` | 正文、消息内容 |
| `--text-3` | `#8C8C94` | 次要说明、参数文本 |
| `--text-4` | `#5C5C64` | 时间戳、辅助信息、placeholder |
| `--text-5` | `#404047` | 禁用态 |

### 3.4 双主题：跟随系统 + 手动覆盖

所有色板不做成编译期常量，而是 **CSS 变量 + 两套变量值**：

- **暗色（默认）**：即 §3.1–3.3 的值，定义在 `:root`；
- **亮色**：定义在 `[data-theme="light"]` 与 `@media (prefers-color-scheme: light)` 下的 `:root:not([data-theme])`——
  无手动选择时跟随系统，系统切换自动响应；手动切换后写入 `localStorage` 并设置 `data-theme` 覆盖媒体查询；
- 标题栏放日/月切换按钮；`color-scheme: dark|light` 同步声明，让滚动条、表单控件等原生部件跟着变。

亮色 Tokens：

| Token（暗 → 亮） | 亮色值 | 说明 |
|---|---|---|
| `--bg-base / raised / overlay / float` | `#ECECF0 / #FAFAFB / #EDEDF1 / #FFFFFF` | 亮色下层级反转：内容区最亮，侧栏略灰，浮层纯白靠阴影托起 |
| `--text-1~5` | `#17171B / #34343B / #5E5E66 / #8E8E96 / #B9B9BF` | 六级灰阶 |
| `--accent / dim / text` | `#1F9D5A / rgba(31,157,90,.10) / #177A48` | 白底上绿色必须加深降纯，否则发飘 |
| `--on-accent` | `#FFFFFF`（暗色为 `#070709`） | Send 按钮上的箭头色 |
| `--border-subtle` | `rgba(0,0,0,.09)` | |
| `--hover / hover-strong / active / pill` | `rgba(0,0,0,.04 / .06 / .05 / .05)` | 亮色下交互反馈全部改用黑透明度 |
| `--shadow-float` | `0 8px 24px rgba(0,0,0,.10), 0 0 0 1px rgba(0,0,0,.04)` | |
| `--glow-accent` | `0 0 8px rgba(31,157,90,.30)` | |
| `--scrollbar / selection / focus-ring` | `rgba(0,0,0,.15) / rgba(31,157,90,.18) / rgba(31,157,90,.35)` | |
| `--composer-focus / halo` | `rgba(31,157,90,.45) / rgba(31,157,90,.10)` | |
| `--tasks-glow` | `radial-gradient(ellipse at right, rgba(31,157,90,.07), transparent 60%)` | ~~Tasks 面板右侧辉光~~ **已废弃**（Tasks 迁右侧 Dock 后平铺无辉光，§4.6）；变量保留兼容，新代码勿用 |

切换逻辑（10 行）：

```ts
const mq = matchMedia('(prefers-color-scheme: light)');
const saved = localStorage.getItem('mafw-theme');
if (saved) document.documentElement.dataset.theme = saved;   // 手动覆盖优先
mq.addEventListener('change', repaint);                      // 系统切换自动跟随
function toggle() {
  const cur = document.documentElement.dataset.theme || (mq.matches ? 'light' : 'dark');
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('mafw-theme', next);
}
```

> Electron/Tauri 里建议同时用 `nativeTheme.themeSource = 'system'` 保证窗口框架（标题栏按钮、菜单）同步；页面层仍以上述 CSS 变量为准。

> **覆盖第三方组件 token 时注意作用域**：如需同步覆盖 session-ui 的 `--v2-*` 变量（气泡、ButtonV2 等），把覆盖规则限定在 MAFW 容器选择器下（如 `.mafw-root[data-theme="light"] .session-ui-scope` 或 `.mafw-root` 内的变量重声明），不要全局重定义，避免主题泄漏到 Goals/Memory 等其它页面。

### 3.5 字阶 / 圆角 / 间距 / 阴影

```
字阶:  12(--text-4) / 13(辅助) / 14(正文默认) / 15(行标题) / 17(--text-1 标题)
行高:  正文 1.55；列表行 1.3
字重:  400 正文 / 500 行标题 / 600 区块标题
数字:  font-variant-numeric: tabular-nums（耗时、token、计数徽章必选）

圆角:  6px(小元素/bubble-tight) 10px(卡片/输入框) 16px(浮层) 999px(pill/徽章)
间距:  4 8 12 16 20 24 32（8px 网格）

阴影:
  --shadow-float: 0 8px 24px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.05)
  --glow-accent:  0 0 10px rgba(70,220,130,.30)   （仅状态点、运行指示）
```

---

## 4. 分区改造规格

### 4.1 窗口标题栏

| 现状 | 改造 |
|---|---|
| 与下方同色，平面 | 底 `--bg-base`；高 `38px`；`MAFW` 字标 13px/600 `--text-2`，绿点 6px 带 `--glow-accent` 脉动（2s） |
| 窗口控制默认样式 | 三个控制按钮 28×38 hover 分别 `--bg-hover`；关闭键 hover `#E5484D` |
| 无拖拽区语义 | 整栏 `-webkit-app-region: drag`，按钮除外 |

### 4.2 顶部导航（Chat / Goals / Memory / Approvals / Triage / Automation）

| 现状 | 改造 |
|---|---|
| 纯文字+图标排一行，激活态仅文字变亮 | **分段 pill 组**：整体容器 `--bg-base`，高 `44px`，下缘 1px `--border-subtle` |
| | 每个 tab：icon 15px + 13px/500，padding `6px 12px`，圆角 8px |
| | 激活态：`--accent-dim` 底 + `--text-1` 文字 + icon 染 `--accent`；非激活 `--text-4`，hover `--text-2` |
| | 带计数的 tab（Approvals 等待办）右侧挂 16px 计数徽章：`--bg-overlay` 底 `--text-3`，有待办时 `--accent-dim` 底 + `--accent-text` |

### 4.3 侧边栏（History）

**结构**：`History 分组头 → 工作区树 → 会话列表 → 底部状态栏`

| 元素 | 规格 |
|---|---|
| 侧栏容器 | 宽 `264px`，底 `--bg-base`，右缘 1px `--border-subtle` |
| 分组头 | `HISTORY` 12px/600 `--text-4` 大写 letter-spacing .08em + 右侧计数（13px tabular `--text-4`）+ hover 出现"折叠/搜索"图标按钮 |
| 工作区文件夹行 | 高 32px，icon 14px `--text-4`，名称 13px/500 `--text-2`；两行的名称不再硬折行，`truncate` 一行显示 |
| 会话行（Manager × 4） | 高 36px，圆角 8px，左右 padding 8px。**取消亮绿 pill 徽章**：改为 ① 行首 20px 方形 agent 图标位（`--bg-overlay` 圆角 6px，内嵌 glyph `--text-3`）② 名称 13px `--text-2` ③ 角色标签（Manager）降级为 11px `--text-4` 纯文字或 `--bg-overlay` 小徽章 |
| 选中态 | **左侧 2px `--accent` 指示条 + `--bg-hover` 底 + `--text-1` 文字**，不再整条绿底 |
| 历史行 | 高 30px，13px `--text-3` truncate + 右侧日期 11px `--text-5`，hover 时日期让位给"⋯"操作按钮 |
| 日期分组 | 超过 20 条时按"今天 / 昨天 / 7月"分组插 sticky 小标题（11px `--text-5`） |
| 底部状态栏 | 高 32px 上缘 1px `--border-subtle`。**全窗口唯一状态条**（合并原根 StatusBar 能力），三态：① `connected` = 6px `--accent` 呼吸点 + `connected :3000` 12px tabular `--text-4`；② `reconnecting` = 琥珀点 `#E7A13D` 脉动 + `Reconnecting…`；③ `failed` = 红点 `#E5484D` + `连接失败` + 行尾 **restart 小按钮**（高 22px、圆角 6px、`--bg-overlay` 底、11px `--text-2`）+ **整条右键菜单**（承接原根 StatusBar 的菜单项：restart / 日志等）。gateway 自动重启失败耗尽重试后，此按钮是 failed 态唯一出口，不可省 |

### 4.4 会话 Tab 条（Manager +）

| 现状 | 改造 |
|---|---|
| 一行文字+"+" | 高 `36px`，底 `--bg-base`；tab 为 10px 圆角小卡 `--bg-overlay`（激活）/ 透明（未激活 hover `--bg-hover`），内含 agent 色点 + 名称 13px + hover 显示 × |
| | "+" 按钮 24×24 圆角 6px `--text-4` hover `--text-2`；tab 可拖拽换位、可滚轮横滚 |

### 4.5 聊天主区

| 元素 | 规格 |
|---|---|
| 容器 | 底 `--bg-raised`；消息列居中、水平 padding 32px，**列宽随视口分档**（宽屏不再两侧大留白）：默认 `760px`，视口 ≥1500px → `880px`，≥1800px → `1000px`，≥2200px → `1100px`（上限保可读性，不再加宽）；Composer、AskCard/PermissionCard 全部跟随同一列宽；Tasks 为顶部指示条（§4.6 v3），不参与聊天列宽——分档以聊天区实际宽度为准；Pin 成 Dock 时聊天区变窄、列宽自然重排 |
| 聊天头部行（Agent 头 + 任务指示区，v3.1） | **固定于聊天区顶部（移出滚动容器，非 sticky）**：h-10（40px）、`--bg-raised` 实底 + 下缘 1px `--border-subtle`。行内：20px 圆形 agent 头像位（`--accent-dim` 底 + glyph）→ 名称 15px/600 `--text-1` → 竖分隔线（14px×1px `--border-subtle`）→ **任务指示区（flex-1，Tasks 组件 bar 形态的宿主，见 §4.6）** → 兜底状态点 `● Running`（12px `--accent-text`，仅 dock 态或无任务时显示，此时原"右侧状态"由它承担）。底缘叠 2px `--accent` 进度细线（宽度 = done/total，圆角右端）；下缘 12px 渐变遮罩（raised→transparent），防消息滚动穿透 |
| 推理正文 | 14px `--text-2` 行高 1.55，段间距 14px |
| 行内代码（`todo`、`session.todo`） | 12.5px mono，`--bg-overlay` 底 + 1px `--border-subtle`，圆角 5px，padding `1px 5px`，`--accent-text` 或 `--text-2`（二选一，建议正文里用 `--text-2`，只有可点击的引用才用绿） |
| "Explored 2 searches" 工具块 | **卡片化**：`--bg-overlay` + 圆角 10px + 1px `--border-subtle`；头部 32px：左侧 14px 工具图标 `--text-3` + 标题 13px/500 `--text-2`（"Explored"）+ 计数徽章（11px `--bg-float` `--text-3`）+ 右侧 chevron 折叠 |
| 工具块子行 | 左缘 2px `--border-subtle` 缩进线；每条 = 工具名 12px mono `--text-3` + 参数 12px mono `--text-4` truncate；hover 整行 `--bg-hover` 可复制命令 |
| 用户气泡 | 右对齐，max-width 70%；底 `--bg-overlay` + 1px `--border-subtle`，圆角 `16px 16px 4px 16px`，padding `10px 14px`，14px `--text-1`；下方可挂 11px 时间戳 `--text-5`（hover 显示） |
| 消息间分隔 | 不再用空行硬撑：user→agent 切换时间距 24px，同角色连续消息间距 8px |

### 4.6 Tasks 面板（任务指示条 + 可 Pin 的 Dock）

> v3 改判：默认形态从"右侧常驻 Dock"再降为**任务指示条（TaskBar）**——用户 90% 的时间只想知道"现在在做什么、做到哪了"，32px 一行足够；完整清单收进点击弹出的浮层；需要挂机盯多任务时 📌 钉成右侧 Dock。v2 的常驻 Dock 有一个隐性成本：320px 是永久税，且清单只填顶部一小块、空面板感明显。内部行规格全部沿用《任务列表面板组件-开发文档》（v2.1 图标制 + §9.1 密度模型），本节只定义摆放与形态切换。
>
> **v3.1（2026-08-05）**：指示条不再独立成行——**并入聊天头部行**（§4.5，与 Agent title 同一行，竖分隔线后 flex-1 居中），聊天区常态成本从 32px 降为 **0**（头部行本来就在）；底缘 2px 进度细线随之移到头部行底缘。原"● Running"状态点与 spinner 去重：有任务时显示任务指示区，dock 态/无任务时显示状态点。

**形态状态机**：`bar（默认）⇄ bar + popover（点击 / Ctrl+J）→ dock（📌 Pin）→ bar（收起 / Ctrl+J）`；形态按会话记忆（`localStorage('mafw-tasks-placement')`）。

| 项 | 规格 |
|---|---|
| **任务指示区（bar，v3.1）** | **嵌入 §4.5 聊天头部行**：Agent 名 + 竖分隔线之后、`flex-1` 占据行中，随头部行固定于聊天区顶部、不随消息滚动；进度细线 = 头部行底缘 2px `--accent`（宽度 = done/total，圆角右端）。聊天区不再为它付出额外行高 |
| 指示区内容 | 与聊天列同宽对齐（同一列宽类）：spinner 12px + 当前任务文本（13px `--text-1`，truncate）+ 旗帜（仅 high）→ 右侧：`n/N`（11px `--text-3`）+ 迷你进度轨（48×3px，`--pill` 底 + `--accent` 填充，<640px 隐藏）+ 耗时（11px `--text-4`）+ chevron 9px |
| 指示区：空态 | **无任务时指示区隐藏**，头部行退化为纯 Agent 头（`● Running` 状态点回到行右）；无 running 时显示最近一条 completed（或首条 pending），spinner 换静态图标 |
| 指示区：hover/点击 | 整块为 button：hover `--hover` 底 + 圆角 6px；点击（或 `Ctrl/Cmd+J`）开/关弹层清单，chevron 旋转 180° |
| **弹层清单（popover）** | 锚定头部行下方 2px、水平居中，宽 `min(560px, 100% - 32px)`；`--bg-float` + 1px `--border-subtle` + 圆角 12px + `--shadow-float`；Header（Tasks 13px/500 + 指标 pill + `n/N` + 📌 + ×，均 22×22 图标钮）；列表 `max-height: 320px` 内滚，复用 §9.1 密度模型与全部行规格；Esc / 点击头部行外部关闭 |
| **📌 Pin 到 Dock** | 点击 📌：清单迁移到右侧 Dock（320px，`--bg-base` 平铺、左缘 1px 分隔线、`flex-1` 全高滚动——v2 规格全部沿用），**指示区同时隐藏、头部行行右改显 `● Running` 状态点**（Dock 已全量展示，不重复）；Dock Header 的收起按钮 = "拔回指示区" |
| 快捷键 | `Ctrl/Cmd + J`：bar 形态开/关弹层；dock 形态拔回 bar |
| 窄屏 | 指示条不受影响（本来就不占横向）；Dock 在 < 1200px 时仍按 v2 规则变 overlay 浮层 |
| 出现/消失 | run 开始：指示区在头部行内淡入（fade 200ms）；全部完成：计时冻结、进度细线走满、文本变 `✓ 全部完成（N/N）`，**不再自动收起**（不占额外行高，无让位压力）；新 run 重置 |
| 聊天列宽 | §4.5 分档以聊天区实际宽度为准；头部行（含指示区）/Dock 都不参与列宽计算 |

废弃说明：`--tasks-glow` 辉光、"输入区组合件"提法、消息列表底部 `padding-bottom` 预留、40px 收起竖条（v2），全部废弃——v3 的"常驻"由指示条承担。

### 4.7 输入框（Composer / InputBar）

结构：**外层容器 = textarea + 底部工具条**，独占输入区（Tasks 面板已迁右侧 Dock，§4.6；输入区只剩 Composer 一件）。

| 元素 | 规格 |
|---|---|
| 容器 | `--bg-float` + 圆角 16px + 1px `--border-subtle`；无独立阴影（`--shadow-float` 只留给 popover 与 Tasks Dock 的窄屏 overlay 态） |
| 容器：聚焦 | 描边 `var(--composer-focus)`（暗 `rgba(70,220,130,.40)` / 亮 `rgba(31,157,90,.45)`）+ 外圈 3px 光晕 `var(--composer-halo)`；背景不变，过渡 150ms |
| textarea | 字号 14px `--text-1`、行高 1.5、水平 padding 16px、上 padding 14px；`caret-color: var(--accent)`；placeholder 14px `--text-4`；`resize: none`；`outline: none`（焦点态全部由容器表达） |
| 自动生长 | 最小高 52px（单行），最大 200px（约 9 行），超出内部滚动；JS：`height='auto'` → `min(scrollHeight, 200)`；清空后回缩单行 |
| 底部工具条 | 高 44px，padding `0 10px 10px`；左起：`+` 附件、`@` 引用 agent；右起：模型选择 pill + Send |
| 图标按钮（`+` / `@`） | 28×28，圆角 6px，icon 14px `--text-4`；hover `--hover-strong` 底 + `--text-2`；`title` 提示（"附件" / "引用 Agent"） |
| 模型选择 pill | 高 28px，圆角 8px，`--bg-overlay` 底 + 12px `--text-3`，hover `--text-2`；内容 = 当前 agent/模型名 + 9px chevron；点击弹选择菜单（菜单本身沿用 `--bg-float` + `--shadow-float`） |
| **Send 主按钮** | 32×32，圆角 8px，`--accent` 底 + `var(--on-accent)` 箭头（↑ 14px，stroke 1.6）——**不要写死 `#0C0C0E`**：暗色 `--on-accent = #070709`、亮色 `--on-accent = #FFFFFF`；hover 仅 105% 亮度（filter brightness(1.05)），无位移 |
| Send：禁用 | 空输入时 `opacity: .4` + `cursor: default`，底色保留（明确它是主操作而非消失） |
| Send：发送中 | agent 运行期间变为停止键：同尺寸同底色，图标换 ■ 10px；点击中断当前 run |
| 快捷键提示 | 聚焦时右下淡显 `Enter 发送 · Shift+Enter 换行` 11px `--text-5`（**用纯文本**：`⏎`/`⇧` 字形在部分平台字体缺失）；失焦隐藏；`Enter` 发送、`Shift+Enter` 换行 |
| 选中文本 | textarea 内沿用全局 `var(--selection)` |

禁用/空态细节：整个 Composer 不整体禁用——会话运行中仍可输入（排队发送），仅 Send 切换为停止键；agent 断开（`connected` 丢失）时 placeholder 变为 "Reconnecting…" 且 textarea `disabled`。

### 4.8 滚动条与全局

```
滚动条: 8px 宽，thumb rgba(255,255,255,.09) 圆角 4px，hover .16；track 透明
选中文本: background rgba(70,220,130,.22)
焦点环: 所有可聚焦元素 outline: 2px rgba(70,220,130,.45)，仅 :focus-visible
```

---

## 5. 动效规范（全局克制）

| 场景 | 参数 |
|---|---|
| hover 变色 | 120ms ease-out，仅颜色/透明度 |
| 折叠/展开（工具块、Tasks） | grid-rows 或 height 过渡，200ms ease-in-out |
| 新消息/新任务行进入 | translateY 8px + fade，200ms， stagger 40ms |
| 状态点呼吸 | opacity .5↔1，2s infinite（仅"运行中"和"已连接"两处） |
| 页面/tab 切换 | 不做位移，仅内容 150ms fade |
| 禁用 | 禁止弹性回弹、禁止 >300ms 的动画——工具型界面，动画是反馈不是装饰 |

---

## 6. 实现要点（SolidJS + Tailwind）

```ts
// tailwind.config.ts — theme.extend：全部映射到 CSS 变量，不写死色值
colors: {
  base:    'var(--bg-base)',
  raised:  'var(--bg-raised)',
  overlay: 'var(--bg-overlay)',
  float:   'var(--bg-float)',
  accent:  { DEFAULT: 'var(--accent)', dim: 'var(--accent-dim)', text: 'var(--accent-text)' },
  ink:     { 1:'var(--text-1)', 2:'var(--text-2)', 3:'var(--text-3)', 4:'var(--text-4)', 5:'var(--text-5)' },
},
borderColor: { subtle: 'var(--border-subtle)' },
boxShadow: { float: 'var(--shadow-float)', glow: 'var(--glow-accent)' },
borderRadius: { card: '10px', layer: '16px' },
```

变量定义在全局 CSS（`:root` 暗色 + `[data-theme="light"]` 亮色 + `prefers-color-scheme` 媒体查询，见 §3.4）。
组件里的交互态同样用变量：`hover:bg-[var(--hover)]`、`bg-[var(--active)]`、`bg-[var(--pill)]`、`text-[var(--on-accent)]`——**禁止再出现 `bg-white/[.x]` 这类写死白透明度的类**，否则亮色主题下全部失效。

落地顺序建议（按收益/成本比）：

1. **背景四级分层 + 文字六色阶**（纯换 token，半天，收益最大——立刻不"平"了）
2. **侧栏选中态与徽章收口**（去掉整条绿底和亮绿 pill，换指示条方案）
3. **导航 tab pill 化 + 会话 tab 小卡化**
4. **Composer 重构**（Send 主按钮、聚焦光晕、自动生长）
5. **工具块卡片化 + Tasks 面板悬浮对齐输入框**
6. 动效与滚动条收尾

迁移注意：

- 现有组件里的硬编码色值（`#101010`、`#316746`、`#5DC63B`）全局搜索替换为 token 引用，避免新旧两套并存。
- Manager 徽章若承载了"运行中"语义，不要删——改为图标位内的小绿点或行尾 11px 状态文字。
- Tasks 为聊天区顶部的 32px 指示条（§4.6 v3）：消息列表底部**不再需要**为面板预留 padding；Pin 成右侧 Dock 时会改变聊天区宽度，列宽分档须以聊天区实际宽度驱动（container query / ResizeObserver），不要用视口宽度硬算。

---

## 7. 验收清单

- [ ] 四级背景（07/0E/16/1F）全量替换，四级明度差肉眼可辨，页面无 `#101010` 平铺感
- [ ] 品牌绿仅出现在：状态点、Send、激活指示（≤3 类语义）
- [ ] 侧栏选中 = 2px 指示条 + 浅底，无整条绿底、无亮绿 pill
- [ ] 文字六色阶落地，正文与辅助文字一眼可分
- [ ] 导航/会话 tab 激活态为 `--accent-dim` pill/卡片
- [ ] 工具块（Explored N searches）卡片化且可折叠
- [ ] 任务指示区并入聊天头部行（与 Agent title 同一行，仅 run 期间存在），底缘 2px 进度细线 + 当前任务 + n/N + 耗时一眼可读；无任务时头部行退化为纯 Agent 头（● Running 状态点在行右）
- [ ] 点击条弹完整清单（复用密度模型）；📌 可钉成右侧 Dock、收起可拔回；`Ctrl/Cmd+J` 开合
- [ ] 视口 < 1200px 时 Dock 变 overlay 浮层，不推挤聊天区，点击外部/Esc 关闭
- [ ] Send 为品牌绿主按钮，空输入 40% 透明度
- [ ] 输入框聚焦有绿色描边 + 光晕
- [ ] 全部动画 ≤300ms，无回弹
- [ ] 数字（耗时/token/计数）全部 tabular-nums
- [ ] 颜色全部走 CSS 变量，无写死的 hex / 白透明度类
- [ ] 亮色主题四级背景（EF/FA/F1/FF）+ 深绿 `#1F9D5A` 落地
- [ ] 默认跟随 `prefers-color-scheme`，系统切换无刷新自动生效
- [ ] 手动切换写入 localStorage 并覆盖系统；重启后保持
- [ ] 亮色下 hover / 选中 / 辉光 / 焦点环全部清晰可辨（黑透明度系）
