# Runtime Canonical v3 — Plan 3：claude 最小 adapter 与核心清洗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付第一个"零 gateway 核心改动"的新 SDK adapter（claude，file-plugin 形态），并完成核心清洗（auth.json 8 消费方切注入式凭据、路由/env/命名去 opencode 化、依赖边界守卫）——实测设计验收线"新增 SDK = 只交付一个 runtime plugin 文件"。

**Architecture:** claude adapter 是自包含 CJS 单文件插件（esbuild 打包 `@anthropic-ai/claude-agent-sdk`，SDK 注入式 seam 供测试假件）：session 注册表 + 进程内事件总线（PiEventStream 同款）+ query 桥（promptAsync → spawn query → SDKMessage 流 → 总线）+ 工具注册（SDK 的 in-process MCP server 承载六件套）。声明式映射表处理 system/result 判别；transformEvent 处理 assistant 拆分 / user tool_result / stream_event 分派 / turn.started 合成（模块级状态）。核心清洗为注入式凭据单点接线（active runtime credentials → legacy auth.json 兜底）。

**Tech Stack:** TypeScript（adapter 源码 esbuild 打包）、node --test + tsx（adapter 测试，TUI 模式）、jest（gateway）、esbuild（根 node_modules 已有）

**Spec:** `docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md`（§3.3 claude 节、§3.6 清洗表、§7④⑤）+ 事实源 `2026-10-21-runtime-canonical-v3-mapping-audit.md`（§2 claude 列 / §1.6 认知面 / F4/F5）
**上游已完成:** Plan 1（flat 基础）+ Plan 2（方言体系，commits 894e8d27..38e4865e）
**SDK 事实**（调研+验证，2026-10-21）：`@anthropic-ai/claude-agent-sdk` @ 0.3.305（npm registry 确认）；`query({prompt, options}) → AsyncGenerator<SDKMessage> + interrupt()`；options 含 `sessionId / resume / forkSession / mcpServers / canUseTool / maxTurns / maxBudgetUsd / permissionMode / cwd`；模块函数 `listSessions() / getSessionMessages(sessionId) / forkSession(sessionId, {upToMessageId})`；SDKMessage 五型 `{type: system|assistant|user|result|stream_event}`（载荷形状见 Task 1 fixtures）

## Global Constraints

- **零核心改动验收线**：Task 1-4 完成后 `git diff --stat gateway/src` 为空（adapter 全部住在 `adapters/claude/`）
- adapter 插件形状 = loader `require()` 契约：`module.exports = { name, capabilities, external, eventSource?, eventMappings?, transformEvent?, createRuntime(ctx) }`（loader.ts:113+）
- claude CLI 与登录是**环境前置**（SDK spawn CLI，二进制不可打包）；无凭据/无 CLI 时 prompt 显式失败为 `turn.failed` 事件，不炸 gateway
- 工具三原语契约（Plan 2 已钉）：tool.call `{callID, tool, input, sessionID?, messageID?}` / tool.delta `{callID, kind:'input'|'output', text}` / tool.result `{callID, output, isError}`；`toolpart_<tool_use_id>` id 方案（live/历史同 id 去重）
- 事件载荷 flat（Plan 2 Task 6 已立）：message.updated 产 `{message}`；SSE egress 已自动还原 `{info}`（零额外工作）
- adapter 测试用 TUI 模式：node --test + `.ts` 后缀相对导入、**禁 TS parameter properties**（strip-only 不支持）、SDK 经构造注入（无模块 mock）
- 核心 auth 切换：消费方注入 `getApiKey(name)` seam；index.ts 单点接线 `active runtime credentials ?? legacy auth.json ?? null`（legacy 兜底是显式裁决——见 Review Focus 5，移除兜底是后续独立翻转）
- TDD 先行；commit 单行 `-m`；交付汇报新增测试数与全量通过数
- **不触碰** `packages/desktop/src/renderer/mafw/chat/use-send-message.*` 与 `ChatPane.tsx`（并行会话未提交工作）

## Review Focus

