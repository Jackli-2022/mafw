# OpenMausBot harness 调研：哪些机制值得 MAFW 借鉴

日期：2026-11-09
对象：[milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot)（Apache-2.0，TypeScript，Electron + 本地 harness server）
方法：读 README、`server/contracts.ts`、`server/harness/*`、`server/drivers/*`、`server/turn-*.ts`、`server/auto-approve.ts`、`shared/*` 等源码；未运行其应用。
问题：它的 harness 有哪些设计值得 MAFW 借鉴，哪些不该照搬。

## 结论先说

OpenMausBot 的 harness 不是“又一个 agent 框架”，而是**本地多 agent 进程治理层**：

- 一个 loopback server（`127.0.0.1:8799`）拥有所有 agent CLI 进程（Claude / Codex / Grok / ACP / API）；
- 每个 driver 把一种 CLI 协议翻译成同一套 `RuntimeEvent`；
- 一个 SSE 流给客户端，每个 thread 另写一份 NDJSON 事件日志；
- 权限请求统一进 broker，turn 队列、steer、watchdog、恢复、资源占用都在 harness 内收口。

这套形状和 MAFW 的 **runtime 契约 + canonical event + Experience + approval policy + Goal/Pod** 高度同构。所以**不要照搬架构**；真正有增量的是若干**契约语义**，尤其是：

1. **Turn 安全包**：区分“AI 从未开始这个回合”和“已经开始/已经产生副作用”，再决定能不能重试；重试前检查 outward actions（git commit/push、支付、外发消息）。
2. **Approval 硬化**：`requiresExplicitApproval`（放宽沙箱只能由显式 Full 批准）、outbound guard、`request.resolved.source` 审计、模型/引擎切换时权限档位不静默继承。
3. **Prompt cache 卫生**：system prompt 显式拆 `stable` / `volatile`，driver 的进程/会话只按 stable 半区做 key；volatile 半区走本轮消息。
4. **上下文增量**：`HandedState` + `unseenMessages`，只把“这个原生会话还没见过”的消息补进去；断 resume 时用 bounded replay 的 `recoveryText`，不整段重放。
5. **Turn watchdog 分状态**：等人/等资源不算 stall，工具运行中给更长阈值，机器休眠时间不计入沉默。

如果只做三条，我建议按这个顺序：**Turn 安全包 → Approval 硬化 → Prompt cache/上下文增量**。

---

## 1. 它的 harness 到底长什么样

```text
App (React, 5199)
  │  HTTP commands
  ▼
Harness server (127.0.0.1:8799)
  ├─ ProviderRegistry        config → live instance / shadow（未知 driver 不崩，降级 unavailable）
  ├─ EventBus                adapter events → 归一化 → SSE + 每 thread NDJSON
  ├─ Permission broker       provider 原生 permission/question → 卡片；approval mode 透传
  ├─ Turn pipeline           queue / steer / watchdog / recovery / cache keep-warm
  └─ Integrations            composio / computer / browser / phone / email / data / custom MCP
  │  spawn + protocol
  ▼
Claude CLI / Codex CLI / Grok CLI / ACP agents / API providers
```

关键文件：

| 文件 | 作用 |
|---|---|
| `server/contracts.ts` | 全部 harness 契约：`ProviderAdapter`、`ProviderDriver`、`ProviderInstance`、`SendTurnInput`、`ProviderSnapshot`、`EngineInstall`、错误类型 |
| `server/harness/registry.ts` | driver 注册、实例创建、影子实例、快照读取、安装/认证 |
| `server/harness/bus.ts` | fan-in 事件总线、delta 合并、NDJSON、redaction、磁盘失败告警 |
| `server/harness/live-steps.ts` | 工具调用的 live step、输出尾行、进程静默探测 |
| `server/harness/progress-gate.ts` | `turn.progress` 400ms 合并，只发“屏幕上看得出变化”的帧 |
| `server/turn-watchdog.ts` | stall watchdog：等人/等资源、工具运行、休眠宽限 |
| `server/steer-queue.ts` | busy 时消息排队、合并、持久化、Stop 后仍可续 |
| `server/drivers/retry.ts` | 瞬时/终态错误分类、退避、`mayResendTurn` |
| `server/drivers/engine-errors.ts` | credits / usage limit / rate limit / overloaded / tool schema / tool count 的归类与文案 |
| `server/auto-approve.ts` | Auto/Full 的自动批准边界：outbound、沙箱放宽、own-files、web search、saved command |
| `shared/approval-mode.ts` | ask / edits / auto / full / custom 与模型切换守卫 |
| `server/cache-keepwarm.ts` | 订阅制登录的 prompt cache 保温 ping |
| `server/system-prompt.ts` | system prompt 分段，`VOLATILE_SECTIONS` 显式列出易变段 |
| `server/delta-context.ts` | `HandedState` / `unseenMessages` / `buildTurnContext` |
| `server/context-rebuild.ts` | bounded replay：24KB / 40 条 / 摘要 / 工具行 |
| `server/turn-resources.ts` | 资源 claim、等待位置、EWMA 等待时间 |
| `shared/tool-scope.ts` | `native:` / `mcp:server:name` 的选择器语言与“权限是否变宽”比较 |

注意：它的 `server/index.ts` 约 979KB / 15,631 行，是单文件编排巨兽。**harness 模块本身拆得不错，但编排入口不值得学**；MAFW 的 route catalog + DI 更健康。

---

## 2. 与 MAFW 现状对照

| 能力 | OpenMausBot | MAFW 现状 | 判断 |
|---|---|---|---|
| 进程所有权 | harness spawn CLI，一个 server 拥有全部 | gateway 经 runtime 插件（opencode serve / pi 进程内 / claude adapter） | 同构，不借 |
| 事件归一化 | `RuntimeEvent` 单一 union + `raw` 载荷 | `mafw-vocabulary` + facets + event-mapper | 同构，不借 |
| 能力声明 | `ProviderAdapter.capabilities` 逐项 + 语义注释 | `RuntimeCapabilities` 布尔面 + `RuntimeAccess` | MAFW 更偏“surface 门”，但粒度较粗 |
| 健康/安装/认证 | `ProviderSnapshot` + `EngineInstall` + 状态文件 | Config 现探 runtime，plugin center | **可借** |
| turn 终态 | `turn.completed` / `turn.retrying` / `cap.exhausted` | `turn.completed/failed/aborted` + NodeDriver 双门 | **可借 retry/handoff 语义** |
| 失败分类 | `classifyError` + `engineFailure`（含 tool schema/count） | `failure-class.ts` 按 code/source | **可借分类与文案** |
| steer | `steered / refused / indeterminate` | `delivery: 'steer'` 布尔 + gateway 队列回落 | **可借三值语义** |
| watchdog | 等人/等资源、工具阈值、休眠宽限 | NodeDriver 30min + 90s grace | **可借停等区分** |
| 审批 | provider 原生模式 + explicit/outbound/own-files + source 审计 | 三档 + dangerous regex + identity policy | **可借硬化语义** |
| prompt cache | stable/volatile + keep-warm | instruction entries + “半稳定靠后” | **可借显式分段** |
| 上下文增量 | HandedState + unseen + bounded replay | Pod handoff 全量注入；原生会话交给 runtime | **可借增量协议** |
| live 进度 | live-only、400ms 合并、进程静默探测 | tool cards + SSE part | **可借 live step DTO** |
| MCP | per-server timeout / result budget / failed 上报 | MCP 配置/连接 | **可借预算与失败面** |
| tool scope | `native:` / `mcp:` 选择器 + widens 比较 | 类别 allowlist + identity policy | **可借选择器语言** |
| 资源队列 | `TurnResources` claim/等待位置/EWMA | Pod 单 running、probe 队列 | **可借通用化** |
| 记忆 | 轻量 memory | 谐波记忆 + pinned/sticky + 管线 | MAFW 领先 |
| Goal/Pod 编排 | routines/triggers，无 Goal loop | NodeDriver + Pod 协作 Goal | MAFW 领先 |
| 插件生态 | 无 runtime 插件 | runtime / media / usage / UI 插件 | MAFW 领先 |

---

## 3. 借鉴清单

### P0-1 Turn 安全包：先证明“没开始/没副作用”，再重试

**它怎么做**

- `contracts.ts` 定义 `TurnNotStartedError`：只有“prompt 尚未到达 provider / 客户端动作尚未发生、且进程已停止”才算可恢复。
- `drivers/retry.ts` 的 `mayResendTurn`：
  - `endedBeforeTurn` → 可重发；
  - 否则必须 `exitCode !== 0 && transient && !streamed && !answered && attempt < 3`。
  - 一旦模型已经流式输出或回答过，就不再重发（订阅已经付过费，CLI 也会自己重试 API 调用）。
