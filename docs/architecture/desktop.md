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
- **主布局**：左 IconRail（46px，文件/改动/讨论/搜索/便签/Lead/审批/Config）+ 左 dock；主区 = chat 指挥列
  + 右工作台（文档舞台）。chat 档位 520/640/760（默认 760）；split push 预算 1240；
  窄窗二选一按当前可见栏算 push（Chat 520 / Workbench 720）；
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
- **内容工作台 scope（2026-11-11 Plan B）**：文件/编辑器/终端的根由显式 `ContentScope` 决定：默认项目
  主目录，Goal revision worktree 只能从结果「查看本版文件」进入；Chat 角色切换不改变根。工作台标题栏
  显示「项目文件」或 `Goal · 标题 · revision N`，Goal scope 提供「返回项目文件」。文件树展开/选中、
  编辑器 tabs/活动文件/阅读位置/选区按 scope 恢复；批注草稿携带 `scopeKey`/`root`，草稿内容仍按 root 隔离。
  最后 scope 按项目持久化（重启/切项目后恢复，worktree 不可用则回退项目根）；终端为每个 scope 保留独立本地会话；
  返回会同步树选中并恢复编辑器选区。内联 diff 只在活动会话目录与内容根一致时显示；持久化评审项留给后续。
- **Stage-first 焦点基础（2026-11-12 Plan 1；2026-11-13 部分被取代）**：content context 走
  `FrameBar / FocusStage / SubjectPicker`；焦点 = `scope + subject + place`，按世界持久化到
  `mafw-focus:v1:<worldId>`。`⌘P` / `Ctrl+P` 取景器打开文件、最近内容、浏览器、终端；返回 /
  面包屑通过 `syncStageToFocus` 同步舞台。选择已打开的文档 tab 会把已有 focus 移到栈顶而不是
  重复入栈，返回按不同 subject 回退，不会在重复 file / web 条目之间空转。文档 tab 右键菜单是
  非 modal，不会给 `body` 加 `pointer-events: none`。
  `⌘⇧P` / `Ctrl+Shift+P` 是命令面板（应用级动作）；两者都走 C3 快捷键注册表、互斥，同一时刻只显示一个浮层。
  `project` / `goal` / `review` 仍是 legacy context；旧 `ContentScopeState` 在首次启动时迁移。详见
  `docs/releases/2026-11-12-workbench-focus-foundation.md`。
- **Tab-as-view + 左栏改动面（2026-11-13）**：右工作台不再有 LensBar；`FrameBar / WorkbenchTabs /
  DocumentToolbar / Stage` 是唯一 chrome。`WorkbenchTabs` 一条 tab 条覆盖全部视图：世界 / Goal /
  文件 / 浏览器 / 改动集 / 终端 / 插件。世界 / Goal 是场景 tab（`scene:*`，按 world 持久化，
  重启恢复）；终端 / 插件是临时场景 tab（不落盘）；文件 / 浏览器 / 改动集是文档 tab。世界页是固定
  首页 tab：`scene:world` 始终排在第一位、不可拖动 / 关闭，切换项目时自动创建。改动集 tab
  （`changeset:*`）一个 turn 或一个 Goal revision 一个 tab，文件导航只在 tab 自己的 toolbar 下拉里，
  不再常驻左侧文件列表。左 rail「改动」face 是项目级、Goal 组在前、讨论组在后：Goal / 讨论的组头
  与单项都可收起，当前项默认展开并用「当前」标签标识；点 Goal / 讨论标题打开对象 tab，点 revision /
  turn 打开改动集 tab。Goal 验收仍是人类专属动作，只在 Goal 结果页出现，不进入左栏。详见
  `docs/releases/2026-11-13-workbench-tabs-and-changes-face.md`。
- **Goal / 评审焦点（2026-11-12 Plan 2；2026-11-13 迁移）**：Goal 以 `goal` scope 进入焦点栈，
  Goal 总览复用 `GoalDetailPanel`。原 `changeSet` subject + `ChangeSetStage` + `InstrumentRail` +
  `GoalReviewQueue` 已删除；评审项改由左栏「改动」面投影（`pod.reviewItems`），
  resolve / reopen 仍只由人触发，验收仍走 Goal 结果页。revision worktree 由 `pod.result` +
  `fs.listDir` 探测，失败回退项目目录。详见
  `docs/releases/2026-11-12-workbench-goal-review-focus.md` 与
  `docs/releases/2026-11-13-workbench-tabs-and-changes-face.md`。
- **Chat 决定面（2026-11-12 Plan 3；2026-11-16 移除）**：Chat transcript 上方的决定板
  （需要你定 / 待确认 / 已定 / 已搁置）已删除——它把决定做成一张大卡片，用户期望由 Lead
  在对话里主动说明。`decisionStore` 仍保留：rail Pod badge 与 Goal 详情（`DecisionRecordCard`）
  继续使用同一份 attention / 记录数据；chat 不再渲染决定板，也不再提供「查看决定记录」跳转。
  决定记录仍由 MCP 起草、人确认 / 搁置 / 重开，落在 `<project>/.mafw/decisions/`；goal-less
  draft 不进 attention（由 Lead 后续消息转达）。新 Goal 先看委托单预览（12 字段 + 授权级别），
  Goal 总览显示代理契约，框显示执行 badge。
- **Chat 消息身份与时间（2026-11-16）**：Lore 身份只在 assistant 回复内容里——每个 assistant
  回合上方一行 `[Lore 头像] Lore · 回合时间`（头像 `assets/lore/lead-avatar-20.png`，正文不缩进）；
  标题栏保持「会话首字母 + 会话标题」。用户消息气泡右下角常显时间，hover / focus 时操作按钮
  在原位覆盖时间，不挤动布局。assistant 时间由 session-ui 通用 `data-turn-time` 提供，
  Lore 样式只在桌面壳层 `mafw.css`。
- **Chat 阅读密度（2026-11-16）**：正文 16px / 1.6（`--mafw-chat-leading`，对齐 ChatGPT
  1.5–1.63 / Claude 1.5–1.6 / Gemini 1.55），段距保持 16px；「已思考」到正文只保留
  assistant content 的 12px flex gap，取消 text-part 12px 顶距与 thinking 2px 底距叠加。
- **Agent-native Chat 意图（2026-11-15 起）**：composer 只保留一个发送面，讨论 / 提议 / 委托 / 解决
  四模式已移除。Lead 按系统提示直接调用 `mafw_create_goal` 建立 `discussing` Goal（带当前话题
  快照，不启动 NodeDriver）；桌面把该工具结果渲染成 `GoalCreatedCard`（打开 Tech Lead 讨论 /
  撤销，撤销只对 live `active + discussing` 开放并走 `goals.stop`），legacy / running / error
  结果不进入动作卡。自由讨论保留「交给 Lead」交接。Tech Lead chat 在 composer 上方内联最多 3 条
  未解决评审项（`PodReviewItems`，确认解决 / 重新打开仍是 human-only，全部入口在左栏改动面）。
  Lead 通过 `mafw_create_goal` 的 `contextSummary` 选择 Goal 来源上下文；不再在 chat 内联
  `BoundaryCard`。话题边界提案仅在「话题」面板（`TopicIndexPanel`）里可见，
  `LeadBoundaryService` 作为后台 hint 保留。Episode 仍按会话存
  `localStorage['mafw-episodes:v1:<sessionID>']`（仅分组视图），「标记 Episode」已从 composer
  移到 transcript header。详见 `docs/releases/2026-11-15-agent-native-chat-intent.md`、
  `docs/releases/2026-11-15-chat-review-and-boundary-cards.md` 与
  `docs/releases/2026-11-15-lead-selected-goal-context.md`。
