# MAFW Desktop 架构

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。
>
> 变更史（原 AGENTS.md §5.5，按日期记录的功能演进）见 `docs/releases/2026-archive.md`。

## 现状摘要（2026-11-10）

- **技术栈**：Electron 42 + SolidJS + `@mafw/ui`（fork 自 opencode UI）、`@mafw/session-ui`、`@mafw/sdk`；
  electron-vite 三段构建（main / preload / renderer）。appId：`ai.mafw.desktop`（prod）/
  `.beta` / `.dev`；dev 用 `ai.mafw.desktop.dev` 独立 userData。
- **受管 gateway**：打包版默认 managed（payload 从 `resources/gateway` 安装到
  `<userData>/gateway/versions/<version>-<digest12>/`，逐文件 SHA-256 校验 + `.install-complete.json`）；
  未登记进程一律 conflict，绝不静默采纳。
  dev checkout 先读 `~/.mafw/runtime/gateway.json`，用 `/health` 的 `pid`/`instanceId` 对账：
  兼容则 attach（Config 显示「已连接」），版本/schema 不符则 conflict 并提供「用当前构建重启」；
  `MAFW_DEV_ADOPT=0` 表示不 attach、提示先停止现有 gateway。详见 `docs/architecture/gateway.md`。
- **主布局**：左 IconRail（46px，项目会话/搜索/便签/鲸群/审批/Config）+ 左 dock；主区 = chat 指挥列
  + 右工作台（`工作 / 工作台 / 执行 / 审阅`）。chat 档位 520/640/760（默认 760）；push 预算 1490；
  `Ctrl+Alt+F` 专注模式；最小窗口 **900×600**。窗口可用宽 ≥1240 并排（chat 520–760），
  <1240 改为 **Chat / Workbench 全宽切换**（chat 保持 760 居中，composer 不被侧面板覆盖）。
- **Lead / Tech Lead 入口（2026-11-10）**：Lead 会话 composer 上方保留 Tech Lead 邀请条（Goal
  标题 + 阶段 + `来自 Lead 话题`）；Goal 详情「上下文来源」显示 snapshot 前 120 字并可「查看全文」
  （`goals.source`）；详情显示 `goalMode` 徽标（Quick / Standard / Standing）；标题栏「状态」按需
  打开 Lead 状态卡（stage / progress / blocker），不常驻占位。
- **P2 调度 / Topic map（2026-11-10）**：工作台首屏改为 attention-first「需要你处理」（person 优先，
  健康状态只在全部 Goal 列表）；Lead 话题面板增加「分叉」与边界提议的接受/合并/撤销，恢复/分叉
  统一走 `openPodSession`，不展示 session id。
- **工作台**：L2 `文件 / 浏览器 / 终端`。文件树 + 编辑器 + 预览；浏览器多 tab（`persist:workbench-browser`，
  本地文件走 `mafw-file://`）；终端本地 + 多 SSH（xterm.js + ssh2，`mafw-terminal/1` 契约）。
- **编辑器**：默认 **Monaco**（VS Code 内核；`mafw-editor-engine=codemirror` 回退，挂载失败自动回退），
  行内 diff 装饰、Ctrl/Cmd+S、MAFW 主题 token 映射、minimap ≥720px。详情见本文件 Monaco 段。
- **文件预览**：md（session-ui markdown）、json 折叠树、csv/tsv 表格、svg 预览/源码、图片、pdf（Chromium
  viewer）、docx/xlsx/pptx（懒加载）、legacy office 外部打开；HTML 走 `mafw-file://` 在浏览器面打开。
- **批注/审阅**：预览选区 = quote 锚、json 节点路径、表格单元格、图片区域、pptx 页码；Enter 直发 /
  Ctrl+Enter 攒草稿；锚点原地高亮 + 已回应状态。改动审阅 = ChangesDock 目录树 + per-turn diff。
- **检查点**：`CheckpointOverlay` 时间线（会话回滚 / 文件回滚 / both）；服务端检查点支持只读预览。
- **托盘与存在感**：15s 轮询 `/api/presence` → tooltip / 菜单状态 / 任务栏进度；attention 差集通知
  持久化防重发；点击通知 `navigateToGoal` 跨项目打开。
- **主题/动效**：单一 token 集（`.mafw-shell, body` 三个主题块键集一致）；`--dur-fast` 140ms /
  `--dur-surface` 280ms；`createPresence` 折叠面过渡期挂载；reduced-motion 降级。
- **语音**：duplex v1（`/ws/voice` 持续 PCM + partial/final）、自动发送静默窗、TTS 流式 + 打断 +
  播放端背压；语音回复走 `mafw_media_speak` 标记与去重。
- **测试**：`npm test`（node --test + `@mafw/test-shim`）；必须 `--conditions=browser`，否则 solid effect 是 no-op。

### Rail 侧边栏数据流

Rail 通过 `window.api.mafw.{namespace}.{method}(...)` 静态类型 API 获取数据：
```
onMount → gateway.info() 等 ready
       → invoke("project", "list")       → GET /api/projects
       → invoke("project", "current")    → GET /api/projects/current
       → invoke("session", "list", pid)  → GET /api/sessions?projectID=...
```
注意：`projects.current()` 返回的是 `Project` 对象本身，不是 `{ project: Project }` 信封。
点击"All projects"里的其他项目时，同时调 `projects.setCurrent(path)` 同步到 gateway。

所有 data fetching 在组件内 inline 使用 `createEffect`，无独立 hook。
轮询间隔：Dashboard 15s / Approvals 10s / Triage 10s / Automations 10s。

#### Rail 全事件驱动互动（2026-09-15，commits dda276c8..9007c220，v4.7.0）

会话列表对**任意客户端**（TUI/CLI/另一窗口）的增/删/改名即时同步，不再依赖"本地写后 invalidate"：

- **sessionStore 局部变更**（`session-store.ts`）：`patch(id, partial)` / `remove(id)`（跨缓存桶、保排序与兜底标题、bump version signal）
- **事件规划器**（`session-events.ts`，纯函数可测）：`planSessionEvent()` 把 SSE 生命周期事件映射为 patch/remove/invalidate/none——隐藏口径对齐 gateway `isHiddenSession`（`core/session-visibility.ts`：parentID / legacy worker 标题前缀 / `agent==='memory-curator'` / `internal` 角色表——agent 判定是确定性的，kv 角色表 7 天 TTL 剪枝后老 worker 会话不会复活到列表）；patch 走字段白名单（title/time/directory/projectID），**绝不 spread info**（SSE info 无 `metadata.mafw.role`，防止抹掉本地 manager 标记）；pi 的 `session.updated` 空壳（agent_start，无 info）忽略，防每回合 invalidate 风暴
- **MafwShell onmessage 三分支**：`created`→invalidate；`updated`→patch + tab 标题双写（`sessions()` + `store.session`）；`deleted`→remove + `closeSession`（外部删除已打开 tab 自动关闭，split view/active 回退复用）
- **gateway 配套**（`runtime/event-broadcast.ts` 纯函数 + jest）：Mode A 广播封装收敛 `opencodeBroadcast()`，passthrough 事件透传 `directory`（normalize 已提取）；两个项目注册点（HTTP `/register` + registry 目录 watcher）广播 `project_registered`，desktop `projectsRev` 信号触发 Rail/MafwShell 项目列表重拉
- **wire 契约**：gateway 顶层广播（非 `mafw_event` 类型）必须**扁平无 `data` 键**——desktop 剥壳 `event = raw?.data || raw` 会把 `data` 当内层载荷吞掉 `type`；形状由 `event-broadcast.test.ts` 固化（信封名 v2 起为 `mafw_event`，原 `opencode_event`）
- **顺手修复**：Rail 删除调用 `sessions.remove`（不存在）→ `delete`（原删除必弹失败 toast）；Rail 删除后 tab 残留（`onSessionDeleted` 接 `closeSession`）；tab 双击改名纯本地 → 接 gateway rename
- **pi runtime 固有降级**：pi 无 created/deleted/标题事件（SessionManager 无 hook），invalidate 兜底；测试 desktop +23 / gateway +6

