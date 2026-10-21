# Runtime Canonical v3 — Plan 1：基础与历史管线 flat 切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 canonical v3 的词汇增量（+turn.started）与 flat 类型基础，并把**历史消息管线**内部切换为 flat（`MafwMessage`），经 egress shim 在路由出口还原 wire 形状——桌面收到的历史 deep-equal 不变。

**Architecture:** 三步走——纯类型模块（canonical-types）→ 纯转换函数（wire-compat，egress 唯一转换点）→ 历史管线原子翻转（契约签名 + pi/opencode 两家 normalizeMessages + 路由出口接 shim）。事件载荷（message.updated 的 {info}→{message}）**不在本计划**——它与方言表耦合，归 Plan 2；本计划结束时事件管线形状不变。

**Tech Stack:** TypeScript (gateway CJS), jest（gateway）、bun test（desktop）、node --test（TUI）

**Spec:** `docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md`（§3.1 类型、§3.4 egress shim、§7 决议）+ 事实源 `docs/superpowers/specs/2026-10-21-runtime-canonical-v3-mapping-audit.md`

## Global Constraints

- 词汇 5 点 guard chain：SDK `RUNTIME_EVENT_TYPES` ↔ `mafw-vocabulary.ts` ↔ `EVENT_FLOW_MATRIX` 行（矩阵强制每 canonical 类型有行）↔ desktop `assertShellEventCoverage` ↔ TUI `KNOWN_EVENTS`（⊆ 单向守卫，仅订阅需要时加）
- wire 不变：desktop 收到的历史仍为 `{info, parts[]}`，验收 = **deep-equal**（JSON 语义等价，非 byte-identical）；egress shim（wire-compat.ts）是唯一 flat→wire 转换点
- 全量回归底线：gateway jest 全绿（基线 258 套件 / 1738 用例）+ desktop `bun test` + TUI `node --test`
- 不动：映射表（opencode-events.ts / pi-events.ts）、assembler、facets、事件载荷——全部归 Plan 2
- 路由正则 query 兼容：`(?:\?|$)` 锚定（AGENTS.md §6.5）
- TDD 先行；commit 消息用 `git commit -F <文件>`（PowerShell 多行参数会拆坏）；交付时汇报新增测试数与全量通过数

## Review Focus

1. **空 content/空 parts 消息**（compaction 边界、pi 空 assistant）——`toWireHistory` 不得炸，输出 `parts: []` → Task 3 测试钉扎
2. **透传变体部件**（compaction/agent/subtask part，session-ui 今日渲染）——shim 原样保留未知 part 类型与全部字段，不吞不裁 → Task 2/3 测试钉扎
3. **无 id 消息**（pi 事件路径无 id）——`toWireInfo` 不强造 id、不炸 → Task 3 测试钉扎
4. **opencode 历史字段保真**（finish/modelID/providerID/tokens/cost/parentID 往返不丢）——round-trip deep-equal → Task 5 golden 钉扎
5. **分页 cursor**（`nextCursor` / `before` 参数）在 flat 翻转后行为不变 → Task 4 路由测试钉扎

---

### Task 1: 词汇 +turn.started（guard chain 五点联动）