- **Workbench 焦点收口（2026-11-12 Plan 5）**：`WorkbenchShell` 只剩 `FrameBar` /
  `LensBar` / `FocusStage` / `InstrumentRail` / `SubjectPicker` + 壳级
  `PluginSurfaceStage`；`WorkbenchContext`、四 context 持久化、全局 L2、执行抽屉与
  split view 删除。世界总览是兜底 subject，无焦点时每个世界自动打开一次取景器；
  文件与最近内容只在取景器进入，Chat 文件链接与取景器共用 `openFileInScope` 焦点
  路由（`fileOpenPlan` 分流）。`FocusStage` 的 Goal 变更集由 `GoalChangeSetStage`
  读 Pod revision worktree diff（「查看本版变更」）。`contentScope` 从 active focus
  派生，旧 `mafw-content-scope` 一次性迁移。后台任务在 Chat 内联，团队 / 记忆在
  世界总览的 Pod 面板。决定记录由 `decision.updated` SSE 定向刷新；chat 决定板已移除，
  记录只在 Goal 详情按 Goal 过滤展示。详见 `docs/releases/2026-11-12-workbench-world-overview-cleanup.md`。
- **WorkbenchTabs / 统一文档条（2026-11-13）**：`WorkbenchTabs` 渲染全工作台唯一的
  `DocumentTabs`，顺序为打开顺序（文件 id 带 root，浏览器 id 带 tab id，场景 id 带 subject）；
  `EditorDock` / `BrowserDock` 以 `embedded` 模式常挂载，按 active kind 用 wrapper 的 `display`
  显隐，切换不重载 webview、不丢编辑器状态。场景 tab（世界 / Goal / 终端 / 插件）与文档 tab 共用
  同一条顺序与拖拽；世界 / Goal 的 scene 快照写入 `mafw-scene-tabs:v1:<worldId>`，终端 / 插件与
  改动集不落盘。2026-11-13 Phase 2B 起，toolbar 由 document 层统一渲染：body 通过
  `registerDocumentToolbar` 注册 `leading / center / trailing` slot，`DocumentStage` 只渲染
  active kind 的一份 `DocumentToolbar`（编辑器的保存 / 外部 / 预览，浏览器的后退 / 前进 /
  刷新 / 地址 / 点选 / 外部，改动集的文件下拉 / 打开文件 / 复制路径 / 刷新仍由各自 body 拥有）。
  `打开浏览器` 命令会先创建一个空白浏览器 tab 再聚焦 web subject，保证统一 toolbar 有地址栏可输入。
  tab 右键菜单由 `buildDocumentTabMenu` 按 kind 提供关闭 / 关闭其他 / 关闭右侧 / 复制路径（文件、
  改动集）或复制链接 / 系统浏览器打开（网页）。`MafwShell` 是 select / close / close-others /
  close-right 的路由层，关闭请求经 `document-tabs-store` 一次性队列交给 owning body 执行。
  2026-11-13 Phase 2A 起，tab 顺序是 store 权威：支持跨文件 / 网页 / 场景拖拽，顺序按 world（项目）
  持久化到 `mafw-document-list:v1:<worldId>`；浏览器 tab 的 id / URL / 标题持久化到
  `mafw-browser-tabs:v1`，重启后恢复并重新加载 webview。文件内容 / dirty / 草稿仍走
  `editor-drafts` / `content-scope-state`；Phase 2C-1 起浏览器 tab 状态归
  `documents/browser-documents`；Phase 2C-2 起 `EditorModel` 按 root 归
  `documents/file-documents`；Phase 2C-3 删除 `browser-tabs` / `editor-model-store`
  兼容 facade，调用面统一到 `browser-documents` / `file-documents`，document store 用模块级
  effect 自动派生 file / web / changeset / scene entries。左 dock 文件面头部提供手动刷新（保留展开态）。
  2026-11-13 起 document store 派生 `changeset` entries：`documents/change-set-documents` 持有
  一个 turn / 一个 Goal revision 的改动集，`ChangeSetView` 在 tab toolbar 里用文件下拉切换当前文件，
  复用 `DiffReviewPanel`（tab chrome 隐藏左侧文件列表）渲染；改动集不持久化，重启后丢弃。
- **编辑器**：默认 **Monaco**（VS Code 内核；`mafw-editor-engine=codemirror` 回退，挂载失败自动回退），
  行内 diff 装饰、Ctrl/Cmd+S、MAFW 主题 token 映射、minimap ≥720px。详情见本文件 Monaco 段。
- **文件预览**：md（session-ui markdown）、json 折叠树、csv/tsv 表格、svg 预览/源码、图片、pdf（Chromium
  viewer）、docx/xlsx/pptx（懒加载）、legacy office 外部打开；HTML 走 `mafw-file://` 在浏览器面打开。
- **批注/审阅**：预览选区 = quote 锚、json 节点路径、表格单元格、图片区域、pptx 页码；Enter 直发 /
  Ctrl+Enter 攒草稿；锚点原地高亮 + 已回应状态。改动审阅 = 左栏 Goal-first 改动面 + 每 turn / 每
  Goal revision 的改动集 tab。
- **检查点**：`CheckpointOverlay` 时间线（会话回滚 / 文件回滚 / both）；服务端检查点支持只读预览。
- **托盘与存在感**：15s 轮询 `/api/presence` → tooltip / 菜单状态 / 任务栏进度；attention 差集通知
  持久化防重发；点击通知 `navigateToGoal` 跨项目打开。
- **视觉语言**：单一 token 集（`.mafw-shell, body` 三个主题块键集一致），按 primitive →
  semantic → component 三层消费。石墨中性表面；`--action-primary-*` 独立承担实心主操作，
  `--accent` 只负责选中/链接/focus/运行，`--success` 只负责通过/完成；禁止把三者混用。
  边框统一 1px（普通分隔用 subtle，输入与关键控件用 strong），内容卡片不叠加装饰阴影/渐变，
  阴影只用于浮层；圆角收敛为控件 6px、容器 10px、浮层 12px。
- **排印/图标**：核心 chat / 工具卡 / Goal 元信息最低 12px，正文 14px，对话 16px/1.7；其余页面按同规则继续审计；路径、命令、hash、计数使用
  mono + tabular-nums；会话关闭/新建等 chrome 控件使用已注册 SVG 图标，不再用文本字形。
