# 自研事件词汇 v2（mafw_event）设计 spec

日期：2026-10-12 · 状态：待用户评审 · 前置调研：`docs/research/2026-10-12-native-event-vocabulary-refactor-research.md`（含三路勘察证据与六平台兼容矩阵）· 基线：`docs/research/2026-10-12-runtime-event-consumption-survey.md`

## 1. 目标与非目标

**目标**：MAFW 拥有自己的 canonical 事件词汇（v2），所有 runtime（opencode/pi 现役；claude/codex/kimi/dsh 既定路线图）强制经翻译层产出该词汇——事件面成为多平台 runtime 的公共兼容基底（与 ToolPartAssembler 是工具模型的接入面对应）。

**非目标**：Part DTO 载荷归一（part.type 判别子 / ToolPart 状态机 / `{info, parts}` 消息模型 / DTO 镜像——全部收编为 MAFW 契约，形状不变，session-ui fork 零改动）；claude/codex/kimi/dsh 插件本体（各自立项，本设计交付它们的接入面）；版本协商与服务端反向桥（出现外部 `/api/events` 消费者再加）；subagent/task 词汇（留命名空间）。

## 2. 决策记录（调研 D1-D6，推荐方案，评审可推翻）

| 决策点 | 结论 | 备选（否决理由） |
|---|---|---|
| D1 所有权策略 | **收编为主 + 只改语义修正点**：语义中立名词同名收编，词汇表/facet/矩阵/守卫/文档所有权归 MAFW；opencode 翻译表声明差异行 + 前缀丢弃（同名词经 canonical passthrough 机制通过） | 全量改名（未知遥测探测全覆盖，但 ~640 测试处纯 churn，无语义收益）；翻译表恒等行全列（冗余噪音，passthrough 机制已覆盖） |
| D2 信封名 | `opencode_event` → **`mafw_event`** | 保留旧名（零成本但无所有权信号） |
| D3 part 前缀 | `message.part.*` → **`part.*`**（去冗余前缀） | 保留（消费方本来就要全改） |
| D4 迁移 | **原子切换**（分支上 3 个 commit 序列，PR 级全绿门） | 双词汇过渡（矩阵×2 测试×2，为不存在的独立升级场景付双倍维护）；版本协商（YAGNI） |
| D5 session.next.* | **除名**：六条（step.ended/reasoning.ended/tool.failed + 词汇表外 tool.started/updated/ended）全部在 opencode 翻译表 drop；唯一 MAFW 侧消费者（v1 宿主插件）在宿主进程内吃原生事件，不经 gateway | 保留透传（opencode 词上 wire，违背所有权） |
| D6 增量词汇 | **入本轮**：`usage.updated`、`plan.updated`（todo.updated 映入）、permission.asked 载荷可选 `options[]`/`suggestedRule` | 留待插件立项时（多平台目标是本轮驱动，纯增量零迁移成本） |

## 3. 词汇表 v2

### 3.1 映射总表（旧 → 新）

| 旧（opencode 形状） | 新（MAFW v2） | 性质 |
|---|---|---|
| session.created / session.updated / session.deleted | 同名 | 收编 |
| session.idle | **turn.completed** | 语义修正：回合终态一等公民 |
| session.error + message.error（双发） | **turn.failed** | 合并（双发保留、类型统一，消费方幂等） |
| message.aborted | **turn.aborted** | 改名 |
| message.updated | 同名 | 收编 |
| message.part.updated / .delta / .complete | **part.updated / part.delta / part.complete** | 去前缀 |
| message.complete | （消亡） | gateway 唯一发射点是 Mode A 改写，改写随本设计删除 |
| session.compacting / session.compacted | 同名 | 收编（双 runtime 供词） |
| question.asked / .replied / .rejected | 同名 | 收编 |
| permission.asked / .replied | 同名；asked 载荷新增可选 `options?: string[]`、`suggestedRule?: string` | 收编 + 增量字段（opencode 不填不受影响） |
| todo.updated | **plan.updated** | 改名（ACP plan / codex todo_list 同域） |
| （新增） | **usage.updated** | gateway 在 turn.completed 聚合后合成发射（TrajectoryCollector turn 的 tokens/cost） |
| （新增） | **connected** | SSE 问候帧登记（修 desktop miss 告警） |
| trajectory.event / trajectory.turn、permission_mode、session.diff | 同名 | 收编 |
| session.next.* 六条 | **除名** | 见 D5；step facet 由另两载体承接 |
| sync | 维持边界丢弃（opencode 翻译表同步 drop 行） | 预留：opencode 移除 legacy 双发时补 syncEvent 翻译 |
| 扁平族 13 条 + **goal_node**（补登） | 同名 | goal_node 进 SDK union/矩阵/穷尽守卫 |

计数：`RUNTIME_EVENT_TYPES` 25→**24**，`FLAT_EVENT_TYPES` 13→**14**，信封 `mafw_event`。

### 3.2 facet 规则 v2（canonical-facets.ts 全表重写）

