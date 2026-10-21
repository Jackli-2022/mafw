# Runtime Canonical v3 设计——gateway 与底层 SDK 彻底解耦

- 日期：2026-10-21
- 状态：v2——builder check 完成（6 项决议已并入，见 §7），待用户批准后进入 plan
- 上游输入：`2026-10-21-runtime-canonical-v3-mapping-audit.md`（v2，双子代理审查已并入）——全量映射表与审计发现 F1-F12/N1-N12 的唯一事实源，本文不重复其表格内容，只引用编号
- 关联既有 spec：2026-10-08 runtime-neutral-agent-identity、2026-10-08 event-mapping-registration、2026-10-12 native-event-vocabulary、2026-10-12 tool-part-compat（gateway 侧 assembler=方案 B）、2026-10-15 runtime-tool-registration-contract

## 0. 意图与为什么

**现状**：runtime/ 缝隙已存在且经 pi 验证（contract.ts 能力位契约、loader 热切换、default-deny 声明式事件翻译、gateway 侧 assembler、host-adapter 认知面四动词）。但三处未完成：①规范 DTO 是 opencode v1 风味（`{info, parts[]}`）且核心代码直引 opencode SDK 语义；②词汇缺 `turn.started`（三家平台原生有此信号）；③opencode 耦合散落核心（/api/opencode-config、SQLite 直读、auth.json、skills/agent 目录直写、双发家族未按方言拆分）。

**目标画面**：gateway 核心对底层 SDK **零知识**。接入 opencode/pi/claude/codex/dsh（dsh = DeepSeek Harness，已确认）中的任何一家 = **零 gateway 核心改动，只交付一个 runtime plugin 文件**，conformance 门禁全绿。

**决策记录**（谁定的）：
- 方案 A + v2同构（形状兼容中立类型，canonical 为 flat `{role, content[]}`）——用户
- 分段实现——用户
- opencode 拆 @v1/@v2 两方言——用户
- **opencode adapter v1/v2 双兼容自适应（探测选表、fail-safe 回 @v1、config 可钉死）——用户（2026-10-21，覆盖 §7③ 原 @v1 默认 call）**
- 词汇仅 +`turn.started`、内部直接切 flat + egress shim、claude 为首个新 adapter——调研与审查支撑，agent 的 call（标注为可否决）

## 1. 目标 / 非目标 / 反目标

**目标**
- G1 canonical v3：flat DTO + 词汇 24 事件（+turn.started）+ tool.delta 语义扩展（kind: input|output，代码已有立足 tool-part-assembler.ts:17）
- G2 `platform@dialect` 寻址：loader/config/switch/探测
- G3 映射表：**四方言代码落地**（opencode@v1 刷新、opencode@v2 新建、pi 修复重映、claude 最小验收）+ codex/dsh 定稿 spec 表（audit doc，Phase 2 实现）
- G4 内部 canonical 切 flat + egress shim 单点转换（desktop/session-ui/gateway-sdk 零改动）
- G5 核心清洗 + 依赖边界（runtime/ 之外零 SDK import）
- G6 conformance 门禁：SDK 词表快照 + 方言套件 + file-plugin CLI 入口
- G7 pi 修复：F1（终态误分类）、F8（agent_start 重映）、N1（live 工具流桥接）、N2（角色误标）

**非目标（本期不做）**
- 桌面/session-ui/gateway-sdk 的 wire 改动（Phase 2 拆 shim 时做）
- opencode/pi demote 为 package plugin（本期只做依赖边界；demote 随 Phase 2 评估）
- claude/codex/dsh 完整 adapter（各为独立工作项；claude 以**最小验收形态**随本期，见 §4）
- 子代理树 canonical 词汇、revert.* canonical（F6 已定 drop/延期）
- 新增 RuntimeCapabilities 能力位（方言差异用元数据与文档表达，不加位）

**反目标（做了即失败）**
- wire 变更逃逸 egress shim 导致桌面回归
- 公开词汇膨胀（turn.started 之外的任何新词）
- 映射表手工枚举漂移（无快照基线）
- 双发双计（同一语义事件经两族映射两次到达消费者）
- 修改 hook/工具实现文件的行为语义（本期是搬运与适配，不是重写）

