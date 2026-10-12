# MAFW 事件词汇 v2（mafw_event）重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 SSE 事件面从「opencode 形状词汇」切换为 MAFW 自有词汇 v2（turn 三元组统一回合终态、删除 Mode A 改写 hack、信封 `mafw_event`），所有 runtime 经同一翻译注册接口产出该词汇。

**Architecture:** 三层结构不动（SDK union ↔ 矩阵 ↔ desktop 穷尽守卫 + TUI 新增弱守卫），换血词汇常量；opencode 经 `registerBuiltin` 携 `OPENCODE_EVENT_MAPPINGS` 接入与文件插件同一注册接口；facet 规则表重写（`broadcast` 字段删除、`toolCommand` 载体迁移到 tool part 快照）；分支上 A/B/C 三 commit 原子切换。

**Tech Stack:** TypeScript (gateway CJS tsc / SDK / desktop SolidJS+TS / TUI node --test)、jest（gateway）、bun test（desktop）。

**Spec:** `docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md`（决策 D1-D6 已定）· 调研：`docs/research/2026-10-12-native-event-vocabulary-refactor-research.md`

## Global Constraints

- **B 档冻结面**：Part DTO 载荷（part.type 判别子 / ToolPart `{input,metadata,tool,output,status}` 状态机 / `{info,parts}` 消息模型 / Question·Permission DTO 镜像）**形状一律不动**——只换事件类型名与信封名。
- **改名映射字典（全计划唯一事实源，机械替换均以此为准）**：

| 旧 | 新 | 备注 |
|---|---|---|
| `session.idle` | `turn.completed` | |
| `session.error` / `message.error`（双发） | `turn.failed` | 两词都映射到同一新词；消费方幂等 |
| `message.aborted` | `turn.aborted` | |
| `message.part.updated` / `.delta` / `.complete` | `part.updated` / `part.delta` / `part.complete` | 载荷不变 |
| `todo.updated` | `plan.updated` | |
| 信封 `opencode_event` | `mafw_event` | SDK/gateway/desktop 剥壳兼容 `raw?.data \|\| raw` 不变 |
| `message.complete` | **删除** | 唯一发射点是 Mode A 改写，随本重构消亡 |
| `session.next.*` 全族 | **删除**（翻译层 drop） | v1 宿主插件在进程内消费原生事件，不经 gateway |
| （新增）`usage.updated` / `connected` / `goal_node`(flat) | | |

- **不变名词**（收编，禁止顺手改名）：`session.created/updated/deleted/compacting/compacted`、`message.updated`、`question.asked/replied/rejected`、`permission.asked/replied`（asked 载荷新增**可选** `options?: string[]`、`suggestedRule?: string`）、`trajectory.event/turn`、`permission_mode`、`session.diff`、扁平 13 条。
- **计数断言**：SDK `RUNTIME_EVENT_TYPES` 25→**24**、`FLAT_EVENT_TYPES` 13→**14**（`events.test.ts` 的 `toBe(25)/toBe(13)` 同步改）。
- **测试命令**：gateway `cd gateway && npx jest --silent`；desktop `cd packages/desktop && bun test`；TUI `cd packages/tui && node --test tests/`；全量 `npm run build`。
- **分支策略**：Phase 0/1 各任务独立绿、可直接落当前分支；Phase 2-4 在 `mafw-event-v2` 分支，按 commit A（gateway+SDK 源）→ B（desktop+SDK rebuild）→ C（TUI）三段，A→B 之间 wire 不兼容**只存在于分支**；PR 级跑全量门。
- **禁止**：修改 Part DTO 形状、v1 插件（`src/plugin.ts`）、deprecated legacy 路径（`core/plugin.ts` 等 AGENTS.md §5.22 死代码清单）。

---

## Phase 0：独立前置修复（每任务独立可合入）

### Task P0-1: goal_node 补登三层守卫 + goal_created/phase_transition 矩阵列修正

**Files:**
- Modify: `packages/gateway-sdk/src/events.ts`（FLAT_EVENT_TYPES + FlatGatewayEvent union + events.test 计数）
- Modify: `gateway/src/runtime/event-flow-matrix.ts`（新行 + 68/70 行 desktop 列）
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts`（IGNORED_AT_SHELL 移除两项 + assertShellEventCoverage 补 case）
- Test: `packages/gateway-sdk/src/events.test.ts`、`packages/desktop/src/renderer/mafw/session-events.test.ts`

**Interfaces:** Produces: SDK union 含 `"goal_node"`；矩阵行 `'goal_node': R([], 'passthrough', 'handled', 'ignore', ...)`。

- [ ] **Step 1: SDK 登记**——`FLAT_EVENT_TYPES` 数组尾加 `"goal_node"`；union 加 `| { type: "goal_node"; goalId?: string; projectDir?: string; [key: string]: any }`；`events.test.ts` 计数断言 13→14。
- [ ] **Step 2: 矩阵**——扁平段尾加行；`goal_created`/`phase_transition` 行 desktop 列 `'ignore'`→`'handled'`，note 改「desktop goalsRev（P2 起消费）」。
- [ ] **Step 3: desktop**——`IGNORED_AT_SHELL` 移除 `"goal_created"`、`"phase_transition"`；`assertShellEventCoverage` switch 补三个 case（goal_node/goal_created/phase_transition → 归入 handled 分支，与 `user_question` 同路径）。
- [ ] **Step 4: 验证**——`cd gateway && npx jest tests/unit/runtime/event-flow-matrix.test.ts --silent`（绿）；`cd packages/desktop && bun test`（绿）。
- [ ] **Step 5: Commit**——`git commit -m "fix(events): register goal_node in SDK/matrix/shell guard; matrix desktop columns for goal_created/phase_transition"`

### Task P0-2: connected 问候帧登记 + dispatcher 消费

**Files:**
- Modify: `packages/gateway-sdk/src/events.ts` + `events.test.ts`
- Modify: `gateway/src/runtime/event-flow-matrix.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`（early branch）
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts`（穷尽 case）
- Test: `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`（新增用例）