- **动效**：`--dur-press` 80ms / `--dur-fast` 120ms / `--dur-select` 180ms /
  `--dur-enter` 220ms / `--dur-surface` 240ms / `--dur-progress` 320ms；标准曲线
  `cubic-bezier(.2,.8,.2,1)`。循环只用于真实 running/recording/streaming/voice/waiting
  状态，同一区域最多一个，在线/空闲不加环境呼吸或 glow；`prefers-reduced-motion` 直达终态并保留
  状态文字。`createPresence` 折叠面过渡期挂载，规则相同。
- **Motion v8（2026-11-16）**：补 `--dur-exit: 140ms` / `--ease-exit`；命令面板遮罩 180ms 淡入、
  面板 220ms 落位，关闭由 `usePresence` 保留 DOM 140ms 做 exit；session tab 选中 180ms；
  work item 按下 `scale(.985)` / 80ms；Goal inline 220ms 进入。空间动效才允许 overshoot，
  颜色/透明度不用 spring。
- **文件树 → 编辑器 shared element（2026-11-16）**：点击文件行用 View Transition 把行 morph 到
  `.mafw-editor-dock` / `.mafw-file-preview`，340ms `cubic-bezier(.32,.72,0,1)`；reduced motion、
  browser 类文件或旧运行时直接打开，不启用。反向 `focusBack` 在返回 world landing 且文件树行
  可见时，从编辑器 morph 回原行；深层历史或行已滚出视口则走普通返回。
- **业界对照与升级建议（2026-11-16）**：`docs/research/2026-11-16-desktop-premium-ui-motion-research.md`
  （Hermes / OpenCode / Linear / Carbon / Material 3 的视觉与动效基准，以及 MAFW 的减法/编排优先级）。
- **Precision Instrument 局部落地（2026-11-16）**：topstrip 非活动 session tab 不再显示身份点，
  活动 tab 改为 `--bg-raised` + accent 下划线；Goal 详情 hero / section / 技术结果不再层层套卡片，
  区块只用一条 hairline 分隔；失败提示改为中性底 + 2px danger 左轨；右 dock 的 Goal inline
  详情保留 20px 水平留白，不再贴边。方向依据见上方调研文档。
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

#### 统一插件包菜单槽位（S4，2026-11-13）

统一插件包可以通过 `plugin.json` / `activate()` 的 `ui.menuItems` 贡献 context-menu 项。descriptor 是纯数据：

```ts
{ id, surface, label, action, icon?, shortcut?, order? }
```

- gateway 用 `validateClientDescriptor` 校验：surface 必须在 `PLUGIN_MENU_SURFACES`，`action` 必须引用同包 action，icon 必须已注册；`danger` 暂不开放。
- desktop `MenuContributionRegistry`（`context-menu/contributions.ts`）把匹配项追加为「扩展」group；merge 后仍过 `validateMenu()`，失败 fail-open 回原菜单。每 surface 上限 7。
- `PluginMenuWiring` 监听 committed descriptors：revision 变化/包卸载先 dispose 旧贡献再注册新快照。
- 点击贡献项调用 `window.api.mafw.plugins.invoke(pkg, action, {}, sessionID)`；失败只记录，不影响菜单。
- 支持的 surface：`editor.tab` / `file.tree` / `file.path` / `message` / `session.row`。
- 仍是宿主渲染：不注入 Solid 组件，不改变 preload/webview sandbox。

#### 统一插件包 composer action（2026-11-13）

统一插件包可以通过 `ui.composerActions` 在 chat composer 左侧工具条贡献按钮：

```ts
{ id, label, action, icon?, order? }
```

- gateway 校验：`action` 必须引用同包 action；icon 必须已注册；每包最多 3 个。
- desktop `PluginComposerActions` 只渲染 `ButtonV2 + Icon`，点击调用 `window.api.mafw.plugins.invoke(pkg, action, {}, sessionID)`。
- action 返回 `{ insertText: string }` 时写入当前会话草稿（`pushComposerInsert`），**不自动发送**；其他返回值忽略。
- action 失败弹 toast，不影响 composer；无活动会话时按钮 disabled。
- 仍是宿主渲染，不注入 Solid 组件，不改变 preload/webview sandbox。

#### 统一插件包 panel rail entry（2026-11-13）

声明式 panel 可以通过 `panel.rail` 选择进入左侧 IconRail：

```ts
{ id, title, viewAction, rail: { icon, order?, badge? } }
```

- gateway 校验 `rail.icon` 必须已注册、`order` 整数、`badge` boolean。
- desktop `railItemsFromPanels()` 只投影声明了 `rail` 的 panel；surface id 与工作台 tab 相同（`plugin:<pkg>:<panel>`）。
- MafwShell 把 panel rail 与 web surface rail 合并排序，再交给 `applyPluginRailState`；点击走现有 `openPluginFocus`，不新增打开路径。
- 仍是宿主 IconRail 渲染；不注入组件，不改变 preload/webview sandbox。

#### Chat part 渲染（2026-11-13，评估）

chat transcript 的 part 渲染保持宿主独占，插件包不注册 renderer：

- 工具 part：统一插件包用 `ui.toolCards` 声明 `viewAction`，desktop `PluginToolCard` 在 settled 后调用它，用 `PluginViewRenderer` 渲染受限 Widget；pending/running 原卡、失败/非法输出/过期回退原卡。
- 非工具 part：`data-<name>` 由 `DataPartCard` 显示名称、`transient` 与 pretty JSON；gateway 已校验名字、≤64KB、JSON 可序列化，并持久化 overlay。
- `PART_MAPPING` / `registerPartComponent` 只服务宿主内部（当前仅 `ThinkingBlock` 覆盖 reasoning），不是插件 API；`plugin-chat-part-boundary.test.ts` 阻止插件模块引用它们。
- 评估结论：Phase 4 不实现 chat part 槽位。未来若有真实需求，唯一推荐形状是 `ui.dataPartCards`（`data-<name>` → 同包 `viewAction` → `PluginViewRenderer`，失败回退 `DataPartCard`）；不覆盖 `text`/`reasoning`/`tool`/`file`/`compaction`，不做每 part webview。

详见 `docs/research/2026-11-13-chat-part-renderer-evaluation.md`。

#### 插件平面与 kernel-v2（2026-11-12，规划中）

统一插件包按 **contributes 平面**区分，而不是按目录/包名：`gateway`（进程内 driver）、`desktop.ui`（声明式数据）、`desktop.web`（sandboxed webview）、`desktop.main`（legacy `~/.mafw/ui-plugins`，迁移期默认关闭/显式同意）。一个包可以同时有多个平面，gateway 与 desktop 各自只加载自己的部分；跨平面只走 action/event bridge，webview 永不接收 gateway apiToken。

Phase 0/1 只做契约与 `gateway/src/kernel-v2/` 并行模块，不改变 desktop 现有行为。详见：