- `turn-outcome.ts` 的 `outwardActions` 从轨迹里识别 `git commit/push`、支付类命令、`isOutboundTool`；**切掉的回合如果已经外发过，绝不自动重跑**。
- `stoppedTurnOutcome` 把“为什么停 + 已经调了多少工具 + 最后一句原话”打包成续跑/人工判断的简报。

**MAFW 现状**

- `gateway/src/core/goal/failure-class.ts` 只看 code/source，未知码 fail-closed 到 `terminal_session`。
- `gateway/src/core/goal/driver.ts:1502` 的 `failNode` 在 `retryable_environment` 且未达 maxAttempts 时直接 `advance` 重跑。
- `node-prompts.ts:482` 只提醒“不要假设副作用已回滚”，但没有证据，模型只能猜。

**怎么落**

1. 在 `goal_node_runs` 或 `nodeSession` 上增加 turn evidence：
   ```ts
   interface TurnAttemptEvidence {
     notStarted: boolean;      // 从未到达 provider
     streamed: boolean;        // 有 content.delta
     answered: boolean;        // 有 assistant_text 完成
     toolCalls: number;
     outward: string[];        // "git push" / "npm publish" / "payment" / ...
   }
   ```
2. `mayRetryNode(evidence, failureClass, attempt)`：
   - `notStarted` → 可重试（即使错误码未知，但只给一次）；
   - `outward.length > 0` → **不可自动重试**，转人工/`AWAIT_RETRY_APPROVAL`；
   - `streamed || answered` → 只允许同回合内的修复，不重发原 prompt；
   - 其余沿用 `retryable_environment`。
3. 把 evidence 写进 `lastFailure` 和重试 prompt，让模型知道“上次已经 git push 过”。
4. 加 outward 分类：shell 命令里的 `git commit/push`、`npm publish`、`deploy`、`kubectl apply`、支付/转账、外发消息工具。

**测试**

- 只读轨迹 + 429 → 自动重试。
- `git push` 成功后进程崩溃 → 不自动重试，进入人工确认。
- 未知错误但 `notStarted` → 只重试一次。
- 已 streamed 的 5xx → 不重发原 prompt。

**价值**：直接降低“重跑已提交/已推送/已付款”的事故面。这是我认为最该先借的一条。

---

### P0-2 Generation fence：迟到的 turn 事件不能结算新回合

**它怎么做**

- `RetiredTurnRegistry` 记录被取消/退休的 turnId，迟到事件直接丢。
- `PendingTurnCancellations` 在 Stop 到 provider turn id 之间的窗口挂闸门，并带 TTL，防止 hung adapter 永久占住。
- `guardTurnDispatch` 在 `sendTurn` resolve 后复查取消状态，若已取消则补一次 interrupt。
- `isTurnEventQuarantined` 同时检查 retired + pending。

**MAFW 现状**

- `run-coordinator.ts` 有 `awaitingStart`（resume 后延迟 abort 终态不结束新 run），这是同思路的单点。
- `driver.ts:1577` 有 `ns.id !== sessionID` 的 stale 事件守卫，但只覆盖 node session id，没有覆盖 turn 代际。

**怎么落**

- 给每次 NodeDriver 派发、每次 RunCoordinator resume 分配 `generation`（或 `dispatchSeq`），事件携带/关联 generation。
- 在 `handleOpencodeEvent` 进 NodeDriver / RunCoordinator 前做 `isTurnEventQuarantined` 等价判断。
- 取消/暂停/重试后，旧 generation 的 `turn.completed/failed/aborted` 一律丢弃；需要收账的异常用产物优先路径补。

**测试**

- 旧 node 的 turn.completed 在新 node 派发后到达 → 不结算新 node。
- suspend 的延迟 abort 终态在 resume 后到达 → 不结束新 run。
- 取消窗口内 sendTurn 晚返回 → 补 interrupt，事件被隔离。

---

### P0-3 Steer 三值：`steered / refused / indeterminate`

**它怎么做**

`ProviderAdapter.steer?()` 返回：

- `steered`：确认进入当前回合；
- `refused`：可证明没送达，调用方可以入队；
- `indeterminate`：**可能已送达，绝不能重发**，否则会跑两次。

**MAFW 现状**

- `SessionPromptOpts.delivery` 只有 `'steer' | 'followup' | 'queue'`，`steerApi` 是布尔。
- W5a 的实证是 opencode steer 实际“回合后优先送达”；失败回落本地 turn-queue 时，没有“可能已送达”的语义。

**怎么落**

- 在 runtime 契约增加 `steer?(sessionID, text, parts): Promise<'steered'|'refused'|'indeterminate'>`（或让 `promptAsync` 在 `delivery:'steer'` 时返回 outcome）。
- gateway `decideBusyDelivery`：
  - `steered` → 清 pending；
  - `refused` → 入 gateway 队列；
  - `indeterminate` → 不重发，UI 显示“已尝试投递，状态未知”，下一回合用 messages 对账。
- desktop/mobile 的 busy 发送路径统一消费这个三值。

**测试**

- `indeterminate` 时不产生第二条队列消息。
- `refused` 时队列可见、可取消。
- `steered` 时队列不重复。

---

### P0-4 Approval 硬化：explicit approval、outbound guard、source 审计

**它怎么做**

- `auto-approve.ts`：
  - `ASKS_A_PERSON`（AskUserQuestion/ask_user）任何模式都不自动答；
  - `full` 之外，`requiresExplicitApproval`（provider 请求放宽 sandbox）不自动批；
  - `isOutboundTool` 在 auto 下始终 human；
  - `own-files`（只读自己的 SOUL/skills/memory）在**任何**档位都可自动批；
  - `commandAllowed` / `toolAllowed` 必须精确匹配 provider/bot/folder/command 或 MCP server/tool/config；
  - `auto` 只额外放行 web search。
- `request.resolved.source`：`user | auto | timeout | system | unavailable | peer`，审计能看出“谁批的”。
- `shared/approval-mode.ts`：`custom` 不跨引擎；切换到不支持该档位的引擎要先回 Ask；`isEmergencyApprovalDowngrade` 只能降到 Ask 并停回合。

**MAFW 现状**

- `policy-service.ts` 三档 + dangerous regex；`full-access` 一律 auto-approve；没有“放宽 sandbox”概念。
- `auto` 预算耗尽回落 read-only，这点比它更保守，是优点。
- 没有 outbound guard，也没有 request.resolved.source 的完整溯源。

**怎么落**

1. 在 permission request DTO 增加 `requiresExplicitApproval?: boolean` 和 `origin?: 'tool' | 'output'`；`auto` 档不得自动批。
2. 增加 outbound 分类（`isOutboundTool` 等价）：`git push`、`npm publish`、部署、支付、外发消息；`auto` 一律 human，`full-access` 才自动。
3. `request.resolved` 记录 `source`，写进 `approval-decisions.jsonl`；UI 上自动批的 chip 可见（“approved git push (full access)”）。
4. 模型/运行时切换时：如果当前是 `full-access`/自定义规则，目标 runtime 不支持同档位 → 回 Ask 或要求确认，不静默继承。
5. Pod 成员/子代理不继承 Lead 的 Full；peer-initiated/内部会话按 fail-closed 处理。

**测试**

- Auto 档 + sandbox widening → human。
- Auto 档 + `git push` → human。
- Full 档 + sandbox widening → auto，但审计 source 正确。
- 模型切换 custom → 新引擎 → Ask 确认。
- AskUserQuestion 任何档位都不自动答。

---

### P0-5 Watchdog：等人/等资源不是 stall

**它怎么做**

`turn-watchdog.ts` 的 `WatchedTurn` 有：

- `waitingOnHuman` / `waitingOnComputer`；
- `runningTools: Set<itemId>`；
- `stallMs` 与 `toolStallMs` 双阈值；
- `sleptMs`：机器休眠期间的时间从沉默里扣掉，不误杀；
- `eventsDiscarded`：Stop 丢弃后续事件后，把拆解过程当新 silent turn 重新 watch。

**MAFW 现状**

- NodeDriver 30 分钟 watchdog + 90s reuse grace；没有“正在等人/等探针/等审批”的状态。
- 笔记本电脑休眠后恢复，可能把休眠时间算成 stall。

**怎么落**

