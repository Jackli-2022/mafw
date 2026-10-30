# 桌面鲸群面板（Project Pod Lite · Phase 2）设计

日期：2026-10-30
状态：Draft（待评审）
上游 spec：`docs/superpowers/specs/2026-10-29-project-pod-lite-design.md`
上游 plan：`docs/superpowers/plans/2026-10-29-project-pod-lite-backend.md`
调研：`docs/research/2026-10-29-agent-team-swarm-tower-pod.md`

## 1. 意图

Phase 1 已交付 Pod 后端（roster / 任务板 / 邮箱 / Pod 记忆 / 单 active goal 队列 / `pod.updated` 事件 / REST / SDK / 插件工具），但桌面只有 `MafwShell` 里的 `pod.onEvent` 空占位——用户看不到「谁在做什么、队列里有什么、团队记得什么」。

本阶段把 Pod 从 API 层带到右工作台「执行」下的第四个视图「鲸群」，让用户能：

- 看见项目 Pod 的 3 人 roster、状态和当前工单；
- 看见 waves 投影出的任务板与 queue；
- 读/发邮箱（以 Lead 身份）；
- 读/编辑 Pod 记忆（`POD.md` / `POD_MEMORY.md` / `glossary.md`）；
- 点成员卡进入 live session，或打开已结束 session 的 transcript 快照；
- 在 SessionStrip 识别 Pod 成员会话。

不做新的执行引擎：goal plan→execute→review→archive 仍是权威，Pod 只是协调/记忆 overlay。

## 2. 已确认决策

| 决策 | 内容 |
|---|---|
| 入口 | 右工作台 ›「执行」› 二级固定下拉新增「鲸群」，位置在「概览」之后 |
| 作用域 | 当前项目一个 Pod；`projectDir = benchRoot() ?? currentProject()`；worktree 目录由 gateway 映射回父 Pod |
| 不自动创建 | 打开面板先 `lookup`；没有 Pod 显示空态「创建鲸群」，只有用户点击才 `ensure`。避免点一下 tab 就建 Pod / 建 Manager session |
| 数据刷新 | SSE `pod.updated` 驱动 + 手动刷新；**不轮询**。同批事件 200ms 合并；无 Pod 时收到事件做一次 lookup |
| 任务板 | 只读镜像 waves/receipts；只允许用户创建手工任务（title），不允许拖拽/改状态。状态由 agent/receipts 驱动 |
| 邮箱 | 桌面操作者以 **Lead** 身份发送；kind 五选一；收件人 = broadcast 或某个成员；v1 不做 thread |
| Pod 记忆 | 三个文件文本查看 + 编辑保存（textarea）；写接口已有 lead 门，桌面省略 actor 属本地信任模型 |
| 已结束 session | 成员卡点击打开只读 transcript 快照 overlay；快照缺失/`unavailable` 显示明确空态 |
| Live session | 成员卡点击打开 live session（tab 打开，不伪造 subagent 返回栈） |
| SessionStrip 徽标 | Pod 成员的 session tab 显示 L/B/R 角色徽标（Tooltip 说明） |
| 旧 gateway 降级 | `lookup` 404 视为「无 Pod」；`ensure` 404 视为「当前 gateway 不支持 Pod」，显示升级提示，不反复 toast |
| Goal 联动 | 任务卡 / 队列项有 `goalId` 时打开 Goal 详情 overlay（复用 `GoalDetailOverlay`） |
| 视觉 | 只用现有 token；无新增动画；窄面板用 grid auto-fit 降级 |

## 3. 信息架构

```
右工作台
├ 工作台（文件/浏览器/终端）
├ 执行
│  └ 二级下拉：概览 · 鲸群 · 待办 · 子代理 · 后台 · 轨迹
└ 审阅

执行 › 鲸群
┌ 鲸群 · mafw ─────────────────────────── [刷新] [休眠] ┐
│ 活跃  · goal-123 · 队列 1 · 预算 $2.40 / $20          │
├ 成员 ─────────────────────────────────────────────────┤
│ Lead      Manager     available   [打开 Manager]      │
│ Builder   mafw-execute working    2 tasks             │
│ Reviewer  mafw-review  waiting    1 review            │
├ 队列 ─────────────────────────────────────────────────┤
│ goal-123 执行中 · goal-124 排队                        │
├ 任务板 ───────────────────────────────────────────────┤
│ 待办(2)   进行中(1)   待审(1)   完成(3)   失败(0)      │
├ 邮箱 ─────────────────────────────────────────────────┤
│ Reviewer → Builder: 测试失败，见 task-7               │
│ [kind ▾] [收件人 ▾] [消息…]                  [发送]    │
├ 记忆 ─────────────────────────────────────────────────┤
│ [POD] [MEMORY] [GLOSSARY]              [编辑]          │
│ 内容…                                                  │
└────────────────────────────────────────────────────────┘
```

