# 自研事件词汇 + 全 runtime 强制翻译（B 档重构调研）

日期：2026-10-12 · 深度档位：**B（词汇 + 语义修正，载荷不动）**——用户已确认 · 方法：三路并行勘察（opencode 渗透面 / 翻译基建承载力 / 迁移爆炸半径）+ 关键结论人工验证（`message.complete` 发射点 grep、v4.20.0 spec 决策表原文核对）

前置基线：`docs/research/2026-10-12-runtime-event-consumption-survey.md`（事件消费面全景与缺口清单）。

---

## 0. 问题与结论速览

**问题**：不再沿用 opencode 的事件词汇，自研一套 MAFW 词汇；所有 runtime（含 opencode）强制经翻译层。**驱动目标是多平台 runtime 兼容**——MAFW 既要接 opencode/pi（现役），也要接 **claude / codex / kimi / dsh**（既定路线图，见 `2026-10-08-runtime-neutral-agent-identity-design.md:9`「即将接入 claude、codex、pi、dsh、kimi、zcode」）；自研词汇 + 通用翻译层就是这六个平台的**公共兼容基底**（与 ToolPartAssembler 是工具模型的接入面对应，本重构是事件面的接入面）。

**结论**：可行且值得做，且**当前正是 spec 预留的重评时机**（2026-10-08 event-mapping spec 决策表明确留门「v2 迁移时再评估」；同日 tool-part-compat spec :17 也把「词汇表中立化」显式搁置待评审——本调研即该评审）。B 档工程量有界：**~37 个生产文件 / ~480 处类型串 + ~640 处测试断言**，三层守卫链把其中大半变成编译器引导的机械改动。关键成本减免：**turn 生命周期统一不需要状态机**——六个平台的回合终态信号全部可 1:1 映射（opencode `session.idle`、pi `agent_end`、codex `turn.completed/failed`、claude `result`、kimi `turn.ended`/stopReason、ACP 响应），翻译基建最难的「有状态流变换」项（transformStream）B 档完全不需要。**v2 词汇经六平台事件模型交叉验证为语义超集**（§3.4），多平台目标不增加任何新的基建阻塞项。

---

## 1. 历史决策与反转论证

### 1.1 当初为什么沿用 opencode 形状（spec `2026-10-08-event-mapping-registration-design.md:23`）

| 决策 | 结论 | 否决理由 |
|---|---|---|
| canonical 词汇表 | 沿用 opencode 形状（25+13 不动） | 重设中立词汇：**客户端冻结面全动，工程量大一个数量级；v2 迁移时再评估** |

佐证：ACP 反面教训（Kimi 自家 Server API 远比 ACP 面丰富 → 中立词汇=最小公分母）。

### 1.2 今天为什么值得反转（逐条对冲）

| 当时的理由 | 今天的变化 |
|---|---|
| 「客户端冻结面全动」 | 冻结面仍在，但**三层守卫链**（SDK union ↔ 矩阵测试 ↔ desktop `assertShellEventCoverage` 编译穷尽）已把它变成编译器逐点指路的机械改动——守卫链是 2026-10-18 `event-wiring-guardrails` 之后建成的，spec 拍板时不存在 |
| 「工程量大一个数量级」 | 那是把词汇与载荷捆在一起估的。拆开：B 档（词汇+语义）≈ 37 生产文件；C 档（+载荷归一）才再翻 ~2.5 倍且重灾区在 session-ui fork 与渲染层。**B 档有界、C 档仍不值** |
| ACP 教训（中立=最小公分母） | 不适用于自研：LCD 是「借用外部中立标准」的问题；自有词汇信息量由我们控制——不低于 opencode（等同）、富于 pi |
| —（当时不存在的新动因） | ① **`sync` 双发定时炸弹**：opencode v2 事件溯源信封与 legacy 双发，矩阵注释已预留「opencode 移除 legacy 双发之日必须翻译 syncEvent」——被动等炸弹不如主动持有词汇；② 语义债累积：Mode A 改写 hack（`session.idle`→`message.complete`，index.ts:1212-1225 硬编码 if 链）、`message.complete` 混血事件（gateway 内唯一发射点就是这次改写，已 grep 验证）、`goal_node` 暗契约（三守卫失明）；③ pi 本来就在伪装 opencode part 词汇（`pi-events.ts:14-24` const `'step-start'`/`'step-finish'`——pi 原生无 part 模型）——「别家 runtime 的适配成本」是既成事实，自研只是把伪装目标从「opencode 形状」换成「MAFW 契约」，pi 成本零增加 |
| — | spec 自己留的门（:23「v2 迁移时再评估」+ :201 YAGNI 节「canonical 词汇表中立化（并入将来 v2 迁移立项）」）——本次调研即该立项的工料表 |