- 给 `nodeSession` 增加 `waitingOn: 'human' | 'resource' | null`，由问答/审批/探针/资源 claim 设置。
- watchdog sweep 跳过 waiting；工具运行中给更长阈值。
- 记录进程 tick 的墙钟 gap，gap 超过若干 sweep 时从 `lastEventAt` 里扣掉。
- 对应 goal event 可以新增 `goal_node.waiting`（或复用 `goal_node` 的 transition），但不必进 canonical 全局词汇。

---

### P1-6 Prompt cache 卫生：stable / volatile 显式分段

**它怎么做**

- `system-prompt.ts` 把所有 section 分成 `VOLATILE_SECTIONS`（memory、mentions、outstanding、teammates、recent、availability、active-routines、plan、assignment、routine-execution、skill-instructions、playbooks、device-place、files）与 stable 半区。
- driver 的 per-thread CLI 进程只按 stable 半区做 key；request-per-turn driver 把 volatile 半区放进**最新 user message**，让缓存前缀保持 byte-identical。
- `contracts.ts` 同时传 `systemStable` / `systemVolatile`。
- `cache-keepwarm.ts`：只对订阅登录、上下文 ≥50k、50 分钟后 ping；用 fork 的 tool-less 请求，检查 `read > 0 && write < 0.1 * read` 才算 warm；有预算门、busy 重试、窗口上限。

**MAFW 现状**

- `instruction-blocks.ts` 三块：memory-guide（稳定）、user-profile（pinned，较稳定）、agent-priors（随 review 变）。
- `instruction-sync-service.ts` 已经按内容 diff 只写变化 key。
- recall 指针走消息，方向是对的；但还没有显式的“这段属于 stable/volatile”分类，也没有 keep-warm。

**怎么落（先做前半，keep-warm 后置）**

1. 给 instruction blocks / system 注入增加 `stability: 'stable' | 'volatile'` 元数据。
2. stable 才写 instruction entries；volatile（近期记忆、Pod 队友状态、当前任务、便签）走本轮消息或 per-turn system 尾部。
3. 加一个“stable 段变化告警”：stable 内容变化意味着缓存前缀失效，记录 revision/bytes，便于观察。
4. keep-warm 作为可选 runtime 能力：
   - `cacheKeepWarm?: { ping, hold, compact }`；
   - 只对订阅 runtime 开；上下文 ≥50k；50 分钟；预算门；
   - 没有 fork/ping 原语的 runtime 不实现。
   - 对 opencode 需要先验证 `session.fork` + 无工具 prompt 是否真的不污染 thread；对 pi 可利用进程内 session。**不要先承诺。**

**价值**：我们已经在 90%+ 缓存命中，这条是“保护命中率”，不是“从零加缓存”。收益主要体现在长 Goal/Pod 会话的空闲窗口。

---

### P1-7 HandedState / delta context：只补“这个原生会话没见过的”

**它怎么做**

- 每个 `(bot, thread, instance)` 记 `HandedState`：`session`、`omitted`、`through`、`ids`。
- 只有 provider **真的动作过**（`content.delta` / `item.*` / `request.opened`）才把消息记为 received；`synthetic` 不算；被 Stop 的回合把 steered 消息撤回。
- `unseenMessages` 只列没见过的，`keep` 消息全量、其余按 12 条/4000 字节预算；开头有明确 preamble。
- resume 失败时 `buildRecoveryText` 用有界 transcript 重放，并明确“这是新会话”。

**MAFW 现状**

- Pod handoff 每个节点都注入完整 `[CONTEXT MANIFEST]` + `[POD HANDOFF]` + 节点正文；上下文重复但可预测。
- 原生会话 resume 由 runtime 负责；我们没有“这个 session 已经见过哪些消息”的记录。

**怎么落**

- 在 gateway 侧为 Pod 节点 handoff 增加 `handed` 记录（key: runtime session id + manifest hash），只补新增的 handoff/decision 消息；稳定基线仍可由 ContextManifest 强制。
- 对 runtime 切换/恢复失败，增加 `recoveryText` 构造：有界 transcript + “这是新会话” preamble，而不是把全部历史塞进 system。
- 与 `session.instructions` 的 revision 对账，避免重复注入。

**注意**：MAFW 的 Pod ContextManifest 是“阶段基线由代码强制”，不能因为增量而丢掉必需文件；增量只用于**对话消息**，manifest 仍全量校验。

---

### P1-8 LiveStep / ProgressGate：状态行用短 DTO，不进 canonical 词汇

**它怎么做**

- `shared/turn-progress.ts`：`activity`（write/edit/command/web/read/fetch/search/tool）、`target` ≤60 字符、`detail` ≤200 字符、`file`、`bytes`、`quiet`、`tail`。
- `live-steps.ts`：从工具输入提取 step；输出尾行 2 行/160 字符；env 赋值只留变量名；进程树采样判断 `network/busy/idle`。
- `progress-gate.ts`：同一 thread 400ms 一帧，`progressKey` 相同就丢；turn 终态清 gate。
- `turn.progress` 是 **live only**：不写 NDJSON、不进历史。

**MAFW 现状**

- tool cards 有 args/status，但没有统一的“当前在做什么”短 DTO；SSE part 更新较细。
- `part.updated` 已经进 canonical，不适合再把高频 progress 塞进去。

**怎么落**

- 新增一个**临时通道**（不进 `mafw-vocabulary`）：`session.activity` 或 SSE `activity` 事件，字段用 LiveStep。
- desktop 状态行/移动端工作 tab 消费；掉线不补发，重连后从 tool part 当前状态恢复。
- 输出尾行做 redaction + env 值隐藏；进程静默探测可选。

**价值**：长命令/构建时用户能看到“还在动”，同时不把 SSE/DB 打爆。

---

### P1-9 Engine snapshot / install / auth：runtime 也有“健康卡”

**它怎么做**

- `ProviderSnapshot`：`available/unavailable`、`reason`、`authenticated`、`account`、`version`、`update`、`billing`、`warning`、`notEngineCli`、`freeFallback`。
- `engine-status-file.ts`：上次状态落盘，启动时先读 last-good，再后台 probe；1s 防抖；60s deadline；CLI 路径被换成别的程序能识别。
- `EngineInstall`：每平台安装命令、docs、signInCommand、npmPackage、standalone 版本+SHA256、appCopy。
- `ProviderRegistry`：同一实例的并发 snapshot 共享；3s 复用；engine list 60s 复用；失败不缓存。

**MAFW 现状**

- Config 页/插件中心现探 runtime；没有持久化 last-good snapshot，也没有“这个 runtime 的 CLI 装在哪、版本多少、要不要登录”的中立描述。

**怎么落**

- 在 runtime 契约增加可选 `snapshot(): Promise<RuntimeSnapshot>` 和 `install?` / `auth?` 描述（不要照搬 standalone 供应链，先做 state/reason/version/auth）。
- gateway 缓存 last-good，Config 先显示缓存再后台刷新；失败不清空。
- 这对 claude/codex 这类 CLI runtime 插件尤其有用；opencode 本身已有 serve 健康检查。

---

### P1-10 错误分类：把“不可用”翻译成“下一步做什么”

**它怎么做**

- `engine-errors.ts` 分出：`credits`、`usage_limit`、`rate_limit`、`overloaded`、`server`、`tool_schema`、`tool_count`、`refused`。
- `tool_schema` 会指出是哪个工具的参数 schema 被 provider 拒绝；`tool_count` 指出超过 provider 的工具数量上限，并建议关掉某个 MCP server。
- `usage_limit` 带 `resetsAt`，按宿主时区显示。
- 文案保留 `classifyError` 能读的关键词，重试/切换账号/健康码不漂移。

**MAFW 现状**

- `runtime/canonical-error.ts` + `failure-class.ts` 有基础分类，但没有 tool schema/count 这一类，也没有“去 Config 关哪个 MCP”的可操作建议。
- 我们有 44 个 MCP 工具，某些 provider 的工具数量/参数 schema 限制会直接变成“invalid request”。

**怎么落**

- 扩展 `classifyNodeFailure`/`canonical-error` 的 kind：`credits`、`usage_limit`、`rate_limit`、`overloaded`、`server`、`tool_schema`、`tool_count`、`refused`。
- 在 Config/MCP 卡上提供“最近一次工具 schema/count 失败”的提示和禁用入口。
- 记录 `limitResetsAt`，goal 暂停/恢复时显示。

---

### P2 备选（先记录，不排期）