1. **claude CLI 缺失/无凭据**（spawn 失败）——promptAsync 产 `turn.failed`（error 文本含原因），不炸 gateway → Task 3 测试
2. **busy 会话排队**——promptWhileBusy 语义：query 进行中的 promptAsync 入队，result 后 flush（一次一条）→ Task 3 测试
3. **tool_use/tool_result 关联**——`toolpart_<tool_use_id>` 在 live（assembler）与历史（normalize）同 id；input_json_delta 先于 assistant 消息到达时 assembler 容忍（applyDelta 无 working 态 = no-op，applyCall 携完整 input 兜底）→ Task 1/2 测试
4. **result 双判别行序**——`terminal_reason: aborted_*` 的 result（subtype 多为 error_during_execution）必须先命中 aborted 行再落 failed 行 → Task 1 测试
5. **凭据兜底链不回归启动序**——TTS/嵌入等启动期服务在 runtime 未激活时仍能取 key（legacy 兜底保证）；激活后走 runtime credentials → Task 5 测试

---

### Task 1: claude 事件方言（映射表 + 转换器）

**Files:**
- Create: `adapters/claude/package.json`（private、`"type": "module"`、deps: `@anthropic-ai/claude-agent-sdk@^0.3.305`；scripts.test = `node --test tests/*.test.ts`）
- Create: `adapters/claude/src/events.ts`
- Test: `adapters/claude/tests/events.test.ts`

**Interfaces:**
- Produces:

```ts
export const CLAUDE_EVENT_SOURCE = { typePath: '$.type', sessionIdPath: '$.session_id' };
export const CLAUDE_EVENT_MAPPINGS: EventMapping[];   // system×3 + result×7（判别行）
export const claudeTransformEvent: TransformEventFn;   // user / assistant / stream_event 拆分与合成
```

- EventMapping/TransformEventFn 类型从 gateway 源复制为本地声明（adapter 不依赖 gateway 源码——单文件自包含；字段语义与 `gateway/src/runtime/event-mapper.ts` 逐字一致）
- SDKMessage fixtures（钉死调研形状）：
  - `system/init {session_id, model, tools[], permissionMode}`；`system/status {status:'compacting'}`；`system/compact_boundary`
  - `assistant {session_id, uuid, message: {id, role:'assistant', content: [text|thinking|tool_use 块], model, stop_reason, usage}}`
  - `user {session_id, uuid, message: {role:'user', content: [text 块 | tool_result 块 {tool_use_id, content, is_error}]}}`
  - `result {session_id, subtype: success|error_max_turns|error_during_execution|error_max_budget_usd|error_max_structured_output_retries, result, is_error, num_turns, total_cost_usd, usage, terminal_reason}`
  - `stream_event {session_id, event: {type:'content_block_delta', delta: {type:'text_delta',text}|{type:'thinking_delta',thinking}|{type:'input_json_delta',partial_json}}}`

- [ ] **Step 1: 写失败测试**（fixtures 走 `applyEventMappings`（本地实现，语义同 event-mapper：mappings 序 → transform → null=suppressed）+ `wrapToolPartAssembly` 不引入——三原语直接断言）

断言：①system/init→session.created（model 保留）；②status+compacting→session.compacting；③compact_boundary→session.compacted；④result success→turn.completed（usage/tokens 进 properties）；⑤result `terminal_reason:'aborted_streaming'`+`subtype:'error_during_execution'`→turn.aborted（**行序**：aborted 行先于 error 行）；⑥四个 error_* subtype→turn.failed；⑦assistant 拆分：message.updated（flat `{message:{id:'cla_<uuid>', role:'assistant', finish:stop_reason, model}}`）+ text 块→part.updated + thinking 块→part.updated(reasoning) + tool_use 块→tool.call（callID=tool_use.id、tool=name、input 完整）；⑧user 纯文本→[turn.started(每回合首条，模块状态在 result 后复位), message.updated(user), part.updated(text)]；⑨user tool_result→tool.result（callID=tool_use_id、output、isError）；⑩stream_event text_delta→part.delta（field:'text'）；thinking_delta→part.delta；input_json_delta→tool.delta（kind:'input'，text=partial_json）

Run: `cd adapters/claude && npm install && npm test`
Expected: FAIL（events.ts 不存在）

- [ ] **Step 2: 实现 events.ts**

mappings 声明式行（system×3、result×7——aborted_streaming/aborted_tools 两行在前、success 一行、error_* 四行）；transformEvent：模块级 `turnStartedBySession: Map<string, boolean>`（result 置 false、user 首条发 turn.started 后置 true）；assistant/user/stream_event 三分支一进多出（数组返回）；本地 `applyEventMappings` 迷你实现（mappings 序匹配 + when 条件 + fields/passProperties——语义同 gateway event-mapper 的执行器子集，够用即可）。

