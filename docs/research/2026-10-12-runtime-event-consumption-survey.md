# Agent Runtime 事件消费面与注册/翻译层调研（gateway × desktop）

日期：2026-10-12 · 方法：三路并行代码勘察（gateway 消费面 / desktop 消费面 / 注册接口与翻译层）+ 关键结论人工抽查验证（event-flow-matrix.ts、gateway-sdk/events.ts、sse/dispatcher.ts 逐行核对）

## 0. 问题与一句话结论

**问题**：gateway 与 desktop 前端各自用到哪些 agent runtime 事件？这些事件有没有对应的注册接口和翻译层？

**一句话结论**：
- 事件词汇表有三层事实源且互有交叉校验（SDK union → EVENT_FLOW_MATRIX → desktop `assertShellEventCoverage`），canonical 管线本身是表驱动的（`CANONICAL_FACET_RULES` + `eventMappings`）；
- 但**注册接口（v4.20.0 eventMappings）只对外部文件插件是完整闭环**；pi 是「声明复用、执行旁路」（真翻译在 PiEventStream 内部）；opencode 与 gateway 顶层广播完全不经注册接口；
- 存在 1 个暗契约事件（`goal_node`）、2 个矩阵/清单漂移、3 个断头/死代码链路。

## 1. 事件管线全景

```
opencode serve (SSE /global/event)          pi runtime (进程内 subscribe)
  原生事件 == canonical（恒等）               PI_EVENT_MAPPINGS 表翻译（PiEventStream 内部）
        │                                          │  + permission/compaction 经 eventStream.push() 直入
        └──────────────┬───────────────────────────┘
                       ▼
       wrapGlobalEventStream（仅插件声明 mappings 时包装）
       wrapToolPartAssembly（三原语 tool.call/delta/result → ToolPart 快照）
                       ▼
            handleOpencodeEvent（gateway/src/index.ts:1072-1231）
             ├ sync / 三原语丢弃、畸形限频 warn、未知遥测
             ├ goalDriver / applyApprovalPolicy / identityState
             ├ TrajectoryCollector → 广播 trajectory.event/turn
             ├ compaction flush → turnCompress
             ├ BudgetGuard（step 切面）
             ├ Mode B per-session 转发（?sessionID=）
             └ Mode A 广播（session.idle→message.complete 改写）
                       ▼
              /api/events SSE（desktop 唯一 EventSource，MafwShell.tsx:875）
                       ▼
          dispatchShellEvent（desktop sse/dispatcher.ts:64-124）
             ├ core 内联：connected?无 / user_question / project_registered /
             │  runtime_switched / goal_node+goal_created+phase_transition / session.*
             └ EXTRA_HANDLERS 链：flow-cards → dock → chat-stream → media-speak → diff
```

## 2. Gateway 消费面（事件 × 切面 × 消费方）

### 2.1 归一化与切面

- `normalizeOpencodeEvent()`：`gateway/src/runtime/normalize.ts:71-88`（sessionID 五层提取链 :75-77）
- `CANONICAL_FACET_RULES`：`gateway/src/runtime/canonical-facets.ts:28-50`，12 条规则产 7 类切面：`step`（step-finish part / assistant+completed message / legacy session.next.step.ended）、`chatSignal`（delta/complete/error）、`broadcast`（idle/error）、`compaction`（compacting/compacted）、`approval`（permission.asked，双 runtime 形状对齐 :48-49）
- **执行器内置特例（表化不了）**：`toolCommand`（`type.includes('tool')` + `args.command`，normalize.ts:83-85）、approval metadata 构造（canonical-facets.ts:90-93）

### 2.2 handleOpencodeEvent 分支（index.ts:1072-1231）

| 消费方 | 触发 | 位置 |
|---|---|---|
| 丢弃 | `sync` 信封 / 三原语漏底 | index.ts:1077-1080 |
| 未知遥测 | 非矩阵/非 `plugin:`/非 `session.next.*` | index.ts:1095-1105 |
| conformance taps | per-session 全量 | index.ts:1110-1116 |
| goalDriver | `session.idle` / `session.error` | index.ts:1119-1122 |
| applyApprovalPolicy | approval 切面 | index.ts:1127-1129 |
| identityState 清绑定 | `session.idle` | index.ts:1131 |
| 自更新调用者定位 | toolCommand | index.ts:1147-1155 |
| TrajectoryCollector | `message.updated` / `message.part.updated` | index.ts:1157-1170 |
| compaction flush | compaction 切面（**start/end 双触发**） | index.ts:1174-1187 |
| BudgetGuard | step 切面 | index.ts:1189-1197 |
| Mode B 转发 | chatSignal | index.ts:1199-1208 |
| Mode A 广播 | broadcast（idle→`message.complete`、error→`message.error` **改写**） | index.ts:1210-1230 |