- **Tool scope 选择器**：`native:` / `mcp:server:name` 的 allow/deny + `toolScopeWidens`。可用于 Pod 成员细粒度权限、插件权限变更的“变宽”警告。
- **TurnResources**：资源 claim + 等待位置 + EWMA 估计。可用于 Pod 唯一 probe 槽、桌面 computer use、终端。
- **`cap.exhausted` + handoffPath**：预算耗尽不是静默 abort，而是写结构化 handoff，RunState 恢复时接着跑。和我们的 `BudgetGuard` + `run_states` 天然契合。
- **`guestConfined`**：外部/邀请回合禁止 shell、禁止读目录外文件。可用于 mobile/external goal source 的受限模式。
- **`ServerText` 固定句**：把“审批为什么被挡住”做成 key + 参数，客户端翻译，服务端保留 fallback。我们的审批文案目前分散。

---

## 3.5 如果目标是“新 runtime 更容易接”

如果借 harness 的目的是降低新 runtime 的接入成本，那么最值得借的不是事件名，而是 OpenMausBot 的 **driver SPI 形状**：

- `ProviderDriver` 只要求：`metadata`、`decodeConfig`、`defaultConfig`、`models`、`create(input)`。
- `ProviderAdapter` 只有 7 个核心方法：`sendTurn`、`interruptTurn`、`respondToRequest`、`steer?`、`hasSession`、`stopAll`、`onEvent`。
- 其余能力（模型刷新、安装、登录、`generateText`、`reviewPermission`、`cacheKeepWarm`）都是 `ProviderInstance` 上的**可选方法**。
- 新增 provider = `server/drivers/` 下一个文件 + 一行注册；ACP CLI / OpenAI-compatible endpoint 甚至零代码，只改配置。

MAFW 现在的门槛：

- `RuntimeClient` 是 30+ 方法的单一接口。虽然大多数方法 optional，但作者一打开契约就要面对整张表。
- `contract-presets.ts` 已有 `core / conversation / autonomous / desktop`，但只有“要求哪些 surface”，没有“默认实现/桩”。
- `eventMappings` 的目标仍是 opencode 形状的 `payload.properties`，新作者要先理解旧方言。
- 没有通用 ACP / stream-json transport；`adapters/claude` 是唯一完整示例（约 556 行）。

### 建议的 v2 形态

**第一层：`RuntimeTransport`（只写协议）**

```ts
interface RuntimeTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  createSession(input: { directory: string; parentID?: string }): Promise<{ sessionId: string }>;
  sendTurn(input: {
    sessionId: string;
    text: string;
    parts?: RuntimePart[];
    model?: ModelRef;
    system?: string;
    cwd?: string;
  }): Promise<{ turnId?: string }>;
  interruptTurn(sessionId: string, turnId?: string): Promise<void>;
  respondToRequest?(sessionId: string, requestId: string, decision: ApprovalDecision):
    Promise<'allowed-once' | 'rejected' | 'answered' | 'unavailable'>;
  steer?(sessionId: string, text: string): Promise<'steered' | 'refused' | 'indeterminate'>;
  snapshot?(): Promise<RuntimeSnapshot>;
  onEvent(listener: (event: AdapterEvent) => void): () => void;
}
```

**第二层：`defineRuntime()`（填表，不写桩）**

```js
const { defineRuntime, createAcpTransport } = require('@mafw/runtime-kit');

module.exports = defineRuntime({
  name: 'my-runtime',
  displayName: 'My Runtime',
  preset: 'conversation',           // core / conversation / autonomous / desktop
  transport: createAcpTransport({
    command: 'my-agent',
    args: ['--acp'],
  }),
  metadata: { cliVersion: /^my-agent\s+\d+/ },
  install: {
    docsUrl: 'https://example.com/install',
    command: { win32: 'npm i -g my-agent', darwin: 'npm i -g my-agent' },
  },
  auth: { type: 'login', command: 'my-agent login' },
  models: { default: 'my-model', options: [{ id: 'my-model', contextWindow: 200000 }] },
  // 只有协议怪癖才写 override；普通事件由内置 mapper 处理
  mapEvent(event) { /* optional */ },
});
```

`defineRuntime()` 负责：

- 按 preset 填满 `RuntimeCapabilities` 与未实现通道的中性桩（不支持的 surface 返回 503 / `supported:false`，不抛异常）；
- 把 `RuntimeTransport` 适配成现有 `RuntimeClient`；
- 把中性 `AdapterEvent` 映射到现有 canonical 事件；
- 统一 `healthCheck`、`snapshot`、`install`、`auth` 的插件中心展示；
- 把 `tools` 通道桥接给 transport（能走 MCP 的走 MCP，不能走的明确拒绝）。

**第三层：内置 transports**

| transport | 覆盖 | 接入成本 |
|---|---|---|
| `createAcpTransport()` | 任何 ACP CLI（Kimi / Hermes / Qwen / 自研） | 配置，零代码 |
| `createStreamJsonTransport()` | Claude Code 类 `--output-format stream-json` | 配置 + 少量事件 override |
| `createAppServerTransport()` | Codex app-server 类 JSON-RPC | 配置 + 少量事件 override |
| `createOpenAICompatTransport()` | OpenAI-compatible HTTP endpoint | 配置，零代码；能力按 chat-only 降级 |
| custom `RuntimeTransport` | 私有协议 | 实现 5-7 个方法，不碰 `RuntimeClient` |

**第四层：脚手架与验收**

- `mafw runtime init <name> --transport acp`：生成可运行的插件目录 + `plugin.json` + 测试。
- `mafw plugin-check <file> --preset conversation`：列出缺哪些 surface / 事件字段。
- `mafw plugin-test <file> --preset core`：跑 S1/S2 场景。
- `mafw plugin-record <file>`：抓一份原生事件 fixtures，回放成 canonical 事件，作者不需要手写映射测试。

### 和现有 `eventMappings` 的关系

`eventMappings` 不退役，降级为**逃逸口**：

- 默认路径：transport 发中性 `AdapterEvent` → 内置 mapper → canonical。
- 需要方言适配时：继续用 `eventMappings` / `transformEvent`（claude adapter 的做法）。
- 这样新作者不必先学 opencode 形状，老 adapter 零迁移。

### 建议的落地顺序

1. **先做 `RuntimeTransport` + `defineRuntime()` + 中性 `AdapterEvent`**，用一个 fake transport 跑通 `core` preset；这是地基。
2. **再做 `createAcpTransport()`**，因为 ACP 是“一个 transport 覆盖多家 CLI”的最高杠杆；用一家真实 ACP CLI 验收。
3. **再做脚手架 + `plugin-check --preset`**，把“照着填”变成默认体验。
4. `stream-json` / `app-server` 按真实需求排期；不要一次做四个。

---

## 3.6 把已接入的 runtime 收进这个形状

先盘点现状：

| runtime | 入口 | 核心协议层 | 事件映射 | 特点 |
|---|---|---|---|---|
| opencode | `gateway/src/runtime/opencode-runtime.ts`（489 行） | `opencode-adapter.ts`（1012 行） | `OPENCODE_*_EVENT_MAPPINGS` + 方言探测 | 全能力参考实现 |
| pi | `gateway/src/runtime/plugins/pi-runtime.ts`（325 行） | `pi/pi-session.ts` + `PiEventStream` | `PI_EVENT_MAPPINGS` | 进程内 SDK |
| claude | `adapters/claude/src/index.ts`（47 行） | `runtime.ts`（198 行） | `CLAUDE_EVENT_MAPPINGS` | 最接近目标形状 |

结论：**不要大爆炸重写，但最终没有 native 旁路**。先加迁移脚手架，再按 `claude → pi → opencode` 的顺序抽 transport。顺序只是风险排序，不是豁免；opencode 也必须走中性接口。

### 第一步：`defineRuntime` 的 `native` 只是迁移脚手架

```ts
type DefineRuntimeInput =
  | { name: string; preset: PresetId; transport: RuntimeTransport; channels?: Partial<RuntimeClient>; ... }
  | { name: string; native: AgentRuntime; ... };  // 临时脚手架，有删除门禁
```

`native` 分支只用于迁移期：让现有 runtime 先统一注册、能力派生、plugin-check 和插件中心展示，行为零变化。**迁移完成后必须删除**，并用架构守卫禁止任何 runtime 绕过 `transport + AdapterEvent`。

删除门禁：

- `native` 分支只允许在迁移期存在，带 `@deprecated` 和到期版本；
- 每个 runtime 迁移完成时，删除对应的 `native` 注册；
- CI 架构测试：`gateway/src/runtime` 之外不得出现 `native:` 注册；`defineRuntime` 的 `native` 分支删除后不得复活。

### 第二步：claude（第一个迁移）

它已经是一个事实上的 transport：

