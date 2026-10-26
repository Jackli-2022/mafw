# Agent 工作台布局与信息架构设计（左 rail / ChatView / 右工作台）

日期：2026-10-26
状态：**B/B1 已由产品在视觉伴侣确认；builder check 已收口；本 spec 待终审**
过程：brainstorming 会话 + 视觉伴侣两屏（现状/目标 → B 两层细化），用户选择 B 并确认二级不会频繁切换
调研依据：`docs/research/2026-10-26-agent-workbench-rails-research.md`
视觉稿：`docs/research/2026-10-26-agent-workbench-b-layout.png`
前置设计：`docs/superpowers/specs/2026-10-26-workbench-merge-design.md`（本 spec 取代其中“会话七面板收 44px 图标轨 + 浮层”和“<1200 右 dock overlay”部分；文件树/编辑器/浏览器/终端内部实现不变）

## 1. 意图与为什么

产品定位是 **agent 工作台**，不是“带聊天侧栏的 IDE”：

- 左侧回答“我在哪些工作里，哪一件需要我”；
- 中央 ChatView 是当前工作的控制面；
- 右侧 agent 工作台是当前工作的环境、工具与结果。

当前桌面端同时存在四套导航：顶部会话页签、左 rail + 左 dock、右 Workbench 内部 tab、最右 44px 会话数据 rail + 420px 浮层。右轨还把不同作用域混在一起：任务/轨迹/改动/子代理/后台属于当前会话，便签是全局记忆，用量跨会话/项目/记忆。结果是内容宽度被再切一刀，语义也难以解释。

本设计通过三个动作解决：

1. **左侧让位**：左 dock 只在足够宽时推挤，窄时浮层；不牺牲 ChatView + 右工作台。
2. **右侧分层**：选择 B 两层结构，取消第二套右轨，把当前 run 的执行信息收进 `执行`。
3. **窗口重定**：提高最小窗口与默认窗口，保证 Core Pair（ChatView + 右工作台）在支持范围内始终可并排。

## 2. 已确认决策

1. **右工作台采用 B 两层结构**：
   - 一级：`工作台 / 执行 / 审阅`
   - `工作台` 二级：`代码 / 浏览器`
   - `执行` 二级：`概览 / 待办 / 子代理 / 后台 / 轨迹`
   - `审阅`：改动与 diff（不另造二级导航）
2. **执行二级固定为 B1 下拉**。产品明确不会在五类之间频繁切换，因此：
   - 不做响应式 tabs / 两行 tabs；
   - 宽屏与 520px 窄宽使用同一种交互；
   - 可见导航标签从 8 个降为 4 个（一级 3 个 + 当前二级 1 个）。
3. **取消最右侧 44px 会话 rail 与 420px 浮层**，不再保留第二套浮动导航。
4. **终端始终固定在右工作台底部**，可收起但保持挂载；切换任意一级/二级不销毁 terminal、scrollback、当前目录。
5. **后台是当前会话的执行信息，不是右轨的全局入口**。当前代码中的 `background` 面板本来就按 `activeSessionId` 过滤；本设计不虚构跨项目后台队列。
6. **子代理是当前 run 的 child**，默认进入 `执行 › 子代理`，不进入左侧全局平级列表。
7. **`便签` 是全局工具，移出当前 run 的右工作台**；`用量` 是跨层分析，不占一级/二级导航。

## 3. 目标 / 非目标 / 反目标

### 目标

- 三套作用域清晰：全局/项目导航、当前工作控制、当前工作环境。
- 右工作台在支持的窗口尺寸内始终能与 ChatView 并排。
- 删除重复右轨后，右工作台实际内容宽度净增 44px。
- 保留既有能力：文件树、编辑器、浏览器、持久终端、diff、子代理、后台、任务、轨迹、用量、便签都可到达。
- 遵守现有 SolidJS、`@mafw/ui/v2`、主题 token、动效 token 与 TDD 约定。

### 非目标

- 不改 gateway、SDK、协议、SSE 词汇、会话数据模型。
- 不新增跨项目后台队列或全局 agent 定义管理。
- 不改 G1/G2 截屏点选、B2/B3、检查点/时间线、共享终端 T1。
- 不重做聊天内容、消息气泡、工具卡视觉。
- 不在本批收敛标题栏 `新话题/并行/细节` 文案与动作；仅把现有 `改动/后台` 入口改指向新结构。
- 不做移动端布局；桌面窗口最小 1088 CSS px。
- 不在本批实现左工作列表的注意力分组/筛选模型；现有时间分组保持。
- 不新增子代理面包屑；现有“返回父会话”入口保留。