- [ ] **Step 3: 跑测试转绿**

Run: `cd adapters/claude && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

`feat(claude-adapter): event dialect - system/result mapping rows + assistant split / tool_result / stream_event dispatch / turn.started synthesis`

---

### Task 2: claude 历史 normalize

**Files:**
- Create: `adapters/claude/src/history.ts`
- Test: `adapters/claude/tests/history.test.ts`

**Interfaces:**
- Consumes: Task 1 的类型约定
- Produces: `normalizeClaudeHistory(raw: any[]): MafwMessage[]`（MafwMessage 本地声明，语义同 gateway/src/runtime/canonical-types.ts——零换名 flat）

- [ ] **Step 1: 写失败测试**

fixtures（SDK `getSessionMessages` 形状：`[{uuid, role:'user'|'assistant', content: 块[], parent_tool_use_id, timestamp?}]`）：
①user 文本→`{id:'clu_<uuid>', role:'user', content:[text part]}`；②assistant text+thinking→对应 parts；③assistant tool_use 块 + 后随 user 的 tool_result 块（tool_use_id 关联）→`toolpart_<tool_use_id>` tool part（state completed/error，与 Plan 1 pi-normalize 同构）；④无 result 的 tool_use→running；⑤stop_reason→finish、usage→tokens 透传。

Run: `cd adapters/claude && npm test`
Expected: FAIL

- [ ] **Step 2: 实现**（pi-message-normalize 同构移植：toolCallId 关联 Map + 单 ToolPart 合并）

- [ ] **Step 3: 转绿 + Commit**

`feat(claude-adapter): history normalize - SDK messages to flat MafwMessage (toolpart pairing)`

---

### Task 3: claude runtime（会话/总线/query 桥/工具注册）

**Files:**
- Create: `adapters/claude/src/runtime.ts`
- Test: `adapters/claude/tests/runtime.test.ts`

**Interfaces:**
- Consumes: Task 1 events、Task 2 history
- Produces: `createClaudeRuntime(deps: ClaudeRuntimeDeps): AgentRuntime`（本地声明契约子集）：

```ts
interface ClaudeSdk {              // SDK 注入 seam（index.ts 接真件，测试接假件）
  query(args: { prompt: string; options?: any }): QueryLike;   // QueryLike = AsyncGenerator<SDKMessage> & { interrupt(): void }
  listSessions(): Promise<any[]>;
  getSessionMessages(sessionId: string): Promise<any[]>;
}
interface ClaudeRuntimeDeps { sdk: ClaudeSdk; log?: {info;warn;error}; now?: () => number }
```

runtime 面：`session.{create,promptAsync,messages,abort,list,delete}`、`global.event()`（PiEventStream 同款 fan-out 总线）、`tools.registerTools(factory)`（stash factory；prompt 时把六件套经 SDK 的 in-process MCP server（`createSdkMcpServer` seam 或 options.mcpServers 自定义 server 对象——实现时按 SDK 实际 API 取，测试只断言 stash 与 prompt 透传）、`normalizeMessages = normalizeClaudeHistory`、`getBaseUrl() => 'http://127.0.0.1:<gatewayPort>'`（pi 同款语义）、`external: true`、capabilities `{sessionApi, promptWhileBusy, eventStream, sessionStorageApi, sessionBranchApi?, turnBudgetApi}`（fork/maxTurns 支持与否按 SDK seam 实测再定，缺则降级声明）

- [ ] **Step 1: 写失败测试**（假 SDK：scripted query 返回 fixture 消息流）

①create→`{id:'cls_...'}`；②promptAsync→query 被调（prompt 文本 + options.sessionId + mcpServers 携 stash 的工具 server）→流内消息经映射进 `global.event()`（端到端：prompt 后消费总线得 session.created→…→turn.completed）；③busy 排队：query 进行中再 promptAsync→入队；流结束（result）→flush 队首一条（Review Focus 2）；④abort→interrupt() 被调；⑤**spawn 失败**：假 SDK query 抛错（ECONN/CLI 缺失模拟）→总线收到 `turn.failed`（error 含原因，Review Focus 1）+ 会话解忙；⑥messages→sdk.getSessionMessages→normalizeClaudeHistory 产物；⑦delete/list 最小实现。

Run: `cd adapters/claude && npm test`
Expected: FAIL

- [ ] **Step 2: 实现 runtime.ts**（session 注册表 Map<sid, {busy, queue[], controller?}>；promptAsync：busy? 入队 : spawn；spawn 循环 for-await 消息→`bus.push({...msg, session_id: msg.session_id ?? sid})`；catch→push turn.failed；finally→busy=false+flush）

- [ ] **Step 3: 转绿 + Commit**

`feat(claude-adapter): runtime - session registry + event bus + query bridge + busy queue + tool stash`

---

### Task 4: 打包 + loader 加载验收（零核心 diff）

**Files:**
- Create: `adapters/claude/src/index.ts`（插件入口：`module.exports = {name:'claude', capabilities, external:true, eventSource, eventMappings, transformEvent, createRuntime(ctx)}`——动态 import SDK 接真件；CJS 导出经 esbuild `--format=cjs`）
- Create: `adapters/claude/build.mjs`（esbuild API：bundle→`dist/claude.js`，platform=node、format=cjs、target=node22、external:[]——SDK 全打包）
- Create: `gateway/tests/unit/runtime/claude-adapter-acceptance.test.ts`
- Modify: **无**（gateway/src 零改动——本任务的验收本身就是这条）

**Interfaces:**
- Consumes: loader `RuntimePluginLoader`（公共 API）、Task 1-3 产物
- Produces: `adapters/claude/dist/claude.js`（gitignore dist）；验收测试

- [ ] **Step 1: 写失败测试**（gateway jest）

①esbuild API 现场打包 `adapters/claude/src/index.ts` → tmp 目录 `claude.js`；②`new RuntimePluginLoader(tmpDir)` + `setCanonicalTypes(CANONICAL_TYPE_SET 同款)` + `scan()` → state ok、name='claude'；③`createRuntime`（假 ctx：fetch/log/pluginConfig/events.make/check）→ runtime 返回：capabilities 断言 + `global.event()` 可订阅 + session.create 工作（SDK 真 spawn 不发生——create 不 spawn ✓）；④**验收线断言**：`git diff --stat gateway/src` 为空（execSync git，工作树中 gateway/src 无未提交改动——本任务不碰它，断言防回归）；⑤映射表经 validateEventMappings 零 issue（loader scan 内建）。

Run: `cd gateway && npx jest tests/unit/runtime/claude-adapter-acceptance.test.ts`
Expected: FAIL（index.ts/build 不存在）

- [ ] **Step 2: 实现 index.ts + build.mjs**

- [ ] **Step 3: 转绿 + 手动冒烟（可选）**：`node adapters/claude/build.mjs && Copy-Item dist/claude.js ~/.mafw/runtime-plugins/claude.js`（用户环境实装；有 claude 登录则 `mafw` 重启后 `GET /api/runtime` plugins 列表可见 'claude'——无登录则跳过，fixture 验收已充分）

- [ ] **Step 4: Commit**

`feat(claude-adapter): bundle + zero-core-diff acceptance - esbuild single-file CJS, real-loader registration, git-diff gateway/src empty`

---

### Task 5: auth.json 8 消费方切注入式凭据

**Files:**
- Modify: `gateway/src/media/pi-adapter.ts`、`gateway/src/media/plugin-context.ts`、`gateway/src/media/tts-service.ts`、`gateway/src/media/media-runtime-executor.ts`、`gateway/src/memory/embedding-provider.ts`、`gateway/src/plugins/package-context.ts`、`gateway/src/usage/plugin-context.ts`、`gateway/src/index.ts`（单点接线 + :56 import 移除）
- Test: 既有套件回归 + 新增 `gateway/tests/unit/runtime/credentials-wiring.test.ts`

**Interfaces:**
- Produces: 各消费方构造参数增 `getApiKey?: (provider: string) => string | null`（缺省 null——fail-open 不变）；index.ts 单点：

```ts
private runtimeGetApiKey(provider: string): string | null {
  return this.runtime?.credentials?.getApiKey(provider) ?? getProviderApiKey(provider);
}
```

（active runtime credentials 优先 → legacy auth.json 兜底 → null；**裁决**：保留兜底而非纯 null——TTS/嵌入/usage 在 runtime 未激活或凭据缺失时的启动序零回归；移除兜底是后续独立翻转，ledger 记录）

- [ ] **Step 1: 写失败测试**

①wiring 测试：mock runtime credentials 返回 'k1' → runtimeGetApiKey='k1'；runtime 无 credentials → legacy 路径（mock auth 模块）；两者皆无 → null；②各消费方：构造注入 getApiKey → 消费路径用它（media plugin-context ctx.apiKey、tts、embedding、usage ctx 各一例——断言注入值到达）。

Run: `cd gateway && npx jest tests/unit/runtime/credentials-wiring.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现切换**（8 处 import 移除、构造点接 index 注入；pi-adapter 的 DEFAULT_AUTH_PATH 直读改为经注入 seam——media 引擎的 pi 认证链 `注入 ?? null`，index 接线时给 runtime 优先+legacy 兜底同款 getter）

