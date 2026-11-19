# 2026-11-18 · 记忆回执 / 过程时间线 / 用户元信息

- 分支：`main`（本地；未 push、未 merge、未发布）
- 设计：`docs/superpowers/specs/2026-11-18-memory-receipt-timeline-meta-design.md`
- 计划：`docs/superpowers/plans/2026-11-18-memory-receipt-timeline-meta.md`

## 交付内容

### 1. 记忆回执

- 每次 recall 后生成结构化回执：`gateway/src/recall/receipt.ts#buildMemoryReceipt`（摘要优先，不含 `memory_value` / 指针 id）。
- T1 只保留 `user_input|user`、`assistant_reply|assistant`；`tool_result` / `reasoning|system` 与工具噪声计入 `filteredT1`。
- 锚点：桌面每次发送带 `[[turn:turn_<uuid>]]` 文本哨兵；host hook 提取 `anchorKey`，回执按 `(session_id, anchor_key)` 挂回同一轮。
- 持久化：`gateway.db#memory_receipts`（同锚点 soft merge，每会话 200 条）；`GET /api/sessions/:id/memory-receipts` 供历史回填。
- 实时：响应结束后 `setImmediate` 广播 `memory.recalled`；持久化/广播都在 `res.end` 之后，abort 不发。
- 桌面：28px 药丸 + 300ms hover 卡；类型标签只用 `semantic→事实 / procedural→做法 / global→通用 / episodic→往事`；邻居标 `↳` 且不计入主计数。
- 快照路径把 R6 temporal neighbors 一并写入回执（`renderWithNeighbors`），与 live 路径对齐。

### 2. 过程时间线

- `splitTurn` 做 lossless 分组：只折叠 reasoning / read / list / glob / grep / websearch / webfetch；**所有 output 永远可见**，中间输出与最终输出同款排版。
- `edit/write/apply_patch/bash/task/审批` 仍是顶层卡；`partDefaultOpen` + `assistantActions` 保留。
- 只有当前活动段默认展开（`defaultSegmentOpen`）；用户手动开关优先。桌面开关：`localStorage['mafw-process-timeline']='0'` 回退旧卡。

### 3. 用户元信息