### 1.3 不拆的资产

2026-10-12 tool-part-compat 刚固化的 ToolPartAssembler / pi-message-normalize / normalize-messages（「join 成 opencode 形状」的 gateway 组件）**不拆**——B 档不动 payload，这些组件泛化为「词汇注入参数」即可（见 §4.2）。Part DTO 轴（`text/tool/reasoning/step-start/step-finish`）**收编为 MAFW 契约**（历史上 opencode 兼容，所有权归 MAFW），session-ui fork 零改动。

---

## 2. 现状关键事实（三路调研摘要）

### 2.1 opencode 渗透面（改名的真实工作量）

- **纯改名（不动载荷）**：gateway ~25 文件/~250 处、desktop 7 文件/~150 处（`session-events.ts` ~95 处为最大单点）、TUI 3 文件/~16 处、SDK 2 文件/~62 处。
- **修正**：`MafwShell.tsx` 与 `chat-reducers.ts` 的类型串**全为注释**（行为代码在 dispatcher/handlers/session-events）；`QuestionWidget.tsx:12` 是第 7 个行为耦合点。
- **gateway 内部消费方分层**（重要——大半已隔离）：按 type 字符串分叉的只有 TrajectoryCollector、canonical-facets、event-field-contract、conformance、tool-part-assembler；**BudgetGuard / applyApprovalPolicy / compaction flush / Mode B / toolCommand 定位全部消费 facet**，词汇替换零感知。
- **两条平行轴**：事件类型串（本重构对象）与 Part DTO 判别子（`part.type` 值，B 档不动）——agent C 明确这是两条轴，别混。
- **`opencode_event` 信封类型串本身是第 41 个词汇成员**（gateway 3 文件 / SDK 2 文件 / 测试 6 文件）。
- **v1 宿主插件在半径外**：`src/plugin.ts:116-124` 吃的是 opencode 宿主原生 `session.next.*`（不经 MAFW SSE），行为不受影响——但这两条类型的词汇表归属需要显式决策（见 §7 D5）。

### 2.2 翻译基建承载力

- **能承载骨架**：`when` 嵌套路径匹配（`$.payload.properties.part.type`）、`fields` 嵌套构造、数组整段透传、数组序优先路由——opencode 信封（`{directory, payload:{type, properties}}`）完全可声明。
- **四个真缺口**（按阻塞度）：
  1. **无字段透传原语**：`fields` 无 spread/copy-all——改名行想保留富载荷必须逐字段枚举，**不改则映射表不可写**（B 档阻塞项）；
  2. **builtin 不 wrap**：`wrapGlobalEventStream` 仅插件分支且声明 mappings 时调用（index.ts:1287）；builtin/direct 分支（:1311-1326）完全不 wrap；opencode 注册不带 extras（:533-541）——「所有 runtime 强制翻译」的字面违反点；
  3. **词汇单源重组**：`CANONICAL_TYPE_SET` 派生自矩阵+丢弃集（自动跟随），但 `RUNTIME_NATIVE_DROPPED` 只有「丢弃」一态，缺「runtime 原生、翻译层消费、绝不透出」中间态；
  4. **transformEvent 不支持状态机**——但 **B 档不需要**（turn 合成是 1:1 映射，见 §3.1）。
- **dry-event 对 builtin 误导 400**：`getPluginEventEntry` 对无 extras 的 builtin 返回 null → 报「unknown plugin 'opencode'」但它明明在列表里（dry-event.ts:64-66）。
- **conformance S1 断言是 opencode 形状**（`CONTENT_TYPES`/`TERMINAL_TYPES`，conformance-scenarios.ts:67-68）——词汇切换时改两个集合常量。
- **零版本协商**：connected 帧无版本字段；SDK EventSource 裸 URL（header 不可用，只能 query）；出口收敛在 broadcast/chatSessions 两处，**服务端桥接可行但零机制**。

### 2.3 守卫链与测试面