- [ ] **Step 1: SDK**——`FLAT_EVENT_TYPES` 加 `"connected"`；union 加 `| { type: "connected"; timestamp?: string }`；计数断言 14→15（本任务后 FLAT=15；Phase 2 会计入最终数）。
- [ ] **Step 2: 矩阵**——加行 `'connected': R([], 'passthrough', 'handled', 'ignore', 'SSE 问候帧；desktop dispatcher 消费防 miss')`。
- [ ] **Step 3: dispatcher**——`sync` 分支之后加：
```ts
if (event.type === "connected") {
  deps.core.trace(event, "conn:greeting")
  return
}
```
- [ ] **Step 4: 穷尽 case + 测试**——session-events 补 case；dispatcher.test 加用例：dispatch `{type:'connected'}` 不触发 miss warn。
- [ ] **Step 5: 验证 + Commit**——bun test 绿；`git commit -m "fix(events): consume connected greeting frame at dispatcher (no more miss warn)"`

### Task P0-3: question_answered/question_cancelled 死发射删除

**Files:**
- Modify: `gateway/src/index.ts`（~:4510/:4517 两处 `this.eventBus.emit('question_answered'|'question_cancelled', ...)`）
- Modify: `gateway/src/event-bus.ts`（`GatewayEvent` union 移除两成员，若全仓无其他引用）

- [ ] **Step 1:** grep 确认无订阅者：`rg "question_answered|question_cancelled" gateway/src packages/` ——仅 index.ts 发射点与 event-bus.ts 类型。
- [ ] **Step 2:** 删除两处 emit 调用及其准备代码；union 移除两成员。
- [ ] **Step 3: 验证 + Commit**——`cd gateway && npx jest --silent`；`git commit -m "chore(events): remove dead question_answered/question_cancelled emits"`

### Task P0-4: pi 未知原生事件遥测（修静默丢弃盲区）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-events.ts`（translatePiEvent + 模块级 recorder）
- Modify: `gateway/src/index.ts`（pi 注册块 :501 后接线）
- Test: `gateway/tests/unit/runtime/pi-events.test.ts`

- [ ] **Step 1: 失败测试**——pi-events.test 加用例：`setPiUnknownRecorder(fn)` 后 `translatePiEvent({type:'queue_update',...}, 's1')` 返回 null 且 `fn` 被以 `'queue_update'` 调用。
- [ ] **Step 2: 跑测试确认失败**——`cd gateway && npx jest tests/unit/runtime/pi-events.test.ts --silent`，预期 FAIL。
- [ ] **Step 3: 实现**——pi-events.ts 模块级：
```ts
let piUnknownRecorder: ((type: string) => void) | undefined;
export function setPiUnknownRecorder(fn: ((type: string) => void) | undefined): void {
  piUnknownRecorder = fn;
}
```
`translatePiEvent` 的丢弃路径（applyEventMappings 返回空/未命中处，参照 :67-95 现形）调用 `piUnknownRecorder?.(String(evt?.type ?? 'unknown'))`（try/catch fail-open）。
- [ ] **Step 4: index.ts 接线**——`registerBuiltin('pi', ...)` 之后：`setPiUnknownRecorder((t) => { try { this.unknownEventTracker.record('pi', t) } catch { /* fail-open */ } })`。
- [ ] **Step 5: 验证 + Commit**——jest 绿；`git commit -m "feat(events): pi native unknown-event telemetry via setPiUnknownRecorder"`

### Task P0-5: TUI 第四道弱守卫（KNOWN_EVENTS ⊆ SDK union）

**Files:**
- Create: `packages/tui/tests/event-coverage.test.ts`

- [ ] **Step 1: 测试**（TUI 无守卫是 Phase 3 的最大风险，先补）：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { KNOWN_EVENTS } from "../src/store/connection.ts";
import { RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES } from "@mafw/sdk";

test("KNOWN_EVENTS all exist in SDK event union", () => {
  const union = new Set<string>([...RUNTIME_EVENT_TYPES, ...FLAT_EVENT_TYPES]);
  for (const e of KNOWN_EVENTS) {
    assert.ok(union.has(e), `KNOWN_EVENTS member not in SDK union: ${e}`);
  }
});
```
- [ ] **Step 2: 验证 + Commit**——`cd packages/tui && node --test tests/`（绿）；`git commit -m "test(tui): KNOWN_EVENTS cross-check against SDK event union"`

### Task P0-6: dry-event 对 builtin 的误导 400 修复

**Files:**
- Modify: `gateway/src/routes/dry-event.ts`（:64-66 附近）
- Test: `gateway/tests/unit/routes/dry-event.test.ts`

- [ ] **Step 1:** `getPluginEventEntry` 返回 null 时区分两态：`runtimeLoader.get(name)` 有 meta 但无 `extras` → 400 `plugin '<name>' is registered but declares no event mappings`；meta 也无 → 400 `unknown plugin '<name>'`。
- [ ] **Step 2: 测试**——两态各一用例（`opencode` 无 extras → 新错误消息）。
- [ ] **Step 3: 验证 + Commit**——jest 绿；`git commit -m "fix(dry-event): distinguish unknown plugin from builtin-without-mappings"`

---

## Phase 1：翻译基建（可独立合入）

### Task P1-1: event-mapper 透传原语（passProperties + 多路径 sessionIdPath）

**Files:**
- Modify: `gateway/src/runtime/event-mapper.ts`（EventMapping + EventSourceShape + applyEventMappings）
- Test: `gateway/tests/unit/runtime/event-mapper.test.ts`

**Interfaces:**
- Produces: `EventMapping.passProperties?: string`（路径表达式；输出 properties = 深拷贝该路径对象，`fields` 在其上覆写）；`EventSourceShape.sessionIdPath?: string | string[]`（多路径取首个 truthy）。

- [ ] **Step 1: 失败测试**——event-mapper.test 加两用例：
```ts
// 用例 A：passProperties 整段拷贝 + fields 覆写
const out = applyEventMappings(raw({ type: 'x', properties: { part: { type: 'text', text: 'hi', messageID: 'm1' }, keep: 1 } }),
  [{ from: 'x', to: 'part.updated', passProperties: '$.payload.properties', fields: { 'part.type': { const: 'step-finish' } } }],
  { typePath: '$.payload.type', sessionIdPath: '$.payload.sessionID' }, () => false, () => {});