#### Shell 事件分发与会话工作区收敛（2026-09-20，阶段一绞杀者）

MafwShell 的 onmessage（原 ~350 行 if-else）与工作区状态抽为独立模块，shell 收敛为布局壳（spec：`docs/superpowers/specs/2026-09-20-desktop-ux-refactor-design.md`）：

- **SSE dispatcher**（`renderer/mafw/sse/dispatcher.ts`）：`dispatchShellEvent(event, deps)` 纯路由——core/lifecycle 内联，其余经 `EXTRA_HANDLERS` 链（flow-cards / dock / chat-stream / media-speak，`sse/handlers/*`）；一切副作用经注入 `ShellEventDeps`（core/lifecycle/flowCards/dock/chat 五组），逐分支可单测；消费语义精确保留原落穿行为（`message.updated`/`part.delta` 提前消费，流式主链与未知事件落穿到 media_speak 检查后 missTrace）；漏接线检测（`isTailAccountedAtShell`）在 dispatcher 尾部
- **纯 reducer**（`sse/chat-reducers.ts`）：乐观 user 消息替换 / assistant 合并 / part delta 累积 / part upsert（含乐观 text 吸收）/ `session.next.tool.*` 承载消息确保 / media_speak 参数提取，全部无 Solid 依赖可测
- **会话工作区单例**（`workspace/session-workspace.ts`）：`workspace` 拥有 tabs signal（`sessions`/`activeId`）、消息 store（`store`/`setStore`）与五个回调注册表（anchor/sendingReset/queueFlush/phase/mediaSpeak，Record 形态 + register/unregister/call API）；MafwShell 以别名引用（`const store = workspace.store` 等），调用点语法零改动
- 测试：desktop 测试已入 CI（root `test:desktop`；desktop 包 `npm test` = node --test + `@mafw/test-shim`，2026-10-21 自 bun 迁移）；desktop +53（dispatcher 9 / flow-cards 9 / dock 8 / chat-reducers+chat-stream 27 / workspace 5，含已知坏 legacy launcher 测试移除 -1）

#### plan/build 模式引导（2026-09-20，切片 3）

- **gateway 零改动**：`SessionPromptOpts.agent` 全链路已通（两条 prompt 路由 + pi 透传）；opencode 内置 plan/build primary agent 天然在 `/api/agents` 列表
- **能力门 = 列表内容判定**：pi 的 `translateAgents()` 恒空（providerConfigApi=true 也不 503），desktop `primaryAgents` 含 plan/build 才显示切换 UI——不得用 capability flag
- **desktop**：`agentSel` 全局单值升级 `agentPicks: Record<sid, name>`（对齐 modelPicks，内存级；`sessionAgent(sid)` accessor）；composer 三态循环「默认→plan→build」（按钮 + Tab 键，picker/mention 激活时 Tab 不抢）；agent pill 加列表非空门（pi 下不再渲染假 "manager" pill）；WelcomeHome「先规划，再执行」按钮（`onStartWithPlan` = createSession + applyAgentSwitch(plan)）
- **TUI**：`/plan` `/build`（幂等 set agentSelection）+ `/agent` picker（含「默认」项）+ chat-store `getAgent` dep 并入 promptAsync body + 状态栏 `◇plan` 徽标
- **顺带修复**：`POST /api/approvals/:id/respond` 空 stub 仍在挂账（独立 bug，与切片无关）

#### worktree 并行会话（2026-09-20，切片 4）

- **能力位**：`RuntimeCapabilities.worktreeApi`（opencode true / pi false）——desktop 入口按 `GET /api/runtime` 的 capabilities 显隐
- **创建**：`POST /api/session` body 加 `worktree?: boolean | string`（`routes/session-worktree.ts` `createSessionWithWorktree`）——`SessionWorktreeManager.create(slug)`：`git worktree add <project>-wt-<slug> -b mafw/<slug>`（平铺于项目同级，与 goal `<proj>-goal-<id>` 约定一致；同名 slug 一律递增 -2/-3，**每会话独立 worktree，无跨调用复用**）→ `session.create({ directory: worktreeDir })` → kv `session-worktree/<sid>` = `{dir, branch, projectDir}`
- **删除联动**：`session.delete`（wave1 dispatch）成功后 `cleanupWorktreeForSession`——worktree remove + branch -D，全部 fail-open 不阻塞删除
- **desktop**：ChatPane titlebar「⎇ 并行」按钮（能力门）+ Rail 行 / titlebar 的 `⎇ <slug>` 徽标（`worktree-label.ts` 纯函数判定：`s.directory` basename 前缀 `<base>-wt-` 且 ≠ 项目主目录）
- **TUI**：`/sessions` picker 行尾 dim `⎇<slug>` 标注（只读）
- **已知边界**：①TS 类字段初始化器先于 constructor 参数属性——`git = simpleGit(this.projectDir)` 拿到 undefined 回退 process.cwd() 会把 worktree 注册进 gateway 自身 repo（已修：constructor 内赋值）；②worktree 内记忆写入不随 directory 分离（HarmonicUnitFileStore 固定 `~/.mafw`），session 维度记忆融合机制未建（goal 链路的 mergeMemoryFromWorktree 不受影响）；③残留孤儿 worktree 可经 `git worktree prune` + 手动清理。**GoalWorktreeManager 修复（2026-09-20）**：①prepare(archive) 的 projectDir 与 constructor 不一致时重绑 simpleGit cwd（防御性，测试钉扎）；②并行路径改为 `worktree add -b` 直建分支——旧实现先在主仓 checkoutLocalBranch 再 `worktree add <branch>`，主仓分支被切走且 add 必败被吞成"already exists"假日志。另：`POST /api/approvals/:id/respond` 空 stub 已替换为真实现（`routes/approvals-respond.ts`：在注册项目 user-questions/（flat+legacy）定位提问 JSON 写 answered/answer/answeredAt，goal askUser 轮询消费；id 路径逃逸防护）

### RightDock 用量/配额拆分（2026-09-07）

- RightDock tabs：`tasks | trajectory | usage | quota | notes`
- **UsageDock（用量）**：上下文条 + Token 统计（会话/项目/记忆三行 + **分模型统计**：今日/7天/30天/全部窗口切换、KPI 行 [总 tokens/估算成本/缓存命中率]、Top3+其他聚合、TooltipV2 五类明细）；数据 `GET /api/usage` 的 `modelStats.windows`，15s 轮询
- **QuotaDock（配额）**：ProviderSection 配额窗口（从 UsageDock 迁出）；UsagePill 点击开 quota tab；15s 轮询同一端点
- 分模型统计查询现算：`TrajectoryStore.getModelUsageStats()` GROUP BY provider+model（索引 `idx_traj_turn_ttl`），成本经 `usage/model-prices.ts` 价目表估算（无价目模型 `estimatedCost: null` 显示 `—`）