## 4. 数据流

### 4.1 新增的非创建式查询

现有 `GET /api/projects/:projectId/pod` 语义是 `ensure`。面板打开不能复用，否则「看一眼」就会创建 Pod。补充：

```
GET /api/projects/:projectId/pod?lookup=1
  200 → PodDetail
  404 → 该项目还没有 Pod（不是错误）
```

- `PodService.lookup(projectDir)` 复用 `resolveProjectDir`（canonical + worktree → 父项目）后 `store.getPodByProject`；未注册项目返回 `null`。
- 与 `ensure` 共路径，不新增 route-catalog operation（query 变化不产生新 OpenAPI path）。
- SDK `pod.lookup(projectID)`；preload 同步。

### 4.2 记忆文件读取

现有 SDK 只有合并上下文 `readMemory(podID, node)` 和写入 `writeMemory`。面板编辑需要按文件读：

```
GET /api/pods/:podId/memory?file=POD|MEMORY|GLOSSARY
  → { content: string }
```

route 已存在；只补 SDK `pod.readMemoryFile(podID, file)` + preload。

### 4.3 状态流

```
PodDock 挂载 / projectDir 变化
  └─ pod.lookup(projectDir)
       ├ 200 → detail + cost
       ├ 404 → detail=null（空态：创建鲸群）
       └ 其他 → error banner（可重试）

创建 → pod.ensure(projectDir) → detail

SSE pod.updated
  ├ 当前 detail.pod.id === event.podId → 200ms 后 pod.get(podId) + cost
  └ detail === null                     → 200ms 后 lookup(projectDir)
```

- `pod.updated` 一次变更可能连续广播多条（实测 6 条/任务操作），必须合并。
- 项目切换时清空 detail；迟到的旧请求用请求序号丢弃。
- 刷新失败不清空已有 detail，只显示 banner。

## 5. 组件拆分

| 文件 | 职责 |
|---|---|
| `renderer/mafw/pod-model.ts` | 纯函数：任务分组、成员/session 查找、事件动作、角色/状态文案、预算文案、unsupported 判定 |
| `renderer/mafw/pod-transcript.ts` | 纯函数：session 快照 → 可渲染 turn 列表 |
| `renderer/mafw/pod-store.ts` | Solid 单例：detail/cost/loading/error/unsupported + lookup/ensure/refresh/status/event |
| `components/PodDock.tsx` | 组合壳：header、成员、预算、队列、子面板、transcript 开合；不写业务算法 |
| `components/PodTaskBoard.tsx` | 任务板分栏 + 手工任务创建；导出 `PodGoalQueue` |
| `components/PodInbox.tsx` | 消息列表 + 发送表单（以 Lead） |
| `components/PodMemoryPanel.tsx` | 三文件读取/编辑/保存 |
| `components/PodTranscriptOverlay.tsx` | 只读快照 overlay |

`ExecutionView` 追加 `pod` section；`MafwShell` 负责 `projectDir`、事件接线、打开 session、Goal overlay、SessionStrip 徽标。

## 6. 交互细节

### 6.1 成员

- 按 role 排序 lead/builder/reviewer（store 已保证）。
- 状态徽标：`available 待命`、`working 工作中`、`waiting 等待`、`sleeping 休眠`、`retired 退役`。
- 点击优先级：
  1. 该成员有 `!endedAt` 的 session → `onOpenSession(sessionId)`（Lead 的 coordination session 就是 Manager）；
  2. 否则有最近一条 `transcriptRef` 的已结束 session → transcript overlay；
  3. 都没有 → 不响应，显示「空闲」。
- 行尾显示该成员当前任务数（`ownerMemberId` 匹配、未完成）。

### 6.2 任务板

- 五栏固定顺序：待办（pending/reopened）、进行中（in_progress/blocked）、待审（review）、完成（done）、失败（failed）。
- 空栏显示 0，不隐藏（用户能看出全貌）。
- 卡片：标题、owner 名、artifact 引用数；有 goalId 时整卡可点开 Goal 详情。
- 「新建」只要求 title；调用 `pod.createTask(podId, { title })`；成功后刷新 detail。
- 队列：`active` / `queued` 优先，最多再显示 3 条最近 `done/aborted`；点击开 Goal。

### 6.3 邮箱

- 列表按时间倒序（后端已 newest first）；显示 `From → To | kind | 时间` + 正文。
- 发送表单：kind（note/request/review/decision/escalation）、收件人（广播/成员）、正文。
- `fromMemberId = lead.id`；空正文禁用发送；成功后清空正文并刷新。
- 发送失败 toast，保留输入。