## 2. 约束

- C1 default-deny 翻译机制不变（10-12 spec）：一切映射走声明表（eventMappings/transformEvent），无直通旁路
- C2 合帧在 gateway 侧 assembler（10-12 spec 方案 B）：`applyCall/applyDelta/applyResult`，插件零状态
- C3 词汇 5 点 guard chain（vocabulary-sync 强制）：gateway-sdk `RUNTIME_EVENT_TYPES` → `mafw-vocabulary.ts` → `EVENT_FLOW_MATRIX` 行 → desktop `assertShellEventCoverage` → TUI `KNOWN_EVENTS`
- C4 回归底线：gateway 现有 317 测试文件全绿；desktop 输出与现状快照一致
- C5 desktop 消费 `{info, parts[]}`：egress shim 是唯一转换点
- C6 opencode serve 2.1.0 对 legacy + next + sync 双发（event-flow-matrix.ts:90-98 已证）

## 3. 设计

### 3.1 canonical v3 模型

**词汇**：23 → 24 runtime 事件，仅 +`turn.started`。`tool.delta` 语义扩为"工具输入或输出增量流"（吸收 opencode@v2 `tool.input.*`、Claude `input_json_delta`）——非新词。5 点 guard chain 一次联动（C3）。

**DTO（v2同构，字段完备版——决议见 §7①）**：
```ts
interface MafwMessage { id?: string; role: 'user' | 'assistant'; content: MafwPart[] }

/** 身份字段是承重的：桌面按 part.id upsert（chat-reducers），assembler 以 id 做 live/历史去重 */
interface MafwPartBase { id: string; sessionID?: string; messageID?: string }

type MafwPart =
  | MafwPartBase & { type: 'text'; text: string }
  | MafwPartBase & { type: 'reasoning'; text: string }
  | MafwPartBase & { type: 'tool'; callID: string; tool: string;
      state: 'pending' | 'running' | 'completed' | 'error';
      input?: unknown; raw?: string; output?: string; error?: string;
      title?: string; metadata?: Record<string, unknown>; time?: { start?: number; end?: number } }
  | MafwPartBase & { type: 'file'; mime: string; url: string; filename?: string }
      // image 无独立变体：image/* mime 的 file（对齐 opencode FilePart 现实；Claude image 块翻译为 file+mime）
  | MafwPartBase & { type: 'step-start' }
  | MafwPartBase & { type: 'step-finish'; reason?: string;
      cost?: Record<string, unknown>; tokens?: Record<string, unknown> }
      // cost/tokens 保留：trajectory/collector 读取，是 usage 统计与 BudgetGuard 成本的主干
  | MafwPartBase & { type: string; [k: string]: unknown }
      // 透传变体：subtask/snapshot/patch/agent/retry/compaction 等——egress 原样保留
      //（session-ui 今日渲染 compaction/agent part，字段丢失即桌面回归）
```
类型归属：gateway 定义并持有（`runtime/` 下新模块，命名留给 builder）。opencode 历史端点是唯一需要 `{info,parts}`↔flat 翻译的平台（一层转换，在 opencode adapter 内）。

### 3.2 platform@dialect 寻址

