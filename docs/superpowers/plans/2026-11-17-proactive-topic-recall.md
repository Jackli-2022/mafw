# Proactive Topic Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有 recall 上方增加 per-session 主题状态与相关记忆标题，提供 `mafw_topic_set`，并让主 Agent 通过 proactive memory guide 主动设置和纠正主题。

**Architecture:** Topic State 存于现有 `gateway.db` kv store，按 session 隔离；gateway 同时提供 HTTP 与 MCP 写入契约，OpenCode 原生工具自动携带 sessionID。recall route 在旧召回本体前 prepend 一个小头部；本刀不改检索、FOK、快照或记忆合并算法。

**Tech Stack:** TypeScript、Node HTTP、better-sqlite3 kv、Zod、Jest、runtime-core node:test、TypeBox route schemas。

**Spec:** `docs/superpowers/specs/2026-11-17-personal-memory-first-principles-design.md`（重点 §6、§14）

## Global Constraints

- 在主 checkout 工作，不创建 worktree/branch；不得覆盖其他会话已有未提交改动。
- TDD：每个任务先写失败测试并确认失败，再写最小实现。
- 100ms 边界不新增 LLM；topic 读写只走 SQLite kv。
- Topic State per-session；新会话未设置；同 session 跨 gateway 重启保留；不继承其他 session。
- `mafw_topic_set` 不取代 `mafw_mark_episode_boundary`，不自动写长期记忆，不授予执行权限。
- 首刀 `matterId` 只是可选不透明字符串，不创建 Matter 注册表。
- 新头部叠加在旧 recall 上方；本刀不宣称完成严格相关门控，不改旧候选本体。
- 不在 prompt 中引用不存在的 retract/clarify 工具。
- canonical prompt 与 OpenCode fallback 同步修改；直接 MCP 调用必须显式 sessionID。

## Review Focus

- 并发会话：两个 session 设置不同主题不能互相覆盖 → Task 1 加双 session 隔离测试。
- 陈旧主题：新 session 与 `active:false` 都显示“未设置” → Task 1/2 各加测试。
- 来源伪造：工具不接受 Agent 自报当前 trace，gateway 从 `currentTurn(sessionID)` 附加 → Task 1 加测试。
- 旧 recall 回归：头部必须在旧 `<recall>` 前，旧本体逐字保留 → Task 2 加顺序与相等性测试。
- 宿主漂移：canonical/fallback prompt 都包含相同主题规则，子代理不被要求设置主题 → Task 4 加文案一致性测试。

---

### Task 1: Topic State + HTTP/MCP 领域契约

**Files:**
- Create: `gateway/src/recall/topic-state.ts`
- Modify: `gateway/src/routes/schemas/recall.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/recall.ts`
- Modify: `gateway/src/types.ts`
- Modify: `gateway/src/kernel.ts`（仅 Services wiring）
- Test: `gateway/tests/unit/recall/topic-state.test.ts`
- Test: `gateway/tests/unit/routes/recall-wiring.test.ts`

**Interfaces:**
- Produces:
  - `TopicState`：`sessionId/topic/summary?/entities/aliases/openLoops/retrievalKeys/matterId?/active/revision/sourceTraceId?/updatedAt`。
  - `readTopicState(db, sessionID): TopicState | null`。
  - `setTopicState(db, input): TopicState`；`expectedRevision` 不匹配抛 `TopicRevisionConflict`。
  - `POST /api/recall/topic`，operationId `recall.topicSet`。
  - MCP Services：`getTopic(sessionID)` / `setTopic(input)`，供 Task 3 使用。
- `setTopicState` 从 `db.currentTurn(sessionID)?.trace_id` 附加 `sourceTraceId`；input 不接受该字段。