**Files:**
- Modify: `gateway/src/runtime/mafw-vocabulary.ts`（回合族，`turnCompleted` 行前插入 `turnStarted: 'turn.started'`）
- Modify: `packages/gateway-sdk/src/events.ts`（`RUNTIME_EVENT_TYPES` 同位置插入）
- Modify: `gateway/src/runtime/event-flow-matrix.ts`（新增 `turn.started` 行——信息性透传，无 facet，参照 `session.created` 行的形状）
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts`（`assertShellEventCoverage` switch 增分支——编译期穷尽检查会强制）
- Test: `gateway/tests/unit/runtime/vocabulary-sync.test.ts`、`gateway/tests/unit/runtime/event-flow-matrix.test.ts`、`packages/desktop/src/renderer/mafw/session-events.test.ts`

**Interfaces:**
- Produces: 词汇表含 `turn.started`（Plan 2 的 @v2/pi/claude 映射行将消费它）

- [ ] **Step 1: 先加 SDK 侧，跑 vocabulary-sync 看它失败**

在 `packages/gateway-sdk/src/events.ts` 的 `RUNTIME_EVENT_TYPES` 加 `"turn.started"`。

Run: `cd gateway && npx jest tests/unit/runtime/vocabulary-sync.test.ts`
Expected: FAIL（SDK union 与 gateway `MAFW` 常量不一致）

- [ ] **Step 2: 补 gateway 词汇 + 矩阵行，两个测试转绿**

`mafw-vocabulary.ts` 加 `turnStarted: 'turn.started'`；`event-flow-matrix.ts` 加行（无 facet 的 passthrough，镜像 `session.created` 行的字段形状）。

Run: `cd gateway && npx jest tests/unit/runtime/vocabulary-sync.test.ts tests/unit/runtime/event-flow-matrix.test.ts`
Expected: PASS（若矩阵测试要求每个词汇成员有行，缺行会先 FAIL——补行后绿）

- [ ] **Step 3: desktop 穷尽检查**

`session-events.ts` 的 `assertShellEventCoverage` switch 增 `turn.started` 分支（信息性事件，无需 UI 动作，与 `session.created` 同样的忽略路径）。

Run: `cd packages/desktop && bun test src/renderer/mafw/session-events.test.ts`
Expected: PASS

- [ ] **Step 4: TUI 单向守卫确认（不改则证明无需订阅）**

Run: `cd packages/tui && node --test tests/event-coverage.test.ts`
Expected: PASS（KNOWN_EVENTS ⊆ union 单向——不加订阅即无需改动；若失败按报错补）

- [ ] **Step 5: Commit**

`git commit -F`，消息：`feat(vocabulary): +turn.started 回合起始事件——guard chain 五点联动（SDK/vocabulary/matrix/desktop）`

---

### Task 2: canonical-types.ts（flat 类型模块 + 类型守卫）

**Files:**
- Create: `gateway/src/runtime/canonical-types.ts`
- Test: `gateway/tests/unit/runtime/canonical-types.test.ts`

**Interfaces:**
- Produces（后续所有任务消费）:

```ts
export interface MafwMessage {
  id?: string; sessionID?: string;
  role: 'user' | 'assistant';
  content?: MafwPart[];               // 事件载荷可缺省（parts 经 part.updated 单独流）；历史形态必有
  time?: { created?: number; updated?: number; completed?: number };
  finish?: string;                    // pi stopReason / opencode finish
  model?: string;                     // opencode wire 为 modelID，翻译层换名
  providerID?: string;
  tokens?: Record<string, unknown>;   // trajectory/BudgetGuard 主干
  cost?: Record<string, unknown>;
  parentID?: string;
}
export interface MafwPartBase { id: string; sessionID?: string; messageID?: string }
export type MafwPart =
  | MafwPartBase & { type: 'text'; text: string }
  | MafwPartBase & { type: 'reasoning'; text: string }
  | MafwPartBase & { type: 'tool'; callID: string; tool: string;
      state: { status: 'pending' | 'running' | 'completed' | 'error';
               input?: unknown; raw?: string; output?: string; error?: string;
               title?: string; metadata?: Record<string, unknown>;
               time?: { start?: number; end?: number } } }
  | MafwPartBase & { type: 'file'; mime?: string; url?: string; filename?: string; [k: string]: unknown }
  | MafwPartBase & { type: 'step-start' }
  | MafwPartBase & { type: 'step-finish'; reason?: string; cost?: Record<string, unknown>; tokens?: Record<string, unknown> }
  | MafwPartBase & { type: string; [k: string]: unknown };  // 透传变体：compaction/agent/subtask/snapshot/patch/retry
export function isMafwMessage(v: unknown): v is MafwMessage;
```

- [ ] **Step 1: 写失败测试**

`canonical-types.test.ts` 断言：①`isMafwMessage` 接受最小 flat 消息 `{role:'user', content:[]}`；②拒绝 v1 信封 `{info:{role:'user'}, parts:[]}`；③透传变体接受 `{id:'p1', type:'compaction', anything:'kept'}` 且不吞字段；④tool part 的四种 state.status 均合法；⑤step-finish 带 cost/tokens 合法。

Run: `cd gateway && npx jest tests/unit/runtime/canonical-types.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现 canonical-types.ts**

守卫做结构校验（role 合法、content 若存在则每项有 string type）；透传变体 = 最后的 catch-all 分支，运行时守卫按"有 id + 有 type"判部件。

- [ ] **Step 3: 跑测试转绿**

Run: `cd gateway && npx jest tests/unit/runtime/canonical-types.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

`feat(runtime): canonical-types flat 消息/部件类型——字段完备+透传变体`

---

### Task 3: wire-compat.ts（egress 转换纯函数）

**Files:**
- Create: `gateway/src/runtime/wire-compat.ts`
- Test: `gateway/tests/unit/runtime/wire-compat.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `MafwMessage` / `MafwPart`
- Produces:

```ts
/** flat 消息 → v1 wire info（缺省字段不输出键；不造 id；model → modelID 是唯一换名——与 opencode 历史翻译的 modelID→model 互逆） */
export function toWireInfo(msg: MafwMessage): Record<string, unknown>;
/** flat 历史 → v1 wire 历史（parts 原样直通——shim 绝不改 part 载荷与 part.id） */
export function toWireHistory(messages: MafwMessage[]): Array<{ info: Record<string, unknown>; parts: unknown[] }>;
```

- [ ] **Step 1: 写失败测试（含 Review Focus 1/2/3）**

断言：①字段完整往返：构造带 id/sessionID/role/time/finish/model/providerID/tokens/cost/parentID 的消息 → `toWireInfo` 输出含全部同名字段、**model 输出为 modelID**（shim 侧唯一换名点，与 Task 4 的 opencode 历史翻译互逆）；②空 content → `toWireHistory` 输出 `parts: []` 不炸；③无 id 消息 → 输出 info 无 id 键、不炸；④透传部件（compaction part 带自定义字段）→ parts 数组原样引用直通、字段零丢失；⑤`toWireInfo` 对缺省字段不输出键（`{role:'user'}` → `{role:'user'}`，仅此一键）。

Run: `cd gateway && npx jest tests/unit/runtime/wire-compat.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现**

`toWireInfo` = 逐可选字段条件展开；`toWireHistory` = `messages.map(m => ({ info: toWireInfo(m), parts: Array.isArray(m.content) ? m.content : [] }))`。**parts 直通引用，不做任何复制/改写**（@v1 原生 part.id 直通不变量的实现基础）。

- [ ] **Step 3: 跑测试转绿**

Run: `cd gateway && npx jest tests/unit/runtime/wire-compat.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

`feat(runtime): wire-compat egress 转换——toWireInfo/toWireHistory 纯函数（parts 直通）`

---

### Task 4: 历史管线 flat 原子翻转（契约 + 两家 normalize + 路由出口 shim）

**Files:**
- Modify: `gateway/src/runtime/contract.ts:255`（`normalizeMessages?(raw: any[]): MafwMessage[]`，注释注明 flat 目标与 egress 约定）
- Modify: `gateway/src/runtime/normalize-messages.ts`（`applyNormalizeMessages` 校验改 `isMafwMessage`；违例文案同步改）
- Modify: `gateway/src/runtime/pi/pi-message-normalize.ts`（输出改 `MafwMessage[]`：`info.role→role`、`info.time→time`、`info.id→id`、`parts→content`；部件本体零改动）
- Create: `gateway/src/runtime/opencode-history.ts`（`normalizeOpencodeHistory(raw: any[]): MafwMessage[]`——`{info,parts}[]` → flat；`info.modelID → msg.model` 换名，其余字段同名直传，`parts → content` 引用直通）
- Modify: `gateway/src/runtime/opencode-runtime.ts`（client 构造处挂 `session.normalizeMessages = normalizeOpencodeHistory`）
- Modify: `gateway/src/index.ts`（messages 路由 ~5835-5859：`runtime.session.messages` 结果 → `toWireHistory(...)` → `enrichHistoryParts` 保持在其后、仍操作 wire parts）
- Test: `gateway/tests/unit/runtime/normalize-messages-route.test.ts`、`gateway/tests/unit/runtime/pi-message-normalize.test.ts`、新增 `gateway/tests/unit/runtime/opencode-history.test.ts`、`gateway/tests/unit/runtime/conformance-scenarios.test.ts`（历史形状断言改 MafwMessage）

**Interfaces:**
- Consumes: Task 2/3 全部导出
- Produces: 历史管线内部契约 = flat；`normalizeOpencodeHistory` 供 Plan 2 复用（@v2 方言历史走同函数）

**注意**：这是原子任务——契约校验、两家实现、路由出口必须同任务落，任何一处分拆都会让中间态红。

- [ ] **Step 1: 写失败测试**

①`opencode-history.test.ts`：真实形状 fixture（含 text/reasoning/tool(state 四态)/step-finish(cost,tokens)/compaction 透传部件；info 含 finish/modelID/providerID/tokens/cost/parentID）→ `normalizeOpencodeHistory` 输出 `isMafwMessage` 全真、`modelID` 换名 `model`、`content` 与原 `parts` **同引用**；②`pi-message-normalize.test.ts` 期望改 flat（`role`/`time`/`id`/`content` 顶层键）；③`normalize-messages-route.test.ts`：mock runtime 返回 flat 历史 → 路由输出 `{info, parts}` wire 形状（`toWireHistory` 生效）、`nextCursor` 透传、`?before=` 参数仍透传给 runtime（Review Focus 5）；④conformance 历史断言改 `isMafwMessage`。