- `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md` §4.6
- `docs/superpowers/plans/2026-11-12-kernel-v2-phase0-1.md` Task 0.4

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
  `PUSH_PAIR_BUDGET=1240`（520 chat + 720 工作台，split 默认 dock push 点约 1550）；
  模式切换有 **12px 滞回**（`PUSH_HYSTERESIS`）。宽度来自主布局容器的 `ResizeObserver`
  （`.mafw-body`），不是 `window.innerWidth`。窄窗二选一按当前可见栏算，Chat 用 520
  （默认 dock 264 → 830 可推）、Workbench 用 720（→ 1030 可推）；切 Chat / Workbench 时左栏
  可在 push / overlay 之间切换。默认窗口 1720×1000、硬下限 **900×600**。
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

### Goal 用户视图与角色连续性（2026-11-11）

Project Agent Workbench 的 Plan A 已完成（Goal / Chat 垂直切片）：

- `goal-user-view.ts` 把 `PodGoal` 统一投影为方向 / 进度 / 结果 / 历史四种用户面；列表与详情共用，不伪造进度，不暴露 Goal ID、phase、Loop、verdict 等内部状态于主视觉。
- 终态失败（`FAIL` / `ERROR` / `MAX_RETRIES`）在用户面显示红色「失败 / 异常 / 重试耗尽」，
  `needsPerson=true`，下一动作是「查看失败原因」；Lead 状态卡保留这类最近失败（PASS 历史不占位），
  不再把失败当作「待验收」。`work-overview-model.ts` 的 attention list 也把终态失败排在
  unseen result 之前，label 为「查看失败原因」。
- Goal 详情头部只展示当前状态、负责人、revision、真实进度与下一动作；技术详情默认折叠。
- 进入非终态 Goal 走 `openGoalAndDiscuss`：先打开右侧 Goal，再恢复 Tech Lead 讨论；终态 Goal 不 ensure live Tech Lead。
- 从 Goal 打开 Tech Lead 讨论、打回、打开 timeline 会话不再关闭右侧 Goal；「返回项目 Lead」只切 Chat，不清空当前 Goal。
- 内容工作台（文件树 / 阅读 / 审阅 / 修改）由 Plan B 完成；评审项与强制验收由 Plan C 完成。
- Plan C：结果页新增「评审意见」区，按未解决优先展示状态（待处理 / 已回应 / 已解决）、文件/行号、Tech Lead 回应与源 revision；只有人类能确认解决或重新打开。有未解决意见时验收主按钮改为「先处理意见」，次级动作「确认风险并强制验收」需勾选风险确认并展示剩余意见；验收后记录 `acceptanceRecord`（forced / 时间 / 未解决项快照），评审项冻结。批注在发送给 Goal 绑定的 Tech Lead 时才落成评审项；落库失败会中止发送并保留草稿。

#### 右工作台 Context Shell（2026-11-11 Plan D1）

spec §5.1/§5.3/§8.2，plan `docs/superpowers/plans/2026-11-11-project-agent-workbench-shell-ia.md`。

- 右工作台不再有「工作 / 工作台 / 执行 / 审阅」四个平级 L1 Tab；改为 **项目 / Goal / 内容 / 审阅** 四种上下文，由 `mafw-rw-head` 面包屑 + 返回 + 执行抽屉构成。
- **项目**：`ProjectWorkView` 只保留优先级、全部 Goal、长效目标与新建 Goal；Goal 详情不再内嵌在项目列表里。
- **Goal**：`GoalDetailPanel` 作为独立上下文面板，按 `podGoalId` keyed 重挂；打开 Goal 不丢 Chat/内容状态。Goal 结果进入本版文件时记录 `contentReturnGoalId`，内容头返回会回到该 Goal。
- **内容**：`WorkbenchCodeView` + `ContentScopeHeader` + 二级 `文件 / 浏览器 / 终端 / 插件`；项目上下文头提供「文件」入口，普通打开不创建持久 Tab。
- **审阅**：`ChangesDock` 是会话变更上下文；Goal 评审项仍在 Goal 结果内，不另造空间。
- **执行**：`ExecutionView` 收进 `mafw-rw-exec-drawer`（可开合、带分区下拉与关闭），不再占一级目的地。
- 焦点快照包含 `context / surface / executionOpen / executionSection`；旧 `mafw-workbench-view` 迁移到 `mafw-workbench-context`，`execution` 回落项目且不自动打开抽屉。
- 已知后续（Plan D2/D3）：项目首页文件树/最近内容、Pod 降为项目属性、三种内容意图、Goal 详情注意力顺序。

#### 项目首页与团队属性（2026-11-11 Plan D2）

spec §5.1/§5.2/§5.3/§6.1/§7.5，plan `docs/superpowers/plans/2026-11-11-project-agent-workbench-project-home.md`。

- **项目首页**：项目名 + 团队条 + 工作优先级 + 两栏主体：左侧「项目文件」树（下方接最近内容），右侧「全部 Goal」列表；两栏占满工作台高度，左栏内部滚动。项目首页不是执行 Dashboard；文件与最近内容直接可达，但不抢工作主视觉。团队条是分隔线而不是卡片，避免首页变成多块并排的盒子。
- **项目文件**：`ProjectFilesCard` 复用 `FilesDock`，固定在项目主目录 scope；从项目首页打开文件会先清 `contentReturnGoalId` 并把 `contentScope` 重置为项目 scope，不继承当前 Goal revision。普通点击仍在内容上下文打开，不创建持久 Tab。
- **最近内容**：`recent-content.ts` 按项目持久化 `mafw-recent-content:<normalized projectDir>`，最多 8 条、同 scope+rel 去重并置顶；D2 只展示项目主目录条目，Goal revision 条目留给 D3 意图视图。
- **双文件树 watcher**：`dir-watch-pool.ts` 对 `(root, rel)` 做 renderer 侧引用计数；项目首页树与内容树同时挂载时，任一方卸载不会误关另一方的目录监听。
- **团队属性**：左栏删除 `pod` face；`IconRail` 的 Pod 目的地改为「Lead」入口：左键直接打开项目 Lead（当前会话是 Lead 时高亮），右键「查看团队」打开项目首页并定位团队条（attention badge / result dot 保留）。Lead / Tech Lead / 团队 / 邮箱 / 记忆入口进入项目首页团队条；`ProjectResources` 退役，`PodDock` 仍保留在执行抽屉。
- **Lead tab 恢复（2026-11-16）**：Lead 是身份不是固定 runtime session；布局恢复只认
  `currentLeadId(project)`，旧 Lead id / `lead-archived` 会话不再恢复成 Lead tab；Pod detail
  刷新后 `reconcileLeadTabs` 用当前 id 替换并保持用户当前 tab 焦点。`SessionStrip.isLeadTab`
  只认 `s.lead` 或 `leadSessionId`，不再用 Pod role 推断历史会话。