### 反目标

- 右工作台再长出一条图标轨、浮层或第三套 tab。
- 把子代理当全局 peer，或把每个 child session 放进左侧主列表。
- 为了“窄屏好看”自动隐藏右工作台，导致 agent 工作台消失。
- 用 emoji 当工作台图标；新增面板绕过 `DockPanelHeader/DockEmpty/DockBanner`。
- 用假数据或新的后端对象伪装“全局后台”。

## 4. 当前实现事实（代码盘点）

| 事实 | 代码位置 | 影响 |
|---|---|---|
| 左 dock 是否推挤由“是否最大化”决定，而非宽度 | `renderer/mafw/left-dock.ts` `resolveMode(open, maximized)` | 同一宽度在窗口化/最大化时布局跳变 |
| 左 dock 默认 264px（180–400） | `left-dock.ts` `LEFT_DOCK_WIDTH` | 宽屏有空间，窄屏必须浮层 |
| ChatView 档位 520/640/760，默认 640 | `workbench-detents.ts` | 档位实际控制 ChatView 宽度；右工作台吃剩余 |
| 右 dock 列 = `左列 | ChatView px | 1fr` | `workbench-layout.ts` `workbenchColumns` | 右工作台随窗口无限增长；44px 会话轨再扣内容宽 |
| 右轨 7 面板，44px 常驻，浮层 420px | `SessionRail.tsx`、`session-rail-model.ts`、`mafw.css` | 第二套导航，盖住工作台 |
| 任务/轨迹/改动/子代理/后台按当前会话；便签全局；用量跨层 | 各 Dock 组件 | 同一轨内作用域不一致 |
| 窗口最小 720×480，默认 1280×800 | `main/window-bounds.ts`、`main/windows.ts` | 无法保证 ChatView + 右工作台并排 |
| <1200 自动把右 dock 转 overlay | `MafwShell.tsx` `viewportNarrow` / `layout-breakpoints.ts` | 用户拉窄窗口就失去工作台 |

## 5. 目标信息架构

### 5.1 左 rail（46px）

只保留全局目的地与全局动作：

- 顶部：`工作`（当前项目的工作入口）
- 中部：`搜索`
- 底部：`Dashboard`、`设置`、`主题`、连接状态

变化：

- 移除 rail 上的 `新建` 动作；新建由左 dock 头部的主按钮与顶栏快捷 `+` 承担。遵循“一个主入口 + 一个快捷键”，不再三处同权重。
- 不在本批新增 `代理` 全局目的地；只有未来出现可复用 agent 定义管理时再加。
- rail 仍为 icon-only，但只保留通用图标；新概念入口用文字放在左 dock/面板内。

### 5.2 左 dock（264px，180–400 可拖）

职责：全局/项目级导航，不承载当前 run 环境。

- 头部：项目切换、新建、搜索。
- **本批保留现有项目/会话树与时间分组**；`待你处理 / 运行中 / 最近` 的注意力分组与筛选是独立后续，不进入本批实现和验收。
- Manager 卡片保持现有位置。
- `便签` 作为左侧全局工具入口：左 rail 底部图标打开左 dock 的 `notes` face，不进入右工作台。
- 不新增 gateway 查询，不伪造会话运行状态。
- 左侧列表的注意力模型需要单独定义数据来源、失败/审批判定与分页搜索交互，避免在布局 spec 中夹带一个未经验证的状态系统。

### 5.3 中央 ChatView

- 保持当前对话、审批、composer、任务条、会话页签。
- 宽度档位 **520 / 640 / 760** 保留，语义明确为 ChatView 可读宽度；默认 640。
- 右工作台宽度 = 可用宽 − leftPx − ChatView；下限 520。
- 本批只改变右工作台入口映射：
  - `onOpenBackgroundDock` → 打开 `执行 › 后台`
  - `onOpenDiffReview` → 打开 `审阅`
  - `onOpenBackgroundDock` 不再打开 44px rail 浮层。
- 检查点 `时间线` 仍是独立 overlay，不与 `执行 › 轨迹` 合并或改名。

### 5.4 右工作台（B 两层）

