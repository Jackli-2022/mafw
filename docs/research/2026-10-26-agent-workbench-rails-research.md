# Agent 工作台：左侧 rail 与右侧 dock 信息架构调研

日期：2026-10-26
状态：产品已选定 B（两层）＋ B1（二级固定下拉）；spec 已写待终审；未改产品代码
范围：产品/界面信息架构、尺寸与窗口布局研究

当前截图：`./current-layout-2026-10-26.png`

## 1. 结论先行

本产品的核心不是“带一个聊天侧栏的 IDE”，而是 **agent 工作台**：

- **左侧**：我在哪些工作里，哪一件需要我；
- **中央 ChatView**：当前这项工作的控制面；
- **右侧 agent 工作台**：当前这项工作的环境、工具与结果。

当前主要问题不是左右栏谁多一个按钮，而是**四套导航同时存在、不同作用域被放在同一条图标轨、窗口尺寸规则允许核心区域互相挤压**：

1. 顶部会话页签；
2. 左侧 46px 全局 rail + 左 dock；
3. 右侧 Workbench 内部的编辑器/浏览器；
4. 最右侧 44px 会话数据 rail + 420px 浮层。

解决方向不是继续在左右两边加面板，而是：

- 左 rail 只负责全局工作导航；
- 后台成为“工作”的状态/筛选，不单独占一条右侧工具轨；
- 子代理/后台任务/任务清单合并为右工作台的当前 run 执行视图；
- 取消最右侧第二套浮动 rail；
- 窗口最小尺寸与断点重定，保证 ChatView 与右工作台始终能并排。

## 2. 当前实现盘点（代码确认）

### 2.1 骨架与尺寸

| 区域 | 当前实现 | 问题 |
|---|---|---|
| 左 rail | 46px 常驻；会话/新建/搜索/ Dashboard/Config/主题，共 6 个无文字图标 | 导航与动作混排；无可见标签；新建在 rail、SessionStrip、聊天标题栏重复 |
| 左 dock | 默认 264px（180–400）；`resolveMode(open, maximized)`：只有最大化才 push，否则 overlay | 是否推挤由“最大化”而非宽度决定；同一宽度在窗口化/最大化时布局跳变 |
| ChatView | 520/640/760 绝对档位；默认 640；当前代码中档位实际控制 **ChatView 宽度** | “WorkbenchDetent”命名容易被误解为右工作台宽度 |
| 右 Workbench | `grid: 左列 | ChatView px | minmax(0,1fr)`，右工作台吃掉剩余宽度；文件树 200px、终端 280px | 右工作台宽度随窗口无限增长；44px 会话轨进一步吃掉内容宽 |
| 右会话 rail | 44px 常驻，7 个无文字图标；点击后 420px 浮层盖住 Workbench | 第二套 rail、第二套浮层、与 Workbench tab 竞争；内容宽度又被压缩 |
| 窗口 | 最小 720×480；默认 1280×800 | 无法保证 ChatView + 右工作台并排；默认尺寸不足以呈现完整三栏 |

### 2.2 右轨 7 个面板的真实作用域

| 面板 | 作用域 | 说明 |
|---|---|---|
| 任务 | 当前会话 | 本会话 todo |
| 轨迹 | 当前会话 | 工具调用树/运行轨迹 |
| 用量 | 混合 | 会话、项目、记忆/模型用量混在一起 |
| 便签 | 全局 | 谐波记忆的 sticky note board，不是当前 run 产物 |
| 改动 | 当前会话 | 当前会话 diff |
| 子代理 | 当前会话 | 当前会话 descendant 子代理 |
| 后台 | 当前会话 | 当前会话 shell + 后台任务，不是跨会话后台队列 |

因此“后台”和“子代理”本身并不是全局导航；它们都属于当前 run 的执行信息。`便签` 反而是全局内容，`用量` 是跨层内容。把它们统一放在“会话数据”轨上，语义并不一致。

### 2.3 重复与命名冲突