- 旧 `mafw-left-dock-face=pod` 启动时回落 `sessions` 并重写键。
- **左栏文件 face（2026-11-13）**：`LeftDockFace` 增加 `files`；`IconRail` 用文件夹按钮切换，
  `LeftDock` 内部不放 face 切换按钮。`FilesDock` 以 `showHeader={false}` 嵌入左 dock，
  root 跟随当前 content scope（项目主目录 / Goal revision worktree），点击文件走
  `openFileInScope` 在右舞台打开；overlay 态选择文件后自动收起左 dock。无持久化 face 时默认
  `files`；旧 `pod` / 未知值回落 `sessions`。右 dock 仍然只做文档舞台，不放文件树。
- 已知后续（Plan D3）：跨重启的树展开/滚动/草稿持久化、Goal revision 最近项、Goal 详情注意力顺序。当前 Goal 详情没有阶段页面 Tab；时间线只是只读投影，不存在待清理的阶段 Tab。

#### 内容意图：阅读 / 修改（2026-11-11 Plan D3a）

spec §7.1/§7.2/§7.4，核心模块 `content-intent.ts`、`editor-state.ts`、`ContentScopeHeader`、`EditorDock`。

- 内容头在作用域标签后提供 `阅读 / 修改`；Goal revision scope 额外提供 `验收`，点击回到该 Goal 的结果上下文。验收仍不是内容 surface，也不改变人类专属验收权限。
- **阅读是默认入口**：项目首页文件树/最近内容、Chat 文件链接、Goal「查看本版文件」后的普通文件点击都以 `reading` 打开。文件树在内容上下文内点击时保留当前意图。
- **直接看到文档**：打开文档后，内容二级条的第一项从泛化的 `文件` 变成当前文档名（如 `AGENTS.md`）；有打开文档时 `DocumentTabs` 始终显示，阅读态单文档也保留一条 tab。
- **Viewer 按内容/动作选择**：内置 `浏览器 / 终端` 不再作为内容 L2 的平级 tab；文档是默认内容面。内容头右侧提供浏览器、终端工具按钮与 `返回文档`；HTML/网页仍自动进入浏览器，Ctrl+` 仍可切终端。只有用户显式安装的插件 surface 继续以 L2 tab 形式存在。
- **阅读用临时预览 Tab**：`openPreviewFile` 只保留一个干净预览，下一次普通打开替换它；持久 Tab、dirty Tab 和只读预览不会被替换。预览 Tab 名称以斜体区分。
- **文件树显式打开持久 Tab（2026-11-13）**：左栏文件树点击带 `persist`，即使当前是阅读意图也直接进持久 Tab，不改变 lens；取景器 / Chat 文件链接仍保持预览语义。`openModeForTab({ intent, persist })` 是唯一判定点。
- **修改是显式动作**：点击 `修改` 把当前预览钉成持久 Tab（`promotePreview`）；首次输入也会自动把预览转持久并切到 `editing`。修改意图下新打开的文件直接进入持久 Tab。
- 阅读/修改只影响 Tab 生命周期与意图状态，不改变文件内容、保存、冲突、草稿或批注语义；图片/Office 的只读预览、SVG/Markdown/JSON/表格的预览切换保持原行为。
- `验收` 入口只在 `contentScope.kind === "goal"` 时出现；项目主目录不显示，避免把会话变更审阅伪装成 Goal 验收。
- **Goal 详情注意力顺序**：Goal 标题与主行动 → 阻塞/错误 → 需要你回答 → 方向 → 计划 → 上下文来源 → 结果 → 探针/证据 → 技术详情。结果与证据先于技术诊断；技术详情默认折叠，没有用户摘要时也提供显式「技术详情」开关，不再因缺少摘要自动展开。
- **内容状态跨重启**：`content-scope-state` 按 `mafw-content-state:<scopeKey>` 持久化树展开/选中、打开文件/活动文件、阅读位置、选区、文件树抽屉偏好；`editor-drafts` 按 `mafw-editor-drafts:<root>` 持久化草稿/mtime/EOL。两者 300ms 去抖、fail-open；重启后打开同一 scope 会恢复活动文档，带草稿的文件自动标 dirty 并转持久 Tab。
- **显式分屏对照**：内容头在文档 surface 提供 `分屏对照`；开启后文件树点击进入第二只读文档面板（`SplitDocumentPane`），主文档保持不变；关闭分屏不影响主文档。宽容器左右并排，窄容器上下堆叠。
- **Goal revision 最近项**：最近内容条目携带 `goalId / revision / worktreeDir`，项目首页以 scope badge 展示；点击时校验 worktree 是否仍存在，成功则恢复该 revision scope 并打开文件，失败给出明确 toast。
- 已知后续（Plan D3d）：无内容域剩余项；Goal 选中态仍按 D1 设计为瞬态，不跨重启恢复。

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

### Chat `/` 命令与技能（2026-11-13）

- `/` 菜单在 `DiscoverySnapshot.skillInvokeSupported` 为 true 时显示 runtime 技能分组；
  `/skill-id` 由 Desktop 调用统一的 `discovery.invokeSkill`，不把 skill id 传给 `session.command`。
- 技能调用方言只存在于 adapter（opencode `@id`、pi `/skill:name`、claude `/name`）；
  gateway 只做 `DiscoveryService.invokeSkill` 校验/转发，Desktop 只认统一 API。
- 同名优先级：MAFW 命令 > runtime 命令 > skill。
- runtime 不支持时 `/` 不显示技能分组，路由返回中性 503。
- runtime command 的 `agent` / `model` 元数据由 Desktop 透传给 `session.command`。

### MCP 管理页（2026-11-14）

- 一级导航新增 `mcp`（IconRail 的 `mcp` 图标 + `/mcp` 命令），不再只埋在 Config → 扩展。
- 页面数据来自 `window.api.mafw.mcp.servers()`（gateway `/api/mcp/servers`），展示
  服务器总数、已连接、需要处理（needs_auth + failed）、未连接/已禁用摘要，以及每个服务器的
  `已连接 / 需要认证 / 连接失败 / 已禁用 / 未知` 状态。
- 支持连接 / 断开、复制认证命令、添加服务器、删除配置文件项；`mcpApi` 缺失时显示中性空态。
- Config → 扩展里的 MCP 管理仍保留；两者共用同一套 gateway API。

### 标准 Chat `/` 指令（2026-11-14）

- 首批 12 条本地命令：`/compact` `/export` `/fork` `/usage` `/permissions` `/diff`
  `/skills` `/undo` `/redo` `/plan` `/build` `/details`。
- 本地命令统一经 `runLocalCommand()`：清空 composer、清草稿、关选择器，再执行。
- `/compact` 调用既有 `POST /api/session/:id/summarize`；Desktop 只新增 preload
  `sessions.summarize`，不新增 gateway/runtime 契约；执行前检查 `session.summarize`
  能力，失败文案保持中性。
- `/export` / `/fork` 复用 shell 的 `exportSession` / `forkSessionFromMenu`。
- `/usage` 打开 Config › Usage；`/permissions` 打开会话配置菜单；`/diff` 打开变更集；
  `/skills` 通过 `mafw:open-config` 事件打开 Config › 扩展；`/details` 等同 Ctrl+O。
- `/undo` 打开检查点面板；`/redo` 在 `canUnrevert()` 时执行 `unrevert`。
- `/plan` / `/build` 只消费 `MafwAgent.planning` / `MafwAgent.default`，不硬编码 runtime
  原生 agent 名；复用 Lead / Creator Agent 锁定与忙时切换确认。

### Chat `/` 指令第二批（2026-11-16）

- `/rename` 打开 `RenameSessionDialog`，写 `sessions.rename`，用 `retitleSessionEntity`
  更新 entity cache，并同步 workspace store。
- `/help` 打开 `ChatHelpOverlay`，列出本地命令和当前快捷键。
- `/init` 发送固定 `INIT_AGENTS_PROMPT`，要求保留已有 `AGENTS.md` 且不提交 git。
- `/clear` 新建会话并保留当前会话（复用 `createSession`）。
- `/` 菜单按 Experience 能力置灰而不是按 runtime 名分支：`/compact` → `session.summarize`，
  `/fork` → `branch.fork`，`/diff` → `branch.diff`，`/undo` → `branch.revert` /
  `checkpoint.restore`，`/redo` → `branch.unrevert`，`/rename` → `session.rename`，
  `/plan` `/build` → `MafwAgent.planning` / `default`，`/skills` → `session.discovery`，
  `/pause` → `run.control`。不可用时保留行并显示中性原因，不改变菜单形状；Experience
  尚未 ready 时不把未知状态当作“不支持”。`session.rename` 是新增的 Experience Action
  （映射 `session.update` surface），会话右键 / tab 菜单同样按它置灰。

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

### 交互模型：replay 补页 / 单一实体缓存 / 决定增量补丁（2026-11-13，E6）

spec `docs/superpowers/specs/2026-11-13-gateway-e6-interaction-model-design.md`，release
`docs/releases/2026-11-13-gateway-e6-interaction.md`。协议与 gateway 事件词汇零改动，只改消费侧
（`decision.updated` 加一个 additive 字段）。

- **SSE 开流前 replay 补页（E6-1）**：`SseConnection.openOnce` 读到持久化游标后，先调
  `recoverGap(since, 500)`；`MafwShell` 注入的实现是 `sse/event-replay-gap.ts#recoverEventGap`
  （`gateway.info().url` + `dispatchShellEvent`，与 live 帧同一 dispatcher 路由）。
  - 分页循环 `GET /api/events/replay?since&limit`（limit 缺省 500 / clamp 1..1000，页数硬上限 100，
    `nextSince` 必须单调前进），每页逐条 dispatch；
  - **canonical 信封解包**：`event_log` 存的是 broadcast 帧 `{type:'mafw_event', data:{...}}`，
    补页时先取 `data`（与 live `raw?.data || raw` 一致）再覆盖 `seq: item.seq` ——seq 以 item 为准，
    不依赖信封自带；
  - 补页成功 → **以 `headSeq` 开流**，`lastAppliedSeq`/持久化游标都钉到 `headSeq`，SSE 零回放，
    live 帧只从 headSeq+1 应用（天然无 replay∩live 重复）；
  - `reset` / `truncated` → 先 `clearSeq()` + `onFullResync(reason)`（清实体缓存 + invalidate 所有
    store）再以 `headSeq` 开流；**E7-5 起同时 `writeSeq(headSeq)`**，把新纪元起点落盘——否则本进程
    退出后下次冷启动又按「无游标」全量重同步一次；404 / HTML / 503 / 网络异常 / 非 ok / 形状不符 /
    `headSeq < since` 且非新纪元 → 返回 null，保持原 `since` 走 E2-3 路径，由 SSE greeting 分级；
  - **超时**：单次请求 5s（`REPLAY_GAP_TIMEOUT_MS`，`AbortController` + 显式 race 覆盖 body 读取），
    网络黑洞不会挂住重连；首次连接（无游标）不 replay。
  - **部分补页回退是幂等安全的**：页数上限/分页异常导致「已 dispatch 若干页后回退旧路径」时，这些
    行可能在 greeting 回放里再出现一次；消费侧 store 都是幂等 upsert，重复应用无副作用。