```text
RightWorkbench
├─ L1 tabs: 工作台 | 执行 | 审阅
├─ L2 context bar:
│  ├─ 工作台: 代码 | 浏览器
│  ├─ 执行:   [当前二级 ▾]（概览/待办/子代理/后台/轨迹）
│  └─ 审阅:   无二级导航
├─ Content
│  ├─ 代码:     文件树 + 编辑器
│  ├─ 浏览器:   浏览器
│  ├─ 执行:     概览/待办/子代理/后台/轨迹
│  └─ 审阅:     ChangesDock
└─ Terminal（常驻底部，可收起，不卸载）
```

#### 一级 tab

- `工作台`：代码与浏览器（IDE 环境）。
- `执行`：当前 run 的执行事实与 child。
- `审阅`：改动与 diff 评论。
- `终端` 不在 L1 内；它是底部常驻面板，右上角按钮控制展开/收起。

#### 二级

- `工作台`：`代码`（默认）、`浏览器`。
- `执行`：固定下拉，默认 `概览`；菜单顺序 `概览 / 待办 / 子代理 / 后台 / 轨迹`。
  - 下拉触发器显示当前二级名称 + 关键计数（例如 `子代理 · 2 运行`）；
  - 宽屏与 520px 窄宽行为一致，不做响应式切换；
  - 键盘支持 ArrowUp/Down、Enter、Esc；关闭后焦点回到触发器。
- `审阅`：不显示 L2，直接渲染改动内容；终端仍在底部。

#### 各视图内容

| 视图 | 内容 | 复用/迁移 |
|---|---|---|
| 工作台 › 代码 | 文件树 + 编辑器 | 现有 `FilesDock`/`EditorDock` |
| 工作台 › 浏览器 | 浏览器 | 现有 `BrowserDock` |
| 执行 › 概览 | 当前 run 状态、当前会话 agent/model、todo 进度、子代理/后台摘要、用量折叠区；**只读**，不提供暂停/恢复/丢弃 | 新组合；`UsageDock` 收进折叠区；运行控制仍只在 ChatView |
| 执行 › 待办 | 当前会话 todo | `TaskList` |
| 执行 › 子代理 | 当前会话 descendant 子代理树 | `SubagentDock` |
| 执行 › 后台 | 当前会话 shell / background tasks | `BackgroundDock` |
| 执行 › 轨迹 | 当前会话工具调用树 | `TrajectoryDock` |
| 审阅 | 改动树 + diff + 评论回传 | `ChangesDock` |
| 终端 | 真实 shell，目录作用域，持久 scrollback | `TerminalDock` |

#### 右工作台布局细节

- L1 高 38px；L2 高 32px；与 `mafw-topstrip` 同风格，使用现有 token。
- 删除 44px rail 后，右工作台直接获得 44px 内容宽。
- 代码视图：文件树 200px；右工作台内容宽 <600px 时文件树默认收起，用户可展开（覆盖/抽屉均可，plan 定）。
- 浏览器视图不强制显示文件树；优先给页面宽度。
- 终端高度 280px、max-height 45%；收起只 `display:none`/高度 0，实例与会话保持。
- 五个执行子视图都保持挂载（用 `display:none` 隐藏），保留滚动/展开状态；隐藏视图的高频轮询暂停留后续性能优化，不阻塞本批；terminal 始终挂载。
- 本批不实现 `执行` 一级数字 badge；因为没有可靠“按当前会话归属”的审批/阻塞计数，禁止用全局审批数冒充当前 run。执行概览显示已知的 running / input_required；审批、提问仍由 ChatView 与左侧状态负责。待有按会话可靠数据后再加 badge。
- `审阅` 不常驻数字 badge；有改动时可用中性小点，plan 裁量。
- `工作台` 不显示 badge。

### 5.5 作用域与选中规则

| 对象 | 归属 |
|---|---|
| 当前会话 shell/后台任务 | 右 `执行 › 后台` |
| 当前会话子代理树 | 右 `执行 › 子代理` |
| 跨项目后台队列/自动化 | 无后端，非目标；未来归左 `工作` 或独立 `自动化` |
| 可复用 agent 定义 | 无 UI，非目标；未来归左 `代理` |
| 选中子代理后的 transcript | 沿用现有子会话语义与“返回父会话”入口；本批不新增面包屑 |
| 便签（全局记忆 sticky board） | 左 dock `notes` face |
| 用量 | 右 `执行 › 概览` 折叠区 / 命令入口 |

