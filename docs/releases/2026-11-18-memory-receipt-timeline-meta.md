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

## 已知问题 / 后续

- `packages/session-ui/src/architecture.test.ts` 在当前工作树为既有红：10 个无关文件命中 `opencode|claude` runtime-literal（`markdown.tsx`、`pierre/*`、stories 等），与本次改动无关；本次用单文件/全量排除该守卫作为门禁。
- 实时宿主 hook 需要 agent/serve 重启后才生效：当前被 gateway 采纳的 serve 早于 `src/hooks/session-recall.ts` 的改动，所以真机聊天发送暂时不会带锚点；`mafw restart-agent` 或重启桌面应用后生效（gateway 已重启）。
- 回执药丸/时间线/ghost 行的视觉验收（hover、520px 窄窗、折叠顺序）待人眼确认。
- TUI `tsc --noEmit` 既有红：`src/ui/triage-tab.ts:47`（与本轮渠道头无关）。
- 手机端 `flutter test` 默认并发下偶发 `did not complete`（widget 测试互相抢占）；`--concurrency=1` 全量 **600/600** 通过。