| `RuntimeTransport` | claude 现有实现 |
|---|---|
| `createSession` | `newSessionId()` + `sessions.getOrCreate` |
| `sendTurn` | `spawn()` → `sdk.query()` |
| `interruptTurn` | `query.interrupt()` |
| `respondToRequest` | 没有原生审批 → `unavailable` |
| `steer` | 当前是入队 → 语义上更像 `refused` 或 `indeterminate`，需要明确 |
| `onEvent` | `bus.event()` |
| `snapshot` | `healthCheck()` |

迁移动作：

- 把 `runtime.ts` 中 `spawn`、`sessions`、`tracker`、`bus` 收进 `createClaudeTransport()`；
- `messages/get/list/delete` 留在 `channels.session`；
- `events.ts` 原样保留，作为 transport 的 `eventEntry`；
- `index.ts` 改成 `defineRuntime({ preset:'conversation', transport, channels, eventEntry })`；
- 用现有 `plugin-check --audit` 和 `event-replay` 验收。

这是最小、最安全的试金石。

### 第三步：pi（第二个迁移）

pi 的 `PiSessionRegistry` 已经接近 transport：

| `RuntimeTransport` | pi 现有实现 |
|---|---|
| `createSession` | `registry.create()` |
| `sendTurn` | `registry.promptAsync()`（busy 时 `sendUserMessage`） |
| `interruptTurn` | `registry.abort()` |
| `respondToRequest` | `registry.permissionReply()` |
| `steer` | `resolveDelivery('steer')` → `sendUserMessage`；需要返回三值 |
| `onEvent` | `PiEventStream` |
| `snapshot` | 进程内可用性 |

迁移动作：

- 新增 `createPiTransport(registry, eventStream)`，把 `promptAsync/prompt` 的阻塞差异收进 transport（`sendTurn` 只负责投递，等待终态由事件流或 `prompt` 变体决定）；
- `messages/normalizeMessages/fork/revert/listByDirectory/agents/completion` 留在 channels；
- `PI_EVENT_MAPPINGS` 原样保留；
- 能力从 channels 派生，删掉手写 `PI_CAPABILITIES` 中与实现不一致的项（例如 `questionApi` 没有声明、`diffApi` 没有声明，靠手写容易漂移）。

### 第四步：opencode（最后迁移，但同样走中性接口）

opencode 的 `opencode-adapter.ts` 是完整 HTTP 面，不适合一次性拆。迁移时只抽 6 个 transport 方法；其余协议细节留在 **opencode adapter 包内部**，不是留在 gateway core：

| `RuntimeTransport` | opencode 现有实现 |
|---|---|
| `createSession` | `POST /session` |
| `sendTurn` | `POST /session/{id}/prompt` |
| `interruptTurn` | `POST /session/{id}/abort` |
| `respondToRequest` | `POST /session/{sid}/permission/{id}/reply` |
| `steer` | `prompt` body 的 `delivery:'steer'`；返回语义需实测 |
| `onEvent` | `/api/event` 流 |
| `snapshot` | `healthCheck()` |

其余 ~900 行（messages 归一化、diff/vcs、MCP、instructions、pty、provider/config、completion、方言探测）全部留在 channels，但 channels 也在 **opencode adapter 包内部**实现。**不要为了“形状统一”把 opencode 的协议细节搬进 transport**；transport 只负责回合生命周期。**也不要因为“opencode 是主运行时”就保留 gateway 内的 native 分支**——最终形态是 opencode adapter 通过同一套 `defineRuntime` 注册。

### 验收：golden 对照，不是“看起来一样”

每个 runtime 迁移时都跑同一组：

1. 固定一份原生事件 fixture（现有 `sampleEvents` / 真机抓包）；
2. 旧实现 → canonical event 序列；
3. 新 `defineRuntime` 实现 → canonical event 序列；
4. 断言两条序列逐事件相等（字段顺序无关）；
5. 再跑 `plugin-check --preset` + `plugin-test` S1/S2。

这能防止“重构把事件语义悄悄改了”。

### 不要做的事

- 不要把 `messages` / `diff` / `MCP` / `instructions` / `pty` 塞进 transport。它们不是回合协议。
- 不要删掉现有 `eventMappings`；它是方言逃逸口，claude/opencode/pi 都还要用。
- 不要为了统一而重写 opencode；它是主运行时，收益低、风险高。
- 不要让 `defineRuntime` 自动猜测所有能力；`turnBudgetApi`、`revertUndoApi` 这类语义位必须显式声明。

---

## 3.7 AdapterEvent v1 草案（目标覆盖现有 80%+）

先明确边界：**AdapterEvent 只覆盖 runtime 原生事件；gateway 自己的事件不进这个 union。**

- `goal_node`、`pod.updated`、`queue.updated`、`run.updated`、`session.checkpoint`、`background.job.updated` 等是 gateway 业务事件，继续由 gateway 生成。
- `usage.updated` 可以由 runtime 提供 usage 数据，但最终聚合/合成仍在 gateway。
- 这样 runtime 只负责“我看到了什么”，不负责“gateway 的业务状态”。

### 信封

```ts
export const ADAPTER_EVENT_VERSION = 1;

export interface AdapterEventBase {
  /** 事件唯一 id；gateway 只用它去重/记录，不要求全局有序。 */
  id: string;
  type: AdapterEventType;
  /** 会话级事件必填；runtime 级 notice/error 可缺省。 */
  sessionID?: string;
  /** 回合关联；有 turn 的事件尽量带。 */
  turnID?: string;
  /** 消息/部件关联。 */
  itemID?: string;
  /** 审批/问答关联。 */
  requestID?: string;
  /** epoch ms。 */
  at: number;
  /** 可选：同一 session 内单调递增，gateway 用来丢弃乱序旧帧。 */
  seq?: number;
  /**
   * 原生载荷，仅用于诊断：gateway 会脱敏、截断、写入 native.ndjson，
   * 但永远不转发给客户端，也不作为业务字段读取。
   */
  native?: { source: string; payload: unknown };
}
```

关键隔离规则：

1. **插件不发 runtime 名字/实例 id**。gateway 在边界统一 stamp `runtimeName` / `instanceID`；插件只发中性事件。
2. **未知 `type` 直接 drop + telemetry**，不 passthrough。opencode 的 `sync` 这类原生信封不能漏进来。
3. **`native` 只进旁路日志**，不进 SSE、不进历史、不进业务判断。
4. **payload 复用 View DTO**（`MafwSession` / `MafwMessage` / `MafwPart` / `MafwPermissionRequest` / `MafwQuestionRequest`），不另造一套 part 形状。

### 事件 union（约 30 个变体）