assert.equal(out.length, 1);
assert.equal(out[0].payload.type, 'part.updated');
assert.equal(out[0].payload.properties.part.text, 'hi');       // 透传保留
assert.equal(out[0].payload.properties.part.type, 'step-finish'); // 覆写
assert.equal(out[0].payload.properties.keep, 1);               // 兄弟字段保留
// 用例 B：sessionIdPath 数组回退
// raw 无 payload.sessionID 但 properties.sessionID='s9' → out[0].sessionID === 's9'
```
（用例按测试文件既有 fixture 风格改写。）
- [ ] **Step 2: 跑测试确认失败。**
- [ ] **Step 3: 实现**——`applyEventMappings` 映射分支（现 :62-80）改为：
```ts
const properties: Record<string, any> = {};
if (m.passProperties) {
  const src = getPath(raw, m.passProperties);
  if (src && typeof src === 'object') properties = JSON.parse(JSON.stringify(src));
}
for (const [key, spec] of Object.entries(m.fields ?? {})) setPath(properties, key, evalField(spec, raw));
```
sessionIdPath 读取处改多路径：`Array.isArray(src.sessionIdPath) ? 首个 truthy : 单路径`。
- [ ] **Step 4: 验证**——`cd gateway && npx jest tests/unit/runtime/event-mapper.test.ts --silent`（全绿，含既有 80 行）。
- [ ] **Step 5: Commit**——`git commit -m "feat(event-mapper): passProperties copy primitive + multi-path sessionIdPath"`

---

## Phase 2（commit A）：词汇 v2 —— SDK 源 + gateway 全侧

> 本 Phase 全部任务在 `mafw-event-v2` 分支；A-1..A-12 完成后**一次性 commit**（gateway jest 直读 SDK 源码，中间态必红）。开始前：`git checkout -b mafw-event-v2`。

### Task A-1: SDK events.ts v2 + 矩阵 v2 + gateway 词汇常量模块

**Files:**
- Modify: `packages/gateway-sdk/src/events.ts`、`events.test.ts`、`sse.ts:39`（信封判定）
- Modify: `gateway/src/runtime/event-flow-matrix.ts`
- Create: `gateway/src/runtime/mafw-vocabulary.ts`
- Create: `gateway/tests/unit/runtime/vocabulary-sync.test.ts`
- Test: `gateway/tests/unit/runtime/event-flow-matrix.test.ts`

**Interfaces:** Produces: `MAFW` 常量对象（gateway 侧单一事实源，后续任务全部引用它，**不再写字符串字面量**）。

- [ ] **Step 1: 词汇常量模块**：
```ts
// gateway/src/runtime/mafw-vocabulary.ts
/** MAFW 事件词汇 v2 —— gateway 侧单一事实源（SDK events.ts 为客户端契约，双向交叉测试钉扎一致）。 */
export const MAFW = {
  sessionCreated: 'session.created', sessionUpdated: 'session.updated', sessionDeleted: 'session.deleted',
  turnCompleted: 'turn.completed', turnFailed: 'turn.failed', turnAborted: 'turn.aborted',
  sessionCompacting: 'session.compacting', sessionCompacted: 'session.compacted',
  messageUpdated: 'message.updated',
  partUpdated: 'part.updated', partDelta: 'part.delta', partComplete: 'part.complete',
  questionAsked: 'question.asked', questionReplied: 'question.replied', questionRejected: 'question.rejected',
  permissionAsked: 'permission.asked', permissionReplied: 'permission.replied',
  planUpdated: 'plan.updated', usageUpdated: 'usage.updated',
  trajectoryEvent: 'trajectory.event', trajectoryTurn: 'trajectory.turn',
  permissionMode: 'permission_mode', sessionDiff: 'session.diff', connected: 'connected',
  envelope: 'mafw_event',
} as const;
export const MAFW_RUNTIME_EVENT_NAMES: readonly string[] = Object.values(MAFW)
  .filter((v) => v !== MAFW.envelope);