- [ ] **Step 1: 写状态与路由失败测试**
  - 首次设置得到 revision=1；同 session 更新 revision=2。
  - 两个 session 可持不同主题；新 session 返回 null。
  - `active:false` 保留记录但 `readTopicState` 返回 null。
  - stale `expectedRevision` 触发 `TopicRevisionConflict`。
  - 当前 turn 为 `t1t_real` 时 state 自动带它；payload 伪造字段被忽略。
  - HTTP 缺 sessionID=400、冲突=409、正常响应 `{ok:true,state}`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/topic-state.test.ts tests/unit/routes/recall-wiring.test.ts`

Expected: FAIL，模块/路由尚不存在。

- [ ] **Step 3: 实现最小状态模块、HTTP route、catalog/schema 与 Services wiring**
  - kv scope 固定 `session-topic`；只存当前 session 状态。
  - `active:false` 不清除历史记录；读取视为未设置。
  - route body 限制 64KiB；字符串/数组做有界校验。
  - 新增 TypeBox schema 并登记 `errors:[400,409]`。

- [ ] **Step 4: 跑测试确认通过并刷新契约产物**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/topic-state.test.ts tests/unit/routes/recall-wiring.test.ts`

Run: `cd gateway; npm run emit:openapi`

Run: `npm run gen:api -w @mafw/sdk`

Expected: 测试 PASS；生成物与 catalog 一致。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/topic-state.ts gateway/src/routes/{recall.ts,route-catalog.ts,schemas/recall.ts} gateway/src/{types.ts,kernel.ts} gateway/tests/unit/recall/topic-state.test.ts gateway/tests/unit/routes/recall-wiring.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(memory): add per-session topic state contract"
```

### Task 2: 每轮 Topic/相关记忆头部

**Files:**
- Create: `gateway/src/recall/topic-recall.ts`
- Modify: `gateway/src/routes/recall.ts`
- Test: `gateway/tests/unit/recall/topic-recall.test.ts`
- Test: `gateway/tests/unit/routes/recall-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 `TopicState`、`readTopicState`。
- Produces: `renderTopicRecallHeader(state: TopicState | null, hasRecallBody: boolean): string`。
- 正常响应的 `pointers` = `topicHeader + 原有 blocks`；异常仍保持 fail-open `{pointers:null}`。

- [ ] **Step 1: 写头部失败测试**
  - 有主题有本体：`主题：X` + `相关记忆：见下方`，且位于旧 `<recall>` 前。
  - 有主题无本体：`相关记忆：无`。
  - 未设置：`主题：未设置`，并包含 `mafw_topic_set` 提示。
  - 空 query 正常路径也返回头部；旧 note-board/goal 顺序不变。
  - route 抛错仍 `{pointers:null}`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/topic-recall.test.ts tests/unit/routes/recall-wiring.test.ts`

Expected: FAIL，头部尚未生成。

- [ ] **Step 3: 实现纯 formatter，并在 empty-query 与正常最终响应（snapshot/live 共用）统一 prepend**
  - 不改 `inject-format.ts`，旧 recall 文本保持原样。
  - `hasRecallBody` 只表示是否存在旧召回本体，不宣称已通过新的语义相关门。

- [ ] **Step 4: 跑相关测试确认通过**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/topic-recall.test.ts tests/unit/routes/recall-wiring.test.ts tests/unit/session-recall-hook.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/topic-recall.ts gateway/src/routes/recall.ts gateway/tests/unit/recall/topic-recall.test.ts gateway/tests/unit/routes/recall-wiring.test.ts
git commit -m "feat(memory): prepend topic state to every recall"
```

### Task 3: `mafw_topic_set` OpenCode + MCP 工具

**Files:**
- Create: `src/tools/topic-set.ts`
- Create: `gateway/src/mcp/handlers/topic-set.ts`
- Modify: `src/plugin.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Test: `tests/topic-set.test.ts`
- Test: `gateway/tests/unit/mcp/topic-set.test.ts`

**Interfaces:**
- Consumes: Task 1 HTTP endpoint 与 MCP Services。
- Produces: 工具名 `mafw_topic_set`；参数 `topic?/matterId?/summary?/entities?/aliases?/openLoops?/retrievalKeys?/active?/expectedRevision?`。
- OpenCode 自动附加 `ctx.sessionID`；MCP 缺 sessionID 返回结构化错误，不写全局状态。

- [ ] **Step 1: 写工具失败测试**
  - OpenCode POST body 含当前 sessionID 与全部字段，不含 sourceTraceId。
  - 成功返回主题与 revision；HTTP 409/网络失败不 throw，返回 `metadata.ok=false`。
  - MCP 有 sessionID 时调用 Task 1 Services；缺失时 `isError=true` 且零写入。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/topic-set.test.ts`