- [ ] **Step 3: 回归**：`cd gateway && npx jest tests/unit/media tests/unit/usage tests/unit/memory` → PASS；全量 `npx jest` → PASS

- [ ] **Step 4: Commit**

`refactor(runtime): auth.json consumers -> injected credentials seam - single wiring point (active runtime credentials -> legacy fallback -> null), 8 imports removed from core`

---

### Task 6: 路由 / env / 命名清洗

**Files:**
- Modify: `gateway/src/index.ts`（`/api/opencode-config` → `/api/runtime-config` 双路由（新名 + 旧名 alias 同 handler，注释标注两个 minor 后移除）；`MAFW_OPENCODE_PASSWORD` → `MAFW_RUNTIME_PASSWORD`（读旧 env 兜底，3 处）；`handleOpencodeEvent` → `handleRuntimeEvent`（含全部调用点）；`subscribeToEvents` 内日志 "OpenCode events" → 中性 "runtime events"）
- Test: `gateway/tests/unit/routes/runtime-config-route.test.ts`（新）+ 既有引用点回归

**Interfaces:**
- Produces: `GET/PATCH /api/runtime-config`（行为逐字节等价——同一 handler 两个路由名）；env 双读

- [ ] **Step 1: 写失败测试**（路由测试：新名 GET/PATCH 通、旧名 alias 通、行为等价）

