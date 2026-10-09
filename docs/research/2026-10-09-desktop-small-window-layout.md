# Desktop 小窗口布局：业界共识对照与本仓库诊断

> 日期：2026-10-09。承接 TUI 小窗口调研（`2026-10-09-tui-small-window-layout-research.md`），本文覆盖 **packages/desktop（Electron + SolidJS）**。
> 按用户决策走「业界共识」路线：不做逐家产品深挖，以桌面 chat/agent 应用的通行做法为基准（参照系：Slack/Discord/VS Code(Copilot Chat)/ChatGPT/Claude 桌面等 Electron 或 web 应用的普遍行为，及本仓库既有调研 `2026-09-28-desktop-topframe-layout-research.md` 等）。

## 1. 业界共识（桌面 chat/agent 应用）

| # | 共识 | 代表做法 | 我们的现状 |
|---|---|---|---|
| C1 | **主窗口设 minWidth/minHeight**——布局不破的下限，而不是允许缩到 0 | Electron 应用普遍设置（Discord ~940×500、Slack ~780×500 一档；有自定义 titlebar 的会算上 chrome 高度） | ❌ `windows.ts` BrowserWindow **无 minWidth/minHeight**（只有默认 1280×800 + 位置恢复） |
| C2 | **窄窗口侧栏自动降级**——<900~1000px 时 sidebar 收成图标栏（~72px）或 overlay 抽屉；手动折叠（Ctrl+B 类）是补充 | Discord/Slack icon rail；VS Code 辅助侧栏 overlay | ⚠️ Rail 可手动折叠（Ctrl+B / ResizeHandle collapseThreshold 120）且 180-400px 可调，但 **viewportNarrow(<1200) 只作用于 RightDock/tasks overlay，不触发 rail**；默认 264px 在 700px 窗口仍占 1/3 强 |
| C3 | **Composer 高度**：min 1-2 行，随内容增高到上限（~6-8 行），封顶后内部滚动 | Slack/ChatGPT/Claude/CS 桌面一致 | ✅ textarea min 52px / max 200px 超限滚动 |
| C4 | **Composer 宽度**：窄时次要控件进「+」溢出菜单或隐藏；模型/模式 pill 截断省略号或缩为图标；发送按钮恒显 | VS Code Copilot Chat 窄时收工具；各家 pill 均 ellipsis | ❌ toolbar 左侧 6 图标（附件/命令/Agent/审阅/语音播报/录音）+ 分隔线 + 权限 pill + 模式 pill，右侧 model pill（带文字）+ context pill + 发送；全部 `white-space: nowrap` 无 ellipsis，容器无 wrap/min-width 处理——chat 区 <~500px 时溢出/挤压 |
| C5 | **消息阅读列** `min(maxWidth, 100% - padding)` | 普遍 | ✅ `width: min(var(--msg-col-width), calc(100% - 64px))`（720px，>1500px 放大到 880px） |
| C6 | **面板/dock 窄窗 overlay 化** | 普遍 | ✅ viewportNarrow(<1200) 时 RightDock/tasks 变 overlay（Esc 可关） |
| C7 | **断点双向**：既有放大断点也有收窄断点 | 普遍 | ⚠️ 只有 `@media (min-width: 1500px)` 放大档，无收窄断点 |

## 2. 本仓库诊断（代码检视）

布局结构：`.mafw-shell` grid `auto 1fr × 38px 1fr`；左 Rail（`mafw-rail-wrap` 宽 = railWidth 信号，默认 264，ResizeHandle 180-400，可折叠）；顶 topstrip（38px，layout-toggle + SessionStrip overflow-x + dock 切换 + 窗口控制）；`.mafw-body` grid `1fr <dockWidth>px`；chat 内部：header 38px + scroll-wrap(flex:1) + composer（textarea 52-200px + toolbar 44px ≈ min 98px）。

小窗口问题按严重度：

| # | 问题 | 位置 | 触发条件 |
|---|---|---|---|
| D1（高） | 窗口可缩至任意小：高度 < ~250px 时 38px titlebar + 38px chat header + ~98px composer 互相挤压溢出；宽度可缩到 0 | `src/main/windows.ts` `createMainWindow`（无 minWidth/minHeight） | 用户随意拖拽 |
| D2（高） | 窄窗口 rail 不让位：<1200px 时 RightDock 已 overlay 化，但 rail 仍占 180-400px（默认 264px）→ 700px 窗口 chat 区仅 ~430px，触发 D3 连锁 | `MafwShell.tsx:1255` viewportNarrow 仅消费于 dock/tasks；rail 只响应手动 Ctrl+B | 窗口 < rail+合理 chat 宽 |
| D3（中） | composer toolbar 溢出：6 图标 + 2 文字 pill + model/context pill 全 nowrap 无省略，容器无收窄策略 | `ChatPane.tsx:1444-1620`（toolbar JSX）；`mafw.css:1318-1420`（pill 无 max-width/ellipsis） | chat 区 < ~500px |
| D4（低） | 极窄时 `calc(100% - 64px)` 两侧各 32px padding 偏大 | `mafw.css:1224/1269` | chat 区 < ~420px |
| D5（低） | `.mafw-chat { height: calc(100% - 24px) }` 在极矮窗口把溢出藏进 overflow:hidden，无「窗口太小」兜底提示 | `mafw.css:629` | 高度 < ~250px（D1 修复后不再可达） |