### UI 组件约定

- MAFW 禁止新增裸 `<button>`、`<input>`、裸 `title` 属性，一律用 `@opencode-ai/ui/v2/*` 组件
- 按钮用 `ButtonV2`（variant: contrast/outline/ghost）
- 文本输入用 `TextInputV2`
- 开关用 `SwitchV2`
- 提示用 `TooltipV2`（统一 `openDelay: 300`）
- 加载用 `LoaderV2`
- 通知用 `ToastV2`（统一 `toastStore` 入口）

#### UI 工具卡插件系统（desktop）

`~/.mafw/ui-plugins/*.js`（CJS `module.exports = { name, tools }`）自定义桌面 ChatView
工具执行卡。main 进程执行插件 `render(ctx)` 返回声明式 Widget 树（8 种：text/code/kv/
tags/list/row/image/link），经 IPC 交 renderer 内置解释器渲染；sandboxed renderer
不执行用户代码。优先级：无注册卡直接生效，覆盖 MafwToolCards/session-ui 内置卡需显式
`override: true`；pending/running 走默认链，completed/error 才渲染用户卡（防流式 output
O(n²) 传输）。启动扫描 + fs.watch 热重载，fail-open（坏插件跳过、render 抛错回退默认卡）。
实现：`desktop/src/main/ui-plugins.ts`（加载器）、`shared/ui-plugins.ts`（类型+校验）、
`renderer/mafw/components/UserPluginCards.tsx`（代理+解释器）。示例：
`docs/examples/ui-plugins/example-tool-cards.js`。

### 项目工作空间与自适应 Goal（2026-11-03）

> **2026-11-04 supersession note**：本节的 Goal 领域语义、`work.overview` 读模型与 Lead handoff 仍有效；
> Desktop 信息架构已被 §5.27「右主 Agent 工作台」取代——`WorkspaceHome`/全页 `goals` 路由退役，
> 项目工作移入右工作台「工作」主面，rail 的 workspace/Dashboard 目的地由独立「审批」入口取代。

spec `docs/superpowers/specs/2026-11-03-project-workspace-adaptive-goal-design.md`，plan
`docs/superpowers/plans/2026-11-03-project-workspace-adaptive-goal.md`。Lead 是所有明确执行请求的唯一入口；
Tech Lead 在每个 Goal revision 内选择 `quick` / `collaborative`；Desktop 把旧「工作 / 鲸群 / Goals」
收敛为一个项目工作空间（Lead 对话、工作概览、统一 Goal 详情），鲸群下沉为项目资源。

- **规范身份 / 读模型**：`core/goal/goal-identity.ts` 以 `(canonicalProjectDir, goalId)` 解析，多项目同 id
  返回 `ambiguous`，绝不回落首个注册项目；canonical-equivalent 重复注册先去重，避免假歧义。
  `GET /api/projects/:projectId/work` 返回完整五桶（`needs_you/queued/in_progress/result_ready/ended`），
  counts 与列表同源；`PodGoalView` 增 `bucket/sourceRef/strategy/assessment/currentAssignment`。
  SDK `work.overview` / `pod.handoffGoal`，preload 同步。
- **Lead handoff**：`GoalSourceRef`（session/message + 4000 字冻结快照）随 request.json 持久化；
  `POST /api/pods/:podId/goals/handoff` 先 `ensureLead` 再以 Lead 身份建 Goal；
  `mafw_create_goal` / `mafw_set_goal` 在 Pod 项目中只走 Lead/Tech Lead，不再写 Pod-less legacy Goal。
- **自适应执行**：`PlanStrategy`；quick 计划只允许一个 task、可无 goalEval、不进独立 Reviewer，
  完成走 `archive_unreviewed`，仅 `goal_outcomes` 写 `UNREVIEWED`，Pod 业务 verdict 保持 `null`；
  `planReview:'manual'` 强制 collaborative 并驻留 `AWAIT_PLAN_APPROVAL`；quick 有 receipt 机械完整性校验、
  一次 Tech Lead 修复、失败一律 FAIL。
- **派工审计**：`core/goal/assignment.ts` 写不可变 Assignment JSON + `attempt-N.prompt.md`（不覆盖旧 prompt），
  prompt 顺序 `CONTEXT MANIFEST → POD HANDOFF → ASSIGNMENT → 节点正文`；修复/复评使用 `-fix` 产物路径。
- **历史迁移**：`scripts/backfill-pod-goals.ts` 默认 dry-run，仅 request 自身可证明项目归属时导入；
  `--apply` 才写库（本批未对真实数据执行 apply）。
- **Desktop**：`WorkspaceHome`（Lead、工作概览、自由讨论、New Goal composer）、统一 `GoalDetailOverlay`
  （结果/打回 Tech Lead/计划任务/问题回答/方向/时间线）、Goal 感知 Session 标题与 ended transcript、
  `ProjectResources`（团队/邮箱/Pod 记忆/便签/工具链接）。退役 `Dashboard`、`PodRailFace`、
  `PodAttentionList`、`PodResultPanel`、`PodGoalQueue`；执行 `pod` 分区隐藏，持久化值一次性迁到资源页。
- **验证（2026-11-03）**：gateway **4669/4669（591 suites）**、desktop **2709/2709（600 suites）**、
  SDK **199/199**、TUI **306（305 pass/1 skip）**、root plugin **34/34**；
  `tsc` / `tsgo --noEmit -p tsconfig.json` / root build / `electron-vite build` rc=0；
  本批 git diff 统计新增/改写 **99** 个测试用例。GUI 冒烟（dev app + repo gateway，1600/1088）：
  工作空间空态、New Goal 创建、Goal title/bucket/revision 一致、取消 Goal → 历史、资源页团队/邮箱/
  Pod 记忆/便签入口、Tech Lead 已结束会话打开 transcript、gateway 重启后 Goal 保留；1366 只覆盖资源/
  右栏布局。**未在 GUI 实测**：quick/collaborative 完整 LLM 闭环、计划批准/Reviewer/结果打回的真实回合、
  OS 级 deep link（解析与路由由单测/接线测试覆盖）。最终实现 commit `2787681e`；本批未 push、
  未 deploy、未发布。
- **视觉收口（2026-11-04，commit `71f729e8`）**：新增「编辑台式」视觉层（沿用 MAFW 暖中性 token 与
  `--accent`，不新增第二套色板）：工作空间标题/Lead 卡片（左侧 accent 线 + L monogram）、工作概览
  （状态点/计数/`rev`/策略/评审 chips、空态图标）、自由讨论（真实相对时间、chevron、细行）、New Goal
  composer（全宽输入）、项目资源（行内图标/成员头像/悬停 chevron/分区细线）、Goal 详情（GOAL 信头、
  stage chips、当前行动条、卡片化版本历史/区块）；取消/中止 Goal 不再渲染结果卡或取消按钮。
  desktop **2714/2714**、`tsgo -p`/`electron-vite build` rc=0；新增 5 个视觉契约用例。