export const MAFW_FLAT_EVENT_NAMES: readonly string[] = [
  'user_question', 'user_feedback', 'goal_created', 'state_change', 'phase_transition',
  'memory_written', 'memory_energy_changed', 'memory_distillation_complete',
  'automation_triggered', 'automation_completed', 'project_registered',
  'runtime_switched', 'mafw_commands_changed', 'goal_node',
];
```
- [ ] **Step 2: SDK v2**——`RUNTIME_EVENT_TYPES` 换为 24 项（见 Global Constraints 字典；删除 message.complete/message.error/message.aborted/message.part.*/todo.updated/session.idle/session.error/session.next.*，新增 turn 三元组/part 三条/plan.updated/usage.updated/connected）；`FLAT_EVENT_TYPES` 15 项（含 goal_node、connected）；信封 `OpencodeEventEnvelope.type: "mafw_event"`（类型名同步改 `MafwEventEnvelope`/`MafwEventData`，`UnwrappedEvent` 名保留）；`sse.ts:39` 剥壳判定改 `'mafw_event'`；`events.test.ts` 计数断言 24/15。
- [ ] **Step 3: 矩阵 v2**——按字典全表重写（骨架）：
```ts
// ---- 会话生命周期 ----
'session.created': R([], 'passthrough', 'handled', 'ignore', 'desktop 走 planSessionEvent invalidate'),
'session.updated': R([], 'passthrough', 'handled', 'ignore', 'desktop patch 标题/时间'),
'session.deleted': R([], 'passthrough', 'handled', 'ignore', 'desktop remove + closeSession'),
// ---- 回合终态（v2 一等公民；Mode A 改写已删除，统一 passthrough） ----
'turn.completed': R(['chatSignal'], 'passthrough', 'handled', 'handled', 'opencode session.idle / pi agent_end 翻译而来；trajectory turn 聚合挂此'),
'turn.failed':    R(['chatSignal'], 'passthrough', 'handled', 'handled', 'session.error+message.error 双发合并；广播带 error 提取'),
'turn.aborted':   R([], 'passthrough', 'handled', 'ignore', ''),
'session.compacting': R(['compaction'], 'passthrough', 'ignore', 'ignore', '仅 pi 发；gateway 触发 turnCompress flush'),
'session.compacted':  R(['compaction'], 'passthrough', 'handled', 'ignore', 'desktop 记录 compactionMarks'),
// ---- 消息/part 流 ----
'message.updated': R(['step', 'chatSignal'], 'passthrough', 'handled', 'ignore', ''),
'part.updated':    R(['step', 'chatSignal', 'toolCommand'], 'passthrough', 'handled', 'handled', '原 message.part.updated；toolCommand 载体（tool part 快照）'),
'part.delta':      R([], 'passthrough', 'handled', 'ignore', '原 message.part.delta'),
'part.complete':   R([], 'passthrough', 'handled', 'ignore', '原 message.part.complete'),
// ---- 问答/审批 ----
'question.asked': R([], 'passthrough', 'handled', 'ignore', ''),
'question.replied': R([], 'passthrough', 'handled', 'ignore', ''),
'question.rejected': R([], 'passthrough', 'handled', 'ignore', ''),
'permission.asked': R(['approval'], 'passthrough', 'handled', 'handled', 'v2 载荷可选 options[]/suggestedRule'),
'permission.replied': R([], 'passthrough', 'handled', 'ignore', ''),
// ---- 数据面 ----
'plan.updated': R([], 'passthrough', 'handled', 'ignore', '原 todo.updated；ACP plan/codex todo_list 同域'),
'usage.updated': R([], 'passthrough', 'ignore', 'ignore', 'v2 新增：gateway 在 turn 聚合后合成'),
'trajectory.event': R([], 'passthrough', 'handled', 'ignore', ''),
'trajectory.turn': R([], 'passthrough', 'handled', 'ignore', ''),
// ---- 能力面 ----
'permission_mode': R([], 'passthrough', 'handled', 'handled', 'gateway 自发'),
'session.diff': R([], 'passthrough', 'handled', 'ignore', 'opencode v2 diffApi'),
'connected': R([], 'passthrough', 'handled', 'ignore', 'SSE 问候帧'),
// ---- 扁平顶层广播（15 行，goal_node/goal_created/phase_transition desktop=handled） ----
...（扁平 15 行按 P0-1/P0-2 现状保留，仅注释放宽）
```
`RUNTIME_NATIVE_DROPPED` 保留 `{'sync'}`（防御 + 遥测已知集）。
- [ ] **Step 4: 交叉测试**——vocabulary-sync.test.ts：
```ts
import { RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES } from '../../../../packages/gateway-sdk/src/events';
import { MAFW_RUNTIME_EVENT_NAMES, MAFW_FLAT_EVENT_NAMES } from '../../../../src/runtime/mafw-vocabulary';
// 双向集合相等断言（排序后 deepEqual）
```
- [ ] **Step 5: 跑**——`cd gateway && npx jest tests/unit/runtime/vocabulary-sync.test.ts tests/unit/runtime/event-flow-matrix.test.ts --silent`（此时其余 gateway 测试预期红——本 Phase 结束才绿）。

### Task A-2: facet 规则表 v2 + normalize 内置特例删除

**Files:**
- Modify: `gateway/src/runtime/canonical-facets.ts`、`gateway/src/runtime/normalize.ts`
- Test: `gateway/tests/unit/runtime/normalize.test.ts`、`normalize-oracle.test.ts`、`approval/normalize-approval-facet.test.ts`

**Interfaces:** Produces: `FacetRule` 删 `broadcast` 增 `toolCommand?: string`；`EventFacets` 删 `broadcast`（`toolCommand` 已有）。

- [ ] **Step 1: 规则表全量替换**：
```ts
export const CANONICAL_FACET_RULES: FacetRule[] = [
  // step 双载体（legacy session.next.step.ended 载体随 v2 除名）
  { type: 'part.updated', when: [{ path: '$.part.type', equals: 'step-finish' }],
    step: { sessionID: '$.part.sessionID', assistantMessageID: '$.part.messageID', finish: '$.part.reason' } },
  { type: 'message.updated',
    when: [{ path: '$.info.role', equals: 'assistant' }, { path: '$.info.time.completed', exists: true }],
    step: { sessionID: '$.info.sessionID', assistantMessageID: '$.info.id', finish: '$.info.finish' } },
  // chatSignal（delta 双路径：part.text 优先）
  { type: 'part.updated', when: [{ path: '$.part.text', exists: true }], chatSignal: 'delta', deltaText: '$.part.text' },
  { type: 'part.updated', when: [{ path: '$.delta', exists: true }], chatSignal: 'delta', deltaText: '$.delta' },
  { type: 'turn.completed', chatSignal: 'complete' },
  { type: 'message.updated', chatSignal: 'complete' },
  { type: 'turn.failed', chatSignal: 'error', chatError: '$.error' },
  // toolCommand：载体从 session.next.tool.*（随 v2 除名）迁到 tool part 快照
  { type: 'part.updated', when: [{ path: '$.part.type', equals: 'tool' }], toolCommand: '$.part.state.input.command' },
  // compaction
  { type: 'session.compacting', compaction: 'start' },
  { type: 'session.compacted', compaction: 'end' },
  // approval 双形状对齐（options/suggestedRule 随 properties 透传，facet 不动）
  { type: 'permission.asked',
    approval: { requestId: ['$.requestId', '$.id'], toolName: ['$.permission', '$.toolName'], patterns: '$.patterns' } },
];
```
- [ ] **Step 2: evaluateFacetRules/normalize.ts**——删 broadcast 处理（:84）与 `FacetSubset.broadcast`；增 toolCommand：`if (!out.toolCommand && r.toolCommand) { const c = getPath(props, r.toolCommand); if (typeof c === 'string' && c) out.toolCommand = c; }`；normalize.ts 删 `toolCommand` 内置特例（:81-85）与 `EventFacets.broadcast` 字段。
- [ ] **Step 3: 测试重写**——normalize.test/normalize-oracle.test 按字典换类型名 + 删 broadcast 断言 + 新增 toolCommand 用例（`part.updated` + `part.type='tool'` + `state.input.command='/pending-restart/x'` → `facets.toolCommand` 命中）；oracle 的 legacy if 链参照体删除，fixture 期望按 v2 表手工重立（27 条逐一过：session.idle→turn.completed 等）。

### Task A-3: event-field-contract v2

**Files:**
- Modify: `gateway/src/runtime/event-field-contract.ts`（switch :31-79）
- Test: `gateway/tests/unit/runtime/event-field-contract.test.ts`

- [ ] **Step 1:** 按字典换 case 名（`session.idle/error`→`turn.completed/failed`、`message.part.updated`→`part.updated`、`message.updated` 保留、`todo` 无 case、`permission.asked` 保留 + `options`/`suggestedRule` 为可选**不进必填检查**）；删 `session.next.*` 相关提示串。
- [ ] **Step 2:** 测试同步。

### Task A-4: index.ts handleOpencodeEvent v2（Mode A 改写删除 + usage 合成）

**Files:**
- Modify: `gateway/src/index.ts`（:1072-1231 主体 + :134-138 CANONICAL_TYPE_SET + :6347 问候帧 + :6437 WS 问候帧 + `opencodeBroadcast` 调用点）

**Interfaces:** Consumes: A-1 `MAFW`、A-2 facet 无 broadcast。Produces: wire 上 `mafw_event` 信封 + turn 三元组。

- [ ] **Step 1: 分支改写**（逐点，保持既有调用形状）：
  - goalDriver 双门：`type === 'session.idle' || f.broadcast === 'idle'` → `type === MAFW.turnCompleted`；error 分支 → `type === MAFW.turnFailed`。
  - identityState 解绑：`type === 'session.idle'` → `MAFW.turnCompleted`。
  - memoryWorker 过滤（:1140）：四个终态 → `type !== MAFW.turnCompleted && type !== MAFW.turnFailed && type !== MAFW.turnAborted`（f.broadcast 判定删除）。
  - delta 日志豁免（:1142）：`'message.part.delta'` → `MAFW.partDelta`。
  - 尾部 Mode A（:1210-1230）整体替换为：
```ts
// 回合终态：trajectory turn 聚合 + usage 合成（v2：原 Mode A 改写 hack 删除，广播统一 passthrough）
if (type === MAFW.turnCompleted && sessionID) {
  try {
    if (this.trajectoryCollector) {
      const turn = this.trajectoryCollector.onIdle(sessionID);
      if (turn) {
        this.broadcast(mafwBroadcast({ type: MAFW.trajectoryTurn, properties: turn, sessionID }, memoryWorker));
        if (turn.tokens || turn.cost) {
          this.broadcast(mafwBroadcast({ type: MAFW.usageUpdated,
            properties: { tokens: turn.tokens, cost: turn.cost, model: turn.model, provider: turn.provider, turnID: turn.turnID },
            sessionID }, memoryWorker));
        }
      }
    }
  } catch (err: any) { log.warn(`[Trajectory] turn aggregation failed (non-fatal): ${err.message}`); }
}
// 统一 passthrough；turn.failed 保留 error 字段提取（消费方错误展示契约）
const errorText = type === MAFW.turnFailed
  ? (props?.error instanceof Error ? props.error.message : String(props?.error ?? 'Unknown error'))
  : undefined;