## 3. 修复（已实施）

| # | 修复 | 位置 | 对应共识 |
|---|---|---|---|
| F1 ✅ | BrowserWindow 加 `minWidth: 720, minHeight: 480`（chrome 合计 ≈ 190px，480 高度余量充足；720 宽度 = rail 折叠后 chat ~660px 可用）；恢复到的过小尺寸抬到下限、缺省坐标不下发 | `src/main/window-bounds.ts`（新，纯函数）+ `windows.ts` | C1 |
| F2 ✅ | 跨越 1200px 断点时**自动折叠 rail**（`railAutoAction` 纯函数：wide→narrow 折叠、narrow→wide 仅当是本组件自动折叠的才展开、同侧不动；自动折叠**不持久化**不覆盖用户偏好；mount 时窄窗口先收） | `src/renderer/mafw/layout-breakpoints.ts`（新）+ `MafwShell.tsx` | C2/C7 |
| F3 ✅ | composer 用容器查询 `@container (max-width: 560px)`：隐藏三个次要图标（审阅/语音播报/录音，加 `mafw-composer-optional`）+ composer-meta；model/agent pill 文本包 `mafw-model-name` 加省略号（max-width 160→96px） | `mafw.css` + `ChatPane.tsx` | C4 |
| F4 ✅ | `@media (max-width: 680px)` 下 composer 侧 padding 64→32px | `mafw.css` | C7 |
| F5 | 不做「窗口太小」占位页 | — | D1 修复后无意义 |

**验证**：TDD 新增 `src/main/window-bounds.test.ts`（3）+ `src/renderer/mafw/layout-breakpoints.test.ts`（5）= 8 例；desktop `bun test` 872 通过 / 0 失败；`electron-vite build` 绿（8.45s）。tsgo 对我改动文件零报错（现存 3 个报错在他人 WIP `tool-cards/*` 与既有 `ui/marked.tsx`）。

## 4. 验证方式

桌面无法像 TUI 那样纯代码断言帧，验证 = `electron-vite build` + 手动把窗口拖到 720×480 / 800×600 观察三项：rail 自动折叠、composer 不溢出、消息列正常。CSS 部分（F3/F4）可用渲染层断言（classList/data-attr 由媒体查询驱动，单测断言样式表规则存在 + 组件在窄容器下渲染的 DOM 不含被隐藏控件——bun test 渲染 ChatPane 成本高，先以样式表规则测试 + 手动冒烟）。

## 5. composer toolbar 溢出（2026-10-09 补，用户反馈）

**现象**：composer 的 44px 工具条内容宽度超出输入框边框（尤其 rail 展开/窗口偏窄时）。

**业界共识**（对话类应用的输入工具条如何处理空间不足）：
1. **工具条恒为单行**，不换行（换行会改变 composer 高度、破坏布局稳定）。
2. **按优先级降级**：先丢文本标签 → 次要按钮 → 更次要的 pill；发送按钮**永远保留且不收缩**。
3. **两种主流结构**：(a) 单行 + **溢出菜单**（`⋯`/`+` popover 收纳次要动作，Slack 格式栏 / VS Code Copilot Chat / Linear）；(b) **上下文与动作分行**——附件/模型/上下文 chips 独立一行（可横滚/换行），动作（发送等）固定右下（ChatGPT / Cursor / Cody）。共同点：动作行永不溢出。
4. **用容器查询而非视口断点**——composer 宽度取决于侧栏是否展开，`@container` 才是正确的判定源（Electron 42/Chromium 136 已支持）。
5. pill 文本 **ellipsis**，不撑破。

**我们的问题**（代码检视）：`ChatPane.tsx:1444-1625` 把「6 个图标 + 分隔线 + 权限 pill + plan/build pill + 右侧 meta/agent/model/context pill + 发送」全塞进一行；`.mafw-composer-left/right` 无 `min-width:0`、无收缩/裁切策略、pill 无省略；此前容器查询阈值 560px 低于常见 composer 宽（如 rail 收起时 683px），故不触发 → 溢出。

**修复（已实施，取共识 2+4+5 的精简版，未改结构）**：
- 结构护栏：`.mafw-composer-toolbar`/组 `min-width:0`；`.mafw-composer-left { flex:1 1 auto; overflow:hidden }`（不足时裁切自身、绝不外溢）；`.mafw-composer-right { flex:0 0 auto }`（含发送，恒完整）。
- 分档容器查询（`@container`，删掉旧 560 档）：**≤720** 隐藏次要图标（`mafw-composer-optional`：审阅/语音播报/录音）+ `composer-meta`、model-name ≤120；**≤620** 隐藏分隔线、model-name ≤96；**≤520** 隐藏上下文 pill、model-name ≤72、pill padding 收紧。
- 实测算术（rail 收起、composer 683）：720 档生效后内容 ≈ 568px < 683，不再溢出；结构护栏兜底。

**未采用**：共识 3(a) 溢出菜单 / 3(b) chips 分行——属结构性改版，留作后续（若后续动作继续增多再上 `⋯` 菜单）。

**验证**：样式契约测试 `composer-toolbar-css.test.ts`（2 例：结构护栏规则存在 + 分档阈值有序且优先级正确）；desktop `bun test` 874 通过 / 0 失败；`electron-vite build` 绿。