- `任务`（todo）与 `后台`（task/shell）都叫任务，用户难区分。
- `轨迹`（工具调用树）与标题栏 `时间线`（checkpoint/rewind）名称接近但功能不同。
- `新话题`、顶部 `+`、左 rail `新建` 是三个同权重新建入口。
- `细节` 实际是“展开全部工具/编辑卡”的阅读偏好，却被放在会话标题栏，与当前任务动作并列。
- 右轨 badge 只统计子代理/后台 running 数，但外观与其他全局导航 badge 类似，语义不统一。

## 3. 业界调研

### 3.1 IDE-first：agent 通常只是侧栏

VS Code 以编辑器为中心：左侧 Activity Bar + Primary Side Bar，右侧 Secondary Side Bar 是辅助视图区域，Panel 承载 Terminal/Output；Secondary Side Bar 默认用于 Chat，但定位仍是 auxiliary。

Zed 传统布局也是左侧 Project、中央 Editor、右/下 Dock 放 Agent/Terminal；其最新 *Agentic layout* 则把 Threads Sidebar + Agent Panel 放左，Project/Git 等放右，说明 agent-first 会主动反转“文件中心”的布局。

结论：不能因为 VS Code 把 Chat 放右侧，就认为 agent 工作台也必须把所有 agent 信息塞右边。布局应服从谁是主任务。

来源：
- https://code.visualstudio.com/docs/configure/custom-layout
- https://code.visualstudio.com/api/ux-guidelines/sidebars
- https://code.visualstudio.com/api/ux-guidelines/activity-bar
- https://zed.dev/docs/ai/parallel-agents
- https://zed.dev/docs/ai/agent-panel
- https://zed.dev/docs/windows-and-projects

### 3.2 Agent-first / 多代理控制台

| 产品 | 全局导航 | 当前任务控制 | 环境/结果 | 关键启示 |
|---|---|---|---|---|
| Devin Desktop / Spaces | 左 sessions sidebar；Space 聚合同一任务的 sessions/PR/files/context | 选中 session 的对话与状态 | Files/Changes/Terminal/Preview 属于所选 session | 子 session 默认挂在父/space 下；切任务恢复现场 |
| ChatGPT Codex | 左 projects/threads | 中央 thread | 当前 thread 内 diff/terminal/browser/summary | command center 以 thread 为单位，不把所有 agent 平铺 |
| Conductor | 左 workspaces | 当前 workspace 内 conversation | 共享 branch/files/terminal | 独立交付用 peer workspace；共享上下文用同 workspace 多 chat |
| Vibe Kanban | 左 workspace sidebar；会话下拉属于当前 workspace | 左主 conversation | 右主 Changes/Logs/Preview；最右 Git/Terminal/Notes | **最右栏可以存在**，但只放当前 workspace 的上下文 |
| Replit Agent | 项目 thread + task board | 主 thread | Ready 任务的工作日志/测试/预览/diff | 执行态与交付态分离；完成 ≠ 已应用 |
| Factory Mission | 全局 sessions / Missions 分开 | Mission Control | 选中 Mission 内才有 orchestrator/workers/validators | 大规模 fan-out 用 run-local roster，不污染全局 |

来源：
- https://docs.devin.ai/desktop/spaces
- https://docs.devin.ai/desktop/changelog
- https://openai.com/index/introducing-the-codex-app/
- https://www.conductor.build/docs/concepts/parallel-agents
- https://vibekanban.com/docs/workspaces/interface
- https://vibekanban.com/docs/workspaces/sessions
- https://docs.replit.com/features/agent/task-lifecycle
- https://docs.factory.com/docs/missions/running-app

### 3.3 通用设计系统

- Material 3：navigation rail 放 3–7 个顶层目的地，位置稳定，要求短文字标签；badge 只表达动态状态。
  - https://m3.material.io/components/navigation-rail/guidelines