```ts
export type AdapterEvent =
  // ── 会话生命周期（5） ───────────────────────────────
  | E<'session.created', { session: MafwSession }>
  | E<'session.updated', { sessionID: string; patch: Partial<MafwSession> }>
  | E<'session.deleted', { sessionID: string }>
  | E<'session.status', { sessionID: string; status: MafwSessionStatus; reason?: string }>
  | E<'session.compacting', { sessionID: string; reason?: string }>
  | E<'session.compacted', { sessionID: string; summary?: string; tokensBefore?: number; tokensAfter?: number }>

  // ── 回合生命周期（8） ───────────────────────────────
  | E<'turn.started', { sessionID: string; turnID: string; model?: MafwModelRef; agent?: string }>
  | E<'turn.completed', {
      sessionID: string; turnID: string; ok: boolean;
      stopReason?: StopReason; usage?: AdapterUsage; costUsd?: number; durationMs?: number;
      /** 本回合的 token 总量；不是线程累计。 */
    }>
  | E<'turn.failed', {
      sessionID: string; turnID: string;
      error: MafwMessageError;
      kind?: 'provider' | 'rate_limit' | 'usage_limit' | 'credits' | 'tool_schema' | 'tool_count' | 'interrupted' | 'unknown';
      retryable?: boolean; setup?: boolean;
      limit?: { scope: 'engine' | 'model' | 'credits'; resetsAt?: number; models?: string[] };
    }>
  | E<'turn.aborted', { sessionID: string; turnID: string; reason?: string }>
  | E<'turn.retrying', { sessionID: string; turnID: string; attempt: number; delayMs: number; reason: string }>
  | E<'turn.waiting', {
      sessionID: string; turnID: string; phase: 'start' | 'end';
      resource: string; position?: number; holder?: { name: string; task?: string };
      waitedMs?: number; outcome?: 'acquired' | 'gave_up' | 'parked' | 'stopped';
    }>
  | E<'turn.cap_exhausted', { sessionID: string; turnID: string; handoffPath: string; reason: string }>

  // ── 消息 / 部件（7） ────────────────────────────────
  | E<'message.updated', { message: MafwMessage }>
  | E<'message.removed', { sessionID: string; messageID: string }>
  | E<'part.updated', { part: MafwPart }>
  | E<'part.delta', {
      sessionID: string; messageID: string; partID: string;
      field: 'text' | 'reasoning' | 'input' | 'output'; delta: string;
    }>
  | E<'part.completed', { part: MafwPart }>
  | E<'part.removed', { sessionID: string; messageID: string; partID: string }>
  | E<'data.updated', {
      sessionID: string; messageID: string; name: string; id?: string;
      data: unknown; transient?: boolean;
    }>

  // ── 计划 / 用量（2） ────────────────────────────────
  | E<'plan.updated', { sessionID: string; items: AdapterPlanItem[] }>
  | E<'usage.updated', {
      sessionID: string; turnID?: string;
      usage: AdapterUsage;
      /** 最近一次模型调用时的完整 prompt 占用，不是累计 input；窗口未知可缺省。 */
      contextTokens?: number; contextWindow?: number;
    }>

  // ── 审批 / 问答（5） ────────────────────────────────
  | E<'permission.asked', {
      request: MafwPermissionRequest;
      /** 精确命令 + cwd：用于“记住这个命令”，不从展示文案反推。 */
      command?: { command: string; cwd: string };
      /** 只读这些文件时可自动放行（own-files 规则）。 */
      reads?: string[];
      choices?: string[];
      /** provider 原生结构化提问（如 AskUserQuestion）。 */
      questions?: MafwQuestionInfo[];
      /** tool=工具请求；output=从模型最终输出里解析出的请求（不可信输入）。 */
      origin?: 'tool' | 'output';
      /** provider 请求放宽 sandbox：只有显式 Full 才能自动批。 */
      requiresExplicitApproval?: boolean;
      /** provider 自己支持“本会话总是允许”。 */
      allowSession?: boolean;
      /** provider 自带的自动审阅器是否在跑；inactive 时 gateway 的 Auto 规则才可接。 */
      nativeReview?: 'active' | 'inactive';
    }>
  | E<'permission.replied', {
      sessionID: string; requestID: string;
      reply: 'once' | 'always' | 'reject';
      source: 'user' | 'auto' | 'timeout' | 'system' | 'unavailable' | 'peer';
      message?: string;
    }>
  | E<'question.asked', { request: MafwQuestionRequest }>
  | E<'question.replied', { sessionID: string; requestID: string; answers: string[][] }>
  | E<'question.rejected', { sessionID: string; requestID: string }>

  // ── runtime 自身（2） ───────────────────────────────
  | E<'runtime.notice', { sessionID?: string; level: 'info' | 'warning'; message: string; code?: string }>
  | E<'runtime.error', {
      sessionID?: string;
      message: string; code?: string;
      retryable?: boolean; setup?: boolean; stalled?: boolean; partial?: boolean;
      limit?: { scope: 'engine' | 'model' | 'credits'; resetsAt?: number; models?: string[] };
    }>

  // ── 工具三原语（给 call/result 分离的 runtime，3） ──
  | E<'tool.call', { sessionID: string; turnID?: string; callID: string; name: string; input?: unknown; title?: string; toolClass?: MafwToolClass }>
  | E<'tool.delta', { sessionID: string; callID: string; field: 'input' | 'output'; delta: string }>
  | E<'tool.result', { sessionID: string; callID: string; ok: boolean; output?: string; error?: string; metadata?: Record<string, unknown> }>

  // ── shell 作业（可选，1） ───────────────────────────
  | E<'shell.updated', { sessionID: string; shellID: string; status: 'running' | 'exited' | 'failed'; output?: string; exitCode?: number }>;

interface E<T extends string, D> extends AdapterEventBase {
  type: T;
  data: D;
}

export interface AdapterUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
  total?: number;
}

export interface AdapterPlanItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
}
```

### 这些事件和现有 canonical 的对应

| AdapterEvent | 现有 canonical | 说明 |
|---|---|---|
| `session.created/updated/deleted` | 同名 | 载荷从 `info` 换成 `MafwSession` |
| `session.status` | `session.updated` 的状态子集 | 显式化 busy/idle/retry，避免全靠时间戳猜 |
| `session.compacting/compacted` | 同名 | 保留 |
| `turn.started/completed/failed/aborted` | 同名 | 载荷中文化，`turn.failed` 增 `kind/retryable/limit` |
| `turn.retrying/waiting/cap_exhausted` | 新增 | 对应 OpenMausBot 的三个生命周期状态 |
| `message.updated` | 同名 | 载荷 `MafwMessage` |
| `part.updated/delta/completed` | 同名 | 载荷 `MafwPart`；tool 三原语由 gateway assembler 合成 |
| `part.removed` / `message.removed` | 现有 translation 里 drop | 显式建模，revert/compaction 可用 |
| `plan.updated` | 同名 | todo 数组 |
| `usage.updated` | 同名 | gateway 仍会聚合/合成 |
| `permission.asked/replied` | 同名 | 补 `command/reads/origin/requiresExplicitApproval/source` |
| `question.asked/replied/rejected` | 同名 | 补 `MafwQuestionRequest` |
| `runtime.notice/error` | `runtime.error` 拆分 | 非致命提示不再当错误 |
| `tool.call/delta/result` | 内部三原语 | 只给 call/result 分离的 runtime；snapshot 型 runtime 直接发 `part.updated` |
| `data.updated` | `part.updated`（`data-*`） | 类型化 data part 的显式通道 |
| `shell.updated` | 无 | 可选；给后台 shell 作业 |

### 覆盖估算

| 类别 | 现有 runtime 面 | v1 覆盖 |
|---|---|---|
| 会话生命周期 | 3 事件 + list/get/delete/update | 100% |
| 回合生命周期 | 4 事件 | 100% + retry/wait/cap |
| 消息 / part | 4 事件 + 历史 | 100% |
| 审批 / 问答 | 5 事件 + list/reply | 100% |
| 计划 / 用量 | 2 事件 | 100% |
| 模型 / Provider | list/config | 100%（channel） |
| Agent | list/install/remove | 100%（channel） |
| 分支 / 回退 | fork/revert/unrevert | 100%（channel） |
| Diff / VCS | diff/apply | 100%（channel，可选） |
| Completion / Media / Shell | 各 1 面 | 100%（channel，可选） |
| MCP | list/connect/disconnect/config | 0%（v2） |
| Discovery | commands/skills | 0%（v2） |
| Instructions entries | list/put/remove | 0%（v2） |
| PTY | create/connect/resize/delete | 0%（v2） |
| Checkpoint / snapshot tree | snapshot/restore | 0%（v2） |

按现有 **runtime 原生事件** 算，v1 覆盖 100%；加上 channels 后，按 **runtime 功能面** 算约 85%。剩下的 15% 是 opencode 专有/低频通道（MCP 配置、discovery、instructions、PTY、checkpoint），放 v2 按真实需求补，不塞进事件层。

### 与 `defineRuntime` 的关系

```ts
defineRuntime({
  name: 'my-runtime',
  preset: 'autonomous',
  transport: { ... },          // 回合协议
  channels: {                  // 非事件面
    messages, providers, agents, branch, diff, completion, shell, mediaSession,
  },
  events: {
    version: 1,                // AdapterEvent v1
    // 默认：transport 直接发 AdapterEvent
    // 方言逃逸：仍可用 eventMappings / transformEvent
  },
});
```

`defineRuntime` 负责：

- 把 `AdapterEvent` 映射到现有 canonical / View DTO（单一 mapper）；
- 把 `tool.call/delta/result` 交给现有 `tool-part-assembler`；
- 把 `permission/question` 映射到现有路由与审批策略；
- 拒绝未知 type、版本不匹配、非法字段；
- 在边界 stamp runtime 名字/实例 id，插件本身不接触 gateway 内部。

---

## 3.8 pi / claude 的映射与迁移

pi 和 claude 不是“例外”，它们正好是两个最好的样板：

- **claude**：外部 SDK，事件面小，最接近 transport；
- **pi**：进程内 SDK，事件面中等，已经有三原语和审批桥；
- **opencode**：全能力，最后迁，不保留 native；协议细节全部收进 opencode adapter 包。

### 事件覆盖对照