### 右主 Agent 工作台（2026-11-04）

spec `docs/superpowers/specs/2026-11-04-agent-workbench-right-primary-design.md`，plan
`docs/superpowers/plans/2026-11-04-agent-workbench-right-primary.md`。右 dock 成为 Agent 主工作台，
chatview 是指挥列，左侧 rail 负责导航与团队状态。

- **右工作台四主面**：`工作 / 工作台 / 执行 / 审阅`。`ProjectWorkView` 在「工作」主面承载完整
  `work.overview` 五桶、就地 `PodGoalComposer` 与统一 Goal 详情入口；插件 surface 仍强制回落
  `workbench`，不会因默认 `work` 被搁浅。
- **路由独立**：`workbenchSplit/workbenchShellHidden({content,open})` 取代 `chatActive()` 门控；
  Memory/Approvals/Triage/Automation 保持右工作台可见，Config 只视觉隐藏不卸载状态。
- **Focus**：`workbenchFocusActive({focus,content,open})` 只在项目路由 + dock 打开时把 chat 列收为 0；
  手动隐藏 dock 或项目切换自动退出；不持久化。默认快捷键 `Ctrl+Alt+F`（`Ctrl+Shift+M` 保留给
  main 进程全局 Quick Entry）。
- **窄窗 Chat / Workbench 切换（2026-11-10 A 方案）**：`workbenchZoneFor(availableWidth)` 以
  `1240 = 520 + 720` 为边界；`workbenchColumns({narrow,narrowWorkbench})` 输出
  `left | 1fr | 0`（Chat）或 `left | 0 | 1fr`（Workbench），不再并排。标题栏出现 Chat/Workbench
  分段控件；chat 视图 `.mafw-main.mafw-narrow-chat .mafw-chat` 宽 `min(760px, 100%)` 居中，
  composer 全宽；隐藏 resize handle。320 只作为极端兜底。
- **尺寸与字体**：chat 档位 `520/640/760`、默认/双击 **760**；`WORKBENCH_MIN_WIDTH=720`；
  `PUSH_PAIR_BUDGET=1490`（默认 dock push 点约 1800）；默认窗口 1720×1000、硬下限 **900×600**。
  chat 作用域 token `--mafw-chat-reading/--mafw-chat-composer: 16px`，composer max-height 220px；
  全局 UI base font 仍 14px。
- **入口收敛**：`WorkspaceHome` 与全页 `goals` 路由退役；legacy `goals`/`workspace` deep link 经
  `openProjectWork()` 重定向到 chat + 右「工作」。rail meta 组为「审批（badge）/Config」，项目工作不再占用
  全页目的地；`ProjectResources` 只保留团队/邮箱/Pod 记忆/便签/班底/注意力/最近消息，不再充当
  Memory/Approvals/Triage/Automation 工具目录。
- **验证（2026-11-04 历史；A 方案后 1088/322 不再出现）**：desktop **2726/2726（600 suites）**
  （较本批起点净 +12 用例），`tsgo --noEmit -p tsconfig.json` 与 `electron-vite build` rc=0。
  真实 GUI 冒烟通过：1088/1366/1600/1800 宽度、1600 chat=760、
  1366 chat≈600、1800 非最大化 chat=760/workbench=730；Focus 进 Config 显示 1490px
  主内容而非 0px；隐藏 dock 自动退出 Focus；`Ctrl+Alt+F` 进出；正文/composer 16px、资源行 12px；
  存量 detent 640 保留、清键后回 760。截图：`.mafw/qa/right-primary-{1088,1366,1600,1800}.png`
  及 `right-primary-{1600,1800}-final.png`。
- **边界**：未 push、未 deploy、未发布。最大化 1800 窗因 8px shell padding，推挤态工作台实测 714px
  （非最大化 730px）；OS 级 deep link 与 Pod attention>0 未在 GUI 注入实测，由 parser/source/model
  测试覆盖。已知 deferred minors：ProjectWorkView 常驻 15s 轮询、composer request remount 重开、
  最近消息 unread 未走 `countUnread`、Focus 中 resize handle 未隐藏、部分旧视觉契约未迁移。
- **实现与终审修复 commits**：`65ee6344`..`b4c2c61a`（最终代码 `b4c2c61a`）。
- **Deferred minors 收口（2026-11-04，commits `ba221583`/`c2e4b098`/`81d2ebb8`/`ed07c0a6`/`bb27330c`/`ea0d7d9e`）**：
  上条列出的 deferred minors 全部修复——① 左栏最近消息统一走 `buildRecentMessages`（自己发出的
  广播不再误标未读，`podRecentMessages` 删除）；② `ProjectWorkView.active` 门控 15s 轮询（Config
  隐藏工作台时也不轮询，`workbenchContent() === "project"`），composer 请求用模块级消费游标只处理
  一次（remount 不重放）；③ Focus 进入时快照 detent/L1/L2/`previousSurface`，退出恢复（Focus 中
  导航也不丢原视图），关 dock 或切项目先恢复再退出，Focus 中隐藏 resize handle；④ `friendlyWorkError`
  只映射 `pod not found`/`没有鲸群`/`no pod`（404 不再冒充“没有鲸群”）；⑤ 过期文案改为右工作台
  （ProjectResources 副标题/注意力行、PodDock hint 与注释、`/goals` 命令标题与描述）；⑥ 恢复视觉契约
  `right-primary-visual-contract.test.ts`（状态点/分组计数/chips/头像/chevron/Goal 信头，钉到具体
  CSS 声明而不仅是类名）；⑦ `mafw.css` 12 行 GBK/U+FFFD 乱码注释重写为可读 UTF-8（仅注释，零选择器/
  声明变化），`css-encoding.test.ts` 同时守卫 U+FFFD 与常见 GBK 乱码字符。门禁：desktop
  **2782/2782（610 suites，本批新增 12 个用例）**、`tsgo --noEmit -p tsconfig.json` rc=0、
  `electron-vite build` rc=0。本批未再跑 GUI 冒烟（纯逻辑/文案/编码，由源契约与全量套件覆盖）；
  计划 `docs/superpowers/plans/2026-11-04-right-primary-minors.md`。