- 三层守卫：L1 SDK union（零 import 单源）→ L2 矩阵测试交叉校验（gateway jest 相对路径直读 SDK **源码**）→ L3 desktop 编译穷尽（读 SDK **构建产物**——不对称：SDK 改完须先 rebuild）。
- **TUI 无第三道守卫**（KNOWN_EVENTS 是白名单非穷尽检查，`'*'` 兜底转发）——迁移前必须补一个 KNOWN_EVENTS ↔ SDK 数组交叉测试。
- 测试面：gateway ~35 文件/~450 处、desktop 8 文件/~135 处、TUI 2 文件/~32 处、SDK 3 文件/~25 处（`events.test.ts` 还有 `toBe(25)/toBe(13)` 数量断言）。性质：矩阵/telemetry/mapper/conformance 类**再生成**（改常量即绿）；normalize-oracle/tool-part-assembler/desktop handler 类**手工重写**（oracle 需为新表重立）。
- 文档同步：AGENTS.md ~10 段、`runtime-plugin-authoring/SKILL.md` 31 处、5 份现行 spec/plan；>30 份历史交付记录按「归档不追改」处理。

---

## 3. MAFW 词汇 v2 设计草案（B 档）

### 3.1 核心语义修正：turn 三元组

```
旧（opencode 形状，5 个终态 + 1 个改写 hack）          新（MAFW v2）
─────────────────────────────────────────          ─────────────
session.idle      ─┐ Mode A 改写 → message.complete ┐→ turn.completed
message.complete  ─┘（index.ts:1223 硬编码）          │
session.error     ─┐ Mode A 改写 → message.error    ─→ turn.failed
message.error     ─┘（index.ts:1225）                 │
message.aborted   ─────────────────────────────────→ turn.aborted
```

- **翻译侧 1:1，零状态机**：opencode `session.idle` → `turn.completed`；pi `agent_end`/`agent_settled` → `turn.completed`（现映射到 session.idle，改目标即可）。两个 runtime 都原生供词回合终态信号——agent B 调研的「transformStream 状态机」基建项**整条砍掉**。
- **Mode A 改写 hack 删除**：翻译层直接产 `turn.completed`，broadcast 原样转发（矩阵 `modeA:'passthrough'`）；desktop 的 `session.idle` 防御性兜底分支、TUI 的双分支（chat-store.ts:257-263 同挂两个）、memoryWorker 四类型过滤全部收敛为 turn 三元组。
- **消费方简化**：desktop `TURN_END_TYPES` 5→3、`CHAIN_TYPES` 收敛；goalDriver 双门 `type === 'session.idle' || f.broadcast === 'idle'` → `type === 'turn.completed'`；identityState 解绑、conformance TERMINAL_TYPES 同步收敛。
- 边界澄清：`turn.completed` = 回合终态（≈ session.idle 语义）；per-message 完成仍是 `message.updated` 的 `time.completed` 载荷字段（Part DTO 轴，不动）。

### 3.2 词汇表 v2（改名映射）

**设计原则 D1：所有权 ≠ 全量改名**。词汇表成员资格、facet 规则、矩阵、守卫、文档全部归 MAFW 所有并显式登记；**改名只发生在语义修正点**，语义已中立的名词收编（同名，但契约是我们的）。opencode 翻译表仍**全量声明**（每个词一行映射，含恒等行）——恒等行同样过加载期校验 + dry-event，「所有 runtime 接入翻译」在架构上无特例。

| 旧词 | 新词 | 性质 |
|---|---|---|
| `session.created/updated/deleted` | 同名 | 收编（名字本就中立） |
| `session.idle` | `turn.completed` | **语义修正**（回合终态一等公民） |
| `message.complete` | `turn.completed` | 合并（混血事件消亡，Mode A 改写删除） |
| `message.error` + `session.error` | `turn.failed` | 合并 |
| `message.aborted` | `turn.aborted` | 改名 |
| `message.updated` | 同名 | 收编 |
| `message.part.updated/delta/complete` | `part.updated/delta/complete` | 去冗余前缀 |
| `session.compacting/compacted` | 同名 | 收编（双 runtime 已供词） |
| `question.asked/replied/rejected` | 同名 | 收编 |
| `permission.asked/replied` | 同名 | 收编（facet 层已有双形状对齐） |
| `todo.updated` / `session.diff` / `permission_mode` | 同名 | 收编（能力位事件） |
| `trajectory.event/turn` | 同名 | 收编（gateway 合成） |
| `session.next.step.ended` | **除名** | opencode <1.18 legacy；step facet 另有两载体 |
| `session.next.reasoning.ended` / `session.next.tool.failed` | **除名** | 唯一消费者是 v1 宿主插件（半径外）；gateway 边界丢弃 |
| `sync` | 边界丢弃（维持现状） | 预留：opencode 移除 legacy 双发时翻译 syncEvent |
| 信封 `opencode_event` | **`mafw_event`** | 所有权信号（D2） |
| 扁平族（goal_node/goal_created/phase_transition/…） | 同名 + **补登三守卫** | `goal_node` 进 SDK union/矩阵/穷尽 switch；eventBus if 链 → 发射注册表 |