- 注册键：`opencode@v1` / `opencode@v2` / `pi`（单方言平台无后缀）
- config：`"runtime": "opencode@v2"`；裸 `opencode` = 运行时探测后落到可用方言（探测信号留给 builder，原则：事件流可见性探测优先，config 显式指定覆盖探测）
- `POST /api/runtime/switch` 与 `GET /api/runtime` 接受/回报方言限定名；兼容：现有 config 值 `opencode` 继续工作（探测不可靠时默认 @v1）
- loader：`registerBuiltin('opencode@v1', …)` / `registerBuiltin('opencode@v2', …)` 共享同一 RuntimeClient 实现（serve 管理、adapter 复用），仅 eventSource/eventMappings 不同——方言是**映射表维度**，不是进程维度
- **默认方言与验收范围（用户裁决，替代 §7③ 原 @v1 默认 call）**：opencode adapter 做 **v1/v2 双兼容自适应**——裸 `opencode` 在激活时探测 serve 能力：v2 面可用（next 族事件可见 / serve 版本信号 / 新端点可用，探测信号实现留给 builder）→ 激活 @v2 表；否则（旧 serve）→ @v1 表。**探测失败方向恒为 @v1**（legacy 族在任何 serve 上都发，fail-safe）。config 显式钉死（`"runtime": "opencode@v1"` / `"opencode@v2"`）覆盖探测；误判逃生 = 钉死 + runtime reload。方言内互斥消费不变（▲ 防双计）；@v2 表本身即混合消费（next 族 + 非 next 的 legacy identity）——对 2.x serve 的"v1v2 兼容"由表内分工实现，对旧 serve 的兼容由自适应回落实现。
- **@v2 工具合帧 id 对齐要求（自适应引入的新不变量）**：@v2 下 assembler 合帧的工具 part id 必须与历史端点的 part.id 一致——优先取 next 族事件携带的 partID/callID 对齐；事件不携带可对齐 id 时，adapter 在历史翻译（`{info,parts}`↔flat）中统一 id 方案为 `toolpart_<callID>`。否则 live/历史按 part.id 去重断裂（桌面先渲染 live 卡再加载历史会重复）。

### 3.3 六方言映射表

完整 from→to 语义见 audit doc §2 表；本节定实现要点与机制选型。

**范围澄清（决议见 §7②）**：Phase 1 落地为**代码 + fixtures** 的是四方言——@v1 刷新、@v2 新建、pi 修复重映、claude 最小验收 adapter。codex/dsh 保持 audit doc §2 的**定稿 spec 表**（事件名与语义已定；完整载荷 schema 在 Phase 2 adapter 实现时从平台源码采集）；F2 的 BudgetGuard turn 计数模式声明与 N8 的 callId join 属 codex/dsh adapter 实现项，随 Phase 2。

**opencode@v1（刷新）**：现有表保留 8 条改名行 + identity；修正 N3 过时 drop 行（`session.next.tool.started/updated/ended` 不存在于 SDK 1.18.21——按快照重生成）；防御行（message.error/message.aborted/message.part.complete）保留并注释标注。`turn.started` 合成**不在 Phase 1**（决议见 §7⑥：无消费方，默认方言上做有状态合成徒增风险，待出现消费方再议）。

**opencode@v2（新建，混合消费表）**：
- next 族为主：`session.next.prompted→turn.started`、`tool.called/success/failed→tool.call/tool.result`、`tool.input.delta→tool.delta(kind:input)`、`tool.progress→tool.delta(kind:output)`、`text.delta/reasoning.delta→part.delta`、`compaction.started/ended→session.compacting/compacted`、`permission.v2.*/question.v2.*→permission.*/question.*`
- 非 next 的 legacy 继续消费（next 族不覆盖）：`session.created/deleted/updated`、`message.updated`、`todo.updated`、`session.diff`、`session.idle`（next 族无回合终态，idle 仍是唯一 turn.completed 源）
- 重叠 legacy 显式 drop：`message.part.*`、`permission.asked/replied`、`question.*`、`session.compacted`（▲ 防双计）
- `session.error` 按 8 成员 error union 判别 turn.failed/turn.aborted（N5）
- 孤儿族处置按 audit F6

**pi（修复重映）**：
- `agent_start→turn.started`（F8 裁决），撤 per-turn session.updated 壳
- `message_end` 角色修复：`info.role` 从 `$.role` 取值，非 const assistant（N2）
- 终态分类（F1）：按最后消息 stopReason——error→turn.failed、aborted→turn.aborted、else turn.completed。实现位置（扩展内发 canonical 事件 vs transformEvent 有状态分类）留给 builder，机制二选一均可
- **live 工具流桥接（N1）**：`tool_execution_start/update/end`（live 真流事件）→ `tool.call/tool.delta/tool.result` 三原语；现有 `tool_call/tool_result` 映射行退役（extension 钩子事件，live 不可达）
- `message_update` 维持 `part.updated` 输出（facet 双路径兼容），可选加 part.delta 直映