### 2.3 gateway 内部 eventBus → 扁平广播桥（index.ts:3141-3176）

`user_question` / `user_feedback` / `goal_created`（+startGoal，index.ts:3144）/ `state_change`（+goalDriver.advance :3149）/ `phase_transition`（+milestone-push :3159）/ `memory_written` / `memory_energy_changed` / `memory_distillation_complete` / `automation_triggered` / `automation_completed`——**硬编码 if 链**，非注册表驱动。

### 2.4 其他消费点

- automation-engine EventTrigger（automation-engine.ts:381-402）：**只挂 gateway 内部 eventBus**，runtime SSE 事件不进 eventBus；当前零内置 event 规则（system-rule-templates.ts:17）
- serve watchdog 重订阅：`subscribeToEvents`（index.ts:1017-1063，AbortController 防孤儿迭代）；调用点五处（启动 589 / 热切换 898 / runtime switch 1659 / serve 恢复 3251、3306）
- v1 opencode 插件（宿主内，不经 gateway）：`session.next.reasoning.ended` / `session.next.tool.failed` → T1 观察（src/plugin.ts:116-124）
- 文件事件目录 `~/.mafw/events/`：watchEventsDir（index.ts:952-979）→ broadcast + goalDriver.advance

## 3. Desktop 消费面（事件 × handler × UI 行为）

连接：唯一 `EventSource` → `GET /api/events`（MafwShell.tsx:875），剥壳 `raw?.data || raw`（:906-912）；onopen 副作用 = conn 状态 + sessionStore.invalidate + flow-card 对账（:880-887）。**desktop 不用 Mode B**。

### 3.1 dispatcher core 内联（无 sid 事件，dispatcher.ts:64-114）

| 事件 | 行为 | 位置 |
|---|---|---|
| `sync` | 兜底静默消费（防版本偏差泄漏） | dispatcher.ts:70-73 |
| `user_question` [扁平] | setActiveQuestion + OS 通知 | :75-80 |
| `project_registered` [扁平] | projectsRev++ → Rail 重拉 | :82-86 |
| `runtime_switched` [扁平] | invalidate + resetChatWorkspace | :88-92 |
| `goal_node`/`goal_created`/`phase_transition` [扁平] | goalsRev++ → Dashboard/泳道重拉（goal_node 无 sid，**必须**在 sid 分发前） | :94-99 |
| `session.created/updated/deleted` | planSessionEvent → invalidate/patch/remove+closeIfOpen | :101-114 |

### 3.2 EXTRA_HANDLERS 链（返回 true 止链）

| handler | 消费事件 | UI 行为 |
|---|---|---|
| flow-cards.ts:48-109 | `question.asked/replied/rejected`、`permission.asked/replied`、`permission_mode`、`session.compacted` | 内联卡 + 🛡 徽标 + 压缩边界分隔线 |
| dock.ts:28-49 | `trajectory.event/turn`、`todo.updated` | TrajectoryDock 滚动窗口 200 / 任务清单 |
| chat-stream.ts:35-120 | `message.updated`、`message.part.delta/updated/complete`、`message.complete/error/aborted`、`session.idle/error`（防御性兜底）、`session.next.tool.*` 前缀族 | 乐观替换 / 流式累积 / part upsert / 回合收束（`sealUnfinishedAssistantMessages`）/ 工具卡父消息确保 |
| media-speak（chat-stream.ts:124-131） | 任意携带 `tool=mafw_media_speak` 的事件（不按 type） | VoiceSession 语音播报，永不消费 |
| diff.ts:10-16 | `session.diff` | ChangesDock 审阅面板数据源 |

### 3.3 漏接线检测