- 除名词进 `RUNTIME_NATIVE_*` **三态**：`dropped`（sync——丢弃）/ `consumed`（session.next.*——runtime 原生、翻译层消费、绝不透出）/ canonical（词汇表）。
- 顺手处置基线缺口：`connected` 问候帧补登词汇 + dispatcher 消费分支（兼修 miss 告警）；`question_answered/question_cancelled` 死发射删除。

**跨平台增量词汇**（10-08 四平台调研 §5.3 缺口清单，多平台目标使其从「另行评审」变为本轮范围；全部是**新增**词，无旧词迁移成本）：

| 增量词 | 六平台证据 | 说明 |
|---|---|---|
| `usage.updated` | ACP `usage_update`、codex `thread/tokenUsage/updated`、kimi turn.ended 载荷、claude result usage 汇总 | 现状 usage 内嵌 message.updated；独立事件后 desktop UsagePill 的 60s 轮询可事件化（轮询保留兜底） |
| `plan.updated` | ACP `plan`、codex `turn/plan/updated`+`todo_list` item | opencode `todo.updated` 映射到此（ACP plan entries 与 codex todo_list 同域）；pi 缺席（能力位门控） |
| `permission.asked` 载荷可选字段 `options[]`（服务端声明决策集）+ `suggestedRule`（服务端起草规则） | codex `availableDecisions[]` + `proposedExecpolicyAmendment`、ACP `options[]`、claude `suggestions` | 纯增量可选字段，opencode 不填不受影响；reply 侧 persist 可直接采纳服务端起草（比客户端推导粒度准，10-08 调研 §5.4） |
| subagent/task 生命周期（`task.*`） | claude task_*、codex SubAgentActivity、kimi TaskStarted hooks | **本轮不做**（desktop/TUI 无 subagent 消费面，YAGNI）——词汇表预留命名空间，capability 位声明 |

### 3.3 边界内不动（B 档冻结面）

- **Part DTO 轴**：`part.type` ∈ {text, tool, reasoning, step-start, step-finish} 与 ToolPart `{input, metadata, tool, output, status}` 状态机——收编为 MAFW 契约，session-ui fork / desktop tool-cards / TUI blocks 零改动。
- **消息两桶模型** `{info, parts}`、SessionInfo/QuestionV1/PermissionV1 DTO 镜像——留 C 档（如果永远不做，就永远是我们兼容 opencode 的既定契约）。
- **v1 宿主插件**：继续吃 opencode 原生 `session.next.*`（宿主内 hook），不受影响。

### 3.4 六平台事件模型兼容验证（v2 = 语义超集）

> 证据源：`2026-10-08-agent-event-models-survey.md`（codex/claude/kimi/ACP 四家实证）、`2026-10-12-tool-call-result-model-compat.md`（工具模型分布）、`2026-10-08-agent-identity-injection-survey.md` + `2026-10-08-node-execution-runtime-survey.md`（dsh 接入面）。

