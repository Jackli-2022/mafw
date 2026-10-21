# Runtime Canonical v3 — Plan 2：方言体系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 platform@dialect 寻址（opencode v1/v2 双方言自适应）、@v2 混合消费映射表、pi 四修复（F1/F8/N1/N2）、事件载荷 flat 翻转（message.updated `{info}`→`{message}`）与 SDK 词表快照门禁——**双发零双计**，桌面 wire 不变。

**Architecture:** opencode 注册为三个 builtin 名（`opencode`=自适应 / `opencode@v1` / `opencode@v2` 钉死），共享同一 runtime factory；探测在事件订阅时经 `resolveEventEntry()`（SSE peek 看 sync/next 族可见性，fail-safe 恒 @v1）。@v2 表混合消费（next 族为主 + 非 next 的 legacy identity + 重叠 legacy 显式 drop）。pi 的 `agent_end` 自带 messages 数组——F1 终态分类可无状态化（transformEvent）。事件载荷翻转与 Plan 1 历史翻转同构：内部 {message}，SSE egress 出口还原 {info}。

**Tech Stack:** TypeScript (gateway CJS), jest（gateway）、node --test（desktop/TUI——desktop 经 root `test:desktop`）

**Spec:** `docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md`（§3.2 寻址/§3.3 六方言/§7 决议③）+ 事实源 `docs/superpowers/specs/2026-10-21-runtime-canonical-v3-mapping-audit.md`（§2 表/F1-F12/N1-N12）
**上游已完成:** Plan 1（commits bfb5b965..8e80862e——flat 历史管线 + wire-compat egress + turn.started 词汇）

## Global Constraints

- C1 default-deny 翻译机制不变：一切映射走声明表/transformEvent 逃逸口，无直通旁路
- **双发零双计（反目标）**：@v2 方言对重叠 legacy 族（message.part.*、permission.asked/replied、question.*、session.compacted）必须显式 drop 行；Task 7 快照锁定
- 桌面 wire 不变：SSE `message.updated` 载荷仍为 `{info}`（egress 出口转换）；desktop/TUI 零改动
- 词汇快照基线：`@opencode-ai/sdk` v2 Event union = **89 成员**（types.gen.d.ts:4；跨 1.18.21→1.18.30 已验证稳定）
- 探测 fail-safe 方向恒 @v1（legacy 族在任何 serve 上都发；误选 @v2 会丢重叠事件——不可反向）
- pi `agent_end` 载荷 = `{type:'agent_end', messages: AgentMessage[]}`（pi-agent-core types.d.ts:377-379）；`tool_execution_start/update/end` = `{toolCallId, toolName, args}|{+partialResult}|{result, isError}`（types.d.ts:396-412）——映射行字段以此为准
- assembler 原语契约：tool.call `{callID, tool, input, sessionID?, messageID?}`；tool.delta `{callID, kind:'input'|'output', text}`（**键名是 text 不是 delta**）；tool.result `{callID, tool?, input?, output, isError, title?, metadata?}`（tool-part-assembler.ts:95-153）
- TDD 先行；commit 用 `git commit -m`（单行）或 `-F`（多行）；交付汇报新增测试数与全量通过数

## Review Focus

1. **空 messages 的 agent_end**（pi 启动即止/异常路径）——F1 分类不得炸，无 assistant 消息时默认 turn.completed → Task 4 测试
2. **@v2 表误用于 v1-only serve**（探测 fail-safe 失效场景）——legacy 重叠族被 drop = 事件丢失；由探测方向约束，Task 3 测试锁定 fail-safe 恒 @v1（探测无信号/超时/异常 → @v1）→ Task 3 测试
3. **SSE egress 对非 message.updated 事件零改写**（plugin:* / part.* / permission.* 载荷原样透传）→ Task 6 测试
4. **探测窗口 idle serve**（无事件流）→ 不得挂起订阅，超时即落 @v1 → Task 3 测试
5. **prompted 事件的 prompt/delivery 字段保留**（steer/queue 语义供后续消费方）→ Task 2 测试

---

### Task 1: @v1 表刷新 + SDK 词表快照测试

