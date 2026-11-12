# Workbench Chat 模式与 Episode（2026-11-12 Plan 4）

- 版本：desktop 5.1.0 / gateway 4.16.1
- Plan 4 base：`b89aa7ab`（docs: plan chat modes and episodes）
- 交付 HEAD：`b7456f7e`（fix: recover thread goals and memoize episode groups）
- 计划：`docs/superpowers/plans/2026-11-12-workbench-chat-modes-episodes.md`
- 设计：`docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md` §7.1 / §10.4 / §10.5 / §10.6 / §10.8

## 范围

Plan 4 只做 Chat 意图模式与 Episode 分组，不改变 Workbench 的对象优先结构（frame / stage / lens /
instruments / stack / picker），也不改变权限模型。

- composer 四模式：讨论 / 提议 / 委托 / 解决；模式是瞬态的，不写会话、不提升权限。
- 提议：把固定指令作为 `synthetic: true` text part 发送，用户正文保持干净。
- 委托：打开既有 New Goal composer 并预填草稿，不发送 chat 消息；委托单预览仍是创建门禁。
- 解决：打开既有 Goal 评审 lens / review 上下文，不发送消息；Agent 不代做人的评审决定。
- Episode：按会话的仅视图分组，存 `localStorage['mafw-episodes:v1:<sessionID>']`；不新增
  session/topic 模型。关闭默认折叠；关闭并记录只起草用户来源的决定记录，确认仍由人在决定板完成。

## 提交

| commit | 内容 |
|---|---|
| `f267bed0` | composer mode model |
| `dd157a94` | composer mode bar |
| `49fb6493` | send mode as a synthetic part（含 Tech Lead parts 透传） |
| `adec13fd` | delegate mode opens the Goal composer |
| `0d5f33bf` | resolve mode opens the review queue |
| `00b81ed6` | episode model and store |
| `96bfd6ab` | episode transcript grouping |
| `b5f782cf` | close episodes into decision drafts |
| `83582fae` | keep episode boundaries and hide mode context |
| `e8acf682` | harden episode reconciliation and goal linkage |
| `b7456f7e` | recover thread goals and memoize episode groups |

## 行为变化

### Chat 模式

- `ChatMode = discuss | propose | delegate | resolve`；`modeDirective` / `modeSendsMessage` /
  `modeAvailability` / `modeActionLabel` 是纯模型，组件只消费。
- 模式栏在 composer 上方，四个 `ButtonV2` chip；不可用模式用 `disabled` + `TooltipV2 openDelay=300`
  说明原因。动作按钮可见文案随模式变为 发送 / 提议 / 委托 / 去处理。
- 提议指令原文：`[[mode:propose]] 请给出至少两个选项、取舍、风险与建议；不要直接执行。`
  普通 chat 把它追加在 voice part 之后；Tech Lead 经 `sendTechLeadMessage` 的 `parts` 透传。
- 忙时排队保留 `chatMode`，`flushQueue` 重放时恢复；delegate / resolve 永远不进入 `sendMessage`。
- 委托要求非空正文与可用项目；解决要求当前有 Goal 焦点或 Goal 内容 scope，且空正文也可点击。
- resolve 会先确保右侧 workbench 可见（窄屏切 workbench），再切 review lens。

### Episode

- `ChatEpisode` 字段：`id / sessionID / title / startMessageId / startAt? / endMessageId / endAt? /
  status / decisionRecordId / createdAt / updatedAt`。
- 分组是视图层：`groupTurnsByEpisode` 保留未分组 turn；关闭且无 end 的 Episode 延伸到末尾；
  起始/结束 id 对账失败时用 `startAt` / `endAt` 在 ±10s 内找最近 turn。
- 关闭默认折叠；展开/收起是会话内覆盖状态，重载后关闭 Episode 仍默认折叠。渲染窗口分页裁掉组首时，
  Episode 头渲染在首个可见 turn 上；历史页本身未加载组首时按计划契约忽略该 Episode（不猜边界）。