- Atlassian：SideNav 是应用内导航；右侧 Panel 是当前主任务的补充内容/三级操作，可折叠、可调整，小视口转 overlay。
  - https://atlassian.design/components/navigation-system/layout/usage
- Microsoft NavigationView：宽屏展开、窄屏 compact、再窄 minimal/flyout；自适应应改变导航形态，不应同时压扁所有内容。
  - https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/navigationview
- NN/g：除少数通用图标外，导航图标需要可见文字标签；hover tooltip 不能作为唯一说明。
  - https://www.nngroup.com/articles/icon-usability/

## 4. 作用域模型

采用三层，而不是一个扁平 agent 列表：

```text
项目 / Space
  └─ 持久工作项（会话 / 任务 / workspace）
       └─ 本次 Run
            └─ 子代理 / 后台任务 / 工具调用
```

入口归属决策树：

1. 有独立目标、持久历史、可单独交付？→ 左侧持久工作项。
2. 只是当前工作的一次执行/等待/fan-out？→ 当前 run 的执行视图。
3. 是当前工作的文件/diff/浏览器/终端/产物？→ 右工作台。
4. 只是命令/偏好？→ 命令面板、新建菜单或设置。

子代理提升为全局平级项，需要同时满足“独立环境/分支”与“可独立 review/apply/archive”；否则留在父 run 内。

## 5. 推荐信息架构

### 5.1 左侧：工作导航

**左 rail（46px）只保留真正的全局目的地：**

- `工作`：会话 + 持久任务 + 后台运行状态的统一入口；
- `代理`（仅当有可复用 agent 定义/团队管理时）；
- `自动化`（仅当它与 session 是不同对象时）；
- 底部：搜索/命令、设置、连接状态、主题。

`新建` 是动作，不应与目的地混成同一组；保留一个主入口 + 一个快捷键即可。若 rail 保持无文字图标，则必须限制为高度通用的图标，其余入口用左 dock 的可见文字承载。

**左 dock（264px）：**

- 顶部：当前项目切换 + 搜索 + 新建；
- 默认分组：`待你处理` → `运行中` → `最近`；
- 状态筛选：全部 / 待处理 / 运行中 / 历史；后台是“运行中”的筛选/分组，不是右侧独立按钮；
- 行内显示完整状态原因：等待审批、提问、失败、待 review；
- 子代理默认不进入全局列表，搜索/深链可以直达；
- `便签` 作为全局记忆工具放左 dock 或命令入口，而不是右工作台 tab。

### 5.2 中央：当前工作的控制面

- ChatView 保持聊天、审批、composer、当前 run 状态；
- `对话` 是主视图；`时间线`（工具轨迹/运行事件）可作为当前工作的第二视图，但不要和全局导航混在一起；
- 标题栏只保留当前 run 必需动作：状态、停止/暂停、检查点（可收进溢出菜单）；
- `新话题` 移入会话新建菜单；`并行` 作为新建菜单中的选项；`细节` 是阅读偏好，移入视图/设置；
- 背景任务可继续在聊天上方显示摘要条，但详情进入右工作台“执行”。

### 5.3 右侧：当前 run 的 agent 工作台

产品在视觉伴侣中选定 **B 两层结构**：一级回答“看什么”，二级回答“具体哪一类”。取消最右侧 44px 会话数据 rail 与 420px 浮层。

```text
右 dock
├─ 工作台
│  ├─ 代码      文件树 + 编辑器（diff 可在此打开）
│  └─ 浏览器    预览/点选批注
├─ 执行
│  └─ [当前二级 ▾]  概览 / 待办 / 子代理 / 后台 / 轨迹
├─ 审阅          Changes + diff 评论/回传
└─ 终端          Workbench 底部常驻，可收起但保 scrollback
```

已定决策：