**claude（首个新 adapter，最小验收形态）**：
- 面：`@anthropic-ai/claude-agent-sdk`（SDK spawn，进程模型留给 builder 但建议 SDK）
- `result` 子型→三终态（success→completed；error_*×4→failed；terminal_reason aborted_*→aborted）+ `result.usage→usage.updated`（F3 原生优先）
- `stream_event` 分派：text_delta→part.delta(text)、thinking_delta→part.delta(reasoning)、input_json_delta→tool.delta(kind:input)
- assistant 消息拆分：transformEvent 一进多出（message.updated + 每 tool_use 块一个 tool.call）；user 消息的 tool_result 块→tool.result
- `system/init→session.created`、首条 user 回显→turn.started 合成、`status(compacting)/compact_boundary→session.compacting/compacted`
- 认知面与审批（canUseTool/PermissionRequest/AskUserQuestion 合成、Elicitation 双路）为 Phase 2 完整版内容，最小形态只做事件+会话+工具注册

**codex（草案定稿，面 = app-server v2 JSON-RPC，N10）**：
- `thread/started→session.created`、`turn/started→turn.started`、`turn/completed→turn.completed(+usage)`、`error 通知→turn.failed`（v2 无 turn/failed，N3）、`turn/interrupt→turn.aborted`
- item 族→快照直通：`item/started(agentMessage)→message.updated/part.updated`、`item/*/delta→part.delta`、`item/started(commandExecution/fileChange/mcpToolCall)→part.updated(tool, state:inProgress)`、`item/completed→part.updated(tool, 终态)`
- `thread/compacted→session.compacted`（优于 ContextCompaction item）、`thread/tokenUsage/updated→usage.updated`、`turn/plan/updated→plan.updated`、`thread/deleted→session.deleted`、`turn/diff/updated→session.diff`
- 审批：`item/*/requestApproval→permission.asked`；回复 `accept/acceptForSession/decline/cancel→once/always/reject(+中止)`（v2 词汇，审查修正）
- BudgetGuard 降级：无 step 边界（F2）→ 方言元数据声明 turn 计数模式
- npm `@openai/codex-sdk` 不可用（旧 exec-JSONL 面）

**dsh（草案定稿，面 = SDK stdio JSON-RPC，钉 master 提交，N11）**：
- `turn/start→turn.started`；`turn/end` 按 TurnEndReason 判别三终态（N7：completed | aborted{cause} | blocked | error | max-tokens | interrupted）
- `step/start/end→part.updated(step-start/step-finish)`——dsh step 是原生 model-cycle 边界（N6），BudgetGuard **不降级**
- `user/message·assistant/message→message.updated`、`agent/assistant-stream→part.delta`、`tool/call·tool/result→tool.call/tool.result`（原语组）
- 审批：`approval/asked→permission.asked`（载荷按 callId join tool/call，N8）、`approval/decided→permission.replied`（allowed-once→once、rejected/cancelled→reject）、`approval/policy→permission_mode`；**'always' 降级为逐次询问**（F4，dsh 无 always）
- `session.status→session.updated`；`assistant/attempt`/`system/message`/`subagent.*` drop

**drop 行维护策略**：所有方言的 drop 行由 SDK 词表快照测试（§3.7）生成或校验，禁止手工枚举维护（防 N3 类漂移）。

### 3.4 内部 flat 切换 + egress shim

- **内部**：assembler 输出 flat tool part；canonical-facets 路径改 flat 读法（具体路径映射以 audit §2 表为准，builder 落地）；`normalizeMessages` 目标 flat；`message.updated` 载荷带 `{message: MafwMessage}`
- **egress shim**：单点模块（位置/命名留给 builder），挂两处出口——SSE broadcast 前、历史 serving 前——flat→`{info, parts[]}`
- **规则**：egress 是唯一 `{info,parts}` 产地；runtime/ 与核心消费方一律 flat；shim 有快照测试锁定输出与现状一致（C4/C5）