选中一个会话/run 时，中央 ChatView、右工作台内容、终端目录、预览、diff 必须原子切换；右工作台不得展示另一个 run 的 stale 数据。

## 6. 尺寸、断点与窗口

### 6.1 常量

| 常量 | 值 | 说明 |
|---|---|---|
| 左 rail | 46px | 现状保留 |
| 左 dock width | 264px | 180–400，现状保留 |
| ChatView floor/ceil | 320 / 760 | 保留代码护栏，但有效可读档 520/640/760 |
| 右工作台最小 | 520px | 现状 `WORKBENCH_MIN_WIDTH` |
| 窗口最小 | **1088 × 720** | 46 + 520 + 520 + 边框 |
| 窗口默认（目标） | **1600 × 1000** | 按屏幕工作区自适应，不小于最小值 |
| 左 dock push 阈值 | **1366px** | 46 + 264 + 520 + 520 = 1350，留 16px |
| 右 dock 默认 | 打开 | 现有 `defaultDockOpen` |

### 6.2 宽度策略

- **≥1366**：左 dock 可推挤；ChatView 按 guard 收到 ≥320（实际档 520/640/760），右工作台 ≥520。
- **1088–1365**：左 dock 强制浮层；ChatView + 右工作台并排，右工作台 ≥520。
- **<1088**：不承诺；窗口最小尺寸阻止进入。
- 右工作台不再按 `<1200` 自动 overlay。宽度不足由窗口最小尺寸保护；用户可主动点击顶栏开关或 `Ctrl+Alt+B` 专注 ChatView。
- 1088 最小宽度时 ChatView 有效约 522px、右工作台 520px；640 档会被 guard 钳制。这是双栏最小代价。
- 1366 + 左 dock push 时 ChatView 会被钳到约 536px；760 档不可达。不得假装三档都可用。
- 1600 + 左 dock push + Chat 640 时，右工作台约 650px；Chat 760 时右约 530px。
- 若目标设备存在 1366@150%（约 910 CSS px）等 `<1088` 工作区，则 520+520 数学上不成立；本 spec 的产品取舍是**不支持**该窗口尺寸，或在后续单独立项做 compact mode。不得在本设计里偷偷恢复右 dock overlay。

### 6.3 高度

- 最小 720px：topstrip 38 + 右工作台 L1 38 + L2 32 + 终端 280（max 45%）后仍有约 332px 内容高。
- 终端高度保持现有 280px / 45% 上限。
- 旧窗口状态恢复时，低于最小尺寸的宽高抬到 1088×720；默认窗口尺寸用于首次启动，不重置用户已保存的合法尺寸。

### 6.4 你/左 dock 的恢复语义

- `resolveMode` 改为**宽度驱动**，不再读取 `winMaximized`：
  - `closed`：open=false；
  - `push`：open=true 且 width ≥1366；
  - `overlay`：open=true 且 width <1366。
- 启动时若窗口 <1366：不自动展开存储为 open 的左 dock（避免覆盖核心双栏）；用户点击 rail 后才以 overlay 打开。
- 窗口从宽拖窄、左 dock 正开着：转 overlay，不自动关闭；核心双栏仍存在，用户可自行收起。
- 从窄拖宽：若 dock 存储为 open，可恢复 push；不得自动改变持久化偏好。
- 具体 `mafw-left-dock-open` 的恢复细节由 plan 落地，但必须满足以上用户可见语义。

## 7. 状态与持久化

建议键（plan 可改名，但必须一次性迁移旧值）：

| 键 | 值 | 默认 |
|---|---|---|
| `mafw-workbench-view` | `workbench \| execution \| review` | `workbench` |
| `mafw-workbench-surface` | `code \| browser` | `code` |
| `mafw-execution-section` | `overview \| todos \| subagents \| background \| trajectory` | `overview` |
| `mafw-right-dock-open` | 现有 1/0 | 打开 |
| `mafw-workbench-terminal` | 现有 1/0 | 打开 |
| `mafw-workbench-detent` | 520/640/760 | 640 |
| `mafw-left-dock-open` | 现有 1/0 | 关闭 |

迁移 `mafw-right-dock-tab`（旧 7 面板）：