- **`broadcast` facet 字段删除**——Mode A 改写 hack 消亡，广播统一 passthrough（turn.failed 保留 error 字段提取一个小特例）。
- **`toolCommand` 从 normalize.ts 内置特例升为规则行**，载体迁移：旧载体 `session.next.tool.*`（`type.includes('tool')` + `args.command`）随词汇除名；新载体 = `{type:'part.updated', when:[part.type='tool'], toolCommand:'$.part.state.input.command'}`（opencode ToolPart 与 assembler 合成快照都携带，自更新调用者定位行为保持）。
- step 双载体保留（part.updated step-finish / message.updated assistant+completed）；legacy `session.next.step.ended` 载体行删除。
- chatSignal：part.updated delta 双路径 / turn.completed complete / message.updated complete（保旧）/ turn.failed error+chatError；turn.aborted 无 chatSignal（保旧 message.aborted 行为）。

## 4. 架构

### 4.1 翻译输入源三类（六平台验证）

①事件流（声明式 mappings 表驱动）；②请求-响应投影（kimi/dsh 的 ACP 模式回合终态在 prompt 响应——adapter 从 `PromptResultEnvelope` 合成 `turn.completed` 经 push 通道入流，pi 先例）；③反向 RPC/回调（codex/claude/kimi-ACP approval 请求-响应对——adapter 合成 `permission.asked` 并路由 reply）。①是本设计范围；②③属各平台插件本体。

### 4.2 强制翻译接线

三分支（plugin/builtin/direct）收敛为同一 wrap 序列：`wrapGlobalEventStream`（强制；无声明 = 校验警告）→ `wrapToolPartAssembly`。opencode 经 `registerBuiltin` 携 `eventSource`（`$.payload.type` / `$.payload.sessionID` 多路径 / `$.directory`）+ `OPENCODE_EVENT_MAPPINGS` 接入，与文件插件同一注册接口（加载期校验 + dry-event）。映射表只声明**差异行**（改名/合并）+ `transformEvent` 前缀丢弃（`session.next.*` 整族 + `sync`）；同名收编词经 canonical passthrough **机制**通过——机制非特权，任何 runtime 走 gateway 统一 wrap 均适用。

### 4.3 Tier 0 最小事件契约

session 生命周期（created 起）+ turn 终态（原生事件或响应投影合成）+ 内容快照（message/part updated 至少快照模式）。其余（delta/approval/question/plan/usage/diff/compaction）为能力位门控可选组。conformance S1 按 Tier 0 校验（CONTENT_TYPES = message.updated/part.updated/part.delta；TERMINAL_TYPES = turn.completed/turn.failed）。

### 4.4 词汇单源与守卫链

SDK `events.ts` 保持客户端契约单源（零 import）；gateway 新增 `runtime/mafw-vocabulary.ts` 常量模块（gateway 侧表格/分支引用常量而非字面量），与 SDK 数组双向相等交叉测试。三层守卫结构不变：SDK union ↔ 矩阵测试 ↔ desktop `assertShellEventCoverage`；TUI 补第四道弱守卫（KNOWN_EVENTS ⊆ SDK union 交叉测试）。

### 4.5 eventBus 扁平发射注册表化

`setupEventBus` 的 10 类型 if 链收敛为 `{eventBus 类型 → flat 载荷映射}` 注册表；goal_node 直发走同一注册表。特殊消费者（startGoal/goalDriver.advance/milestonePush）保持 eventBus 订阅，不经注册表。

## 5. 迁移（D4 原子切换）

分支上 3 个 commit（每个 commit 自身套件绿；commit A→B 之间 wire 不兼容，仅存在于分支）：
- **A**：SDK 源 + 矩阵 + gateway 全部（facets/field-contract/conformance/index.ts 分支/Mode A 删除/opencode+pi 映射表/vocabulary 模块）+ gateway 测试（gateway jest 直读 SDK 源码，必须同 commit）。
- **B**：desktop（session-events/dispatcher/handlers/QuestionWidget）+ desktop 测试 + SDK rebuild（desktop 守卫读构建产物）。
- **C**：TUI（3 文件 + 测试）。
PR 级全量门：gateway jest + desktop bun test + TUI node --test + root build + 真实会话冒烟（工具卡渲染 / turn 收束 / 审批流）。

## 6. 验收

1. 全仓 grep 无 `opencode_event` 字面量（信封）；`session.idle`/`message.part.*`/`message.complete`/`todo.updated` 无生产代码引用（测试 fixture 除外——fixture 同步换）。
2. `POST /api/runtime/dry-event` 对 `plugin:'opencode'` 可用（试衣间跑通 OPENCODE_EVENT_MAPPINGS）。
3. conformance S1（Tier 0 化）在 opencode 与 pi 双 runtime 通过。
4. desktop EventInspector 无 miss（除显式 ignore 清单）；真实会话：流式渲染、工具卡、回合收束、审批、压缩边界分隔线全通。
5. 自更新调用者定位冒烟：bash 写 pending-restart 令牌 → tokenWriterSession 命中（toolCommand 新载体验证）。