Run: `cd gateway; npx jest --runInBand tests/unit/mcp/topic-set.test.ts`

Expected: FAIL，工具尚未注册/实现。

- [ ] **Step 3: 实现两个适配器并注册工具**
  - 复用 add-memory/episode-boundary 的 timeout 与非抛出错误风格。
  - MCP input/output schema 照实声明；annotations 为写状态、非人类审批面。
  - 子代理限制由 Task 4 prompt 与 per-session 隔离共同约束，本刀不新增全局内部会话判定。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/topic-set.test.ts`

Run: `cd gateway; npx jest --runInBand tests/unit/mcp/topic-set.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/topic-set.ts src/plugin.ts tests/topic-set.test.ts gateway/src/mcp/handlers/topic-set.ts gateway/src/mcp/tool-registry.ts gateway/tests/unit/mcp/topic-set.test.ts
git commit -m "feat(memory): expose mafw_topic_set to agents"
```

### Task 4: Proactive prompt、文档与全量门禁

**Files:**
- Modify: `packages/runtime-core/src/host-adapter.ts`
- Modify: `src/hooks/memory-guide.ts`
- Modify: `docs/architecture/memory.md`
- Create: `packages/runtime-core/src/memory-guide.test.ts`
- Create: `tests/memory-guide.test.ts`
- Create: `docs/releases/2026-11-17-proactive-topic-recall.md`

**Interfaces:**
- Consumes: 已注册的 `mafw_topic_set` 与现有 search/get/add/supersede 工具。
- Produces: canonical/fallback 相同的“主题管理（proactive）”规则。

- [ ] **Step 1: 写 prompt 失败测试**
  - 两份 guide 都包含：未设置时调用 `mafw_topic_set`；主题偏移主动纠正；相关记忆与当前对话不一致先核实；无相关记忆不补位。
  - 子代理条款明确不调用 `mafw_topic_set`。
  - 不包含不存在的 retract/clarify 工具指令。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:core`

Run: `npx jest --runInBand tests/memory-guide.test.ts`

Expected: 新增断言 FAIL。

- [ ] **Step 3: 同步修改 canonical/fallback prompt 与架构文档**
  - 主题管理放在现有记忆指南前部；不改现有 pinned/sticky/episode 语义。
  - `memory.md` 记录 Topic State 是 per-session 注意力状态，首刀不改变检索门控。

- [ ] **Step 4: 跑定向、类型与全量门禁**

Run: `npm run test:core`

Run: `npx jest --runInBand tests/topic-set.test.ts tests/memory-guide.test.ts`

Run: `cd gateway; npx jest --runInBand tests/unit/recall/topic-state.test.ts tests/unit/recall/topic-recall.test.ts tests/unit/mcp/topic-set.test.ts tests/unit/routes/recall-wiring.test.ts tests/unit/session-recall-hook.test.ts tests/unit/api-contract.test.ts`

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`

Run: `npx tsc --noEmit`

Run: `cd gateway; npm test -- --forceExit`

Expected: 全部 PASS；记录新增测试数与 gateway 全量 suite/test/pass/skip 数。

- [ ] **Step 5: 写交付记录并 Commit**
  - release 文档记录范围、非目标、实际 commit、测试数量；不 bump 版本、不宣称完成完整记忆重设计。

```bash
git add packages/runtime-core/src/{host-adapter.ts,memory-guide.test.ts} src/hooks/memory-guide.ts tests/memory-guide.test.ts docs/architecture/memory.md docs/releases/2026-11-17-proactive-topic-recall.md docs/superpowers/specs/2026-11-17-personal-memory-first-principles-design.md docs/superpowers/plans/2026-11-17-proactive-topic-recall.md
git commit -m "docs(memory): guide proactive topic management"
```