- 关闭并记录：`DecisionRecordService.draft` 写 `history[0].by = 'user'`；桌面只保存返回的
  `decisionRecordId` 并刷新决定板，不自动确认。决定归属优先取 Pod detail 中该会话的 Goal 身份
  （重载后仍可用），其次 Tech Lead 内存映射 / 工作台焦点 / 内容 scope；只有 exact id 或与
  `startAt` 相差 ≤2s 时才把组首写成新的 `startMessageId`，避免近似匹配永久污染边界与证据 ref。
- 查看决定记录：展开决定板并定位到链接记录。

### 显示净化

opencode 2.1.0 prompt 只接受单 `text` 字段，适配器会把多个 text part 合并进存储的用户正文，
因此历史重载可能暴露模式指令与记忆注入块。`ingest/messages.ts` 在展示层剥离：

- `<deltas>` / `<patterns>` / `<facts>` / `<history>` 注入块（任意顺序、重复出现）；
- 语音来源标记 `[语音输入]` 行；
- composer 模式指令 `[[mode:...]]` 行。

assistant 文本不受影响。服务端原始消息保留给模型，不改写。

## 验证

| 门禁 | 结果 |
|---|---|
| Plan 4 新增测试 | **50**（desktop 44 + gateway 6） |
| desktop focused suite | 58/58（5 suites） |
| gateway focused suite | 16/16（2 suites） |
| desktop full `npm test` | **3576/3576**（696 suites；Plan 3 baseline 3532 + Plan 4 44） |
| gateway full `npm test -- --forceExit` | **6653/6653**（857 suites；当前树，含外部 kernel-v2 交付） |
| desktop `tsgo --noEmit -p tsconfig.json` | rc=0 |
| gateway `tsc --noEmit -p tsconfig.json` | rc=0 |
| `electron-vite build` | rc=0 |
| gateway `npm run build` | rc=0 |

Gateway 的 6653 构成：Plan 3 baseline 6608 + `98c8c232` / `967917c0`（events / standing-goals）7 +
Plan 4 6 + 外部 kernel-v2 交付 32。`98c8c232` / `967917c0` 是 Plan 4 base 的祖先；`24dc3f10` /
`517cf541` / `a1a292e7` / `105c8bd6` / `fa84bfca` / `1b84ae11` / `0f37169d` 是在 Plan 4 期间/之后
落地的外部 kernel-v2 / plugin-contract 交付。以上外部 commit **均不属于 Plan 4**，本记录只按 Plan 4
自己的 11 个 commit 归属；上述全量数字是 Plan 4 验证时点，后续外部 commit 的测试增量不计入。

### 真机 smoke

- 四模式可见；动作按钮分别显示 发送 / 提议 / 委托 / 去处理；无 Goal 时解决禁用。
- 提议：用户气泡只显示原文；发送边界捕获到一个 `synthetic: true` text part，含
  `[[mode:propose]]`；历史重载后正文仍干净。
- 委托：New Goal composer 预填标题与目标；chat turn 数不变；委托单预览仍在前。
- 解决：右侧评审 rail 显示「评审 / 评审意见 / 未解决 0」；chat turn 数不变。
- Episode：标记 → 第二回合 → 关闭并记录；Episode 折叠为 `已关闭 · 2 轮`；决定板 待确认 +1；
  展开后 2 个 turn 回来；重载后仍折叠且边界保留。
- 决定：决定板确认后 已定 +1；Episode 的「查看决定记录」会展开决定板并展开对应记录。
- 关闭表单：修改 Episode 标题后表单不关闭，摘要保留（Solid memo 修复的真机验证）。
- 来源：gateway 重启后新起草记录 history 为 `drafted · user`；Tech Lead Goal 归属由
  `resolveEpisodeGoalReference` 纯函数测试覆盖（Pod 会话身份 / 线程 Goal 优先于工作台焦点，
  重载后仍可用）。