- **B1 固定下拉，不做响应式 tabs**：用户明确表示不会在待办/子代理/后台/轨迹之间频繁切换，因此二级不值得长期占一排标签；
- `执行` 默认落在 `概览`；下拉里保留各项 running/blocked 计数；
- 一级只出现 `工作台 / 执行 / 审阅`，加上当前二级 = 4 个可见导航标签，而不是 8 个；
- `执行` 聚合待办、子代理树、后台任务、调用轨迹；每个二级仍按当前 run 过滤；
- `审阅` 承接改动与 diff，不再另开浮层；
- `用量` 不占一级/二级导航，放执行概览底部或标题栏“更多”；
- `便签` 是全局记忆工具，移到左侧；
- 删掉 44px rail 后，右工作台直接多出 44px 内容宽；
- 终端仍固定在 Workbench 底部，切换任何层级都不卸载，保持真实 shell / 目录作用域 / 持久 scrollback。

视觉稿：`docs/research/2026-10-26-agent-workbench-b-layout.png`（B1 已确定；窄宽与宽屏一致使用下拉，不保留 B2/B3）。

### 5.4 “后台”和“子代理”的最终归属

| 对象 | 归属 | 理由 |
|---|---|---|
| 当前会话的 shell/后台任务 | 右工作台 `执行` | 是当前 run 的执行事实 |
| 当前会话的子代理树 | 右工作台 `执行` | 是当前 run 的 fan-out，不是全局 peer |
| 跨项目的后台队列/自动化 | 左 `工作` 的筛选/分组，必要时独立 `自动化` 目的地 | 是全局工作导航 |
| 可复用 agent 定义 | 左 `代理`（若存在） | 是配置，不是运行实例 |
| 选中子代理后的 transcript | 中央/执行检查器，面包屑 `父 run / 子代理` | 不改变左侧全局选中 |

## 6. 尺寸与窗口布局

### 6.1 宽度模型

保留现有对话列档位 **520 / 640 / 760**，但明确其语义是 **ChatView 可读宽度**；右 agent 工作台吃掉剩余空间。这样：

- 对话不会在超宽屏变成难读的长行；
- 右工作台作为 agent 工作区获得大屏红利；
- 需要改的是窗口边界、左 dock 让步规则与右轨，而不是再给右 dock 加固定档位。

常量关系：

```text
46 左 rail + 520 ChatView min + 520 右工作台下限 = 1086px
```

因此建议：

| 项目 | 现在 | 建议 |
|---|---|---|
| 窗口最小宽 | 720 | **1088**（保证 46 + 520 + 520 + 边框） |
| 窗口最小高 | 480 | **720**（给 280px 终端 + 编辑区留可用高度） |
| 默认窗口 | 1280×800 | 目标 **1600×1000**，按屏幕工作区自适应（不小于最小尺寸） |
| 左 dock push 条件 | 窗口最大化 | **窗口宽 ≥ 1366**，与最大化无关 |
| 左 dock 小于阈值 | overlay | overlay/flyout，选中后关闭；不再挤压核心双栏 |
| 右工作台窄屏行为 | <1200 自动 overlay | **不按宽度自动 overlay**；宽度由最小窗保护，用户可主动隐藏/专注 ChatView |
| 右 rail | 44px 常驻 + 420 浮层 | 删除，内容并入 Workbench |

### 6.2 断点建议（以内容宽度为准，最终需 GUI smoke）

| 窗口宽 | 左 dock | ChatView | 右工作台 | 说明 |
|---|---|---|---|---|
| ≥1600 | 可 push 264 | 默认 640，可 520/760 | 剩余宽度（约 ≥650） | 完整三栏 |
| 1366–1599 | 可 push 264 | guard 自动压到 ≥520 | ≥520 | 三栏仍成立，760 档可能被钳制 |
| 1088–1365 | 强制 overlay | 520/640，按可用宽钳制 | ≥520 | 核心双栏，左导航浮层 |
| <1088 | 不允许（窗口最小） | — | — | 若必须支持更小窗口，就无法同时保证 520+520 |

补充：