- 运行期 missTrace（dispatcher.ts:57-62）+ `isTailAccountedAtShell`（session-events.ts:124-129）：`IGNORED_AT_SHELL`（:106-112，15 项）/ `TAIL_ACCOUNTED_TYPES`（:115-118）/ `TAIL_ACCOUNTED_PREFIXES`（`plugin:*`、`session.next.tool.*`）；其余未知 → warn + EventInspector 红 miss 行
- 编译期 `assertShellEventCoverage`（session-events.ts:148-197）对 SDK `UnwrappedEvent` union 强制全员归类
- 矩阵交叉校验：`gateway/tests/unit/runtime/event-flow-matrix.test.ts:6-28`

### 3.4 轮询兜底（非事件）

Dashboard 15s / GoalDetail 15s / Approvals 10s / Triage 10s / Automations 10s / UsageDock 15s / UsagePill 60s / NotesDock 15s / ManagerCard 15s / flow-card 对账 60s / 托盘 30s。

### 3.5 pi 下降级路径

pi 无 `session.created/deleted`/标题事件（agent_start→`session.updated` 空壳被 planner 判 none）→ Rail 靠 SSE 重连 invalidate + 轮询兜底；无 `message.part.delta`（全量 upsert）；无 `session.diff`/worktreeApi（入口隐藏）；`session.compacting` 为 pi 独有。

## 4. 注册接口与翻译层

### 4.1 注册接口（v4.20.0，仅对文件插件完整闭环）

- 类型定义：`gateway/src/runtime/event-mapper.ts:8-33`（`EventMapping` / `EventSourceShape` / `TransformEventFn` / `FieldValue` 三态 `{path,default}|{const}|{template}`）
- 加载期校验：`loader.ts:149-159`（`validateEventMappings`：未知 canonical `to`、坏路径、空 `from`…→ `capabilities.eventStream=false` 降级，仍注册 fail-open）+ 交叉校验 :160-173
- 执行器：`applyEventMappings`（event-mapper.ts:47-92）四级优先级 = **mappings 数组序 → canonical 直发 passthrough（:82）→ transformEvent 逃逸口 → 丢弃+未知遥测**；`wrapGlobalEventStream`（:123-141）仅在插件声明 mappings 时包装（index.ts:1287）
- 路径求值：`path-expr.ts`（`^\$(\.[A-Za-z_]\w*|\[\d+\])*$`，无 eval）
- 辅助：`event-telemetry.ts`（已知集 = 矩阵 keys ∪ dropped ∪ 前缀族）、`event-field-contract.ts`（缺字段静默失效检查）、`POST /api/runtime/dry-event` 试衣间（映射→facet→矩阵→字段契约每跳回显）、conformance S1-S5（routes/conformance.ts）

### 4.2 覆盖矩阵（谁真的走注册接口）

| 事件来源 | 经注册接口？ | 实际翻译层 | 备注 |
|---|---|---|---|
| 外部 runtime 插件原生事件 | ✅ 完整闭环 | event-mapper wrap + 校验 + 遥测 + dry-event | 唯一全权路径 |
| pi 原生会话事件 | ⚠️ 声明复用、执行旁路 | `PI_EVENT_MAPPINGS`（pi-events.ts:12-26，8 条）但执行点在 **PiEventStream 内部** `translatePiEvent`（:67-74）；gateway 侧 wrap 对 pi 是 no-op（事件到达时已信封化，命中 passthrough 短路 event-mapper.ts:55-57） | 注册声明的真实价值只剩加载期校验 + dry-event |
| pi permission/compaction | ❌ 绕过 | `eventStream.push()` 直入（pi-approval-extension.ts:65-99、pi-session.ts:188-200）——extension 直造 canonical 信封 | 设计意图（push 通道给已 canonical 事件用） |
| pi 未知原生事件 | — | `translatePiEvent` **不传 onUnknown** → 静默丢弃无遥测（pi-events.ts:67-74） | 缺口 #6 |
| opencode 原生事件 | ❌ 不经（原生即 canonical，注册无 extras，index.ts:533-541） | 恒等（opencode-adapter.ts:322-326）；边界仅丢 `sync`/三原语 | wrapToolPartAssembly 恒等直通 |
| 三原语（内部类型） | 可映射可校验但不进词汇表/矩阵/广播 | `tool-part-assembler.ts`（part.id=`toolpart_<callID>`；接线 index.ts:1301/1316/1325；历史路径 `session.normalizeMessages` 契约 + pi-message-normalize.ts） | handleOpencodeEvent :1078-1080 防漏底线 |
| gateway 顶层扁平广播 | ❌ 不经 | eventBus 硬编码 if 链（index.ts:3141-3176） | 词汇表在 SDK 但发射侧非注册表 |