- `tasks` → `execution` + `todos`
- `trajectory` → `execution` + `trajectory`
- `subagents` → `execution` + `subagents`
- `background` → `execution` + `background`
- `changes` → `review`
- `usage` → `execution` + `overview`
- `notes` → 不改变右工作台视图；便签入口移到左 dock；保留旧键读取一次后不再读取
- 旧 `mafw-workbench-tab`（editor/browser）→ `mafw-workbench-surface`

会话切换不重置一级/二级选择；所有内容仍按当前 run 过滤。视图选择全局持久化，避免每切一个会话就跳回默认。

## 8. 组件与代码结构（实现约束，不是任务拆分）

- 新增/改造右工作台壳（可命名 `WorkbenchShell`）：
  - 拥有 L1、L2、content、terminal 四段；
  - L1/L2 是纯状态模型，可单测；
  - `Workbench` 不再内嵌 `SessionRail`。
- 删除 `SessionRail.tsx`、`session-rail-model.ts` 及 44px/420px 浮层 CSS；不保留死代码。
- `Workbench` 现有 `FilesDock`/`EditorDock`/`BrowserDock` 复用；代码/浏览器两级切换替代原内部 tab。
- `Execution` 组合现有 `TaskList`/`SubagentDock`/`BackgroundDock`/`TrajectoryDock`/`UsageDock`；不复制数据逻辑。
- `审阅` 复用 `ChangesDock`。
- `NotesDock` 移入左 dock 的 `notes` face（`LeftDockFace` 扩展）；左 rail 底部增加便签入口；不得留在右工作台。
- `left-dock.ts`：`resolveMode(open, width)` 取代 `resolveMode(open, maximized)`；更新单测。
- `main/window-bounds.ts`：最小尺寸常量改为 1088×720；`main/windows.ts` 默认尺寸改为自适应 1600×1000。
- 移除右 dock 的 `viewportNarrow` 自动 overlay 判断；保留 `Ctrl+Alt+B` 显式开关。
- 旧 `tasksPlacement=dock` 的 legacy dock fallback 在 `执行 › 待办` 接管后移除；顶部 TaskBar popover 保留。
- 不新增 gateway 调用、不新增 API。

## 9. 无障碍与交互

- L1 使用 `role=tablist` / `role=tab` / `aria-selected`；方向键切换。
- L2 代码/浏览器使用 tab 语义；执行下拉使用 button + menu，`aria-haspopup="menu"`、`aria-expanded`、方向键/Esc。
- 所有 icon-only 按钮保留 `aria-label` 与 Tooltip；新可见文字入口优先。
- 终端保持为可聚焦的面板，收起后仍可从 L1 顶部按钮恢复。
- 视图切换不抢 composer 焦点；下拉关闭后焦点回到触发器。
- 动效沿用 `--dur-fast`/`--dur-surface`，`prefers-reduced-motion` 下关闭非必要动画。

## 10. 验收标准

1. **1088×720**：左 dock 默认关闭；ChatView ≥约 522px、右工作台 520px 并排；无横向溢出；打开左 dock 只出现浮层，不挤压双栏。
2. **1366×720**：左 dock 打开 → push 264px；ChatView 与右工作台均 ≥520px；无裁切。
3. **1600×1000**：默认 ChatView 640、右工作台约 650；终端展开；完整三栏无重叠。
4. **右轨消失**：DOM/CSS 不再保留 44px 右轨或 420px 浮层；右工作台内容宽度净增 44px。
5. **B/B1**：L1 仅 `工作台/执行/审阅`；工作台二级代码/浏览器；执行二级固定下拉五类；默认概览；宽窄一致；无 B2/B3 分支。
6. **终端持久**：切换 L1/L2、收起/展开、切换会话，终端实例、scrollback、目录作用域不丢；agent 命令不出现在用户终端。
7. **入口迁移**：旧右轨七个面板都可达；`改动` 打开审阅；`后台` 打开执行›后台；`便签` 从左 dock 可达；`用量` 在执行概览可达。
8. **选中原子性**：切换会话后，右工作台所有内容与终端 cwd 同步到新会话；不显示上一会话 stale 数据。
9. **概览只读**：执行›概览不出现暂停/恢复/停止/丢弃等运行控制，不复制 ChatView 的 run-state 操作。
10. **迁移**：旧 `mafw-right-dock-tab` 七值映射正确；旧窗口尺寸低于最小值被抬到 1088×720；非法档位回 640。
11. **窗口边界**：右工作台不再由 `<1200` 自动转 overlay；只有用户主动隐藏；左 dock 模式不随最大化状态跳变。
12. **回归**：`npm test`、`tsgo`、`electron-vite build` 全绿；新增纯函数测试覆盖左 dock 模式、窗口尺寸、B1 状态迁移与视图映射。
13. **GUI smoke**：1088/1366/1600 三档；左 dock 开合/缩放；B1 键盘；执行五类；审阅 diff；终端收起/恢复；窗口最大化/还原保持布局不跳变。