### 6.4 Pod 记忆

- 三个文件页签；首次切换时读取；按文件缓存。
- 展示原始内容（左对齐、保留换行）；空文件显示占位。
- 「编辑」进入 textarea；保存调 `writeMemory`；成功后更新缓存并退出编辑。
- 保存失败保留草稿 + toast。
- 不做 diff/历史/并发冲突提示（v1）。

### 6.5 Transcript 快照

- 快照结构 `{ sessionID, messages, unavailable? }`；消息可能是 `{info, parts}` 或 `{role, content}`。
- 只渲染文本（user/assistant/other），工具/推理不展开；空快照显示「该会话没有可用快照」。
- Esc / 遮罩点击关闭。

### 6.6 SessionStrip 徽标

- `SessionStrip` 增加可选 `podRoleOf?: (sessionId: string) => PodMemberRole | null`。
- 有角色时在标题后渲染 `L`/`B`/`R`/`C` 小徽标，Tooltip「Pod · Lead」等。
- 数据只来自当前项目已加载的 PodDetail；未加载时无徽标（v1 限制，不额外探测）。

## 7. 错误与空态

| 场景 | 表现 |
|---|---|
| 无 projectDir | DockEmpty「先打开一个会话」 |
| 无 Pod | DockEmpty「这个项目还没有鲸群」+「创建鲸群」按钮 |
| lookup 网络错误 | DockBanner error + 重试 |
| ensure 404（非「project is not registered」） | DockBanner warn「当前 gateway 不支持 Pod，请更新 gateway」 |
| 刷新失败但已有数据 | 保留数据 + banner |
| 无任务/无消息/无记忆 | 各自小节空态文案（不用 emoji） |
| 快照 unavailable | 「该会话没有可用快照」 |

## 8. 非目标

- 不做拖拽改任务状态、队列排序、roster 增删、模型/权限编辑。
- 不做任务与会话的深度关联（后端当前无 task→session 字段）。
- 不做邮箱 thread、未读计数/通知。
- 不做 Goal 详情里的 Pod 徽标/任务板反向链接（v1.1）。
- 不做多 Pod、Curator、Task Force（Phase 3）。
- 不做 TUI 鲸群面板。
- 不新增 canonical 事件；只用 `pod.updated`。
- 不自动创建 Pod，不轮询。

## 9. 验收

1. 未创建 Pod 的项目打开面板：不产生 `project_pods` 行；显示创建按钮；点击后出现 3 人 roster。
2. 已有 Pod：显示 status、active goal、queue、预算、3 成员、任务、消息、记忆。
3. 一次任务操作触发的多条 `pod.updated` 只触发一次刷新（200ms 合并）。
4. 项目 A → B 切换时，A 的迟到响应不覆盖 B。
5. 成员 live session 可打开；已结束 session 打开快照；无 session 行不可点。
6. 手工任务创建后出现在「待办」；任务卡有 goalId 时打开 Goal 详情。
7. 邮箱以 Lead 发送成功，列表出现新消息。
8. 记忆三文件可读；编辑保存后重新读取为保存内容。
9. SessionStrip 对 Pod 成员 session 显示角色徽标。
10. gateway 无 Pod 路由时显示升级提示，而不是空转/循环 toast。
11. 520 / 640 / 760 三档宽度无水平溢出，五栏自动降为 2 栏。

## 10. 测试策略

- 纯函数：`pod-model.test.ts`、`pod-transcript.test.ts`（分组、事件动作、成员/session、预算、快照解析）。
- store：`pod-store.test.ts`（注入 fake API/timers：lookup 404、ensure 404、事件合并、迟到请求丢弃、cost）。
- 接线契约：`pod-dock-wiring.test.ts`、`pod-panel-wiring.test.ts`、SessionStrip/ExecutionView/design-contract 更新。
- 后端/SDK：`pod-service.test.ts`、`pods.test.ts`、`client.test.ts`。
- 门禁：desktop `npm test`、`tsgo --noEmit -p tsconfig.json`、`electron-vite build`；gateway pod 套件；SDK `npm test`。
- GUI 冒烟：创建空态、真实 goal 任务出现、邮箱、记忆保存、成员跳转、快照打开、窄宽三档。

## 11. 开放问题（不阻塞）

1. 桌面操作者是否应建模成第 4 个成员（`operator`），而不是借用 Lead 身份发消息？
2. Pod 记忆编辑需要并发冲突/版本提示吗（当前 last-write-wins）？
3. transcript 快照保留期是否跟随 trajectory retention（Phase 1 开放问题）。
4. 任务卡与 session 的深度关联需要后端补 `task.sessionId` 或由前端按 owner+goal 推断？