- **Tech Lead 按 Goal 持久入口 + 班底焦点行（2026-11-04，spec `docs/superpowers/specs/2026-11-04-techlead-goal-entry-design.md`，plan `docs/superpowers/plans/2026-11-04-techlead-goal-entry.md`，调研 deck `docs/research/2026-11-04-techlead-entry-industry-research.html`）**：
  修 GUI 验收 #2 断链（邀请条只在 discussing 一瞬、Goal 详情无按钮、班底行开「最新会话」抽奖）。
  ① **入口 A**：Lead chat 邀请条非终态持续化——`techLeadInvite` 以 `PodGoal.endedAt` 为终态权威（老 gateway 缺 stage 不再一票否决），`pickTechLeadInviteGoal` discussing 优先选位 + `podStageLabel` 阶段标签透传 ChatPane/PodTechLeadInvite；
  ② **入口 B**：`GoalDetailOverlay` 头部「与 Tech Lead 讨论」按钮（非终态 → `requestPodTechLeadOpen(id, activeRevision())` + `onClose`，走 ensure；终态 → `techLeadEntryMode` 判 transcript，从 Pod detail 找已归档 discussion 会话开 transcript，无快照给「讨论已归档（无快照）」提示——终态 revision 的 GET tech-lead 会 409，绝不走 ensure）；
  ③ **班底焦点行**：`memberFocus` 纯函数（Tech Lead 恒走 `{kind:"techlead"}` → openTechLead ensure 讨论会话，其余成员 live/transcript；行内显示「讨论/实施/评审「Goal 标题」」，无 live 显示待命不可点），`ProjectResources` + `PodDock` 双面接入，techlead 目标经模块单例桥梁路由（零新 props 穿透）。
  两入口均汇到既有 `openTechLead` → `ensureSession` 通路；**gateway / SDK / 运行时契约零改动**，成员消息维持邮箱 + A2A。业界依据：Devin（任务为中心/一步可达）、Claude Code Agent View（roster）、Naive 公司板、aweb 焦点、Jira/Elixion 任务挂人（详见 deck）。commits `1a759b1e`/`62812009`/`1c3b4259`/`57b85245`/`145342ef`/`4535df25`/`a8415a29`/`6707c681`/`1350602f`；desktop **2809/2809（617 suites，本批净 +18）**、`tsgo --noEmit -p tsconfig.json` rc=0、`electron-vite build` rc=0。终审（deepseek-v4.1-flash）：1 Critical（终态入口走 ensure 必 409）已修——`techLeadEntryMode` 分支 + `techLeadTranscript` 走已归档 discussion transcript（无快照给诚实提示）；1 Important（班底 live 会话挂终态 Goal 仍走 ensure）已修（memberFocus 只认非终态 Goal）；另 1 Important（入口 B 契约测试抓不到分支回归）已由 `techLeadEntryMode` 纯函数单测补上。
  **真机冒烟（2026-11-04，dev app + CDP 9222，截图 `.mafw/qa/techlead-entry-resources*.png`）**：终态 Goal 入口 B →「查看 Tech Lead 讨论」→ 打开归档 transcript（无 409）；新建 discussing Goal 后：入口 A 邀请条带阶段标签「Tech Lead 讨论中」、入口 B 按钮「与 Tech Lead 讨论」→ 点击关浮层 + 打开「Tech Lead · <Goal 标题>」tab、班底 Tech Lead 行「讨论「<Goal 标题>」」点击进同一 tab——全部通过。冒烟抓到并修复：① 真实讨论会话用 `scopeKind:"discussion"` 标记（node 为空），焦点词表只认 node → 显示成「工作」；已与 `podSessionRoute` 同口径（commit `1350602f`）。② 用户报「项目资源页按钮全是加号」根因 = `@mafw/ui/v2` 图标注册表缺 `refresh`/`square-arrow-top-right`/`layout-grid`，`ButtonV2 icon=` 未知名静默回退 `plus`；补三个字形（路径取自 v1）+ 新增 `icon-registry-coverage.test.ts` 扫描全部 ButtonV2/IconButtonV2 用法（commit `6707c681`）。**冒烟发现的产品缺口（非本批引入，未修）**：`取消 Goal`（goals.control ABORT）对 discussing 阶段是 no-op——讨论中的 Goal 无法取消，冒烟 Goal 留在项目「进行中」。**方向裁定选项 B 追加点验（2026-11-04，用户拍板）**：goal 进入 planning 后 Lead 邀请条仍显示且阶段标签变为「Tech Lead 规划中」，点击打开同一 Tech Lead 讨论 tab（未新建）——跨阶段持续与验收 1 通过；冒烟 Goal 的 Tech Lead 还抓到 Lead 焦点行「协调「未命名目标」」编造标题（协调会话 goalId 为空），已修（无 Goal 归属时显示「协调中」，`8a6b63dd`，+2 用例）。desktop 最终 **2810/2810（617 suites，本批净 +19）**、`tsgo -p` rc=0、`electron-vite build` rc=0。**冒烟暴露 goal driver 缺口并已修（2026-11-04，commit `4a6d6cbb`）**：plan 节点复用 Tech Lead 讨论会话时，若模型走结构化交卷（`mafw_submit_result`）而不写 `waves.json`，唯一的完成 idle 会被「复用会话陈旧 idle 宽容」吞掉 → 节点卡在 running 直到 30 分钟 watchdog（真机：attempt 1 卡死，retry attempt 2 才走通）。修复：宽容分支先查结构化交卷（有交卷即按完成收账）+ grace 改为每个节点派发独享（派发时清除）。TDD：`plan-package-driver` 新增无文件产物 + 结构化交卷用例（无修复 RED → 修复 GREEN），goal 套件 **407/407（51 suites）**、gateway `tsc` rc=0。**运行中的 gateway 未重启，修复待部署生效**（冒烟 Goal 已用 retry 解开并进入 execute）。

### Composer 会话配置菜单 + switchAgent 门 + rail 视觉精修（2026-11-04）

spec `docs/superpowers/specs/2026-11-04-inputbar-rail-attention-redesign-design.md`，plan
`docs/superpowers/plans/2026-11-04-inputbar-rail-attention-redesign.md`。注意：本批为**收窄后范围**——
attention 通知链整体移交 `2026-11-04-pod-event-layer-ambient-attention-design.md`（用户裁决「以他们为准」），
本批**不产生**任何 `pod.updated {kind:'attention'}` / toast / OS 通知 / 托盘改动，也不动 result 通知链。

- **Composer 收敛（B 方案）**：常态 17 → 7（`＋` 附件菜单 / `⋯` 更多 / `🛡` 审批 / `🎤` / 上下文微标 /
  **模型名「会话配置」pill** / 发送 + busy 暂停）；删 agent pill、plan/build 三态 pill、`/` 与 `@` 按钮、
  keyhint 浮层（教学并入 placeholder `输入消息…（/ 命令 · @ 引用）`）。会话菜单（`SessionConfigMenu`）三行：
  Agent（默认/plan/build 内联展开；Lead 锁定）、模型（转开 ModelPicker）、Thinking（七档；
  runtime 不支持时禁用 `—`）。pill 默认显示模型名，**偏差才出小徽标**（`plan`/`lead`/`create`/`⚡ level`）。
  键位零变化（Tab 三态循环、`/`、`@`、Ctrl+Enter、↑↓ 全保留）。窄窗档位 4→2（≤620 藏上下文微标；
  ≤520 藏 `＋`，附件/截屏/引用在 `⋯` 菜单仍可达）。
- **Thinking 管道**：`SessionConfigService.get` additive `thinkingLevelSupported`（`typeof setThinkingLevel === 'function'`）
  + SDK 类型；桌面 `session.config` 从 `IGNORED_AT_SHELL` 移出、flow-cards 分支消费 → `sessionConfigs` store；
  打开会话拉 `sessions.config`（fail-open），设置走 `sessions.setConfig({category:'thought_level'})` 乐观+回滚。
- **switchAgent 双向门**（网关）：`POST /api/sessions/:id/agent` 非 coordination 会话切到 lead/manager → 403；
  coordination 绑定会话切离 lead → 403；worker 注册表身份 → 403；`mafw-create` 与 runtime 原生（build/plan）放行；
  `lead-archived`（已解绑）不受限。`SessionSwitchDeps.isCoordinationSession/isRegistryIdentity` 由 Wave1Gateway
  注入（`leadSessionRegistry.findBySessionId` / `identityRegistry.get`）。