### 3.5 契约修订（对既有 spec 的显式修订）

- `normalizeMessages?(raw): MafwMessage[]`（签名变更，contract.ts）
- **F3 usage 所有权**（修订 10-12 spec 的"gateway 合成"定义）：adapter 原生优先；gateway 仅在 turn.completed 后未见 `usage.updated` 时兜底合成；去重检查为新增逻辑
- **F4 'always' 语义**：契约注释定义 'always' = "runtime 尽力持久，范围由 runtime 决定"；dsh 方言降级逐次；桌面文案不得承诺"永久"
- 能力位零新增（§1 非目标）

### 3.6 核心清洗

| 现状 | 处置 |
|---|---|
| `/api/opencode-config` 路由 | → `/api/runtime-config`（旧路由兼容别名，保留两个 minor 后移除） |
| `MAFW_OPENCODE_PASSWORD` | → `MAFW_RUNTIME_PASSWORD`（读旧 env 兜底一个版本） |
| auth.json 直读（runtime/auth.ts，8 个核心消费方：index.ts、media/pi-adapter、media/tts-service、memory/embedding-provider、usage/media/package plugin ctx、completion-http） | auth.ts 迁入 opencode adapter 侧；**全部核心消费方改走 contract `credentials` 动词**（active runtime 的实现，缺省 fail-open null）；pi 对 auth.json 的直读收编为 pi adapter 自己的 credentials 实现（adapter 可持平台凭据源知识，核心不可）；runtime-neutral 的 completion-http 改为注入式凭据（决议见 §7⑤） |
| `listSessionsFromDb` SQLite 直读 | 挪进 opencode-runtime 内部（`listByDirectory` 契约不变） |
| `~/.config/opencode/skills|agent/` 直写 | 挪进 `agents.install` 实现（identity-registry 物化已有此设计） |
| `handleOpencodeEvent` 等命名 | 去 opencode 化（handleRuntimeEvent 等） |
| 依赖边界 | runtime/ 之外禁止 import `@opencode-ai/sdk` 与 `@earendil-works/pi-coding-agent`（ESLint 规则或测试守卫，builder 选型）；gateway package.json 依赖加注释分区，demote 留 Phase 2 |

### 3.7 conformance 门禁

1. **SDK 词表快照测试**：基线 = `@opencode-ai/sdk@1.18.21` v2 union 89 成员（types.gen.d.ts:4 锁定）；drop 行与防御行由它校验
2. **方言套件**：每方言一份 eventMappings 测试（fixtures 原生事件 → canonical 断言），沿用 tests/unit/runtime/ 现有模式（event-field-contract/normalize-oracle）
3. **file-plugin CLI 入口**：复用 `/api/runtime/conformance` 对 `~/.mafw/runtime-plugins/*.js` 可跑
4. **新 adapter 验收式**：conformance 全绿 + `git diff gateway/src` 为空（零核心改动）

### 3.8 pi 修复（随本期，G7）

F1 终态分类、F8 agent_start 重映、N1 tool_execution 桥接、N2 角色修复（N4 空消息症状随 F1 消失）。pi 是 live 流回归的主要受影响方——修复即回归验证载体。

## 4. 分期

**Phase 1（本设计范围）**：§3 全部 + **claude 最小验收 adapter**（事件流 + 映射表 + 会话 + 工具注册，file plugin 形态交付，用于证明"零核心改动"验收线；认知面/审批/hooks 后置）。

**claude 最小 adapter 打包（决议见 §7④）**：源码在仓库 `adapters/claude/`（与 gateway/、packages/ 平级的新目录）；esbuild 打包为单文件 CJS（`@anthropic-ai/claude-agent-sdk` 随插件打包；**claude CLI 与登录是环境前置**——SDK spawn CLI，二进制不可打包）；产物经安装/复制步骤落 `~/.mafw/runtime-plugins/claude.js`；验收 = **fixture 级映射 conformance 全绿**（确定性）；live 回合冒烟为可选项（环境有 claude 凭据时跑，无则跳过不阻塞验收）。