| 平台 | 接入/驱动通道 | 原生回合终态 | delta | approval | 工具模型 | 翻译策略 |
|---|---|---|---|---|---|---|
| **opencode**（现役） | `/global/event` SSE（SDK v2） | `session.idle`/`session.error` | `message.part.delta`（≥1.18） | `permission.asked` 事件 + control request | 融合 ToolPart（唯一原生融合家） | **纯表**：恒等改名 + turn 三元组 + part.* 前缀 + sync/session.next.* 丢弃 |
| **pi**（现役） | 进程内 subscribe | `agent_end`/`agent_settled` | `message_update` 全量快照（映射为 part.updated） | extension 同步直评 → `permission.asked`（push 通道） | 分离 → assembler 合帧 | **表 + push**（现状 PI_EVENT_MAPPINGS 目标词跟随） |
| **claude** | Agent SDK stream-json | `result`（subtype success/error_*，**when 子字段路由**） | `stream_event`（**嵌套二级 type**：Anthropic SSE 藏在 `$.event.type`） | `canUseTool` 入站回调（可被配置短路成 `permission_denied` 纯事件） | 分离（tool_use/tool_result blocks） | **表 + 逃逸口**：嵌套 when 已支持；stream_event 的 index→partId 物化需 transformEvent（或降级快照模式）；回调→事件由 adapter 合成 |
| **codex** | app-server JSON-RPC / exec --json | `turn.completed/failed`（TurnStatus 含 interrupted） | per-part delta 通知（`item/agentMessage/delta` 等，exec 模式**无 delta**） | server→client JSON-RPC **request**（三方法分拆 + `availableDecisions[]` + Guardian 预审） | 分离 ThreadItem → 边界 join | **表 + 构造器逃逸口**（`ExecCommandBegin` 等需解析构造，codex 官方 event_mapping.rs 自认纯表覆盖不了一对一投影之外）；approval request→事件由 adapter 桥接 |
| **kimi** | Server API WS / ACP / hooks | WS：`turn.ended`；**ACP：turn 结束在 `session/prompt` 响应的 `stopReason` 里（非事件！）** | `assistant.delta`/`thinking.delta`（带 offset 累积偏移 + volatile 标记） | WS：`event.approval.requested/resolved`（24h 过期）；ACP：request_permission RPC | WS 分离 / ACP tool_call+update | **表 + 响应投影**：WS 模式干净映射；ACP 模式回合终态从 PromptResultEnvelope 合成 |
| **dsh**（DeepSeek Harness，developer preview） | ACP profile（stdio）/ Python SDK（JSON-RPC）/ 内部 append-only 事件流 | ACP：同 kimi（stopReason 在响应）；内部流待实证 | ACP：`agent_message_chunk` | ACP：request_permission RPC | **分离**（call/result 独立条目 + 嵌套 call tree，可回放） | **表 + 响应投影 + assembler**；观察名单（不可嵌入，但事件面可经 ACP 消费） |

**三条设计结论**：

1. **翻译输入源必须是三类**（10-08 调研 §5.7 的修正在此兑现）：①事件流（主通道，declare mappings）；②**请求-响应投影**——kimi-ACP/dsh-ACP 的回合终态在 prompt 响应里，adapter 从 `PromptResultEnvelope`（finish/usage）合成 `turn.completed` 经 push 通道入流（pi 的 approval/compaction push 就是先例）；③**反向 RPC/回调**——codex/claude/kimi-ACP 的 approval 是请求-响应对，adapter 合成 `permission.asked` 并把 reply 路由回原生响应。①是表驱动，②③是 runtime 插件 adapter 代码（各自立项），gateway 基建零新增。
2. **Tier 0 最小事件契约**（每个 MAFW runtime 必须供词）：session 生命周期（created 起）+ turn 终态（原生事件或响应投影合成）+ 内容快照（message/part updated 至少快照模式）。其余（delta/approval/question/plan/usage/diff/compaction）全部是能力位门控的可选组——快照型 runtime（codex exec）天然降级为 upsert 渲染，与 pi 现状同构。conformance S1 升级为按 Tier 0 校验。
3. **ACP 教训在此框架下失效**：LCD 问题是「借用外部中立标准」的问题；自研词汇 = 我们控制的语义超集（不低于 opencode、富于 pi、可承接 codex/claude 的 plan/usage/options 增量），弱 runtime 用可选字段 + 能力位表达缺失，不削足适履。ACP/kimi-ACP/dsh-ACP 只是又一类翻译目标。

---

## 4. 全 runtime 强制翻译架构

### 4.1 接线收敛（消灭「免翻译特权」）

```
现状                                          目标
────────────────────────────                ────────────────────────────
plugin 分支: wrapMappings(仅声明时) + wrapAssembler    三分支共用同一 wrap 序列：
builtin 分支: 仅 wrapAssembler（恒等）          wrapGlobalEventStream(强制，无声明=校验警告)
direct 兜底:  仅 wrapAssembler                → wrapToolPartAssembly
opencode 注册: 无 extras                      opencode 注册: eventSource + OPENCODE_EVENT_MAPPINGS
```