- **Rail 视觉精修（46px 布局零变化）**：`bubble-5`/`magnifying-glass`/`sticky-note`/`team-three` 四枚字形按
  1.3px 线宽重描（弃粗体气泡/放大镜）；`new-action` 去虚线改实心 accent 14% tint；gap 5→8px、padding 8→10px。
- **测试**：新增 `composer-session-menu-wiring`（6 例）、`session-config-menu-model`（8 例）、
  session-switch gate（8 例）、session-config supported（2 例）+ wiring（1 例）、flow-cards session.config（2 例）、
  gateway `opencode-agent-roles`（4 例）+ `opencode-thinking-level`（4 例）+ view-projections 角色标记（1 例）+ SDK agent 字段（1 例）、
  session-events 覆盖保持；更新 `design-contract`/`composer-toolbar-css`（含源序守卫）/`agent-identity`/
  `lead-coordinator-wiring`/`duplex-voice-wiring`（麦克风单入口 3→2）。desktop **2829/2829**（617 suites，较批前 2810 净 +19）、
  gateway **4771/4771（604 suites）**、SDK **199/199**；`tsgo --noEmit -p tsconfig.json` / gateway `tsc` /
  `electron-vite build` rc=0。
- **终审（deepseek-v4.1-flash）修复**（commit `cca48dd4`）：2 Critical + 2 Important 已修——
  ① `thinkingLevelSupported` 生产恒 true（`index.ts` 恒注入抛错 wrapper）→ 新增
  `supportsThinkingLevel` 活 runtime 探针 + wiring 测试；② view DTO id 是 `Build`/`Plan`，
  菜单小写 id 查不到 entry（plan/build 静默失效）+ pill 恒显 `Build` 徽标 → `agentBadge` 大小写不敏感、
  新增 `findAgentEntry`（`isAgentKey`）+ 行为单测；③ `POST /api/session/:id/config {category:'agent'}`
  绕过 coordinator 门 → 抽出共享 `checkAgentSwitchGate` 并接入 config 路由；④ 菜单行为测试缺口由
  上述单测补上。
- **Deferred minors 收口（commit `7027c01b`）**：① 门大小写归一（`Lead`/`MAFW-TECH-LEAD` 不再绕过）；
  ② `SessionSwitchDeps` 两个门回调改为必填（漏接线不再静默降级）；③ Thinking 子菜单加「默认」项
  （`thought_level:null` 清配置层档位，runtime 无 unset 原语、不清 runtime 内部状态）；
  ④ `mafw-create` 会话 Agent 行同样锁定；⑤ `archiveLeadSession` 归档后清除指向该会话的 kv 槽
  （`clearSlotsForSession`，archived⇒unbound 不再依赖 rotation 写新槽）；⑥ 死 CSS（`.mafw-keyhint`）/
  暂停按钮死 class/测试名清理；⑦ ≤620 审批 pill hover/聚焦显示短标签（spec §3.1 字面）；
  ⑧ 注释 typo。gateway 目标套件绿（session-config 8、session-switch 13、manager-session-runtime 23）、`tsc` rc=0。
  **契约边界收口（2026-11-04）**：`thinkingLevelSupported` 探针从「直摸 `runtime.session.setThinkingLevel`」
  改为 **`RuntimeAccess.can('session.setThinkingLevel')`** 契约面判定（wiring 测试钉 `can('session.setThinkingLevel')`）。
  发现并记录：opencode 的推理档位实际是 **model variant**（`/api/model` 的 `variants[{id,settings.reasoningEffort}]`，
  `model_config.variant` 切换）——属 runtime 内部实现；中性契约只暴露 `session.setThinkingLevel`。
  **2026-11-06 补齐**：opencode 适配器实现该 surface（`thinkingVariantForLevel` 把七档映射到当前模型 variants：
  精确 id/effort 优先、缺档取最近（平局取更高）、`off` 优先 `none`/`thinking.disabled` 否则降级最低档），
  复用 `POST /session/:id/model` 切 variant；`thinkingLevelSupported` 随之变 true，桌面菜单可直接选档。
  variant 目录仍只存在于适配器，桌面**不分叉 runtime、不暴露目录**（契约隔绝）。
- **Agent 菜单契约中立化（2026-11-04）**：`plan`/`build` 不再进入前端——Agent 行选项、Tab 循环、偏差徽标
  全部从 `MafwAgent` DTO 派生（`session-config-menu-model.ts` 的 `agentMenuOptions`/`nextRuntimeAgent`/`agentBadge`；
  只列 `source:'runtime' && selectable`，默认 agent 置顶）。runtime 的「默认主 agent / 规划 mode」由适配器翻译为
  中性 `MafwAgent.default` / `MafwAgent.planning`（opencode 的 `default_agent`/`build`/`plan` 只存在于
  `opencode-adapter.ts`），`WelcomeHome` 的「先规划，再执行」改读 `planning` 标记；`SessionConfigMenu` 不再有
  硬编码「默认」项。`experience-boundaries` 增 `runtime-agent-name` 扫描（`isAgentKey(..., "plan"/"build")`
  在 renderer 全域禁入，反向 fixture 钉扎）。老 gateway 无标记时：不猜默认（无徽标；显式选择后显示），
  Agent 选项仍按 DTO 列表工作。`session-config` 的 thought_level 错误文案改为契约面名
  `session.setThinkingLevel`。
- **GUI 冒烟（契约中立化，旧全局 gateway v5.0.0）**：新建会话菜单 Agent 行显示 `Build`（会话 agent 真值；
  无硬编码「默认」项）+ 选项 `Build✓ / Plan`；切 Plan → pill `Plan` 徽标；「先规划」按钮因缺 `planning`
  标记而隐藏（新 gateway 标记后恢复）。截图 `.mafw/qa/agent-menu-contract.png`、`agent-pill-plan-contract.png`。
- **Thinking 子菜单可选中（2026-11-06）**：`.mafw-picker-pop` 是 `overflow:hidden` + `max-height:380px`，
  Thinking 展开 8 档后下半截被裁掉（用户实证「向下弹出、选择不了」）。修复：`.mafw-config-menu` 放宽到
  `min(480px, calc(100vh - 16px))`，`.mafw-config-rows` 允许滚动（`overflow-y:auto; min-height:0`）；
  `PopoverShell` 抽出纯函数 `computePopoverPlacement`（`popover-placement.ts`）并加 `ResizeObserver`，
  内容变高时重新锚定（否则 top 固定、popover 向下长出视口）。测试：placement 6 例 + CSS 1 例 + wiring 1 例；
  Electron 离屏布局实测 13 行菜单 473px 全可见，400px 高窗口 rows scrollable（scrollHeight 442 > client 356）。
  desktop **2877/2877**、`tsgo -p` / `electron-vite build` rc=0。
- **自定义 provider 不再被隐藏（2026-11-06）**：`/api/provider` 的 `connected` 原先只取 `/api/credential`；
  蓝区 `gateway` 的 apiKey 在 opencode 配置 `settings.apiKey` 里、不是 credential → 被标 `connected:false`，
  桌面 `modelGroups` 直接跳过整个 provider（用户实证「gateway 的模型不见了」）。适配器把带内联 apiKey 的
  provider 并入 `connected`（凭据仍是 /api/credential 权威，只是不再是唯一来源）。测试 +1；
  gateway **4772/4772（604 suites）**、`tsc` rc=0；已 build + deploy:local + 重启（`/api/provider`
  现在 `gateway.connected=true`，5 个模型在 envelope 内）。