Run: `cd gateway && npx jest tests/unit/routes/runtime-config-route.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现**（route-catalog.ts 登记新路由 operationId `runtime.config`——SDK 契约面同步：`packages/gateway-sdk` 的 api-schema 经 `npm run build` 重生成——gen:api 从 route-catalog 驱动）

- [ ] **Step 3: 转绿 + gateway 全量**

- [ ] **Step 4: Commit**

`refactor(runtime): de-opencode core naming - /api/runtime-config (compat alias), MAFW_RUNTIME_PASSWORD (legacy fallback), handleRuntimeEvent`

---

### Task 7: 依赖边界守卫 + 三端全量回归

**Files:**
- Create: `gateway/tests/unit/runtime/dependency-boundary.test.ts`
- Test: 同上

**Interfaces:**
- Produces: 守卫测试——扫描 `gateway/src/**/*.ts`（排除 `runtime/**`）：禁 import `@opencode-ai/sdk` 与 `@earendil-works/pi-coding-agent`（含子路径）；`runtime/auth.ts` 仅允许 `runtime/**` 与 `index.ts`（单点接线）import

- [ ] **Step 1: 写测试**（先跑——当前应 PASS：Plan 1-3 已收敛边界；若红则说明有漏网 import，按发现修）

Run: `cd gateway && npx jest tests/unit/runtime/dependency-boundary.test.ts`
Expected: PASS（守卫立起来；红=漏网，修之）

- [ ] **Step 2: 三端全量回归 + 交付汇报**

Run: `cd gateway && npx jest`；`cd adapters/claude && npm test`；`cd packages/desktop && npm test`；`cd packages/tui && node --test "tests/*.test.ts"`
Expected: 四套全绿

- [ ] **Step 3: Commit**

`test(runtime): dependency boundary guard (SDK imports quarantined to runtime/; auth.ts single wiring point) + full regression`

---

## 验收线重述（设计 §6）

1. **新增 SDK = 零 gateway 核心改动 + 一个 plugin 文件**（Task 4 的 git-diff 断言 + 真 loader 注册）
2. claude 方言 conformance：fixture 级全绿（Task 1-3 测试即 conformance）
3. 核心清洗：8 auth import 归零、路由/env 双轨、边界守卫常驻
4. 三端 + adapter 四套全绿