| AdapterEvent | pi | claude | opencode |
|---|---|---|---|
| `session.created` | 合成（registry.create） | 原生 `system/init` | 原生 |
| `session.updated` | 合成（rename） | 合成（rename） | 原生 |
| `session.deleted` | 合成（registry.delete） | 合成（delete） | 原生 |
| `session.status` | 从 turn 事件派生 | 从 turn 事件派生 | 原生 |
| `session.compacting/compacted` | 扩展事件 | 原生 `system/status` / `compact_boundary` | 原生 |
| `turn.started` | 原生 `agent_start` | runtime-kit 合成 | 原生 |
| `turn.completed/failed/aborted` | 原生 `agent_end` 三分类 | 原生 `result` 三分类 | 原生 |
| `turn.retrying` | 不可用（pi 自己重试） | 不可用（SDK 自己重试） | 原生/可合成 |
| `turn.waiting` | 不可用（无资源队列） | 不可用 | 可合成（computer/browser） |
| `turn.cap_exhausted` | 从 budget abort 合成 | 从 budget abort 合成 | 从 budget abort 合成 |
| `message.updated` | 原生 `message_start/end` | 原生 `assistant/user` | 原生 |
| `part.updated` | 原生 `turn_start/end` + 消息块 | 原生 assistant/user block | 原生 |
| `part.delta` | 原生 `message_update` | 原生 `stream_event` | 原生 |
| `part.completed` | 从 `message_end` 合成 | 从 assistant 终态合成 | 原生 |
| `plan.updated` | `registry.todo()` 快照 | 不可用 | 原生 `todo.updated` |
| `usage.updated` | `turn_end` 的 usage | `result` 的 usage | 原生/ gateway 聚合 |
| `permission.asked/replied` | 原生 ApprovalBridge | 不可用（无原生审批） | 原生 |
| `question.asked/replied/rejected` | 不可用（pi 无 question API） | 不可用 | 原生 form |
| `runtime.notice/error` | 部分（本地失败） | 部分（本地失败） | 原生 |
| `tool.call/delta/result` | 原生三原语 | 原生 tool_use/tool_result + input_json_delta | snapshot 型 `part.updated` |
| `data.updated` | 可合成 | 可合成 | 原生 data part |
| `shell.updated` | 不可用 | 不可用 | 原生 shell |

结论：**33 个变体是“能力上限”，不是“每个 runtime 必须全发”。** 每个 runtime 按实际能力发；不支持的显式 `unavailable`，不伪造。plugin-check 应该校验“声明的能力 ↔ 实际事件/通道”，而不是要求全绿。

### claude 迁移时顺手要修的三个点

1. `part.delta` 的 thinking 目前写的是 `field:'text'`（`adapters/claude/src/events.ts:215`），中性 IR 应该是 `field:'reasoning'`。
2. `tool.delta` 目前用 `kind/text`（`events.ts:221`），中性 IR 统一为 `field/delta`。
3. `session.created` 只有 `info.id/directory`；`session.updated/deleted/status` 需要从 `create/update/delete` 通道补合成事件，否则客户端只能靠列表轮询。

### pi 迁移时顺手要修的三个点

1. `session.created/deleted` 目前没有事件；registry 的 create/delete 应该各发一条，否则 Rail 只能靠轮询。
2. `usage.updated` 没有显式事件；`agent_end` 里有 usage，应该合成，不然 `UsageDock` 只能等 gateway 的 trajectory 聚合。
3. `plan.updated` 只有 pull 的 `todo()`；pi 的 todo 变更应该推一条，否则计划面板不实时。

### opencode 迁移时不要动的东西

- 方言探测（v1/v2/v21）留在 adapter；
- `messages` 的 role/type/content 归一化留在 adapter；
- MCP JSONC、instructions entries、PTY 帧格式留在 adapter/channels；
- `session.diff` / `vcs.apply` 留在 channels；
- 只把 6 个回合方法抽成 transport。

---

## 3.9 最终形态：没有 native 旁路

目标目录（名字可调整，边界不变）：

```text
gateway/src/runtime/          ← 只有中性契约，没有任何 provider 名字
  transport.ts                ← RuntimeTransport
  adapter-event.ts            ← AdapterEvent v1（33 变体）
  adapter-event-mapper.ts     ← AdapterEvent → canonical / View DTO（唯一执行器）
  channels.ts                 ← RuntimeChannels（messages/providers/agents/branch/diff/...）
  define-runtime.ts           ← 所有 runtime 的唯一注册入口
  loader.ts                   ← 内置 + 外部共用

adapters/opencode/            ← opencode 协议、serve、MCP、instructions、PTY、方言
adapters/pi/                  ← pi SDK、registry、approval bridge、event stream
adapters/claude/              ← claude SDK、history、event mapping
```

### 硬规则

1. **gateway core 不认识任何 runtime 名**。`gateway/src`（`adapters/` 之外）不得出现 `opencode` / `pi` / `claude` 的协议分支、配置键、存储路径、CLI 解析。
2. **所有 runtime 走同一个 `defineRuntime`**。内置 runtime 只是“随包分发的 adapter”，不是特殊路径。
3. **所有事件出口只有 `AdapterEvent`**。adapter 内部的 `eventMappings` / `transformEvent` 可以保留，但它们是 adapter 自己的实现，输出必须是中性事件；gateway 不接收 `payload.properties`。
4. **所有非事件面只有 `RuntimeChannels`**。messages / providers / agents / branch / diff / completion / shell / media 都走 channels；MCP / discovery / instructions / PTY / checkpoint 是 v2 channels，按 runtime 声明。
5. **没有 `native` 分支**。迁移期的 `defineRuntime({ native })` 是脚手架，迁移完成后删除；CI 禁止复活。
6. **前端不读 runtime 原生字段**。View DTO 是唯一契约；`time.busy` 这类字段要么改成中性名，要么只在 adapter 内使用。

### 迁移后要搬走/删除的 gateway 代码

| 现在的位置 | 迁移后 |
|---|---|
| `gateway/src/runtime/opencode-runtime.ts` | `adapters/opencode/runtime.ts` |
| `gateway/src/runtime/opencode-adapter.ts` | `adapters/opencode/adapter.ts` |
| `gateway/src/runtime/opencode-events.ts` / `opencode-21-events.ts` | `adapters/opencode/events.ts` |
| `gateway/src/runtime/opencode-mcp.ts` / `opencode-mcp-config.ts` | `adapters/opencode/mcp.ts` |
| `gateway/src/runtime/opencode-snapshot.ts` | `adapters/opencode/snapshot.ts` |
| `gateway/src/runtime/serve-sidecar.ts` | 通用进程监督器留在 gateway，opencode 的 spawn/readiness 描述进 adapter |
| `gateway/src/runtime/auth.ts` 的 opencode auth.json 读取 | `adapters/opencode/auth.ts`；gateway 只经 `credentials` channel |
| `gateway/src/runtime/opencode-history.ts` | `adapters/opencode/history.ts` |
| `gateway/src/runtime/plugins/pi-runtime.ts` | `adapters/pi/runtime.ts` |
| `gateway/src/runtime/pi/**` | `adapters/pi/**` |
| `gateway/src/runtime/identity-registry.ts` 的 agent md 写入 | `adapters/opencode/agents.ts`（经 `agents.install`） |
| `gateway/src/runtime/tool-classes.ts` 的 opencode 原生工具名 | 静态表可保留为共享词汇；具体声明走 channels 的 `nativeTools()` |
| `gateway/src/index.ts` 的 opencode 分支/117 处引用 | 删除；默认 runtime 由 `defineRuntime` 包注册 |
| `gateway/src/config.ts` 的 opencode 配置键 | adapter 自己的 config schema |
| `gateway/src/recall/index-scan.ts` / `media-service.ts` 的 auth 直读 | 经 `credentials` / `completion` channel |

### CI 守卫

```text
1. gateway/src（adapters 之外）grep opencode|pi|claude → fail
2. gateway/src 内 grep 'payload.properties'（adapter 之外）→ fail
3. defineRuntime 的 native 分支删除后 → 出现即 fail
4. 所有 builtin runtime 必须经 defineRuntime 注册 → 扫描注册表
5. desktop/session-ui/tui 的 runtime 名引用 → 允许 WSL/主题等功能名，其余 fail
```

这些守卫不是“洁癖”，是防止下一次又长出一个 `normalizeOpencodeXxx` 的硬约束。

---

## 3.10 计算机架构类比：runtime 就是设备驱动

这不是比喻装饰，它能直接决定边界。把 gateway 想成内核，把 runtime 想成设备：