- **GUI 冒烟（2026-11-04，dev app CDP 9222 + 旧全局 gateway v5.0.0）**：主仓 dev app 实测——
  工具条收敛为 `＋ ⋯ | 🛡 | 🎤 上下文 会话pill 发送`（agent/plan-build pill、`/` `@`、keyhint 均消失）；
  Lead 会话菜单 `Agent lead·锁定`（disabled）+ `Thinking —`（opencode 无 setThinkingLevel，两代 gateway
  一致降级）；普通会话菜单 Agent 三选项（默认✓/plan/build；**已由下方契约中立化取代**），点 plan → pill 出 `plan` 徽标、点默认 →
  徽标消失且**不再出现 Build 徽标**（Critical #2 端到端回归）；`＋` 菜单 附件/截屏批注/引用Agent、
  `⋯` 菜单 附件/截屏/引用/审阅改动(N)/语音播报/暂停(忙时)；容器档位强制宽度实测 610→仅藏上下文、
  500/420→藏＋、发送恒显且 toolbar 零溢出。**冒烟抓到并修复**：档位 `@container` 块写在
  `.mafw-context-pill`/`.mafw-composer-meta` 基础规则之前，同特异性按源序被覆盖（窄窗 ctx 未隐藏，
  旧代码同样隐患）→ 档位块移到全部基础规则之后 + 源序守卫测试（commit `f76b16a4`）。
  截图 `.mafw/qa/{composer-menu-wide,composer-pill-plan,composer-pill-default,smoke-composer-plan,smoke-rail}.png`。
  未覆盖：`switchAgent` 403 HTTP 实测（运行中的全局 gateway 为 v5.0.0，门未部署；由 13 个路由单测覆盖）、
  Thinking 启用态（opencode 恒不支持，pi 专属）。
- **已知边界**：attention 通知链与托盘 presence 归 pod-event-layer 批次（其设计已评审、实现进行中）；
  本批未 push、未 deploy。

### Pod 事件层与常驻注意力（2026-11-04，进行中）

spec `docs/superpowers/specs/2026-11-04-pod-event-layer-ambient-attention-design.md`，plan
`docs/superpowers/plans/2026-11-04-pod-event-layer-ambient-attention.md`。**Task 1–9 全部交付**（Task 9
桌面 inbox / `viewedResults` 双读迁移于 2026-11-05 收口）。

- **事件模型**（`gateway/src/core/pod/pod-event-model.ts`）：确定性分级，无 LLM。Goal 归档 `verdict ∈
  {PASS,FAIL,MAX_RETRIES,ERROR,UNREVIEWED}` → p1（`resultReady` 不决定是否通知，硬失败同样要看见）；
  `CANCELLED`/`verdict=null` → p3；成员消息 `request|escalation` 且 `to=lead` → p2，其余 p3。
  `goalDedupeKey(goalId, revision)` 带 revision（打回后第二版不被吞）。
- **存储**（`pod-store.ts` + `pod-event-service.ts`）：`pod_events` 表是运行时真相（`UNIQUE(pod_id,dedupe_key)`
  幂等、`state` 只有 unread/seen、`wakeState/attempts/at/sessionId`），`~/.mafw/pods/<id>/events/*.json`
  是创建时写一次的审计快照（写失败只 log，不丢事件）。
- **写点**：`finishPodGoal`（全 verdict）+ **`PodStore.insertMessage`**（REST service / decision note / A2A bridge
  三路唯一收口——挂在 service 层会漏掉 A2A 主通道）。
- **`GET /api/presence`**：跨项目聚合 `running/attention(items+revision)/unreadResults`；progress 取自
  `pod_tasks` 的 done/total（`state.currentWave` 只有 legacy 路径在写），worktree 经 `parentProjectDirForWorktree`
  折叠；`PodAttentionItem` 增 `revision` 且 id 变 `goal:kind:r<rev>`。
- **Lead 唤醒**（`pod-event-wake.ts`）：p2 落库后 `notify()` + 启动 5s + 每 60s 扫描；闸门 = Pod 暂停 /
  run suspended / busy / 6 次每小时 / 同 goal+kind 10min；**已 delivered 的镜像消息直接落定不重复注入**；
  多条 pending 合并成一条 `[POD EVENT]`；成功后 `commitDelivered` 收口；重启后 pending 自动补发。
- **SSE `pod.event`** `{podId,eventId,goalId,revision,kind,severity}`：六处词汇链 + `emit:openapi` /
  `emit:runtime-contract` / `gen:api` 同步；`checkEventFields` 增 `pod.event` 必填校验（并行批次报出的红）。
- **桌面**（`presence-model.ts` / `presence-poller.ts` / `attention-diff.ts` / `notify-state.ts`）：main 15s 轮询
  `/api/presence` → 托盘 tooltip + 任务栏 `setProgressBar`（无进度用 2 不确定态）+ 菜单状态行导航
  （左键仍 toggle）；attention 差集按 id（含 revision）通知一次并持久化 `mafw-notify.json`，重启不重发；
  结果按 `goalId:r<revision>` 去重后通知。
- **测试**：gateway 新增 `pod-event-model` 16、`pod-event-service` 6、`pod-event-write-points` 4、
  `pod-presence` 6、`pod-events-route` 4、`pod-event-wake` 6；desktop 新增 `presence-model` 1、
  `attention-diff` 1、`pod-events` 1；SDK 契约计数 32→33。**gateway 4726/4726（598 suites）**、
  **desktop 2828/2828（618 suites）**、**SDK 199/199**；`tsc` / `tsgo -p` rc=0。
- **冒烟（2026-11-04，部署后 HTTP 实测）**：gateway build + `deploy:local` + 重启（`2a2f1265`）后 `/health` 200；`GET /api/presence` 返回 `running/attention/unreadResults` 三键，实测 `running=1 attention=1`（stale `plan-smoke-9`，attention id 已是 `goal:kind:r1`，`action` 正确）；`GET /api/pods/:id/events` 可用。POST 一条 `note` 消息 → 端到端产出 `member.note / p3 / audience=none / state=seen`（写点收口 + 分级 + 非人事件不计未读全部验证）。**冒烟抓到并修**：p3/lead 事件原本也计 `unread`，会污染人侧 inbox 计数 → 非 `human` audience 写入即 `seen`（commit `2a2f1265`，新增回归用例）。
- **GUI 冒烟（2026-11-04，dev app 重启后）**：main 侧 presence 链跑通——`%APPDATA%\ai.mafw.desktop.dev\mafw-notify.json`
  首次写入 `{"attentionIds":["plan-smoke-9:blocked:r1"]}`，证明「15s 轮询 → attention 差集 → 一次通知 → 持久化
  防重发」全链生效，且 id 确实带 revision。任务栏进度未验（当前无在跑的 Goal，`plan-smoke-9` 是 stale blocked，
  progress=null → 不画进度条）。

