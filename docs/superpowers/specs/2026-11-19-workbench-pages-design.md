# 桌面主区只留 Chat：其余页面进右工作台（2026-11-19 设计）

## 意图

把「会替换主区 chat 的页面」全部收进右工作台，主区永远只显示 chat。
右工作台继续使用 focus + scene tab 模型；每个页面是一个 `page` subject，像文件 / Goal / 世界一样可返回、可关 tab、可持久化。

## 范围

移入右工作台：

- Approvals
- Triage
- Automations
- MCP
- Config（含 Usage / 插件 / 键位等全部 section）

已经完成：

- Memory（`scene:memory`，compact）

主区：

- 只渲染 chat（含 Welcome 空态）
- 不再有 `activeTab("approvals"|"triage"|"automation"|"mcp"|"memory")` 分支
- 不再有 `showConfig()` 主区分支

## 非目标

- 不改 Gateway / runtime 契约
- 不改审批的人类专属权限（accept / approvals / questions 的 human-only 规则不动）
- 不重写页面数据模型（Approvals/Triage/Automations/MCP/Config 的 API 与状态保持原样）
- 不把 chat 拆成右 dock

## 决策

### 1. 通用 `page` subject

```ts
export const WORKBENCH_PAGE_IDS = ["approvals", "triage", "automation", "mcp", "config"] as const
export type WorkbenchPageId = (typeof WORKBENCH_PAGE_IDS)[number]
```

`SubjectRef` 增加：

```ts
{ kind: "page"; id: WorkbenchPageId }
```

`subjectKey` = `page:<id>`；scene tab = `scene:page:<id>`，持久化；label / icon 来自
`workbench-pages.ts`：

| id | label | icon |
|---|---|---|
| approvals | 审批 | checklist |
| triage | 分诊 | warning |
| automation | 自动化 | sliders |
| mcp | MCP | mcp |
| config | 设置 | settings-gear |

### 2. 导航语义

- 左栏 / 命令面板 / `onNavigateTab` / `onNavigate` / deep link 都走同一个
  `navigateWorkbench(target)`：`revealWorkbench()` + `openSceneTab` + `selectFocus`。
- 主区永远 chat；打开页面只打开/切换右 dock，不替换 chat。
- 页面 tab 持久；切换会话、点击 chat、打开 subagent **不清掉**右 dock 页面。
- **只有** FrameBar back / tab close / Config 自己的显式关闭会关闭页面。
- `setShowConfig(false)` 类副作用全部删除，不再用「关 config」代替导航。
- `openPageFocus` 用 `selectFocus`，同一页面重复打开只移到栈顶，不产生重复 focus。

### 2.1 Config section 请求

- `openConfigPage(section?)`：`setConfigSection(section)` + `openPageFocus("config")`，
  然后 `requestAnimationFrame` 派发 `mafw:open-config`（detail = section）。
- ConfigPage 已挂载时靠这个事件切 section；未挂载时靠 `initialSection`。
- 删除 `MafwShell` 里 `if (!showConfig()) setConfigSection(undefined)` 的 reset effect。
- `/skills` 等现有 `mafw:open-config` 发射器继续有效；MafwShell 的 handler 只
  `setConfigSection` + `openPageFocus("config")`，不再 `setShowConfig(true)`。

### 2.2 生命周期与边界

- **项目范围**：page tab / focus 按项目（world）存，和 memory 一致；切项目切换页面栈。
  Welcome 的 `unscoped` 页面在进入项目后不保留（明确接受）。
- **重启**：`focus-persistence.isSubject` 接受 `page` 与 `memory`；如果旧快照的
  `activeId` 是 page tab 但 focus 栈没有该 page，恢复时清掉该 activeId，避免
  tab 高亮与 stage 不一致。
- **Gateway 断开**：page focus（至少 Config）仍渲染右 dock；主区/dock 的
  「Gateway 已断开」占位只在没有 page focus 时出现。
- **Deep link**：`mafw://tab/approvals|triage|automation|memory|mcp|config` 需要
  `navigateWorkbench` 路由；`goals/workspace` 仍打开项目工作。删除旧
  `activeTab(link.id)` 路径，避免 chat-only guard 把深链吞掉。