- 1366 宽度、左 dock push 时：46 + 264 + 520 + 520 = 1350，留 16px 边框/间隙，刚好成立。
- 1600 宽度、左 dock push、Chat 640 时：右工作台约 650；若 Chat 760，则右约 530，仍 ≥520。
- 旧 760 档在“左 dock push + 1366”下不可达，guard 会把 Chat 压到约 536；这是空间事实，不应假装三档都可用。
- 1088 最小宽时 Chat 只能到约 522，默认 640 会被钳制；这是保证双栏的最小代价。
- 若产品必须支持 1366@150%（约 910 CSS px）这类旧屏，则 520+520 数学上不成立，只能选择“右工作台 overlay”或降低两侧最小宽；这是产品取舍，不是布局 bug。

### 6.3 让步顺序

空间不足时按以下顺序牺牲，保证核心：

1. 左 dock 从 push 变 overlay；
2. ChatView 从 760/640 收到 520；
3. 右工作台收到下限 520；
4. 到窗口最小尺寸为止，不自动拆掉右工作台；
5. 用户主动 `Ctrl+Alt+B` 隐藏右工作台 = 专注 ChatView，不是宽度触发的自动行为。

这修正了当前的两个结构性问题：

- 左 dock 是否推挤不再取决于“最大化”，避免同一宽度下窗口化/最大化跳变；
- 右工作台不再在 <1200 时自动变 overlay，避免用户刚把窗口拉窄就失去工作台。

## 7. 现有控件迁移表

| 现有入口 | 目标位置 | 处理 |
|---|---|---|
| 左 rail 会话 | 左 `工作` | 保留，成为主入口 |
| 左 rail 新建 | 左 dock/顶栏单一新建入口 | 去重，保留一个快捷入口 |
| 左 rail 搜索 | 左 dock 搜索 / 命令面板 | 保留 |
| 左 rail Dashboard/Config/主题 | 底部工具区 | 保留，但与导航分组 |
| 右 rail 任务 | 右 `执行` › 待办 | 合并进二级下拉 |
| 右 rail 轨迹 | 右 `执行` › 轨迹 | 合并进二级下拉，消除与“时间线”命名冲突 |
| 右 rail 用量 | 右 `执行` › 概览底部或标题栏更多 | 降级，不占导航 |
| 右 rail 便签 | 左全局工具 | 移出当前 run |
| 右 rail 改动 | 右 `审阅` | 合并 |
| 右 rail 子代理 | 右 `执行` › 子代理 | 合并进二级下拉 |
| 右 rail 后台 | 右 `执行` › 后台；跨项目后台进左 `工作` | 合并/分流 |
| 标题栏新话题 | 会话新建菜单 | 去重 |
| 标题栏并行 | 新建菜单选项 | 降级 |
| 标题栏时间线 | 当前会话检查点 | 保留但避免与轨迹混名 |
| 标题栏细节 | 视图/设置 | 降级为阅读偏好 |

## 8. 不建议的做法

- 不把所有 agent 相关按钮继续堆到右 rail；
- 不把子代理当全局平级 session；
- 不把跨项目后台塞进当前 run 的右工作台；
- 不在窄窗口自动隐藏右工作台来“解决”拥挤；
- 不照抄 Vibe Kanban 的四栏几何——我们的右工作台已经可以承载当前工作上下文，不需要再养第四条常驻导航；
- 不为左 rail 的新概念画更多抽象图标，先减少入口和统一作用域。

## 9. 本次调研范围与未完成项

本对话目前完成的是：

- 当前截图观察；
- 当前三栏/左右轨实现盘点；
- 设计系统与 agent 产品调研；
- 目标信息架构、尺寸和窗口策略建议；
- 视觉伴侣线框图（1600 / 1088）；
- 产品确认 **B 两层** 与 **B1 二级固定下拉**。

尚未进行（也未获批准）：

- 对整份目标 IA 的最终确认；
- 布局 spec / plan；
- 任何代码修改、测试与提交。

历史上其它线（T1 共享终端、G3 steer、P1 backlog、人工 GUI 冒烟等）不属于本对话的未完成项，不应混入本任务的待办。