**Files:**
- Modify: `gateway/src/runtime/opencode-events.ts`（导出更名 `OPENCODE_EVENT_MAPPINGS` → `OPENCODE_V1_EVENT_MAPPINGS` + 保留旧名 alias export（index.ts 渐进切换）；N3 过时 drop 行修正；防御行注释）
- Create: `gateway/tests/unit/runtime/opencode-vocabulary-snapshot.test.ts`
- Test: 同上 + `gateway/tests/unit/runtime/opencode-events.test.ts`（既有，扩展）

**Interfaces:**
- Produces: `OPENCODE_V1_EVENT_MAPPINGS: EventMapping[]`（+ `export const OPENCODE_EVENT_MAPPINGS = OPENCODE_V1_EVENT_MAPPINGS` 兼容 alias）；`parseSdkEventUnion(): string[]`（快照测试内部，读 types.gen.d.ts 文本解析 union——不 import 类型，纯文本正则）

- [ ] **Step 1: 写失败测试**

`opencode-vocabulary-snapshot.test.ts`：
①解析 `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts` 的 Event union → **断言恰好 89 成员**（基线漂移即红，指向 SDK 升级需重审映射表）；
②@v1 表的每个 `from`（rename/drop 行）存在于 union 或防御行白名单（message.error/message.aborted/message.part.complete）——N3 类拼写错误在此现形；
③union 全成员处置覆盖：每个成员要么被 @v1 表的行命中（from 匹配），要么命中 canonicalIdentity 收编名，要么在显式 drop 集——`session.next.tool.started` 等三个幽灵名断言**不在** union（N3 埋葬）。

Run: `cd gateway && npx jest tests/unit/runtime/opencode-vocabulary-snapshot.test.ts`
Expected: FAIL（N3 幽灵行触发②；coverage 断言③失败——next 族真名未列入 drop）

- [ ] **Step 2: 修正 @v1 表**

drop 行替换为 SDK 真名全集（`session.next.*` 28 个 durable + delta 族按 union 枚举，从快照解析结果驱动——手写枚举由测试③校验）；防御行加注释标注"不在 SDK union，legacy 兼容"。导出更名 + alias。

- [ ] **Step 3: 跑新测试与既有套件转绿**