- opencode 经 `registerBuiltin('opencode', …, { eventSource: {typePath: '$.payload.type', sessionIdPath: '$.payload.properties.sessionID', directoryPath: '$.directory'}, eventMappings: OPENCODE_EVENT_MAPPINGS })` 接入——**与文件插件同一注册接口**（加载期校验 + dry-event 试衣间立即对 opencode 可用，顺手修误导 400）。
- `OPENCODE_EVENT_MAPPINGS` 内容 ≈ §3.2 映射表（恒等行 + turn 三元组 + part.* 改名 + session.next.*/sync → drop）。
- pi：`PI_EVENT_MAPPINGS` 目标词机械跟随（tests 半再生成）；执行点仍在 PiEventStream 内部（双轨保留——收敛是可选项，非本重构阻塞项）；**补 `translatePiEvent` 的 onUnknown 遥测**（修静默丢弃盲区）。
- **claude/codex/kimi/dsh 插件本体不在本轮**（各自立项）：本重构交付的是它们的**接入面**——同一注册接口（表驱动 mappings + 加载期校验 + dry-event）+ §3.4 三类翻译输入源 + ToolPartAssembler 合帧。与 tool-part-compat spec 对插件本体的切分（「本设计是它们的接入面」）一致。runtime-plugin-authoring SKILL.md 同步改写为新词汇契约。

### 4.2 基建改造清单（B 档必须 vs 可后置）

| # | 项 | B 档 | 说明 |
|---|---|---|---|
| 1 | event-mapper **字段透传原语**（`fields` 支持 `{path:'$.payload.properties', all:true}` 类整段拷贝 + 覆写少数字段） | **必须** | 不改则任何改名行丢载荷 |
| 2 | **assembler 词汇注入**（输出事件名/part 形状常量抽为构造参数） | **必须** | 不然 assembler 继续产 `message.part.updated` 旧词 |
| 4 | **强制 wrap 收敛**（三分支共用序列；无声明 = 校验警告） | **必须** | 「所有 runtime 接入翻译」的字面要求 |
| 5 | **词汇单源重组**（词汇表换血 + RUNTIME_NATIVE 三态） | **必须** | 新 `to` 的登记位 |
| 6 | SESSION_ID_TARGETS 可配置 | 顺手 | part.* 注入约定跟词汇走 |
| 7 | dry-event builtin 400 修复 | 顺手 | Phase 0 |
| 8 | pi onUnknown 遥测 | 顺手 | Phase 0 |
| 9 | connected 帧带 `vocab:'v2'` + dispatcher 消费 | 顺手 | 兼修 miss 告警；完整协商机制后置 |
| 3 | transformStream 流级逃逸口 | **不需要** | turn 合成是 1:1 映射 |
| 10 | turn 状态机挂点 | **不需要** | 同上 |

### 4.3 守卫链保持结构、换血内容

SDK `events.ts` 仍是 L1 单源（v2 词汇 + `mafw_event` 信封 + goal_node 补登）；L2 矩阵测试、L3 desktop 穷尽 switch 机械跟随；TUI 补第四道弱守卫（KNOWN_EVENTS ↔ SDK 交叉测试）。发射侧 eventBus if 链（index.ts:3141-3176）收敛为**发射注册表**——顶层广播也过注册接口，呼应「自研一套」的所有权诉求。

---

## 5. 迁移方案（三选一）

| 方案 | 内容 | 评估 |
|---|---|---|
| **一：原子切换（推荐）** | monorepo 单一 release 切换；desktop 捆绑 gateway（模式 A）天然同步；TUI 同仓同发；connected 帧带 vocab 字段 | 前提：**无不受控外部 SSE 消费者**。SDK 虽发布 npm 但 `/api/events` 消费者只有 desktop/TUI（同仓）。半完成状态不可部署 → 全部在分支上原子合入，全量测试门 |
| 二：双词汇过渡 | gateway 双发射 N 个 release，客户端各自迁移 | 矩阵×2、测试×2、发射分叉——为一个理论上的版本偏差窗口付双倍维护；desktop 捆绑 gateway 使本方案的前提（独立升级）基本不存在。不推荐 |
| 三：版本协商 + 服务端反向桥 | connected 帧协商 vocab，broadcast/chatSessions 两出口挂 per-connection 反向翻译 | 工程最大；仅当出现不受控外部消费者才值得（YAGNI 后置） |