| 计算机概念 | 对应到 MAFW |
|---|---|
| ISA（指令集） | `AdapterEvent` v1 + `RuntimeTransport` 方法签名：稳定、版本化、所有实现共享 |
| 设备驱动 | `adapters/opencode`、`adapters/pi`、`adapters/claude` |
| 总线（PCIe/USB） | `RuntimeBus` / `defineRuntime` / loader：枚举、匹配、绑定、路由 |
| 设备 ID / class code | adapter manifest：capabilities、channels、events、config schema |
| 中断 | `AdapterEvent` 异步事件流：带 type/sessionID/turnID，可屏蔽、可合并 |
| 中断向量表 | `AdapterEvent` type → canonical mapper 的单一分发表 |
| IRQ masking / spurious IRQ | generation fence / stale turn 丢弃 / unknown type 计数 |
| 中断合并 | delta 50ms 合并、progress 400ms 合并 |
| DMA | 图片/文件/patch 走附件 handle，不把 base64 内联进事件 |
| 系统调用 | `RuntimeAccess` / Experience / View DTO：业务只经此，不碰驱动内部 |
| HAL / class driver | `RuntimeChannels`：session、messages、providers、agents、branch、diff、completion、MCP、discovery、PTY… |
| 固件 / ACPI | `install` / `auth` / `snapshot` 描述：gateway 不硬编码 vendor 细节 |
| 微内核 | gateway core 最小；驱动在 `adapters/*`；IPC 是中性事件/通道 |
| 保护环 | 驱动只能发事件/返回结果，不能改 kernel 状态；`native` payload 只是调试寄存器 |
| ABI 版本 | `adapterApi: 1`；不匹配拒绝加载 |
| 热插拔 | runtime switch / reload 的 probe → attach → detach |
| 设备探测 | `plugin-check` / `plugin-test` / conformance |
| 机器检查异常 | `runtime.error` 的 correctable（retryable）vs uncorrectable（terminal） |
| 看门狗定时器 | turn watchdog / node watchdog |
| 总线仲裁 | turn queue / steer / resource claims |

### 直接结论

1. **内置 ≠ 特权。** 内核可以静态链接驱动，但驱动只能通过 driver interface 被调用；不能把驱动的私有寄存器搬进调度器。所以 `defineRuntime({ native })` 这种东西，本质是“在调度器里直接读设备寄存器”，最终必须删。
2. **没有 vendor ioctl。** MCP、Discovery、PTY、Checkpoint 也应该是标准 class driver；驱动没实现就返回 `ENODEV`，不能开一条 vendor 专用通道。这样“新 runtime 更容易接”才是真的。
3. **内核里不能有 `#ifdef opencode`。** `normalizeOpencodeEvent`、`opencode-*`、`serve-sidecar` 的 opencode 分支、`index.ts` 的 117 处引用，都是内核里的 `#ifdef`，最终要搬进驱动。
4. **ISA 要宽但正交。** 33 个事件变体是“指令集”，每个指令的编码固定、校验严格；class driver 覆盖 80% 的面，剩下的是新 class，不是 native escape。
5. **ABI 要版本化。** `adapterApi: 1` + `AdapterEvent.version`；破坏性变更升版本，gateway 拒绝不匹配的驱动。
6. **DMA 思维。** 大载荷不走进事件总线；事件只带 handle/URL/attachment id，避免 base64 把总线撑爆。
7. **中断纪律。** 未知 type 是 spurious IRQ：drop + 计数，不 passthrough；迟到 turn 是 stale IRQ：generation fence 屏蔽。
8. **热插拔生命周期。** runtime switch/reload 是 detach 旧驱动 → probe 新驱动 → attach；不是“杀掉重建”了事。
9. **保护环。** 驱动不能调用 gateway 内部函数；gateway 也不能绕过 interface 读驱动私有字段。`native` 只能进旁路日志。
10. **微内核可以后置。** 现在 adapter 可以进程内，但接口按进程外设计；未来把 adapter 放进子进程/Worker，总线 ABI 不变。

### 按这个类比，迁移顺序不变，但性质变了

- claude / pi / opencode 都是**驱动**，不是“内置 runtime”与“插件”两种东西；
- 迁移顺序只是“先写哪个驱动”，不是“哪个可以留在内核里”；
- 全部迁完后，`gateway/src/runtime` 是内核（bus + ISA + class interfaces + mapper），`adapters/*` 是驱动；
- 内置驱动可以随包编译，但注册、能力、事件、通道必须和外部驱动完全同构。

这就是“不要 native”的架构含义：**内核不认识任何具体设备。**

---

## 4. 不建议照搬

1. **单文件 `server/index.ts`**：979KB / 15,631 行，编排、路由、业务、prompt 全在一处。MAFW 的 route catalog + DI + runtime facade 更好，别退回去。
2. **默认 Full access**：`DEFAULT_APPROVAL_MODE = "full"` 是它的产品信任模型（本地个人机器）。MAFW 有 Pod/内部会话/无人值守 Goal，默认必须 fail-closed；我们现在的 identity policy + internal auto-deny 更合适。
3. **把 `turn.progress` 放进 canonical 事件 union**：它明确 live-only，但仍然进了 `RuntimeEvent` 类型；MAFW 的 canonical 词汇是跨客户端契约，频繁 progress 应走独立临时通道。
4. **把 provider 原生审批完全当权威**：它的注释说“OpenMausBot never decides a permission itself”，但 MAFW 的身份策略/内部会话 deny 必须高于 provider；借它的“透传 + 补充守卫”，不要借“完全交给 provider”。
5. **照搬 CLI 专有协议**：Claude stream-json、Codex app-server、Grok ACP 的细节只适合做 adapter 参考；MAFW 的 runtime 插件应继续用事件映射表 + `mafw-vocabulary`，不要把某家 CLI 的形状写进核心。

---

## 5. 建议切片

### Slice A（P0，建议先做）：Turn 安全包

范围：

- `TurnAttemptEvidence` + `mayRetryNode`；
- outward action 识别与“有副作用不自动重试”；
- generation fence（NodeDriver + RunCoordinator 共用）；
- steer 三值（契约 + gateway 队列 + desktop 决策）。

为什么先做：直接对应我们已有的真实故障模式（节点卡死/重试、resume 延迟终态、busy 发送重复），改动集中在 goal/run/runtime 契约，不碰 UI 大改。

测试：新增约 15-20 例（evidence 4、outward 4、fence 4、steer 4、回归 4）。

### Slice B（P0/P1）：Approval 硬化

范围：

- `requiresExplicitApproval` + `origin:'output'`；
- outbound guard；
- `request.resolved.source` 审计；
- 模型/运行时切换的档位守卫；
- 错误分类（credits/tool schema/tool count）。

为什么第二：安全边界，且能直接改善 Config/MCP 的用户可操作性。

测试：新增约 12-15 例。

### Slice C（P1）：Prompt cache / 上下文增量

范围：

- instruction blocks 的 stable/volatile 标记 + stable 变化告警；
- Pod handoff 的 handed/unseen 增量（manifest 仍全量）；
- recoveryText 有界重放；
- keep-warm 先做 spike，不直接排期。

为什么第三：成本优化，收益依赖真实会话长度；先测量 cache hit / prompt tokens 再决定 keep-warm。

测试：新增约 10-12 例 + 一个缓存命中对照。

---

## 6. 证据索引

OpenMausBot（Apache-2.0）：

- `server/contracts.ts`
- `server/harness/bus.ts`
- `server/harness/registry.ts`
- `server/harness/live-steps.ts`
- `server/harness/progress-gate.ts`
- `server/harness/engine-status-file.ts`
- `server/turn-watchdog.ts`
- `server/turn-dispatch-guard.ts`
- `server/turn-outcome.ts`
- `server/steer-queue.ts`
- `server/drivers/retry.ts`
- `server/drivers/engine-errors.ts`
- `server/auto-approve.ts`
- `shared/approval-mode.ts`
- `server/cache-keepwarm.ts`
- `server/system-prompt.ts`
- `server/delta-context.ts`
- `server/context-rebuild.ts`
- `server/turn-resources.ts`
- `shared/tool-scope.ts`

MAFW 对照：

- `gateway/src/runtime/contract.ts`
- `gateway/src/runtime/mafw-vocabulary.ts`
- `gateway/src/runtime/event-mapper.ts`
- `gateway/src/core/goal/failure-class.ts`
- `gateway/src/core/goal/driver.ts`
- `gateway/src/core/goal/node-prompts.ts`
- `gateway/src/core/run/run-coordinator.ts`
- `gateway/src/core/approval/policy-service.ts`
- `gateway/src/core/budget-guard.ts`
- `gateway/src/recall/instruction-blocks.ts`
- `gateway/src/core/instructions/instruction-sync-service.ts`