- **Session 单一实体缓存（E6-2）**：`session-entities.ts` 是**唯一**的会话元数据来源
  （`id/title/directory/projectID/metadata/time/agent/parentID`；`get/upsert/patch/remove/version/reset`，
  upsert 是 merge、`undefined` 永不清空字段）。`session-store` 不再保存实体副本，只保留
  `project bucket → { ids（按 last-activity 排序）, fetchedAt, failed }`；`fetchFor` 先 upsert 实体再存
  id[]（`batch` 一次 bump），`sessionsFor` = `ids.map(entities.get)`，`patch/remove` 走实体并重排/摘除
  bucket，`invalidate` 保留实体供离线读，公共 API 不变。
  - **tab 只作 fallback**：`ChatSession.title` 仅用于持久化 `{id,title}` 恢复的首帧兜底；
    `session-title.ts` 是唯一读标题路径（`sessionTitle` / `sessionTabTitle`），Role 命名的 tab
    （Lead）永远显示角色标签；`retitleOpenTab` 只写实体、不再复制写 tab/store；
    `resolveOpenSessionTitle` 保证打开 tab / 布局快照不会用陈旧 `Chat N` 覆盖用户改名或新标题。
  - **角色派生**：`workspace.sessionRole(sid)` 从实体 `metadata.mafw.role` 派生（tab identity 兜底）。
  - **全量重同步**：`onFullResync` 先 `sessionEntities.reset()` 再 `sessionStore.invalidate()`，
    新纪元不留 gateway 已不存在的行。