推荐一；若未来 npm 包出现第三方 `/api/events` 消费者再升级到三。

---

## 6. 工作量与实施顺序

**总量**：生产 ~37 文件/~480 处类型串 + 测试 ~48 文件/~640 处 + 文档（AGENTS.md ~10 段 / SKILL.md 31 处 / 5 份现行 spec 勘误）。守卫链覆盖处为编译器引导的机械改动；无守卫处（TUI、gateway 发射点、dry-event/conformance 路由）靠 grep + 新增交叉测试。

| Phase | 内容 | 量级 |
|---|---|---|
| **0 前置独立修复** | goal_node 补登三守卫；connected 帧消费（修 miss 告警）；question_answered/cancelled 清理；pi onUnknown 遥测；TUI 交叉守卫测试；dry-event 400 修复 | ~半天，全部独立可先行合入 |
| **1 翻译基建** | #1 透传原语；#4 强制收敛；#2 assembler 词汇注入；#5 三态；#6 | 1-2 天 |
| **2 词汇定义 + gateway 原子切换** | SDK v2 + 矩阵 + facets + field-contract + conformance 集合 + index.ts 分支 + **Mode A 改写删除** + eventBus 注册表化 + OPENCODE/PI 映射表 | 2-3 天（分支上连续提交，全量测试门） |
| **3 消费方** | desktop（先 rebuild SDK 触发编译守卫，逐点接线）→ TUI | 1-2 天 |
| **4 测试与文档** | ~640 测试处 + oracle 重立 + AGENTS.md/SKILL.md/现行 spec | 1-2 天 |

**~1-1.5 周**量级。合入顺序内嵌依赖：Phase 2 是原子核心（词汇表+翻译+gateway 消费必须同 commit 序列），Phase 3 紧随（desktop/TUI 不切则事件全 miss——但 fail-open 不崩，miss 告警刷屏即探测器）。

---

## 7. 风险与开放决策

**风险**：
1. TUI 无守卫（Phase 0 补交叉测试后缓解）；
2. opencode 版本升级破坏映射表——dry-event + conformance S1 作回归门，未知遥测当漏网探测器（这正是强制翻译的收益：风险隔离在翻译层单点）；
3. desktop 守卫读 SDK 构建产物（asymmetric）——流程上先 `npm run build` 再 typecheck；
4. review 负担真实存在（~1100 处 diff）——机械性高，但需按 Phase 分批 review；
5. `sync` 双发若在重构期间被 opencode 移除——翻译层挂点已就位（eventSource 声明 + 三态 `consumed`），补 syncEvent 翻译行即可；
6. dsh 处于 developer preview（事件面经 ACP profile 可消费，但内部 append-only 流未实证——10-08 node-execution 调研官方文档 fetch 空）；claude stream_event 的 index→partId 物化是已知需逃逸口的难点——多平台映射表的正确性靠 dry-event 试衣间 + conformance S1（Tier 0 化）逐平台验证，插件本体各自立项时消化。

**开放决策（需用户拍板）**：
- **D1 所有权策略**：收编为主 + 改名语义修正点（§3.2 推荐，churn 有界） vs 全量改名（未知遥测探测全覆盖，但 ~640 测试处纯 churn）；
- **D2 信封改名** `opencode_event` → `mafw_event`：推荐做（所有权信号，成本低）；
- **D3 `part.*` 前缀去除**：推荐做（消费方本来就要全改）；
- **D4 原子切换确认**：确认无外部 `/api/events` 消费者；
- **D5 `session.next.*` 除名**：确认 v1 插件宿主内消费路径不需要 MAFW 词汇支持（现为唯一消费者且在半径外）；
- **D6 跨平台增量词汇**：`usage.updated` / `plan.updated`（opencode todo.updated 映射入）/ permission 载荷 `options[]`+`suggestedRule` 可选字段——推荐入本轮（纯增量、零迁移成本、直接服务多平台目标；subagent/task.* 留命名空间不做）。

---

## 附：本调研的三路原始报告要点已在正文吸收；如需逐文件明细（文件 × 类型 × 计数表、测试钉扎性质表、文档同步位置清单），见调研会话记录，spec 阶段可要求再生成完整附录。