this.broadcast(mafwBroadcast(
  { type, properties: props, sessionID, directory: f.directory, ...(errorText !== undefined ? { error: errorText } : {}) },
  memoryWorker));
```
  - `opencodeBroadcast` 全部调用点（:1164/:1217/新代码/:2784 permission_mode/:3141-3176 桥等）随 A-5 更名。
- [ ] **Step 2:** CANONICAL_TYPE_SET（:134-138）与未知遥测、问候帧（:6347/:6437 加 `vocab: 'v2'` 字段）同步。

### Task A-5: 信封改名 opencode_event → mafw_event

**Files:**
- Modify: `gateway/src/runtime/event-broadcast.ts`（构造函数 + `:11-21` 信封常量）、`gateway/src/routes/event-publish.ts`（:11/:52/:55 守卫）、`gateway/src/index.ts`（调用点更名 `mafwBroadcast`）

- [ ] **Step 1:** `event-broadcast.ts` 的 `opencodeBroadcast` 更名 `mafwBroadcast`，信封 `type: 'mafw_event'`；wire 契约注释同步（可选字段缺失不得出现）。
- [ ] **Step 2:** event-publish.ts 守卫串与注释同步；index.ts 全部调用点更名（IDE rename symbol 或 grep `opencodeBroadcast`）。
- [ ] **Step 3:** desktop 剥壳 `raw?.data || raw` 信封无关——不改（B 阶段只改 SDK 类型名）。

### Task A-6: OPENCODE_EVENT_MAPPINGS + 强制 wrap 收敛

**Files:**
- Create: `gateway/src/runtime/opencode-events.ts`
- Modify: `gateway/src/index.ts`（:533-541 注册带 extras；:1287-1326 三分支 wrap 收敛）
- Test: `gateway/tests/unit/runtime/opencode-events.test.ts`（新）、`event-mapper.test.ts`

- [ ] **Step 1: 映射声明**：
```ts
// gateway/src/runtime/opencode-events.ts
import type { EventMapping, EventSourceShape, TransformEventFn } from './event-mapper';