验收：
- conformance 与现有 317 测试文件全绿
- egress shim 快照：desktop SSE/历史输出与现状一致
- `+turn.started` 5 点 guard chain 绿
- claude adapter 落地为 file plugin 且 `git diff gateway/src` 为空
- @v2 方言下双发零双计（快照测试锁定）

**Phase 2**：拆 egress shim，desktop/session-ui/gateway-sdk 切 flat（版本化 wire 协商）；opencode@v2 历史端点实测（新扁平端点可用则近恒等）；codex/dsh adapter 完整实现；opencode/pi demote 评估。Phase 2 内 wire flip 与新 adapter 可并行（adapter 不依赖 flip）。

## 5. 留给 builder 的决定

- MafwMessage/MafwPart 模块位置与命名；egress shim 模块位置与命名
- facet 路径的 flat 具体写法（以 audit §2 表为准）
- 边界 lint 选型（ESLint 规则 vs 测试守卫）
- @v2 探测信号的具体实现
- pi 终态分类的实现位置（扩展发 canonical vs transformEvent 有状态分类）
- claude adapter 进程模型（建议 SDK spawn）
- 测试拆分与 TDD 顺序（用户偏好 TDD 先行）

## 6. 验收线（重述）

1. 新增 SDK = 零 gateway 核心改动 + 一个 plugin 文件 + conformance 绿
2. 公开词汇 24 事件，guard chain 5 点绿
3. 双发零双计（@v2 方言快照锁定）
4. desktop 兼容双验收：**@v1**（钉住 / 旧 serve 自适应回落）byte-identical 快照；**@v2**（2.x serve 自适应选中）语义等价断言（渲染端到端 fixtures：工具卡渲染 / 回合终态 / usage 记账）+ live/历史 part.id 一致性测试
5. pi：引擎错误正确到达 turn.failed（F1 回归测试）

## 7. builder check 决议记录（2026-10-21）

builder check 提出 6 项计划前必须回答的问题，处置如下（①③由项目自身验收线决定，②④⑤⑥为 agent 的 call，可否决）：

1. **MafwPart 字段完备性** → 字段完备（§3.1 已更新）：identity 字段（id/sessionID/messageID——桌面按 part.id upsert、assembler 以 id 做 live/历史去重，缺失即断）、step-finish 带 cost/tokens（trajectory/BudgetGuard 主干）、tool 带 pending 态 + raw/title/metadata、**透传变体**兜住 subtask/snapshot/patch/agent/retry/compaction 等（session-ui 今日渲染 compaction/agent）、**无独立 image 变体**（image = image/* mime 的 file，对齐 opencode FilePart 现实）
2. **codex/dsh 的 Phase 1 产物** → spec 定稿表（audit doc §2），非代码；四方言才进代码+fixtures；F2 turn 计数与 N8 join 随 Phase 2 adapter
3. **裸 `opencode` 默认方言** → ~~Phase 1 恒 @v1~~ **用户裁决（2026-10-21）：v1/v2 双兼容自适应**——激活时探测 serve 能力选表（v2 面可用 → @v2；否则/探测失败 → @v1 fail-safe），config 可钉死；验收双轨：@v1 byte-identical / @v2 语义等价 + 工具合帧 id 对齐（§3.2）
4. **claude 插件打包** → 仓库 `adapters/claude/` + esbuild 单文件 CJS + claude CLI/登录为环境前置；验收 = fixture 级 conformance，live 冒烟可选不阻塞
5. **auth.json 清洗范围** → 8 个核心消费方全量切 contract `credentials` 动词（fail-open null 兜底）；pi 直读收编进 pi adapter 的 credentials 实现；completion-http 注入式
6. **@v1 turn.started 合成** → 不做（无消费方；默认方言上的有状态合成徒增风险，待消费方出现再议）

builder 旁证：安装的 SDK 已是 1.18.30，v2 union 仍为 89 成员——快照基线跨小版本稳健。