- **评审（glm-5.3）与修复**：C1 已修——`unreadResults`/托盘 attention 原先由 `resultReady`（永不回 false）推导，导致托盘永久卡 attention、且无产物的硬失败反而不显示；现改为按 `pod_events` 的未读 p1（`goalId:r<revision>`）推导，seen 后自然回落 idle。I2 已修——唤醒预算失败退回、预算拒绝只累加 `wakeAttempts`（3 次才 suppress）、member 事件去重键带 message 身份（否则全 Pod 的 escalation 共用一个键）。I6 已修——presence 连续 3 次失败回落 idle（不再让托盘中继过期状态）。
- **quick 路径 goal-eval 缺口（2026-11-05，commit `d0752664`）**：quick 计划允许不写 `goalEval`（`validatePlanPackage` 契约），
  但 execute/review 的 ContextManifest 把它当硬前置 → 每个 quick Goal 一进 execute 就 fail-closed
  （实证 `goal-20261104-120349-31c1a0`：`required context missing: goals/<id>/goal-eval.json`）。
  裁决（用户）：**quick 也要 eval**，但**不额外消耗模型输出**——由 driver 从 `waves.tasks[].acceptance` 派生
  （1 条 outcome + N 条 `g<task>-<n>` 条件 + mapping），manifest 保持严格。对齐 SuperAgent 的「完成状态是结构化
  Report、绝不从自由文本推断」。测试：`goal-driver-quick-path` 新增派生用例，`context-manifest-wiring` 的 quick 用例翻成
  fail-closed；goal 套件 **426/426**、`tsc` rc=0。真机复跑 `goal-20261105-010329-3722d8`：goal-eval 生成 →
  execute 通过 → 文件产出 → 归档 `resultReady` → 结果通知一次（ledger 记 `goal-20261105-010329-3722d8:r1`）。
- **grace 有时限（2026-11-05，commit `15aeda0d`）**：复用讨论会话的 plan 回合若既没写产物也没结构化交卷，
  首个 idle 被 grace 吞掉后不会再有第二个 idle → 以前只能等 30 分钟 watchdog（实证 `goal-20261104-132754-140bde`）。
  现在 grace 消耗后启动 `reuseGraceMs`（默认 90s，deps 可覆盖）定时器，超时直接走 `completeNode` →
  `artifact_missing` 判失败；节点派发/收账/失败都会清掉定时器。RED→GREEN：无修复时新用例失败，
  修复后 goal 套件 **411/411**、`tsc` rc=0；已部署重启（health 200）。
- **idle 归属（2026-11-05，commit `521139ba`）**：调研 `docs/research/2026-11-05-turn-idle-attribution-research.md`
  后按业界第 1 级（完成信号归属本回合）修：`NodeDriver` 记 `dispatchSeq`（派发瞬间的活动水位）与 `activitySeq`
  （`turn.started` / `part.updated` / `part.delta` / `message.updated` 经 `handleRuntimeEvent` 单点累加）；
  idle 到达时**没有本回合活动就忽略且不消耗 grace**，有活动才收账（无产物 → `artifact_missing`）。
  grace 超时（90s）降为「有活动却迟迟没有 idle」的兜底。测试新增 `idle-attribution` 三例（陈旧 idle 不收账 /
  有活动无产物快速失败 / 有活动有产物正常完成），harness `fireIdle` 默认模拟「先有活动再 idle」，
  显式 `{withActivity:false}` 才构造陈旧 idle；goal 套件 **414/414**、`tsc` rc=0，已部署重启（health 200）。
- **Task 9：桌面 inbox + `viewedResults` 双读（2026-11-05，commit `8864bf45`）**：`pod-events.ts` 增
  `createPodEventsStore`（Solid 单例）——`pod.event` SSE 经 dispatcher `onPodEvent` 进 `ingest`（先本地落一条
  让角标立即动，再拉 server truth）；`markSeen` 乐观 + 失败回滚（角标清了但结果没看到是更糟的状态）；
  事件路由 404/HTML 回退 → `supported=false` 退回 legacy localStorage（特性门控）。**双读判定**
  `isResultViewed` = `pod_events` 同 goal+revision 已 seen（且 podId 匹配）或 legacy `viewedResults` 键命中
  （旧存档不丢，随查看自然收敛）。四个消费点：`MafwShell.podResultDot`、`pod-model.latestUnviewedResult`
  （改为 `viewed(goalId, revision)`）、`PodResultView`（结果**加载成功后** `pod.events.seenAll`）；
  `openPendingResult` 随旧通知链一并退役。工作台「工作」`result_ready` 行新增「未查看」chip
  （`.mafw-work-chip.is-unviewed`）。**旧通知链退役**（spec §7）：`handlePodResultEvent` 的 toast +
  hidden-only 通知 + `pendingResultGoalId` + 结果事件队列全部删除——完成通知归 main 的 presence 轮询
  （同一条结果不再双通知）。
  测试：desktop **2845/2845（620 suites，本批净 +17）**、`tsgo --noEmit -p` / `electron-vite build` rc=0。
  真机冒烟（dev app + CDP）：工作面显示「未查看」chip → 点行打开结果、数据加载成功 → DB 事件
  `state=seen`（unread 3→2）且 chip 消失；legacy localStorage 里两个已查看键仍抑制 chip（双读生效）。
  终审（glm-5.3）：I-1 已修——`seenAll` 成功后再落一次 seen（await 期间并发刷新带回 unread 不会让角标
  复活），回滚只作用于同 Pod；I-2 通知文案改为「打开工作台查看结果」（不再承诺点击跳转，
  `mafw-navigate-goal` 接收端仍 deferred）。
- **deferred 收口（2026-11-05，commits `1a708c19`/`e2779fe0`）**：
  - `mafw-navigate-goal` 全链接线：main 托盘状态行 + attention/result 通知点击 → `navigateToGoal`
    （`{podId, projectId, goalId}`；无窗口时新建并等 `did-finish-load`）→ preload `navigate.onGoal`
    → renderer 跨项目先 `handleSelectProject` 再 `openGoalDetail`；结果通知文案恢复「点击查看结果」。
  - `pod.event` 到达时 renderer 调 `presence.refresh()`（新 IPC `mafw-presence-refresh`），完成通知/托盘
    不再等 15s 轮询。
  - presence 折叠真去重：同 `(parentProjectId, goalId, revision)` 只保留一条 running/result，
    attention 按 revision-scoped id 去重（不再只改标签）。
  - p3 事件 prune：`PodEventService.prune()` 每天（+ 启动时）清掉 7 天前**已读** p3 行（unread/待唤醒
    不删）与 30 天前审计 JSON（按事件 `createdAt`，不是 mtime）；p1/p2 永不在此删除。
  - inbox 收口：`loaded()` 门控冷启动不闪「未查看」；>200 事件时 keptSeen 优先占位；`seenAll` 成功后
    重新落 seen；非当前 Pod 的 `markSeen` 仍提交 server；首屏未加载/已查看重放的 SSE 事件不再先落 unread。
  测试：gateway pod 套件 **449/449**、`tsc` rc=0；desktop **2853/2853（620 suites，本批净 +8）**、
  `tsgo -p` / `electron-vite build` rc=0。（prune 的每日定时接线在 `gateway/src/index.ts`，该文件随
  并行批次 commit `d8bfc043` 一并落库。）
- **未做（资产类）**：托盘三态仍无独立图标资源（只换 tooltip/菜单文案）；`latestUnviewedResult` /
  `shouldMarkSeen` 作为纯契约 helper 保留（生产暂无调用方）。