- composer 上方 ghost 行（10.5px、无边框、hover 才出现底色与 `›`），popover 300px：时间只读 / 渠道只读 / 城市输入 + 开关 / 语言只读。
- 城市默认关闭，只发城市名；每轮发送带隐藏 `<latest-reminder>`（含日期/时区/语言/**渠道**）。
- 渠道自动识别：桌面 reminder 写 `渠道：桌面端`；gateway 按 `x-mafw-client` 为手机/TUI/API 补 `<client-channel>…</client-channel>`；WS `send` 默认 mobile。
- `mafw-latest-reminder=0` 只关 reminder，turn marker 仍保留（回执锚点不能丢）。
- 历史与实时都由 `stripInjectedUserText` 剥离 reminder / marker / 渠道块；手机端 `displayText` 同样剥离。

## 主要提交

- `461692e75` `c3f531bc3` `44d460249` `51699be6f` — turn marker（文本哨兵）与 hook anchorKey
- `94ac6b3ac` `b0e16f603` `793363046` `9ede56b41` `c4c92c7ff` — 回执 builder / 快照结构 / 持久化 / emit / 历史路由 + SDK
- `2d3397fbc` `9bde569ea` `dbea65429` `034096e91` `cc36bb95f` — 桌面投影 / SSE / 药丸卡 / 历史回填 / 真实数据
- `dd27fa559` `18b5ae5a3` `1d73057bf` `1bfb79988` — splitTurn / ProcessTimeline / 接入 / 折叠
- `f745117ec` `3f716f98f` `57e13fae1` — reminder + marker 发送路径 / ghost chip
- 验证修复：`d4c9f40c3`（IPC 参数）、`a564c0cff`（工具卡默认展开/actions）、`493910814`（live 替换保留 turnKey）、`be77475c9`（T1 source 映射）、`7a377a8f8`（启动崩溃）、`4a5ae66c7`（快照邻居）、`f058dade7`（旧 preload 兼容）、`e194f9f2b`（路由覆盖账本）、`238c6f9f7`（城市输入溢出）、`be46c487c`（段头图标）
- 渠道：`589b2045f`（gateway 注入）、`3c93726e3`（桌面 reminder/popover）、`0c7a7cfee`（TUI 头）、`6cebcb887`（mobile 头 + 展示剥离）
- 文档：`a1286acaf`

## 验证

- Desktop：`npm test` → **795 suites / 4160 pass / 0 fail**；`npx tsgo --noEmit -p tsconfig.json` → rc 0。
- Mobile：`flutter test --concurrency=1` → **600 pass / 0 fail**；新增渠道头与 `displayText` 剥离测试。
- TUI：`npm test` → **325 pass / 0 fail**（1 skip）；`tsc --noEmit` 仍有既有 `src/ui/triage-tab.ts:47` 类型错误（非本轮改动）。
- Session UI：全部测试（排除既有 `architecture.test.ts`）→ **26 suites / 161 pass / 0 fail**；`tsgo` rc 0。
- SDK：`npm test` → **246 pass / 0 fail**；`tsc` rc 0。
- UI：`tsgo` rc 0。
- Gateway：`npx tsc --noEmit -p tsconfig.json` → rc 0；定向回执/路由/快照/DB 测试全绿。
- Gateway 全量：`npx jest --runInBand --forceExit` → **8443 pass / 16 failed / 8461 total（8 suites）**。其中 3 个 suite（9 tests）是新增 `/api/sessions/:id/memory-receipts` 的路由覆盖账本，已更新为 336 ops / 329 covered responses 并通过；`pod-worktree-service` 与 `restore-git` 为全量负载下的偶发（单跑通过）；剩余 3 个 suite（6 tests）为并行工作遗留：`runtime/validate-shape`（`sessionChildrenApi` 期望）、`runtime/architecture-boundaries`（`sessions-read.ts` 读 `runtime.capabilities`）、`architecture/legacy-route-inventory`（transport 清单漂移）。
- 复跑失败集：**5 pass / 3 fail（6 tests）**，失败仅剩上述并行遗留。
- 渠道增补：gateway 新增 11 条（client-channel 6 + chat-wiring 3 + sessions-core 2），定向 **36/36**；desktop +3、mobile +3、TUI +1 条用例。gateway 全量基线未重跑（本轮无新增路由/契约变化）。
- 构建：root `npm run build` 通过；`gateway npm run build` 通过；`packages/desktop npx electron-vite build` 通过。
- 真机 smoke：`GET /api/recall/context?...&anchorKey=...` → 200；`/api/events` 收到 `memory.recalled`（与 anchor 一致）；`GET /api/sessions/:id/memory-receipts` 返回同锚点回执（3 anchors + 3 neighbours，无 `memory_value`）。smoke 行已清理。
- Gateway 运行状态：本轮结束时 gateway 以 standalone 方式运行在 `:3000`（PID 47436，instance `bc4d7733-b009-4965-a392-7172245666aa`，health `ok`；构建源 commit `4a5ae66c7`，branch HEAD 以 `git log -1` 为准）；托管网关的启动崩溃已由 `7a377a8f8` 修复。
- 桌面窗口：本轮重启 gateway 时，两个桌面实例的 supervisor 用尽自动重启（4 次）并进入 failed；需**手动重启一次桌面应用**让它重新拉起 managed gateway（代码已修）。

## 2026-11-19 · 过程时间线定稿

- 段头只写 `已思考 N 秒`；抽屉里第一行是 `思考`（11px/550，与工具名同字号，默认折叠一行），随后是全部工具（含 bash/edit/write）。
- 工具行无前置图标、无外框、工具名原样 + 相对路径/命令、右侧一个 chevron；edit/write 保留 diff 卡。
- 历史无 part time：单段回退整轮 message 时长，多段省略，避免每段重复整轮时长。
- 两套“已思考”实现对齐：`process-timeline` 与 desktop `ThinkingBlock` 都改为裸时长，并去掉 `✻` 字形。
- `DataProvider` 的 directory 从 `.` 改为当前会话绝对目录，原生 read/edit/write 卡与时间线统一显示相对路径。
- 提交 `cd6fa5539`；session-ui **163/163**、desktop **4160/4160**，`tsgo` rc 0。
- `ef3352804`：展开思考时隐藏预览行，避免与正文第一行重复。
- `86dfbd079`：Edit/Write 卡标题与 Read/Shell 行统一为 11px/550，路径 10.5px。
- `ea92d374f`：抽屉内所有工具改为复用注册的原生卡（删除 `ToolRow` / `CARD_TOOLS`），只做作用域归一化：标题 11px/550、目标/路径 10.5px、隐藏 task 家族图标、行工具无外框 + hover 淡底 + 一个 chevron；Edit/Write/ApplyPatch 保留 diff 卡，Task/Question/Skill/MAFW family 保留原生操作与 `mafw-tool-box` 内容盒。调研：`docs/research/2026-11-19-tool-card-refactor-survey.md`。
- Phase 1 门禁：Session UI **26 suites / 165 pass / 0 fail**（排除既有 `architecture.test.ts`），Desktop **795 suites / 4160 pass / 0 fail**，两侧 `tsgo` rc 0，`electron-vite build` 通过。
- 真机 CSS probe：basic tool 标题 **11px/550**、副标题/args **10.5px**、trigger `0` 边框 + 28px 行高；task 标题 **11px/550**、家族图标 `display:none`；bash code **10.5px**；`mafw-tool-box` padding `6px 8px`；tool-output **11px**。真实历史段中 Edit 卡实测 **11px/550**、相对路径 **10.5px**。
- `4971632bb`：`read` 原生卡补 `data-component="tool-output"` 折叠体（默认收起、可滚动），与 List/Glob/Grep 一致；普通聊天与过程抽屉同时生效，Read 也重新有了 chevron。
- `ae6d021d8`：展开正文与折叠标题对齐同一条左边缘（`--mafw-tool-content-left: 6px`）；diff 卡头 padding 12→6，bash 正文、tool-output、MAFW 内容盒统一使用该 token，不再向轨内多缩进一格。
- Read 门禁：Session UI **27 suites / 166 pass / 0 fail**，Desktop **795 suites / 4160 pass / 0 fail**，`tsgo` rc 0，`electron-vite build` 通过。
- 对齐门禁：Session UI **27 suites / 167 pass / 0 fail**，Desktop **795 suites / 4160 pass / 0 fail**，`tsgo` rc 0，`electron-vite build` 通过。

## 2026-11-19 · ToolPresentation Wave 1 + CodeMode 卡

- 设计：`docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md`；计划：`docs/superpowers/plans/2026-11-19-tool-presentation-contract.md`；CodeMode 数据边界：`docs/research/2026-11-19-codemode-tool-results.md`。
- 契约：`packages/session-ui/src/components/tool-presentation.ts` 定义 `collapsed` / `expanded` 两态、`resolvePresentation()` 和显式默认（`DEFAULT_EXPANDED.body = "default"`，通用输入/输出）；`partOutputText()` 统一 history `state.content[].text`。
- 注册面：`ToolRegistry` 新增 `present` / `renderCollapsed` / `renderBody` / `override` / `has` / `names` / `entry`；插件 override 快照并恢复完整 entry，`ToolPartDisplay` 优先尊重 override。
- 渲染：新增 `ToolCard`（`tool-card.tsx/.css`）——折叠固定一行 28px、标题 11px/550、目标 10.5px、只在箭头前 8px 渐隐、展开正文与标题同一条 6px 左边缘；`data-state="collapsed|expanded"`，pending/running 不禁止展开。
- 行工具：read/list/glob/grep/webfetch/websearch/bash 接 `present`；`GenericTool` 有 `genericPresentation` 兜底；context 组改用 `resolvePresentation(mode: "context")`，删除 `contextToolTrigger` / `contextToolDetail`。
- CodeMode：`execute` 接 `presentExecute` + `ExecuteBody`；折叠显示 `Code Mode 执行` + 失败/最近子调用摘要 + `N 次调用`，展开显示子调用行（只展开 input JSON）+ 最终输出；**不渲染 per-call 结果卡**（数据不存在）。
- 门禁：Session UI **33 suites / 187 pass / 0 fail**（排除既有 `architecture.test.ts`）；Desktop **797 suites / 4164 pass / 0 fail**；两侧 `tsgo` rc 0；`electron-vite build` 通过。
- 真机：打开 CodeMode 段实测 `Code Mode 执行` 标题 **11px/550**、object **10.5px**、`1 次调用`、1 个子调用行、最终输出存在、子结果卡 **0**；Shell 行同字号，页面无 `.mafw-turn-render-error`。
- 评审修复（`c3c3d67f2`）：`shouldUsePresentation` 让插件 override 真正优先；未知 MCP 工具走 `genericPresentation` + `ToolCard`；context 组改为 `ToolCard group`；`renderBody` 用 `Dynamic` 挂载、CodeMode 子调用改 `Index` 保留行状态；补 `resolveToolEntry` canonical 链、bash ANSI 清理、webfetch 折叠链接、websearch 链接体、`partOutputText` 空 output 回退；移除未实现的 `animated`/`defer` 字段。
- 修复后门禁：Session UI **35 suites / 193 pass / 0 fail**；Desktop **797 suites / 4164 pass / 0 fail**；两侧 `tsgo` rc 0；`electron-vite build` 通过。
- `2d761a572`：段头 `已思考 N 秒` 改为 **12px / 400**（比工具名大一档、不加粗）；`processSummary` 同时读取 reasoning 的 `time.created/completed`，历史段不再丢时长；只有最后一段在完全无时间时回退整轮时长，前面段不重复。
- 段头门禁：Session UI **36 suites / 196 pass / 0 fail**；Desktop **797 suites / 4164 pass / 0 fail**；两侧 `tsgo` rc 0；`electron-vite build` 通过。
- `be294bd81`：所有工具卡运行时默认 **collapsed**；移除 CodeMode / question / MAFW 自绘卡的默认展开，`ToolCard` 只认调用方显式 `defaultOpen`（详情模式仍可展开 shell/edit）。
- 折叠门禁：Session UI **36 suites / 197 pass / 0 fail**；Desktop **797 suites / 4164 pass / 0 fail**；两侧 `tsgo` rc 0；`electron-vite build` 通过。
- 提交：`638c97e8d`（契约）、`f931f2734`（registry）、`8747e565a`（ToolCard）、`495aa6664`（行工具）、`133f85bc7`（ToolPartDisplay）、`04532270a`（context 组）、`8d9d31689`（plugin override）、`e67a71f4a`（ChatView 11px）、`8f29e679e`（CodeMode 卡）。
- Wave 2（diff 卡）：`edit/write/apply_patch` 接 `presentDiffTool` + `renderBody`；折叠行显示相对路径 / `N 个文件` 与 `+N -M`（0/0 不显示），展开体保留 `ToolFileAccordion` / `DiffChanges` / `DiagnosticsDisplay` 与 `virtualizeDiff`；不再包 `BasicTool`。diff body 文件名统一 11px/550、目录 10.5px，正文与折叠标题同边（6px，内层 button 不再叠加 padding）。
- Wave 2 评审修复：`data-file-path` 留在始终渲染的 `tool-part-wrapper`（折叠行右键仍出文件菜单）；`ToolPresentationFallback` + `toolFallbackKind` 让插件代理在 presenter-only 卡上回落真实 `ToolCard` 而不是 GenericTool JSON；单文件 `apply_patch` 删除项不再默认展开；折叠行与 body 共用 `hasPatchContent` 过滤，计数一致；Windows 反斜杠路径恢复目录显示；body 内层 button 不再叠加 6px padding。
- Wave 2 门禁：Session UI **42 suites / 216 pass / 0 fail**；Desktop **799 suites / 4172 pass / 0 fail**；两侧 `tsgo` rc 0；`electron-vite build` 通过。
- Wave 2 真机：`Write` 卡折叠行 `state=collapsed`、标题 11px/550、object 10.5px、行高 28px、`+174`，`closest("[data-file-path]")` 命中 wrapper；展开后 diff 文件头 11px/550、目录 10.5px，首个内容元素（文件图标）与标题左边缘差 0.8px；页面无 `.mafw-turn-render-error`。
- Wave 2 提交：`96a4a8e5e`（model+presenter）、`9fca8a63f`（bodies）、`c55f92a3b`（wiring）、`ab3d1229b`（density）、`ba1c5a479`（edge alignment）、`b9bc8e33d`（conformance + desktop wiring test）、`dba65abec`（collapsed row file path）、`61d1a6ec1`（renderable patch rows）、`07f324e39`（deleted seed + Windows dirs）、`12a79fe13`（plugin presenter fallback）。
- Wave 3（富卡）：`task/question/skill` 接 `presentTask` / `presentQuestion` / `presentSkill`；task 折叠行显示 agent + description + `(background)`，`TaskBody` 显示 agent/description/session，`open-subagent` 动作经 `ToolCard.onOpenSession` 导航；question 显示首个问题 + 已回答/问题数，`QuestionBody` 保留 Q/A 列表（未回答显示占位）；skill 从 `input.name` / `input.skill` / `output` 的 `# Skill: <name>` 推导名称，展开体显示 Markdown。删除 task 自绘 trigger、`task-tool-icon` 分支与时间线 task-tool CSS。
- Wave 3 评审修复：`ToolPresentationFallback` 补 `onOpenSession`（插件覆盖的 task 仍有子会话导航）；新增 `task-tool-model.ts` 的 `taskSessionForParent`，用 part 的 `sessionID` 而不是路由 pathname 解析子会话（桌面 MemoryRouter 下历史 task 的旧解析实际失效）；task 无 agent 时动作标签不再拼成 `Agent Agent`；`ToolCard` 拒绝 `//` 协议相对 href、只拦截普通左键、隐藏全空的动作容器；question 零问题时回退到 `未回答`。
- Wave 3 门禁：Session UI **47 suites / 235 pass / 0 fail**（Wave 2 基线 42/216，本轮 +5 suites / +19 tests）；Desktop **798 suites / 4172 pass / 0 fail**；两侧 `tsgo` rc 0；`electron-vite build` 通过。
- Wave 3 真机：`task` 卡折叠行标题 `General`、object `实现召回分段计时`、11px/550、28px；展开体 `task-detail` + `General Agent` 动作；`skill` 卡标题 `Writing-plans`、11px/550、28px，展开体 Markdown 正常；页面无 `.mafw-turn-render-error`。question 卡当前会话无实例，由 presenter/body 单测覆盖。
- Wave 3 提交：`5aac72edd`（presenters）、`42213d271`（bodies + session action）、`c09ba0f25`（wiring）、`736c84a6b`（timeline task CSS）、`a1bb666d9`（skill name from output header）、`87bc47305`（conformance）、`396c1489b`（task navigation + action hardening）。
- Wave 4（MAFW family）：`ToolRegistryEntry` 增加 `renderSections`，`ToolPartDisplay` / `ToolPresentationFallback` 转发给 `ToolCard`；新增 `family-present.ts` 的 `presentFamily(spec, ctx)`（title/subtitle/badge → 折叠行，`extract` → `expanded.sections`，空 output → `(无输出)`，extract 异常/空 → `genericSections`）；29 个 family spec 注册 `present` + `renderSections`，不再注册 `familyCard` 的 `render`；`mafw_create_goal` 仍由 `MafwGoalCreatedCard` 接管，legacy fallback 用 `FamilyCard`（`ToolCard` 包装）。
- Wave 4 评审修复：注册逻辑抽到 `family-register.ts` 的 `registerFamilyCards`，运行时断言 60 个别名全部有 `present` + `renderSections`、无 `render`，并断言 goal 自绘卡注册在 family 之后；`familySections` 过滤空 kv/tags/text/code/list，空列表回退 `genericSections`；`genericSections("null")` 不再抛；`extract.ts` 改为 re-export session-ui 的 `Section` / `ListItem` / `ToolBadge`，去掉两处 `as unknown as`；`FamilyCard` 转发 `defaultOpen` / `open` / `onOpenChange`。
- Wave 4 门禁：Session UI **47 suites / 237 pass / 0 fail**；Desktop **803 suites / 4189 pass / 0 fail**；两侧 `tsgo` rc 0；`electron-vite build` 通过。本轮新增 **4 suites / 12 tests**（family-present、family-register、shared、family-registration + extract null case）；Desktop 总数同时包含并发 memory-receipt 工作新增的用例。
- Wave 4 真机：当前会话没有顶层 MAFW family 工具调用（本会话的工具都在 Code Mode 子调用里），family 卡视觉未观测；`family-present` / `family-register` / `shared` 测试覆盖 presenter、空态、fallback 与 29 个 spec 的注册。
- Wave 4 提交：`106a73577`（renderSections slot；同 commit 夹带并发 memory-receipt 的 `turnFooter` hunks，cherry-pick 时需注意）、`f36b0ccf6`（family presenter）、`a0d11a22a`（family registration + FamilyCard）、`91740d47b`（goal-created wiring test）、`785b0fad7`（fallback comment）、`4341f29df`（registration/empty-section hardening）。
- Wave 5（清理 + conformance）：删除未使用的 `getToolInfo` / `ToolInfo` / `agentTitle` 重复映射与 `IconProps` 残留 import；`ToolRegistry.has()` 现在统计 `present` / `render` / `renderCollapsed` / `renderBody` 全部自定义槽位（`renderSections` 是 body slot，不计入 occupancy）；新增源码派生的第一方注册 conformance（14 个注册块逐个解析，除 `HIDDEN_TOOLS` 外必须有 `present`，alias 目标必须已注册，另有 synthetic 负例证明块隔离）；`toolFallbackKind` 也识别 `renderCollapsed`；删除未使用的 `ToolCardSpec.defaultOpen`、`basic-tool.css` 中已无 markup 的 task-tool/agent-title 样式，并更新时间线注释。
- Wave 5 门禁：Session UI **49 suites / 242 pass / 0 fail**；Desktop **803 suites / 4191 pass / 0 fail**；两侧 `tsgo` rc 0；`electron-vite build` 通过。本轮新增 Session UI **2 suites / 5 tests**、Desktop **1 test**；Desktop 总数同时包含并发工作新增用例。
- Wave 5 真机：重载后工具卡正常折叠/展开，页面无 `.mafw-turn-render-error`；本波无视觉改动，作为回归守卫。
- Wave 5 提交：`6cb235c79`（getToolInfo removal）、`f16ebba0f`（registry occupancy）、`ed67711fc`（registration conformance）、`cffda77af`（defaultOpen + comment cleanup）、`0e67fbeed`（task agent assertion move）、`87100cf58`（cleanup/conformance hardening）。

## 已知问题 / 后续

- `packages/session-ui/src/architecture.test.ts` 在当前工作树为既有红：10 个无关文件命中 `opencode|claude` runtime-literal（`markdown.tsx`、`pierre/*`、stories 等），与本次改动无关；本次用单文件/全量排除该守卫作为门禁。
- 实时宿主 hook 需要 agent/serve 重启后才生效：当前被 gateway 采纳的 serve 早于 `src/hooks/session-recall.ts` 的改动，所以真机聊天发送暂时不会带锚点；`mafw restart-agent` 或重启桌面应用后生效（gateway 已重启）。
- 回执药丸/时间线/ghost 行的视觉验收（hover、520px 窄窗、折叠顺序）待人眼确认。
- TUI `tsc --noEmit` 既有红：`src/ui/triage-tab.ts:47`（与本轮渠道头无关）。
- 手机端 `flutter test` 默认并发下偶发 `did not complete`（widget 测试互相抢占）；`--concurrency=1` 全量 **600/600** 通过。