- **决定增量补丁（E6-3）**：gateway 的 `decision.updated` 现在额外携带 `record`（写入后的完整
  `DecisionRecord`），既有 `action/projectDir/goalId/revision/recordId` 字段逐字不变（内部事件，
  catalog/openapi/SDK 契约不动）。桌面 `DecisionStore.ingest(event)`：
  - 校验 action ∈ `drafted|confirmed|shelved|reopened`、record 的 `id/status/updatedAt` 形状 → 合法则按
    id upsert `records`（`updatedAt` 相同复用对象保持 memo 身份，新记录 newest-first 插入），
    patch `attention.items` 中同 id 且暴露 `status`/`summary` 的行，返回 true，**不发任何全量请求**；
  - **freshness guard**：比已存记录更旧的补丁（`updatedAt` 更小）返回 true 且零写入，避免在途
    refresh 回包覆盖刚 ingest 的新记录；`refresh` 的合并同样「旧的不覆盖新的」；
  - **foreign-project guard**：`record.projectDir` 与当前项目规范化比较（`\`→`/`、去尾斜杠、小写）
    不同 → 视为别项目写入，返回 true 不 patch、也不触发本项目的 refetch；
  - 形状不符 / 无 record / 无当前项目 → false，`MafwShell` 回退 200ms 合并的 `scheduleDecisionRefresh()`
    （旧 gateway 行为不变；attention 投影没有独立轮询，靠下一次 refresh——项目/Pod 切换、显式动作、
    fallback——收敛）。
- **已知残留（E6 接受）**：
  1. ~~`/api/attention` 不投影 decision 记录~~ **E9-2 已落地**：带 `goalId` 的 draft 现在出现在
     `items` 里（`kind:'decision'`、`action.type:'open_decision'`、`itemId` = record id），
     `ingest` 的 attention patch 真正生效；**chat 决定板于 2026-11-16 移除**，goal-less draft
     仍不进 attention，由 Lead 通过对话转达。
  2. 持久化 tab 的 `{id,title}` 仍是首帧兜底：实体未取到（离线/桶被裁剪）时显示旧标题，直到
     bucket fetch 或 `session.updated` patch 到实体。
  3. foreign-project guard 只看 `record.projectDir`（规范化后比较）；记录里缺 `projectDir` 时按本项目处理。

### preload `event.url()` 零参（2026-11-13，E8-2）

E7-2 把 SDK 的 `event.url(sessionID?)` 收成零参后，desktop 的 preload 桥仍保留可选
`sessionID` 形参并在 `mafw-api.ts` 转发第三参（运行时早被忽略，无调用方传值）。E8-2 收口：
`mafw-types.ts` 的 `EventApi.url(): Promise<string>`、`mafw-api.ts` 的
`url: () => invoke("event", "url")`——形参与转发一并删除。唯一生产调用方 `MafwShell.tsx`
本就零参，SSE 订阅仍恒为全局 `/api/events`（Mode A）；没有 `event/url` 专用 main handler，
统一入口 `mafw-invoke` → `resolveIpcMethod` → SDK `events.url()` 行为逐字不变。

### Attention decision 投影与决定板去重（2026-11-13，E9-2）

> 2026-11-16：Chat 决定板已移除（`f185559b`）。`focus/decision-model.ts` 的投影仍保留为
> `decisionStore` 的数据层，供 rail badge 与 Goal 详情使用；chat 不再渲染决定板。

E6 留下的第一条残留（`/api/attention` 不投影 decision）在 E9-2 收口：gateway 现在把**带 `goalId`
的 draft** 作为 `kind:'decision'` 的 attention item 发出（gateway 侧见 `gateway.md` §「E9 交互补齐」）。
桌面 `focus/decision-model.ts` 的消费规则：

- `attentionKind`：`'decision'` → `'other'`。不按 `action.type` 反推 record kind（记录本身没有
  可靠的 kind 字段），因此「需要你定」里 decision 排在 typed kinds 之后（`KIND_PRIORITY.other = 10`）；
- `decisionActionForAttention`：`action.type === 'open_decision'` 且有 `itemId` →
  `{kind:'record', recordId: action.itemId}`，直接打开对应决定记录；缺 `itemId` → `{kind:'none'}`，
  不再误落到 Goal/timeline；
- `buildDecisionBoard`：先收集 attention 中所有 `open_decision` 的 `itemId`，再从 records 生成候选前
  按 record id 丢弃 → 同一条 draft 只出现一次（「需要你」文案留在 attention item 上；已定 / 已搁置
  分组仍由 records 驱动）。`goalId === null` 的 draft 没有 attention item，只从 records 生成。
- 测试：`focus/decision-model.test.ts` 新增 5 条（record action、缺 `itemId`、draft 不重复、
  decided 仍在、goal 过滤）。

### 缺失会话 404（2026-11-13，E10-3）

gateway 的 `session.get` 对不存在会话从 `200 {error:'not found'}` 改为 **404 `{error:'not found'}`**
（body 逐字不变；gateway 侧见 `gateway.md` §「E10 契约覆盖第一批」）。SDK 的 `request()` 对非 2xx
抛错，不再把错误信封当作 `Session` 返回，因此桌面侧的「会话是否还在」判定必须从「读响应体」改成
「认 404」。

- `renderer/mafw/subagent-reconcile.ts` 新增 `isSessionNotFoundError(err)`：`err.status === 404`
  或消息同时含 `404` 与 `not found`（`HTTP 404: not found`，兼容 electron IPC 再包一层的错误串）。
- `reconcileSubagentsOnce` 的空历史收敛路径：`getSession` **成功且带 `error`** → 旧 gateway 的
  200 信封（跨代兼容，仍收敛 `session-deleted`）；**抛错且是 404** → E10-3+ 的缺失 → 同样收敛
  `session-deleted`；其余失败（网络 / 500 / IPC 崩）继续 **fail-open**（不收敛，宁可留旧状态也不误删）。
  E10-3 之前 404 也落在 fail-open 分支，已删子会话的行会一直停在 stale `running`；现在只有真正的
  404（或旧 gateway 的 200 信封）才收敛。
- 其余调用方本来安全，无需改：`ChatPane`（try/catch，失败时 `canUnrevert` 保持 false）、
  `MafwShell` 的 `hydrateSessionInfo` / `openSubagentSession`（try/catch）、`loadSessionHistory`
  （`.catch(() => null)`）、`session-status.ts`（纯函数读 `info?.status`，缺失 = 不可用）。
- 测试：`subagent-reconcile.test.ts` 新增 2 条（404 收敛 / 500 不误判）。
- **注意旧桌面产物**：在 E10-3 之前把 200 信封当「会话可用」的旧构建会把缺失会话当活会话（不会崩，
  只是状态偏旧）。桌面与 gateway 同版本发布（managed payload），跨版本混用时以升级桌面为准。

### Triage 渲染对齐真实 wire（2026-11-13，E10b-3）

SDK `TriageItem` 在 E10b-2 被重塑成磁盘 / wire 真形状
`{ id, automationId, discoveredAt, source, summary, state, userAction, deadline, proposedGoal?, llmSuggestions?, updatedAt? }`
（旧形状 `{goalId, reason, severity, createdAt}` 是无人产出的 phantom override 遗留；gateway 侧见
`gateway.md` §「E10b 契约覆盖第二批」）。`TriagePage` 之前仍在读 `reason` / `goalId` / `severity` / `createdAt`
（恒为 `undefined`），并且用 `as any[]` 绕过了类型：

- 新增纯模块 `renderer/mafw/triage-model.ts#triageCardModel(item)` → `{ title, meta, badge }`：
  - **title**：`proposedGoal.title` → `summary.title` → `summary.skillDraft.name` →
    `summary.axiomDraft.name` → `id`（空白串视为缺失）；
  - **meta**：`source` · 本地化 `discoveredAt` · `截止 <deadline>`；非法 / 空时间**静默省略**
    （绝不出现 `Invalid Date`），`deadline` 只在合法时追加；
  - **badge**：`PENDING_CONFIRMATION` → 待确认 / `warn`、`CONFIRMED` → 已确认 / `neutral`、
    `REJECTED` → 已拒绝 / `danger`；存在 `llmSuggestions` 时只追加**最高优先级**
    （high > medium > low）的 ` · 建议确认|建议拒绝 <priority>`，**不**凭空造 severity、不改 tone。