- **窄窗**：窄窗下打开页面会切到 Workbench 视图（不能同时显示 chat + dock）；
  chat 仍在 Chat/Workbench 切换里，一键可回。宽窗保持 split。

### 3. Compact 页面契约

每个页面接受 `compact?: boolean`：

- 隐藏 `PageHeader`（FrameBar 已有 crumb）
- 页面根节点 `overflow-y: auto`，padding 12/14/24
- 动作行 `flex-wrap: wrap`；窄宽度下按钮换行而不是溢出
- Config：隐藏 200px 左导航，改为顶部 `SelectV2` section picker；panel 占满 dock 宽度
- Automations：固定宽度输入改为可伸缩字段（compact 下 100%）
- MCP：PageHeader 的刷新/添加动作移到 compact 工具栏
- Approvals / Triage：卡片动作行换行；审批按钮的 human-only 回调不变

### 4. 主区清理

- 删除 `showConfig` signal；`activePageId() === "config"` 取代所有 active 判断。
- `workbenchContent()` 恒为 `"project"`（config 不再是主区 content mode）。
- 保留 `activeTab` 仅作 chat/welcome 兼容；加 guard：
  ```ts
  createEffect(() => { if (activeTab() !== "chat") setActiveTab("chat") })
  ```
- 删除 main render 的 approvals / triage / automation / mcp / memory / config 分支；
  `mafw-content` 内只保留 chat。
- IconRail 的 approvals/mcp/config active 改为 `activePageId()`。

## 页面矩阵

| 页面 | 入口 | compact 关键点 | 风险 |
|---|---|---|---|
| Triage | palette | PageHeader 隐藏、动作换行 | 低 |
| Approvals | rail + palette | 3 按钮换行、命令预览折行、human-only 不变 | 中 |
| Automations | palette | 表单字段 100%、规则卡换行 | 中 |
| MCP | rail + palette | 顶部工具栏、summary 卡换行、dialog 不变 | 中 |
| Config | rail + palette + usage ring | section picker、表单/网格折行、滚动 | 高 |

## 风险与对策

1. **Config 表单在 640 档溢出**：compact 先做横向折行 + `min-width: 0`；live 逐 section 检查
   gateway / models / plugins / usage / keybindings。
2. **Approvals 按钮溢出**：动作行改 class + `flex-wrap`；窄档可让按钮整行落到标题下方。
3. **activeTab 旧路径残留**：加 guard + source-scan 测试，禁止再次出现非 chat main 分支。
4. **MafwShell scene whitelist**：`sceneSubjectOf` / `sceneLabelFor` / `ensureSceneTabFor` /
   `tabIdForSubject` / `syncStageToFocus` 必须同时认识 page；否则 tab 高亮、返回、重建 tab 都会错。
5. **Config section 切换**：重复打开同一 section 也要能切；用 `mafw:open-config` 事件，
   不能只靠 `initialSection`。
6. **Offline / 深链 / 重启**：Config 在 gateway down 时仍要可达；deep link 不能变空操作；
   page focus 重启后不能和 activeId 打架。
7. **Human-only 审批被误改**：Approvals 只改布局，不碰 `onPermissionReply` / `approvals.respond`
   的权限与参数。

## 验收

- 主区任何导航都不会替换 chat；右 dock 可显示 5 个页面 + memory。
- 每个页面在 640 档可用：无横向滚动、动作按钮不溢出。
- Config 的所有 section 可从 compact picker 到达；usage ring 能直达 `config/usage`
  （包括 Config 已挂载在别的 section 时）。
- deep link 能打开对应页面；gateway down 时 Config 仍可达。
- 切会话、点 chat、开 subagent 不关闭右 dock 页面；FrameBar back / tab close 才关闭。
- 重启后 page tab 与 focus 一致；旧快照不会留下高亮错位的 page tab。
- desktop 全量测试 + `tsgo --noEmit` + `electron-vite build` 通过；live smoke 每个页面。