Run: `cd gateway && npx jest tests/unit/runtime/opencode-history.test.ts tests/unit/runtime/pi-message-normalize.test.ts tests/unit/runtime/normalize-messages-route.test.ts tests/unit/runtime/conformance-scenarios.test.ts`
Expected: FAIL（新文件模块不存在；既有两套形状断言不匹配）

- [ ] **Step 2: 实现四处修改**

opencode-history 翻译逐字段（info.* → msg.*，唯一换名 `modelID→model`）；opencode-runtime 挂载；contract/normalize-messages 校验翻转；index.ts 路由接 `toWireHistory`。

- [ ] **Step 3: 定向测试转绿**

Run: `cd gateway && npx jest tests/unit/runtime/opencode-history.test.ts tests/unit/runtime/pi-message-normalize.test.ts tests/unit/runtime/normalize-messages-route.test.ts tests/unit/runtime/conformance-scenarios.test.ts`
Expected: PASS

- [ ] **Step 4: gateway 全量回归**

Run: `cd gateway && npx jest`
Expected: 全绿（轨迹/eval/media 等历史消费方若有 {info,parts} 断言，在本步骤一并改为 flat 读取——消费方清单见 audit §Q7：trajectory/api.ts、eval-endpoint.ts:185、media-runtime-executor.ts:118）

- [ ] **Step 5: Commit**

`refactor(runtime): 历史管线内部切 flat——契约/pi/opencode 翻译+路由出口 egress shim（wire 不变）`

---

### Task 5: 历史 round-trip 快照 + 三端全量回归

**Files:**
- Create: `gateway/tests/unit/runtime/history-roundtrip.test.ts`
- Test: 同文件

**Interfaces:**
- Consumes: Task 4 全链（`normalizeOpencodeHistory` + `toWireHistory`；pi 侧 `normalizePiMessages` + `toWireHistory`）

- [ ] **Step 1: 写 round-trip 属性测试（Review Focus 4）**

两组断言：①**opencode round-trip deep-equal**：wire fixture 集（Task 4 的 fixture 扩充：多消息、user+assistant 混合、含透传部件、含空 parts 消息）→ `normalizeOpencodeHistory` → `toWireHistory` → 与原输入 deep-equal；②**pi 新旧等价**：pi 原始消息 fixture → 新 flat `normalizePiMessages` + `toWireHistory` → 与旧实现输出 fixture（从当前 main 分支的 `pi-message-normalize.test.ts` 期望值复制为 golden）deep-equal。

Run: `cd gateway && npx jest tests/unit/runtime/history-roundtrip.test.ts`
Expected: FAIL（golden 未固化 / 字段丢失会暴露）

- [ ] **Step 2: 修至 round-trip 全绿（任何字段丢失在此暴露并修）**

Run: `cd gateway && npx jest tests/unit/runtime/history-roundtrip.test.ts`
Expected: PASS

- [ ] **Step 3: 三端全量回归**

Run: `cd gateway && npx jest` → PASS；`cd packages/desktop && bun test` → PASS；`cd packages/tui && node --test tests/*.test.ts` → PASS

- [ ] **Step 4: Commit**

`test(runtime): 历史 round-trip golden——flat 化后 wire 输出 deep-equal 不变`

---

## Plan 2 / Plan 3 路线图（随后各自成文）

- **Plan 2（方言体系）**：platform@dialect 寻址与自适应探测、@v1 表刷新（N3 过时 drop 行）、@v2 新表（混合消费+▲防重）、pi 四修复（F1 stopReason 分类/F8 agent_start→turn.started/N1 tool_execution_* 桥/N2 事件侧角色）、**事件载荷 flat 翻转**（message.updated {info}→{message}：映射行+facets 路径+消费方+oracle/replay fixtures，strangler 式双路径过渡）、assembler 输出类型化 MafwPart（part 载荷本就兼容，收类型+守卫）、SDK 词表快照测试（89 基线）、方言 fixtures、file-plugin conformance CLI
- **Plan 3（claude 最小 adapter 与核心清洗）**：adapters/claude/ + esbuild 单文件 + fixture 级 conformance + 零核心 diff 验收、auth.json 8 消费方切 credentials、/api/runtime-config 改名、命名去 opencode 化、依赖边界 lint