/** opencode 原生事件信封：GlobalEvent {directory, payload:{type, properties, sessionID?}} */
export const OPENCODE_EVENT_SOURCE: EventSourceShape = {
  typePath: '$.payload.type',
  sessionIdPath: ['$.payload.sessionID', '$.payload.properties.sessionID'],
  directoryPath: '$.directory',
};

/** 差异行：改名/合并。同名收编词（session.created 等）经 canonical passthrough 机制通过，不声明。 */
export const OPENCODE_EVENT_MAPPINGS: EventMapping[] = [
  { from: 'session.idle', to: 'turn.completed', passProperties: '$.payload.properties' },
  { from: 'session.error', to: 'turn.failed', passProperties: '$.payload.properties' },
  { from: 'message.error', to: 'turn.failed', passProperties: '$.payload.properties' },
  { from: 'message.aborted', to: 'turn.aborted', passProperties: '$.payload.properties' },
  { from: 'message.part.updated', to: 'part.updated', passProperties: '$.payload.properties' },
  { from: 'message.part.delta', to: 'part.delta', passProperties: '$.payload.properties' },
  { from: 'message.part.complete', to: 'part.complete', passProperties: '$.payload.properties' },
  { from: 'todo.updated', to: 'plan.updated', passProperties: '$.payload.properties' },
];