### 4.3 opencode Mode A 改写（硬编码执行器）

`session.idle → message.complete`、`session.error → message.error`（index.ts:1212-1225）；矩阵声明 `modeA:'rewrite'` 但执行在 index.ts if 链。`trajectory.event/turn` 为 gateway 合成广播（:1157-1170、:1212-1222）。

## 5. 缺口清单（按实质影响排序）

1. **`goal_node` 是暗契约事件**（2026-10-09 P2 引入）：gateway 广播（driver.ts:169→index.ts:708）、desktop 消费（dispatcher.ts:95），但**不在** SDK union（events.ts:10-31）、**不在** EVENT_FLOW_MATRIX（event-flow-matrix.ts:31-79）、**不在** `assertShellEventCoverage`——与 2026-10-08 补登的 `permission_mode`/`session.diff` 完全同类，三处守卫对它失明。〔已验证〕
2. **矩阵/忽略清单漂移**：`goal_created`/`phase_transition` 的 desktop 列仍为 `'ignore'`（matrix :68/:70 注「15s 轮询」）且仍列于 `IGNORED_AT_SHELL`（session-events.ts:107），但 dispatcher.ts:95 自 P2 起已消费——单表事实源落后于实现。〔已验证〕
3. **`mafw_commands_changed` 断头**：矩阵 :78 注「desktop ChatPane 另行消费补全」不实——desktop 仅忽略清单两处（session-events.ts:110/183）无消费分支，TUI 也只在启动拉一次（app.ts:134）。自定义命令热重载的 SSE 通知两端皆不消费。〔已验证〕
4. **`connected` 问候帧 miss 告警**：gateway 每次建连写 `{type:'connected'}`（index.ts:6347），desktop dispatcher 无分支、不在 SDK union、不在任何放行清单 → 每次（重）连触发 `unhandled SSE event at shell: connected` warn + EventInspector 红 miss 行。良性噪声。〔已验证〕
5. **`question_answered`/`question_cancelled` 死发射**：index.ts:4497/4490 emit 到 eventBus，全仓无订阅者、不广播、不进矩阵/SDK。
6. **pi 未知原生事件静默丢弃无遥测**：`translatePiEvent` 不传 onUnknown（pi-events.ts:67-74）；gateway 侧 wrap 的遥测对 pi 永不触发。
7. **compaction flush start/end 双触发**：index.ts:1174 不区分切面值——pi 一次压缩跑两次 turnCompress flush（压缩前抢救 + 压缩后结算，cron 互斥兜底）。
8. **approval facet 静默失效面**：`permission.asked` 缺 sessionID → 无 approval 切面 → 不自动审批（落 human），生产路径无日志（仅 dry-event/字段契约有 warning）。
9. **automation EventTrigger 与 runtime 事件流完全解耦**（设计事实）：EventTrigger 只挂内部 eventBus，`handleOpencodeEvent` 无任何 emit；且当前零内置 event 规则——整条机制「仅有引擎、无默认消费者」。
10. TUI `KNOWN_EVENTS` 列 `question.asked` 但无分支（connection.ts:23，行为=矩阵 ignore 一致，清单易误导）。

## 6. 建议最小修复集（未实施）

- `goal_node` 补登 SDK `FLAT_EVENT_TYPES` + 矩阵新行 + `assertShellEventCoverage`；同时把 `goal_created`/`phase_transition` 矩阵 desktop 列改 handled、移出 `IGNORED_AT_SHELL`
- dispatcher 对 `connected` 加早退分支（或登记 SDK + 内联消费做 conn 状态信号）
- `mafw_commands_changed`：desktop ChatPane 命令列表接 signal 刷新，或删矩阵注并降级为「广播-only」
- `translatePiEvent` 注入 onUnknown → 复用 UnknownEventTracker（source='pi'）
- `question_answered`/`question_cancelled` 删除或接消费方（desktop 提问 overlay 即时消解）