- `TriagePage` 改用 `createSignal<TriageItem[]>`（去掉 `as any[]`），删除 `severityColor` 内联 hex，
  badge 走既有 token 类 `.mafw-tool-badge[data-tone]`（`warn|danger|neutral → warn|err|muted`）；
  卡片菜单 target 只保留 `{ id }`（`buildTriageCardMenu` 不再接收没人用的 `goalId`）。
- `triage.viewGoal` 菜单项保留，但只 `props.onOpenGoals()` 打开 Goal 面——wire 不再携带 Goal 关联，
  不猜目标 ID。
- preload `permissions.list()` 声明改为 canonical `MafwPermissionRequest[]`（运行时本就是它，
  旧声明 `PermissionRequest[]` 只是类型滞后）。
- 未展示 `proposedGoal.boundaries` / `estimatedLoops`；本批只保证「不渲染 phantom 字段」，
  新增展示需要产品口径。
- 测试：`triage-model.test.ts` 5 条（title 回退 / meta 非法日期 / 三种 state / llm 优先级 /
  页面不再读 phantom 字段守卫），`card.test.ts` 与 context-menu wiring 同步。

### note-board 预算 `perNoteCap`（2026-11-14，E10f-E）

gateway `memory.listSticky` 的 wire 一直是 `{...NOTE_BOARD_BUDGET, used}`（`perNoteCap: 240`，按条截断防
单条长记忆饿死整板），但 OpenAPI schema / SDK `StickyNoteBudget` 只声明 `max` / `maxChars` / `used`。
E10f-E 把契约补齐（gateway 侧见 `gateway.md` §「E10f 全量读表面收口」）：

- `packages/desktop/src/preload/mafw-types.ts` 的**内联** `memory.listSticky()` 返回类型补
  `perNoteCap: number`（这是 desktop 侧唯一一份 budget 副本；`mafw-api.ts` 是转发，无形状声明）。
- **纯类型改动，无运行时行为变化**：wire 早就在发该键，preload 只是类型滞后。
- `NotesDock` 的自有局部字面量 `{ max, maxChars, used }` **不改**：它只读 `budget().used / budget().max`，
  结构化类型无需跟随；将来要展示按条上限时再补。
- SDK `StickyNoteBudget` 同步为 required `perNoteCap`；`recall.pinned` 的 budget **不同形**（见 gateway 侧
  E10f 节「残余」——pinned 不按条截断，schema 有意只有 `max/maxChars/used`）。

### human token 轮换后的 403 自动重读重试（2026-11-13，E11-1）

gateway 新增 `POST /api/human-token/rotate`（见 `gateway.md` §「E11 身份 / 配额硬化」）：轮换成功后
**旧 token 立刻失效**，而桌面主进程只在 gateway 进入 `ready` 时构造一次 SDK client（`mafwClient`
把 `readHumanToken()` 的结果冻结在头里）——不处理的话，一次 CLI 轮换就让桌面所有 human-only 动作
持续 403，直到重启应用。E11-1 让统一 IPC 入口自愈：

- `packages/desktop/src/main/human-token.ts`（main-only，凭据永不进 renderer / preload / 插件 web / 日志）：
  - `isStaleHumanTokenError(err)`：**只**认「凭据被换掉」这一类 403——`status === 403`
    （显式 `err.status`，否则从 `HTTP 403` / `403 Forbidden` 文本解析）**且**带稳定码
    `human_principal_required`。403 但没有该码是另一种授权失败，401 / 429 / 500 / 网络错误都不是凭据问题，
    重试只会放大副作用；
  - `withHumanTokenRetry(call, refresh)`：先 `call()`；命中 stale 才 `await refresh()` 再 `call()` 一次，
    **只重试一次**，第二次失败原样抛给调用方。
- `packages/desktop/src/main/mafw-ipc.ts#mafw-invoke` 统一包一层：`refresh` 用
  `createGatewayClient('http://127.0.0.1:' + getGatewayPort())` 重建 client（重新读 token 文件）；
  端口为 `null`（gateway 不在）时保留旧 client，让原始错误照常浮出。
- **重试必须重新解析方法**：`invoke()` 闭包每次都从**当前** client 上 `resolveIpcMethod(namespace, method)`，
  绝不复用已绑死旧头的 client；`method === "invoke"` 的活转发路径不入重试包装。
- 不新增 UI / preload 面：轮换是 CLI 动作，桌面只负责「跟上」。测试：`src/main/human-token.test.ts`
  12 条（`isStaleHumanTokenError` 6：403+码 / 文本形态 / 403 无码 / 401·429·500 / 网络 / 结构化 code；
  `withHumanTokenRetry` 5：成功不刷新、stale 刷新后重试一次、二次失败上抛、刷新抛错、非 stale 不重试；
  1 条 IPC 接线守卫）。

### 自动 schema epoch 协商（2026-11-16，E10j-J2）

gateway 每个响应都带 `X-MAFW-Schema-Epoch`（`releaseMetadata` 未加载时省略），客户端**主动携带**旧值会被
409 `schema_epoch_mismatch` 拒绝（见 `gateway.md` §「E10j 交互与版本协商补齐」/ E3-5）。桌面主进程此前
从不发这个头，也就是 gateway 升级后仍按旧契约说话——不报错，只是静默错位。E10j-J2 把协商放进 SDK，桌面只 opt-in：

- `packages/desktop/src/main/human-token.ts#createGatewayClient` 传 `schemaEpoch: 'auto'`。
  它是**唯一**构造 SDK client 的入口（`mafw-ipc.ts` / `mafw-sidecar.ts` 都经它，守卫测试断言
  main 入口不出现 `new MafwClient(`），所以 renderer / preload / 插件 web 仍然不接触 epoch。
- SDK 语义：首个请求不带头 → 从**每个**响应（成功或失败）读取 `X-MAFW-Schema-Epoch` 并缓存 →
  之后请求自动携带；收到「响应 epoch 与本地已知值**不同**」的 409 时采用新值并**重试一次**
  （同 path/init），同值 / 无 epoch / 非数字 → 原样上抛（不猜、不循环）。
- 与 `withHumanTokenRetry` 是**两条互不重叠**的通道：409 是契约漂移，403 +
  `human_principal_required` 是凭据轮换；各自最多重试一次，不叠加。
- `fetchPath`（SSE / 二进制 / 媒体流 / 裸 Response）**不带** epoch、不重试（与 `clientToken` 同规则）。
  所以 SSE 订阅不受影响：不发头 = gateway 放行，不会因 epoch 漂移反复重连。
- 测试：`src/main/human-token.test.ts` 新增 1 条行为用例（epoch 回声 fake fetch：首请求无头、
  第二请求带上学到的值，human token 仍在），文件 **27/27**。