/** legacy 族 + sync：v1 宿主插件在 opencode 进程内消费原生 session.next.*，gateway 边界整族丢弃。 */
export const opencodeTransformEvent: TransformEventFn = (raw) => {
  const t = raw?.payload?.type || raw?.type;
  if (typeof t === 'string' && (t.startsWith('session.next.') || t === 'sync')) return null;
  return raw;
};
```
- [ ] **Step 2: 注册 + 强制 wrap**——index.ts opencode `registerBuiltin('opencode', …, { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_EVENT_MAPPINGS, transformEvent: opencodeTransformEvent })`；三分支（plugin :1287 / builtin :1311 / direct :1320）收敛为：
```ts
const mapped = wrapGlobalEventStream(rt, entry, { isCanonicalType, onUnknown }); // 强制；entry 无映射 = 警告日志 + passthrough
const final = wrapToolPartAssembly(mapped);
```
（`wrapGlobalEventStream` 内部：无 mappings 声明时 warn 一次并恒等透传。）
- [ ] **Step 3: 测试**——opencode-events.test：8 条差异行逐条断言（输入 GlobalEvent 信封 → 输出新类型 + properties 透传保留兄弟字段）；transformEvent 对 `session.next.tool.started`/`sync` 返回 null、对 `message.updated` 原样返回。
- [ ] **Step 4: dry-event 验证**——`POST /api/runtime/dry-event {plugin:'opencode', event:{directory:'/x', payload:{type:'session.idle', properties:{sessionID:'s1'}}}}` → 映射跳显示 `turn.completed`。

### Task A-7: pi 映射目标词跟随

**Files:**
- Modify: `gateway/src/runtime/pi/pi-events.ts`（PI_EVENT_MAPPINGS 8 行 `to` 值）
- Test: `gateway/tests/unit/runtime/pi-events.test.ts`

- [ ] **Step 1:** `to: 'session.idle'` → `'turn.completed'`；`to: 'message.part.updated'`（3 行）→ `'part.updated'`；`message.updated`/`tool.call`/`tool.result`/`session.updated` 不变；piTransformEvent（permission 信封）不变；push 通道（permission/compaction）类型名本就未变。
- [ ] **Step 2:** pi-events.test 期望值同步（`session.idle`→`turn.completed` 等）。

### Task A-8: ToolPartAssembler 词汇常量化

**Files:**
- Modify: `gateway/src/runtime/tool-part-assembler.ts`
- Test: `gateway/tests/unit/runtime/tool-part-assembler.test.ts`、`tool-part-assembler-stream.test.ts`

- [ ] **Step 1:** `'message.part.updated'`（:4/:68/:91 等全部）→ `MAFW.partUpdated`；`'message.updated'`（:71/:85）→ `MAFW.messageUpdated`；part.id 前缀 `toolpart_`、`part.type:'tool'`、state 状态机**不变**（冻结面）。
- [ ] **Step 2:** 测试断言同步（输出类型名）。

### Task A-9: eventBus 扁平发射注册表化

**Files:**
- Create: `gateway/src/runtime/flat-emit-registry.ts`
- Modify: `gateway/src/index.ts`（setupEventBus :3141-3176）
- Test: `gateway/tests/unit/runtime/event-broadcast.test.ts`（补注册表用例）

- [ ] **Step 1:** 把 if 链 10 个分支的**载荷构造逐字**搬进注册表：
```ts
export const FLAT_EMITTERS: Record<string, (data: any) => Record<string, any>> = {
  user_question: (d) => ({ type: 'user_question', /* 原 :3151 分支字段 */ ...d }),
  // ... 10 条，每条 = 原 if 分支 return 的对象字面量原样
};
```
- [ ] **Step 2:** setupEventBody 改为遍历注册表 `this.eventBus.on(name, (d) => this.broadcast(emit(d)))`；**特殊消费者不动**（goal_created→startGoal、state_change→goalDriver.advance、phase_transition→milestonePush 保持独立 `eventBus.on`）。
- [ ] **Step 3:** 测试：每个 flat 类型发一条 eventBus 事件 → broadcast 收到对应形状（复刻原 event-broadcast.test 断言）。

### Task A-10: conformance S1 集合 Tier 0 化

**Files:**
- Modify: `gateway/src/runtime/conformance-scenarios.ts`（:67-68）、`gateway/src/routes/conformance.ts`（:49）
- Test: `gateway/tests/unit/runtime/conformance-scenarios.test.ts`、`routes/conformance.test.ts`

- [ ] **Step 1:** `CONTENT_TYPES = new Set(['message.updated', 'part.updated', 'part.delta'])`；`TERMINAL_TYPES = new Set(['turn.completed', 'turn.failed'])`；评估消息文案同步；routes/conformance.ts settled 判定同步。

### Task A-11: gateway 其余改名清扫

**Files:**
- Modify: `gateway/src/trajectory/collector.ts`（:124 `type === 'message.updated'` 不变；:176 `'message.part.updated'` → `MAFW.partUpdated`；Part 判别子 text/tool/step-finish/reasoning **不变**）
- Modify: `gateway/src/runtime/event-telemetry.ts`（`KNOWN_PREFIXES = ['plugin:']`——删 `'session.next.'`，该族已由 opencode transformEvent 消费）
- Modify: `gateway/src/runtime/event-mapper.ts`（SESSION_ID_TARGETS :35-38 键 `'message.part.updated'` → `'part.updated'`）
- Modify: `gateway/src/runtime/loader.ts`（README 示例 :360-363 词汇同步）
- Modify: `gateway/src/runtime/identity-state.ts`、`core/goal/starter.ts`、`plugins/package-types.ts`、`opencode-runtime.ts`（注释串同步）

- [ ] **Step 1:** 按字典逐文件替换（生产 + 注释）；`rg "session\.idle|message\.part\.|message\.complete|todo\.updated|opencode_event" gateway/src` 清零（`opencode-adapter.ts` 文件名与 SDK 方法名等**碰撞项除外**，见验收 D-2 白名单）。

### Task A-12: gateway 测试与 fixture 全量同步

**Files（枚举，全在 `gateway/tests/`）:** `unit/runtime/`：normalize-oracle、normalize、event-mapper、event-telemetry、event-broadcast、event-replay、event-diagnostics、event-field-contract、tool-part-assembler{,-stream}、pi-events、pi-approval-extension、pi-native-approvals、conformance-scenarios、normalize-messages-route、loader-event-mappings、ctx-events；`unit/routes/`：dry-event、conformance；`unit/goal/`：goal-driver、goal-e2e、ask-user；`fixtures/events/runtime-raw-session.jsonl`；`helpers/goal-driver-harness.ts`

- [ ] **Step 1:** 按字典机械替换 fixture 与断言；oracle/normalize 类按 A-2 新语义逐条核对（不是纯改名——turn 合并处期望值合并）。
- [ ] **Step 2: 全量验证**——`cd gateway && npx jest --silent`（全绿）。
- [ ] **Step 3: Commit A**——`git add -A && git commit -m "feat(events)!: MAFW vocabulary v2 — turn trio, part.*, mafw_event envelope, forced translation wiring (gateway + SDK source)"`

---

## Phase 3（commit B）：desktop

> 前置：`cd packages/gateway-sdk && npm run build`（desktop 守卫读构建产物）。

### Task B-1: session-events.ts v2 + dispatcher

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts`、`sse/dispatcher.ts`
- Test: `session-events.test.ts`、`sse/dispatcher.test.ts`

- [ ] **Step 1:** `TAIL_ACCOUNTED_TYPES = ['part.updated', 'part.complete', 'turn.completed', 'turn.failed', 'turn.aborted']`；`TAIL_ACCOUNTED_PREFIXES = ['plugin:']`；`IGNORED_AT_SHELL` 删 `session.next.*` 三项（保留 user_feedback/state_change/memory_*/automation_*/mafw_commands_changed/session.compacting）；`ShellHandledType` 与 `assertShellEventCoverage` 按字典全量换 case（编译器逐点报错指路）。
- [ ] **Step 2:** dispatcher：分支类型名核对（session.*/user_question/project_registered/runtime_switched/goal_* 均未变；connected 已在 P0-2）。
- [ ] **Step 3:** 测试同步 + `bun test` 绿。

### Task B-2: handlers（chat-stream/dock）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/chat-stream.ts`、`dock.ts`
- Test: 对应 .test.ts

- [ ] **Step 1: chat-stream**——`CHAIN_TYPES = ['message.updated', 'part.delta', 'part.updated', 'part.complete', 'turn.completed', 'turn.failed', 'turn.aborted']`；`TURN_END_TYPES = ['turn.completed', 'turn.failed', 'turn.aborted']`；**删除** `session.idle` 防御分支（Mode A 改写已死，gateway 直发 turn.completed）与 `session.next.tool.*` 前缀 ensure 块（该族已在边界 drop；opencode part 自带 messageID、pi 由 assembler 锚点兜底）；`message.error`→`turn.failed`、`message.aborted`→`turn.aborted` 分支合并。
- [ ] **Step 2: dock**——`'todo.updated'` → `'plan.updated'`（数据载荷形状不变）。
- [ ] **Step 3:** flow-cards/diff 无改动（名词未变）；测试同步 + `bun test` 绿。
- [ ] **Step 4: Commit B**——`git commit -m "feat(events)!: desktop consumes MAFW vocabulary v2 (dispatcher/handlers/session-events)"`