## 11. Builder check 收口（2026-10-26）

独立 builder review 提出 4 个问题，已处理：

1. **左 dock 注意力分组是否在本批？→ 延后。** 本批只做布局/入口/宽度；`待你处理 / 运行中 / 最近` 需要单独定义审批、提问、失败、阻塞的真实数据源、分页/搜索交互与降级规则，另立 spec。左 dock 现有时间分组保留，验收不要求新分组。
2. **子代理 breadcrumb 是否交付？→ 不做。** 现有“返回父会话”保留；本批不新增父链查询/面包屑 UI，避免与右工作台布局耦合。
3. **执行›概览是否可操作？→ 只读。** 暂停/恢复/丢弃等 run-state 控制仍只在 ChatView；概览展示当前会话 agent/model、run 状态、todo/子代理/后台摘要与折叠用量，不复制控制面。
4. **视觉稿缺失？→ 已落到仓库。** 截图 `docs/research/2026-10-26-agent-workbench-b-layout.png`；调研稿也已位于 `docs/research/`。

无剩余阻塞问题；若产品要把第 1 项纳入本批，需要先回答其数据源与交互，本 spec 的验收范围随之扩大。

## 12. 风险与取舍

- **最小宽 1088** 会改变产品可运行窗口下限；高 DPI 小工作区可能无法满足 520+520。若必须支持，需要单独立项 compact mode，而不是恢复右 dock 自动 overlay。
- **B1 固定下拉** 牺牲五类的直接可见性，换取更安静、更稳定的顶部；产品已以“不频繁切换”确认。
- **删除右轨** 会让 `便签/用量` 的访问路径变深；通过左 dock / 执行概览 / 命令入口补偿。
- **左 rail 只剩一个主目的地** 可能在视觉上偏空；不为了填满而新增无产品意义的导航。
- **左会话注意力分组延后**：本批只改布局与入口，既有时间分组保留；否则会把未经验证的状态模型夹进布局改造。后续独立 spec 处理 `待你处理 / 运行中 / 最近`。
- **右工作台变宽** 后文件树/编辑器可能需要新的内部比例优化，不在本 spec 的布局骨架内。

## 13. 留给 plan 的裁量

- 左 dock `notes` face 的容器样式与空态（入口固定为左 rail 底部便签图标）。
- 文件树在右工作台 <600px 时的展开形态（抽屉/浮层/临时覆盖）；默认收起已定。
- `审阅` 是否显示中性 changed-file dot。
- 执行一级 badge 的后续数据来源与上限（本批不做；必须先有按会话可靠归属的审批/阻塞计数）。
- 执行子视图隐藏时的高频轮询暂停（本批不阻塞；五个子视图保持挂载以保状态）。
- 默认 `工作台›代码`、`执行›概览` 的首次启动与迁移顺序。
- 标题栏 `新话题/并行/细节` 的后续收敛（不在本 spec）。

## 14. 不在本 spec

- T1 共享终端、G3 steer、P1 backlog、人工冒烟遗留项。
- gateway / SDK / terminal bridge / browser session 行为变更。
- 全局后台队列、跨项目 agent 定义管理。
- 移动端或 `<1088` 的 compact mode。
- 新一轮视觉皮（颜色、字体、图标风格）。

## 15. 参考

- 调研：`docs/research/2026-10-26-agent-workbench-rails-research.md`
- 视觉稿截图：`docs/research/2026-10-26-agent-workbench-b-layout.png`
- 现有工作台 spec：`docs/superpowers/specs/2026-10-26-workbench-merge-design.md`
- 现有左 dock 设计：`docs/superpowers/specs/2026-10-22-workbench-layout-design.md`
- 代码入口：`packages/desktop/src/renderer/mafw/MafwShell.tsx`、`components/Workbench.tsx`、`components/SessionRail.tsx`、`left-dock.ts`、`workbench-layout.ts`、`workbench-detents.ts`、`src/main/window-bounds.ts`、`src/main/windows.ts`