Run: `cd gateway && npx jest tests/unit/runtime/opencode-vocabulary-snapshot.test.ts tests/unit/runtime/opencode-events.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

`fix(runtime): opencode@v1 table refresh - N3 stale drop rows -> real SDK names, snapshot test with 89-member baseline`

---

### Task 2: @v2 混合消费映射表

**Files:**
- Modify: `gateway/src/runtime/opencode-events.ts`（新增 `OPENCODE_V2_EVENT_MAPPINGS`）
- Test: `gateway/tests/unit/runtime/opencode-events.test.ts`（扩展 @v2 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `OPENCODE_V1_EVENT_MAPPINGS`（identity 行复用：`canonicalIdentity()` 单源派生）
- Produces: `OPENCODE_V2_EVENT_MAPPINGS: EventMapping[]`——**行序敏感**：specific 行（改名/判别/drop）在前，`canonicalIdentity('$.payload.properties')` 恒等行殿后

- [ ] **Step 1: 写失败测试（@v2 块，fixtures 用 SDK 载荷真形状）**

断言（输入 = `GlobalEvent` 形状 `{directory, payload: {type, properties}}`，经 `applyEventMappings` + `wrapToolPartAssembly` 端到端）：
①`session.next.prompted {sessionID, messageID, prompt, delivery}` → `turn.started`（Review Focus 5：properties 保留 prompt/delivery）；
②`session.next.tool.called {assistantMessageID, callID, tool, input}` → 三原语 `tool.call`（fields 含 messageID=assistantMessageID）→ assembler → `part.updated` tool part（id=`toolpart_<callID>`，state running）；
③`session.next.tool.input.delta {callID, delta}` → `tool.delta`（kind input，text=delta）→ assembler input 累积；
④`session.next.tool.success {callID, content, assistantMessageID}` → `tool.result`（output=content 数组，assembler coerceOutput）→ part updated completed；
⑤`session.next.tool.failed {callID, error, result?}` → `tool.result` isError → part updated error；
⑥`session.next.text.delta {assistantMessageID, textID, delta}` → `part.delta`（fields：partID=textID、messageID=assistantMessageID、field='text'、delta）；`reasoning.delta` 同构（partID=reasoningID）；
⑦`session.next.compaction.started/ended` → `session.compacting/compacted`；
⑧`permission.v2.asked/replied`、`question.v2.*` → `permission.*/question.*` passProperties；
⑨`session.error {error: {name:'MessageAbortedError', data:{message}}}` → `turn.aborted`；`{name:'ApiError', ...}` → `turn.failed`（**行序**：aborted 判别行在前）；
⑩重叠 legacy 双发防双计：同一语义事件对（`message.part.updated` + `session.next.tool.called`）→ 仅 next 族产出，legacy 显式 drop（suppressed 计数）；
⑪孤儿族 drop：`session.next.retried`/`moved`/`agent.switched`/`model.switched`/`context.updated`/`synthetic`/`shell.started`/`shell.ended`/`text.started`/`reasoning.started`/`step.started`/`step.ended`/`compaction.delta`/`revert.staged`/`revert.cleared`/`revert.committed` → drop；
⑫`session.idle`/`todo.updated`/`session.created` 等非重叠 legacy → 照常消费（identity/rename 行）。

Run: `cd gateway && npx jest tests/unit/runtime/opencode-events.test.ts`
Expected: FAIL（OPENCODE_V2_EVENT_MAPPINGS 不存在）

- [ ] **Step 2: 实现 @v2 表**

```ts
export const OPENCODE_V2_EVENT_MAPPINGS: EventMapping[] = [
  // ---- 回合生命周期（next 族原生） ----
  { from: 'session.next.prompted', to: 'turn.started', passProperties: '$.payload.properties' },
  // ---- 工具三原语（原语组——经 assembler 合帧） ----
  { from: 'session.next.tool.called', to: 'tool.call', fields: {
      callID: { path: '$.payload.properties.callID' }, tool: { path: '$.payload.properties.tool' },
      input: { path: '$.payload.properties.input' }, messageID: { path: '$.payload.properties.assistantMessageID' } } },
  { from: 'session.next.tool.input.delta', to: 'tool.delta', fields: {
      callID: { path: '$.payload.properties.callID' }, kind: { const: 'input' },
      text: { path: '$.payload.properties.delta' } } },
  { from: 'session.next.tool.progress', to: 'tool.delta', fields: {
      callID: { path: '$.payload.properties.callID' }, kind: { const: 'output' } } },
  { from: 'session.next.tool.success', to: 'tool.result', fields: {
      callID: { path: '$.payload.properties.callID' }, output: { path: '$.payload.properties.content' },
      messageID: { path: '$.payload.properties.assistantMessageID' } } },
  { from: 'session.next.tool.failed', to: 'tool.result', fields: {
      callID: { path: '$.payload.properties.callID' }, isError: { const: true },
      output: { path: '$.payload.properties.error' }, messageID: { path: '$.payload.properties.assistantMessageID' } } },
  // ---- 文本/推理流 ----
  { from: 'session.next.text.delta', to: 'part.delta', fields: {
      partID: { path: '$.payload.properties.textID' }, messageID: { path: '$.payload.properties.assistantMessageID' },
      field: { const: 'text' }, delta: { path: '$.payload.properties.delta' } } },
  { from: 'session.next.reasoning.delta', to: 'part.delta', fields: {
      partID: { path: '$.payload.properties.reasoningID' }, messageID: { path: '$.payload.properties.assistantMessageID' },
      field: { const: 'text' }, delta: { path: '$.payload.properties.delta' } } },
  // ---- 压缩（原生对） ----
  { from: 'session.next.compaction.started', to: 'session.compacting', passProperties: '$.payload.properties' },
  { from: 'session.next.compaction.ended', to: 'session.compacted', passProperties: '$.payload.properties' },
  // ---- 审批/问答 v2 名 ----
  { from: 'permission.v2.asked', to: 'permission.asked', passProperties: '$.payload.properties' },
  { from: 'permission.v2.replied', to: 'permission.replied', passProperties: '$.payload.properties' },
  { from: 'question.v2.asked', to: 'question.asked', passProperties: '$.payload.properties' },
  { from: 'question.v2.replied', to: 'question.replied', passProperties: '$.payload.properties' },
  { from: 'question.v2.rejected', to: 'question.rejected', passProperties: '$.payload.properties' },
  // ---- session.error 判别（aborted 行在前，行序敏感） ----
  { from: 'session.error', to: 'turn.aborted', when: [{ path: '$.payload.properties.error.name', equals: 'MessageAbortedError' }], passProperties: '$.payload.properties' },
  { from: 'session.error', to: 'turn.failed', passProperties: '$.payload.properties' },
  { from: 'session.idle', to: 'turn.completed', passProperties: '$.payload.properties' },
  { from: 'todo.updated', to: 'plan.updated', passProperties: '$.payload.properties' },
  { from: 'message.aborted', to: 'turn.aborted', passProperties: '$.payload.properties' }, // 防御行
  // ---- 重叠 legacy 显式 drop（双发防双计——@v2 方言不消费） ----
  ...(['message.part.updated', 'message.part.delta', 'message.part.complete',
       'permission.asked', 'permission.replied',
       'question.asked', 'question.replied', 'question.rejected',
       'session.compacted', 'sync'] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
  // ---- next 孤儿族 drop（F6 处置） ----
  ...NEXT_ORPHAN_DROPS, // Task 1 快照驱动的枚举（retried/moved/switched/context.updated/synthetic/shell.*/text.started/reasoning.started/step.*/compaction.delta/revert.*）
  // ---- 恒等行殿后（session.created/updated/deleted、message.updated、session.diff、plan.updated 等收编词） ----
  ...canonicalIdentity('$.payload.properties'),
];
```

- [ ] **Step 3: 跑测试转绿**

Run: `cd gateway && npx jest tests/unit/runtime/opencode-events.test.ts tests/unit/runtime/opencode-vocabulary-snapshot.test.ts`
Expected: PASS（快照测试③对 @v2 表同样校验覆盖）

- [ ] **Step 4: Commit**

`feat(runtime): opencode@v2 mixed-consumption mapping table - next-family primitives + error-union discrimination + overlap drops`

---

### Task 3: platform@dialect 寻址与自适应探测

**Files:**
- Modify: `gateway/src/runtime/contract.ts`（`AgentRuntime` 增可选 `resolveEventEntry?(): Promise<EventMappingEntry>` 与 `activeDialect?: string`；import type EventMappingEntry from './event-mapper'）
- Modify: `gateway/src/runtime/loader.ts`（无结构性改动——确认 builtin 名含 '@' 可注册/查找/列出；`GET /api/runtime` 的 available 列表含方言名）
- Modify: `gateway/src/index.ts`（①:549-561 注册三 builtin：`opencode`（自适应，extras=v1 表作 fail-safe 静态兜底）+ `opencode@v1` + `opencode@v2`（各自钉死表）；②三处 subscribeToEvents 包装点（:512-516/:548-560/:1371-1378/:1406 一带）改 `const entry = await (rt as any).resolveEventEntry?.() ?? staticExtras` 后再 wrapGlobalEventStream；③GET /api/runtime 响应增 `dialect` 字段）
- Create: `gateway/src/runtime/opencode-dialect-probe.ts`（`probeOpencodeDialect(baseUrl: string, fetchImpl: typeof fetch, timeoutMs = 2500): Promise<'v1' | 'v2'>`——GET `{base}/global/event` SSE peek：流内首见 `"type":"sync"` 或 `session.next.` → 'v2'；窗口超时/连接关闭/异常 → 'v1'）
- Modify: `gateway/src/runtime/opencode-runtime.ts`（createOpencodeRuntime 返回对象挂 `resolveEventEntry`：config 显式方言（runtime.plugin 值带 @ 后缀）→ 直接返回钉死表并置 activeDialect；裸名 → 探测后选表）
- Modify: `gateway/src/routes/runtime-switch.ts`（switch 接受方言限定名——已按名字查找，确认 'opencode@v2' 可切换 + 响应含 dialect）
- Test: `gateway/tests/unit/runtime/opencode-dialect-probe.test.ts`（新）+ `gateway/tests/unit/runtime/loader-builtin.test.ts` / `opencode-runtime.test.ts`（扩展）

**Interfaces:**
- Consumes: Task 1/2 的两张表
- Produces: `probeOpencodeDialect(baseUrl, fetchImpl, timeoutMs)`；`AgentRuntime.resolveEventEntry/activeDialect`；config 值 `"opencode@v1" | "opencode@v2" | "opencode"`（裸名=自适应）

**探测语义（设计 §3.2 用户裁决）**：双发之下两方言永远"可用"，探测只判 **v2 面可见性**（sync/next 事件出现 ⇒ 2.x serve）；无信号（idle serve）⇒ @v1 fail-safe——@v1 表在 2.x serve 上照常工作（legacy 族双发），仅损失 next 族丰富度，方向安全。

- [ ] **Step 1: 写失败测试**

①probe 测试：mock SSE 流首帧含 `"type":"sync"` → 'v2'；流含 `session.next.tool.called` → 'v2'；窗口超时无信号 → 'v1'（Review Focus 4：resolve 在 timeoutMs 内完成，不挂起）；fetch 抛错 → 'v1'；
②opencode-runtime 测试：config `runtime.plugin: 'opencode@v2'` → resolveEventEntry 返回 @v2 表且 activeDialect='v2'（**不调 probe**）；裸名 → mock probe 返回 'v2' → @v2 表；mock probe 返回 'v1' → @v1 表（Review Focus 2：fail-safe 锁定）；
③loader 测试：'opencode@v1'/'opencode@v2' 可注册、可按名查找、available 列表含三名字。

Run: `cd gateway && npx jest tests/unit/runtime/opencode-dialect-probe.test.ts tests/unit/runtime/opencode-runtime.test.ts tests/unit/runtime/loader-builtin.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现**（probe 模块 + contract 扩展 + runtime 挂载 + index 三点接线 + switch/GET 报告）

- [ ] **Step 3: 跑测试转绿 + runtime 目录回归**

Run: `cd gateway && npx jest tests/unit/runtime`
Expected: PASS

- [ ] **Step 4: Commit**

`feat(runtime): platform@dialect addressing - adaptive probe (SSE peek, fail-safe v1) + pinned opencode@v1/@v2 builtins + dialect reporting`

---

### Task 4: pi F1 终态分类 + F8 agent_start 重映

**Files:**
- Modify: `gateway/src/runtime/pi/pi-events.ts`
- Test: `gateway/tests/unit/runtime/pi-events.test.ts`

**Interfaces:**
- Consumes: pi `agent_end` 载荷 `{messages: AgentMessage[]}`（messages 内 assistant 消息带 `stopReason`/`errorMessage`）
- Produces: transformEvent 内 `agent_end` 三分类（error→`turn.failed`（properties 含 error 文本）/ aborted→`turn.aborted` / 其余→`turn.completed`）；映射行 `agent_start → turn.started`

- [ ] **Step 1: 写失败测试**

①`agent_end {messages: [..., {role:'assistant', stopReason:'error', errorMessage:'boom'}]}` → `turn.failed`（properties.error 含 'boom'）；
②`stopReason:'aborted'` → `turn.aborted`；
③正常 `stopReason:'stop'`/undefined → `turn.completed`；
④**空 messages**（Review Focus 1）→ `turn.completed` 不炸；
⑤`agent_start` → `turn.started`，且**不再**产 `session.updated` 空壳（撤壳断言）；
⑥`agent_settled`（防御）与 agent_end 同分类。

Run: `cd gateway && npx jest tests/unit/runtime/pi-events.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现**

映射表删 `agent_end/agent_settled → turn.completed` 行与 `agent_start → session.updated` 行；增 `agent_start → turn.started`。transformEvent 增 agent_end/agent_settled 分支：从 `raw.messages` 反向找首个 assistant 消息，按 stopReason 三分类**总是返回**一个 canonical 终态事件（不返 null——null 是 suppressed 语义）。既有 permission.* 透传分支不动。

- [ ] **Step 3: 跑测试转绿**

Run: `cd gateway && npx jest tests/unit/runtime/pi-events.test.ts tests/unit/runtime/pi-integration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

`fix(pi): F1 terminal classification by stopReason (agent_end carries messages) + F8 agent_start -> turn.started (drop per-turn session.updated shell)`

---

### Task 5: pi N1 live 工具桥 + N2 角色修复

**Files:**
- Modify: `gateway/src/runtime/pi/pi-events.ts`（+ 可能 `gateway/src/runtime/pi/pi-mafw-host-extension.ts` 的 tool_result observe 路径确认——live 工具卡经 assembler 后 observe 动词是否仍从扩展钩子取数）
- Test: `gateway/tests/unit/runtime/pi-events.test.ts`（扩展）

**Interfaces:**
- Consumes: `tool_execution_start {toolCallId, toolName, args}` / `tool_execution_update {…, partialResult}` / `tool_execution_end {…, result, isError}`
- Produces: 三原语映射行（fields：callID=toolCallId、tool=toolName、input=args / kind+text=partialResult / output=result、isError）

- [ ] **Step 1: 写失败测试**

①`tool_execution_start` → `tool.call` → assembler → part.updated tool running（`toolpart_<toolCallId>`）；②`tool_execution_update` → `tool.delta`（kind output）；③`tool_execution_end` → `tool.result`（isError 传递）→ part updated completed/error；④旧 `tool_call`/`tool_result` 行退役（extension 钩子事件：映射后为 drop——live 不可达，显式 drop 保计数）；⑤N2：`message_end {message: {role:'user', …}}` → `message.updated` 载荷 role='user'（修复后 trajectory turn_start 对 pi 可触发——断言 role 正确透传）。

Run: `cd gateway && npx jest tests/unit/runtime/pi-events.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现**（三行新增 + 两行退役为 drop + message_end 角色路径修复——注意 message_end 行此时仍产 `{info}` 形状，flat 翻转在 Task 6）

- [ ] **Step 3: 跑测试转绿 + pi 全家回归**

Run: `cd gateway && npx jest tests/unit/runtime/pi-events.test.ts tests/unit/runtime/pi-*.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

`fix(pi): N1 live tool bridge (tool_execution_* -> primitives) + N2 user role passthrough on message_end`

---

### Task 6: 事件载荷 flat 翻转（message.updated {info}→{message}）

**Files:**
- Modify: `gateway/src/runtime/opencode-events.ts`（@v1/@v2 共享 transformEvent：`message.updated` → `{payload:{type, properties:{message: props.info}}, sessionID, directory}` 零换名展开——identity 行已不含 message.updated（transform 优先级在后，需把 message.updated 从 canonicalIdentity 产物中排除或让 specific 行先行命中；实现取"identity 行生成时排除 message.updated + transformEvent 处理"路径，理由：字段枚举不可维护，spread 未来防漏））
- Modify: `gateway/src/runtime/pi/pi-events.ts`（message_end 行 fields：`'message.role': {path:'$.message.role'}`、`'message.time.completed': {path:'$.message.timestamp'}`、`'message.finish': {path:'$.message.stopReason'}`）
- Modify: `gateway/src/runtime/tool-part-assembler.ts`（anchor 发射 `properties: {info}` → `{message: info}`；partEvent 输出类型标注 `MafwPart`）
- Modify: `gateway/src/runtime/canonical-facets.ts`（step 规则路径 `$.info.role/$.info.time.completed/$.info.finish/$.info.id/$.info.sessionID` → `$.message.*`）
- Modify: `gateway/src/runtime/normalize.ts`（sessionID 五层提取链 `props?.info?.sessionID` → `props?.message?.sessionID`）
- Modify: `gateway/src/runtime/wire-compat.ts`（新增 `toWireEventPayload(type: string, properties: Record<string, unknown>): Record<string, unknown>`——message.updated 的 `{message}` → `{info: toWireInfo(message)}`；其余类型原样引用返回）
- Modify: `gateway/src/runtime/event-broadcast.ts` 或 index.ts broadcast 出口（SSE 转发前对 message.updated 载荷过 `toWireEventPayload`——**唯一**事件 egress 点）
- Modify: `gateway/src/trajectory/collector.ts`（live 事件 `props?.info` 读点 → `props?.message ?? props?.info`）
- Modify: `gateway/src/runtime/event-field-contract.ts`（message.updated 字段契约路径 info.* → message.*）
- Test: `gateway/tests/unit/runtime/normalize-oracle.test.ts`、`event-replay.test.ts`、`event-field-contract.test.ts`、`canonical-facets.test.ts`、`pi-events.test.ts`、`opencode-events.test.ts`、`event-broadcast.test.ts`（fixtures 全部翻到 {message} + wire 端断言 {info}）

**Interfaces:**
- Consumes: Plan 1 的 `toWireInfo`（载荷级复用）
- Produces: canonical `message.updated` 载荷 = `{message: MafwMessage}`（事件形态：content 可缺省）；SSE wire 载荷 = `{info}`（不变）

- [ ] **Step 1: 写失败测试（批量）**

①oracle/replay：message.updated fixtures 载荷改 `{message: {id, role, time, finish…}}` → facets 照常产出 step 切面（路径翻转后）；②facets 直测：`{message: {role:'assistant', time:{completed:1}}}` 触发 step、`{message: {role:'user'}}` 不触发；③pi message_end `{message:{role:'user', timestamp}}` → `message.updated` properties.message.role='user'；④assembler anchor：合成消息锚 `properties.message.id` 存在；⑤wire-compat `toWireEventPayload`：message.updated `{message}` → `{info}`（**deep-equal 原生 {info}**——round-trip）；其他类型（part.updated/plugin:*）**原样引用**返回（Review Focus 3）；⑥event-broadcast：转发 message.updated 后 wire 载荷含 info 不含 message；⑦trajectory collector live：`props.message.role==='user'` 触发 turn_start（含 pi 路径）。

Run: `cd gateway && npx jest tests/unit/runtime/normalize-oracle.test.ts tests/unit/runtime/event-replay.test.ts tests/unit/runtime/canonical-facets.test.ts tests/unit/runtime/event-broadcast.test.ts`
Expected: FAIL（路径/载荷不匹配）

- [ ] **Step 2: 实现**（上述 Modify 清单逐项；transformEvent spread + identity 排除 + facets/normalize 路径 + broadcast 出口 + collector 双读）

- [ ] **Step 3: runtime 目录 + 全量回归**

Run: `cd gateway && npx jest tests/unit/runtime && npx jest`
Expected: PASS

- [ ] **Step 4: Commit**

`refactor(runtime): event payload flat flip - message.updated {info} -> {message} internally, SSE egress restores {info} (wire unchanged); facets/assembler/anchor/collector follow`

---

### Task 7: @v2 双发零双计快照 + 三端全量回归

**Files:**
- Create: `gateway/tests/unit/runtime/opencode-v2-dual-emission.test.ts`
- Test: 同上

**Interfaces:**
- Consumes: Task 2 @v2 表 + Task 3 寻址 + Task 6 载荷翻转后的全链

- [ ] **Step 1: 写双计快照测试**

真实双发序列 fixture（一个完整 turn：sync 信封 + legacy 对 + next 族对的交错流，含 message.part.updated/tool.called、permission.asked/permission.v2.asked、session.compacted/compaction.ended、message.updated、session.idle）→ 经 @v2 wrap（映射+assembler）→ 断言：①每个语义只产**一次** canonical 事件（tool part 恰一张、permission 恰一对、compaction 恰一对、turn.completed 恰一次）；②legacy 重叠对全部落 suppressed 计数；③对照 @v1 表跑同一序列 → legacy 族照常消费（两表互斥性的反向证明）。

Run: `cd gateway && npx jest tests/unit/runtime/opencode-v2-dual-emission.test.ts`
Expected: FAIL（若 @v2 表有漏 drop 行在此现形）

- [ ] **Step 2: 修至零双计绿**

Run: `cd gateway && npx jest tests/unit/runtime/opencode-v2-dual-emission.test.ts`
Expected: PASS

- [ ] **Step 3: 三端全量回归 + 交付汇报**

Run: `cd gateway && npx jest`；`cd packages/desktop && npm test`；`cd packages/tui && node --test "tests/*.test.ts"`
Expected: 三端全绿（desktop/TUI 零改动——wire 不变的证明）

- [ ] **Step 4: Commit**

`test(runtime): @v2 dual-emission zero-double-count snapshot + three-client full regression`

---

## Plan 3 路线图（随后成文）

**claude 最小 adapter 与核心清洗**：`adapters/claude/` 源码 + esbuild 单文件 CJS（SDK 打包、claude CLI/登录环境前置）、fixture 级 conformance + 零核心 diff 验收（`git diff gateway/src` 为空）、auth.json 8 消费方切 `credentials` 动词、`/api/opencode-config` → `/api/runtime-config`（兼容别名）、`MAFW_OPENCODE_PASSWORD` → `MAFW_RUNTIME_PASSWORD`、handleOpencodeEvent 等命名去 opencode 化、依赖边界 lint（runtime/ 外禁 import 两 SDK）。

> 注：file-plugin conformance CLI（`mafw plugin-test` + `POST /api/runtime/conformance`）**已存在**（2026-09-18 四件套）——方言化后按名激活方言 builtin 即可复用，本计划无需为其建设。