## 最终评审

独立 reviewer 复核 `b89aa7ab..HEAD`，结论 `Ready to merge? No`（修复前）；随后对
`83582fae..b7456f7e` 做 delta review。已在本分支修复：

1. **Critical**：乐观 `user-...` id 被服务端 id 替换后，Episode 头只按精确 id 查找会消失，关闭
   Episode 的 turn 无法展开。改为按分组组首解析，并补渲染窗口分页时首个可见 turn 渲染；新增
   `episodeStartingAt` 与对账测试。
2. **Critical**：Tech Lead 线程关闭 Episode 时只按工作台焦点取 Goal，可能把记录挂空或挂错 Goal，
   决定板按线程 Goal 过滤后不可见；且内存映射在桌面重载后丢失。改为优先使用 Pod detail 的会话
   身份（`goalSessionIdentity`），映射只作 Pod 未加载时的兜底；Pod 已加载但目标不存在时忽略旧映射。
   决定板过滤同样先读 Pod 身份。补 session identity / stale mapping / focus / content 测试。
3. **Critical**：记忆注入块不只 `<facts>`，`<deltas>` / `<patterns>` / `<history>` 会泄漏到用户气泡。
   展示层改为任意顺序、重复剥离四类块；补 mixed-tag 测试。
4. **Important**：动作按钮只有图标，没有可见模式文案；已渲染 `mafw-send-label` 并调整 composer
   按钮宽度。
5. **Important**：Episode 关闭表单在标题输入时被 effect 重置。Solid 的 `on(() => props.episode.id)`
   仍会随同 id 的新对象重跑；改为 `createMemo(() => props.episode.id)` 后再 `on`，并补一个
   Solid 反应式回归测试（memo 不重跑 / 直接 getter 会重跑）。
6. **Important**：委托草稿留在 `goalComposerInitial`，之后手动新建 Goal 会复用旧草稿；在手动
   toggle、创建成功、项目切换时清理，项目切换关闭 composer，并让空目标不能进入预览。
7. **Important**：关闭 Episode 时把时间近似匹配的邻居写成 `startMessageId` 会永久污染边界与证据。
   新增 `resolvedCloseStartId`：只有 exact id 或与 `startAt` 相差 ≤2s 才重写，否则保留原 id +
   `startAt` 继续对账。
8. **Important**：`episodeGroups` 在每次渲染/标题输入时重复 O(turns × episodes) 计算。改为
   `userMessages` / `visibleTurns` memo + 按 Episode 结构 key 缓存分组，并缓存 message→episode、
   header→episode 映射。
9. **Important**：Task 9 文档缺失；本记录与 `desktop.md` 已补。

一并修复的 minor：resolve 焦点下右侧 workbench 可见性、delegate 仅有附件时按钮仍可点、隐藏
Episode turn 出现在导航/搜索、关闭表单 flex 布局、重复 Episode 起点、空标题回退。

### 延后 minor

- Episode 标题每次输入都写整个数组；未做防抖 / blur 提交。
- `window.localStorage` 属性访问仍在 `episodeStore` 的 fail-open 之外；Electron 正常环境不触发。
- HTTP `decisions.draft` 允许本地调用方自报 `source: 'user'`；记录仍是非权威草稿，确认仍人类专属，
  属审计标签问题；后续可白名单路由字段。
- 历史页本身未加载 Episode 组首（且中间隔了 >10s 的不同 user turn）时按计划 Task 6 契约忽略该
  Episode；只覆盖渲染窗口分页，不做跨历史页边界猜测。
- 结构化 wiring 测试仍占一定比例；关键行为已由 episode / sanitizer / goal-resolution / Solid
  反应式测试覆盖。

## 不在本计划

split view、world overview、legacy `WorkbenchContext` / 四上下文清理、execution drawer 移除、
decision-board SSE invalidation、决定记录虚拟化，均留给 Plan 5；本计划按 spec 的迁移顺序把
cleanup 放在最后。
