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

- 左栏 / 命令面板 / `onNavigateTab` / `onNavigate` 都走同一个
  `navigateWorkbench(id)`：`revealWorkbench()` + `openSceneTab` + `openSubject`。
- 主区永远 chat；打开页面只打开/切换右 dock，不替换 chat。
- 页面 tab 持久；切换会话、点击 chat 不清掉右 dock 页面。
- 页面自己的返回由 FrameBar 的 back / tab close 处理；Config 不再需要 `onBack`。

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
4. **右 dock 页面被会话切换清掉**：只允许 FrameBar back / tab close 关闭；删除 `setShowConfig(false)` 类副作用。
5. **Human-only 审批被误改**：Approvals 只改布局，不碰 `onPermissionReply` / `approvals.respond` 的权限与参数。

## 验收

- 主区任何导航都不会替换 chat；右 dock 可显示 5 个页面 + memory。
- 每个页面在 640 档可用：无横向滚动、动作按钮不溢出。
- Config 的所有 section 可从 compact picker 到达；Usage 从上下文圆环直达 `config/usage`。
- desktop 全量测试 + `tsgo --noEmit` + `electron-vite build` 通过；live smoke 每个页面。