### Task B-3（可选，不阻塞）: UsagePill 消费 usage.updated

**Files:** Modify: `packages/desktop/src/renderer/mafw/components/UsagePill.tsx`（MafwShell dispatcher `usage.updated` → 缓存 bump；60s 轮询保留兜底）。事件在 `IGNORED_AT_SHELL`→handled 迁移时一并登记。

## Phase 3（commit C）：TUI

### Task C-1: TUI 三文件 + 测试

**Files:**
- Modify: `packages/tui/src/store/connection.ts`、`store/chat-store.ts`、`ui/app.ts`
- Test: `packages/tui/tests/chat-store.test.ts`、`connection.test.ts`

- [ ] **Step 1:** `KNOWN_EVENTS = ['part.updated', 'part.delta', 'turn.completed', 'turn.failed', 'turn.aborted', 'permission.asked', 'permission_mode', 'question.asked']`；chat-store `applyEvent`：`'message.part.updated'`→`'part.updated'`、`'session.idle'`/`'message.complete'` 双分支合并为 `'turn.completed'`；app.ts `:635` usage 刷新触发 `session.idle`→`turn.completed`。
- [ ] **Step 2:** P0-5 交叉测试自然通过；`node --test tests/` 绿。
- [ ] **Step 3: Commit C**——`git commit -m "feat(events)!: TUI consumes MAFW vocabulary v2"`

---

## Phase 4：文档、验收与冒烟

### Task D-1: 文档同步

**Files:**
- Modify: `AGENTS.md`（~10 段：§5.6 wire 契约 mafw_event/扁平、§5.9b/§5.9b.1 TUI 事件名、§5.18 session.idle 清绑定、§5.19 事件映射注册段词汇 v2、§5.22 P1/P2 wire 形状、§4.1 工具表 events 描述）
- Modify: `.opencode/skills/runtime-plugin-authoring/SKILL.md`（31 处：词汇契约表按 v2 重写——Tier 0 最小契约 + 可选组能力位 + 三类翻译输入源 + OPENCODE_EVENT_MAPPINGS 作参考实现）
- Modify: `docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md`（状态改「已实施」+ commit 哈希）；`docs/research/2026-10-12-runtime-event-consumption-survey.md` 顶部加勘误注（「v2 词汇已切换，本文为切换前快照」）

- [ ] **Step 1:** 按上列逐段更新；历史 spec/plan（>30 份）按「归档不追改」处理，仅在本 spec 加一行指向。

### Task D-2: 验收门（PR 合入前全绿）

- [ ] `rg "opencode_event" gateway/src packages/ src/ --glob '!*.test.*'` → 0 命中（信封）。
- [ ] `rg "session\.idle|message\.part\.|message\.complete|message\.error|message\.aborted|todo\.updated" gateway/src packages/ src/ --glob '!*.test.*'` → 0 命中（历史文档/spec 除外）。
- [ ] `cd gateway && npx jest --silent` 全绿；`cd packages/desktop && bun test` 全绿；`cd packages/tui && node --test tests/` 全绿；`npm run build` 成功。
- [ ] `POST /api/runtime/dry-event {plugin:'opencode', event:{...session.idle...}}` → `turn.completed`（A-6 Step 4 复跑）。
- [ ] conformance S1 在 opencode 与 pi 双 runtime 通过（`mafw plugin-test` / `POST /api/runtime/conformance {scenarios:["chat-roundtrip"]}`）。

### Task D-3: 真实会话冒烟（desktop + TUI）

- [ ] desktop 真实会话：流式渲染（part.delta/upsert）、工具卡渲染（assembler 快照 + toolpart_ 去重）、回合收束（turn.completed → sending 复位 + 队列续发）、审批卡（permission.asked → 三档决策）、压缩边界分隔线（session.compacted）；EventInspector 无红 miss。
- [ ] TUI 冒烟：回合收束 + permission overlay + 🛡 徽标。
- [ ] 自更新定位冒烟：会话内 bash 写 `~/.mafw/pending-restart.json` → gateway 日志确认 tokenWriterSession 命中（toolCommand 新载体）。
- [ ] 合入：PR 合并（或 fast-forward），删除 `mafw-event-v2` 分支。

---

## Self-Review 记录

- **Spec 覆盖**：spec §3.1 映射表 → A-1/A-6/A-7；§3.2 facet（broadcast 删除/toolCommand 载体/step 双载体）→ A-2；§4.2 强制接线 → A-6 Step 2；§4.4 单源与守卫 → A-1/P0-5；§4.5 注册表 → A-9；§5 三 commit → Phase 2/3 划分；§6 验收 → D-2/D-3。pi push 通道（②③类输入源）在 v2 无需改动（类型名未变）——与 spec §4.1「②③属插件本体」一致。
- **类型一致性**：`MAFW.turnCompleted` 等常量名在 A-1 定义、A-2/A-4/A-8/A-11 消费一致；`mafwBroadcast` 在 A-5 定义、A-4/A-9 消费；`passProperties`/`sessionIdPath: string[]` 在 P1-1 定义、A-6 消费。
- **已知风险内嵌**：A→B 之间 wire 断（分支限定，B 开头 rebuild SDK）；oracle 重写是最大手工面（A-2 Step 3 逐条核对指令已给）。
