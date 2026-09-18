# 事件链路防遗漏四件套 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 SSE 事件从 gateway 到 desktop 的多跳接线缺口，从"人肉点 UI 才能发现"变成"编译错 / 测试红 / 面板可见"。

**Architecture:** 单一事实源在 `@mafw/sdk`（`events.ts`：canonical 事件 union + assertNever，零运行时依赖）；gateway 侧事件链路矩阵（`event-flow-matrix.ts`）+ jest 遍历门禁；desktop MafwShell onmessage 全分支 narrowing + 末端 assertNever；两侧 golden 回放测试；desktop dev 事件检查器（分支 trace + 链路时延显示）。

**Tech Stack:** TypeScript、bun test（SDK/desktop）、jest --runInBand（gateway）、tsgo typecheck（desktop）、SolidJS（检查器 UI）。

## Global Constraints

- 用户偏好 TDD 先行：每个任务先写失败测试再实现。
- gateway 测试命令：`cd gateway && npx jest <path> --runInBand`（全量 `npm test` = `jest --runInBand`）。
- SDK 测试命令：`cd packages/gateway-sdk && bun test`；typecheck：`bun run typecheck`（tsc --noEmit）。
- desktop 测试命令：`cd packages/desktop && bun test <path>`；typecheck：`bun run typecheck`（tsgo -b）。
- desktop renderer 只允许经 `window.api`（`src/preload`）调主进程；纯逻辑模块不引入 Electron 依赖。
- `packages/gateway-sdk/src/events.ts` 必须**零 import**（gateway jest 经相对路径直接 import 它，desktop/TUI 经 `@mafw/sdk` import 它）。
- 不改任何现有事件的线上行为（本计划全部是给链路加门禁，不改语义）。
- 每个任务结束 commit（执行前与用户确认）。
- AGENTS.md 记录了 wire 契约（§4.1 接线、§5.6 广播扁平约定）；改 wire 形状属于破坏性行为，本计划不做。

## 背景：canonical 事件清单（勘察结论，2026-09-18）

**opencode_event 信封内层（`data.type`，gateway/src/runtime/event-broadcast.ts + index.ts）**：
`session.created / session.updated / session.deleted / session.idle / session.error / session.compacting / session.compacted / message.updated / message.part.updated / message.part.delta / message.complete / message.part.complete / message.error / message.aborted / question.asked / question.replied / question.rejected / permission.asked / permission.replied / todo.updated / trajectory.event / trajectory.turn / session.next.step.ended / session.next.reasoning.ended / session.next.tool.failed`

**扁平顶层广播（无 data 键）**：
`user_question / user_feedback / goal_created / state_change / phase_transition / memory_written / memory_energy_changed / memory_distillation_complete / automation_triggered / automation_completed / project_registered / runtime_switched / mafw_commands_changed` + 插件自定义 `plugin:<name>:<event>`（模板字面量类型覆盖）

**desktop MafwShell onmessage 现有分支**（MafwShell.tsx:1320-1640）：user_question、project_registered、runtime_switched、session.created/updated/deleted（→planSessionEvent）、question.asked/replied/rejected、permission.asked/replied、session.compacted、trajectory.event、trajectory.turn、todo.updated、message.updated、message.part.delta、message.part.updated、message.complete、message.part.complete、session.idle、session.error/message.error/message.aborted、session.next.tool.*（前缀）、mafw_media_speak 工具检测（尾落，不 return）。
**MafwShell 显式不消费**（需 no-op 分支）：goal_created、state_change、phase_transition、memory_*（3 个）、automation_*（2 个）、user_feedback、mafw_commands_changed（ChatPane 另行消费）、session.compacting（仅需 session.compacted）。

---

### Task 1: SDK canonical 事件 union + assertNever

**Files:**
- Create: `packages/gateway-sdk/src/events.ts`
- Modify: `packages/gateway-sdk/src/index.ts`（re-export）
- Test: `packages/gateway-sdk/src/events.test.ts`

**Interfaces:**
- Produces（后续全部任务依赖）:
  - `RUNTIME_EVENT_TYPES: readonly string[]`（信封内层 type 全集）
  - `FLAT_EVENT_TYPES: readonly string[]`（顶层广播 type 全集）
  - `RuntimeEventType = typeof RUNTIME_EVENT_TYPES[number]`
  - `FlatEventType = typeof FLAT_EVENT_TYPES[number]`
  - `OpencodeEventData { type: RuntimeEventType | \`plugin:${string}\`; properties?: any; sessionID?: string; directory?: string; error?: string; internal?: boolean }`
  - `GatewayEvent = { type: 'opencode_event'; data: OpencodeEventData } | FlatGatewayEvent`
  - `FlatGatewayEvent`（每个 FLAT_EVENT_TYPES 成员的判别 union，properties 宽松 `any`）
  - `assertNever(x: never, context?: string): never`

- [ ] **Step 1: Write the failing test**

`packages/gateway-sdk/src/events.test.ts`：

```ts
import { test, expect } from "bun:test"
import {
  RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES,
  assertNever, type GatewayEvent, type RuntimeEventType,
} from "./events"

test("runtime event list has no duplicates and is sorted-stable", () => {
  expect(new Set(RUNTIME_EVENT_TYPES).size).toBe(RUNTIME_EVENT_TYPES.length)
  expect(RUNTIME_EVENT_TYPES.length).toBe(25)
})

test("flat event list has no duplicates", () => {
  expect(new Set(FLAT_EVENT_TYPES).size).toBe(FLAT_EVENT_TYPES.length)
  expect(FLAT_EVENT_TYPES.length).toBe(13)
})

test("assertNever throws with context", () => {
  expect(() => assertNever("x" as never, "test")).toThrow("test")
})

test("GatewayEvent accepts envelope and flat shapes (compile-time)", () => {
  const a: GatewayEvent = { type: "opencode_event", data: { type: "session.idle", sessionID: "s1" } }
  const b: GatewayEvent = { type: "project_registered", projectDir: "/x" }
  const c: GatewayEvent = { type: "opencode_event", data: { type: "plugin:foo:bar" } }
  expect(a.type).toBe("opencode_event")
  expect(b.type).toBe("project_registered")
  expect(c.type).toBe("opencode_event")
})

test("every runtime type is a dotted name", () => {
  for (const t of RUNTIME_EVENT_TYPES) expect(t).toContain(".")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/gateway-sdk && bun test src/events.test.ts`
Expected: FAIL（`Cannot find module "./events"`）

- [ ] **Step 3: Write implementation**

`packages/gateway-sdk/src/events.ts`：

```ts
/**
 * Canonical SSE 事件契约 —— gateway 与全部客户端（desktop/TUI）的单一事实源。
 *
 * 本文件必须保持零 import：gateway jest 经相对路径直接 import，
 * desktop/TUI 经 @mafw/sdk import。新增事件类型 = 在这里加一行，
 * desktop/TUI 的 assertNever 分支随即编译报错，指向需要接线的位置。
 */

/** opencode_event 信封内层 data.type 全集（runtime 原生事件经 normalize 后的 canonical 名） */
export const RUNTIME_EVENT_TYPES = [
  "session.created", "session.updated", "session.deleted", "session.idle",
  "session.error", "session.compacting", "session.compacted",
  "message.updated", "message.part.updated", "message.part.delta",
  "message.complete", "message.part.complete", "message.error", "message.aborted",
  "question.asked", "question.replied", "question.rejected",
  "permission.asked", "permission.replied",
  "todo.updated",
  "trajectory.event", "trajectory.turn",
  "session.next.step.ended", "session.next.reasoning.ended", "session.next.tool.failed",
] as const

export type RuntimeEventType = typeof RUNTIME_EVENT_TYPES[number]

/** 顶层扁平广播 type 全集（无 data 信封；见 event-broadcast.ts 的扁平约定） */
export const FLAT_EVENT_TYPES = [
  "user_question", "user_feedback", "goal_created", "state_change",
  "phase_transition", "memory_written", "memory_energy_changed",
  "memory_distillation_complete", "automation_triggered", "automation_completed",
  "project_registered", "runtime_switched", "mafw_commands_changed",
] as const

export type FlatEventType = typeof FLAT_EVENT_TYPES[number]

/** opencode_event 信封内层载荷（wire 契约见 gateway event-broadcast.ts） */
export interface OpencodeEventData {
  type: RuntimeEventType | `plugin:${string}`
  properties?: any
  sessionID?: string
  directory?: string
  error?: string
  internal?: boolean
}

export interface OpencodeEventEnvelope {
  type: "opencode_event"
  data: OpencodeEventData
}

/** 顶层扁平广播：判别 union，properties 宽松（各消费方自行窄化） */
export type FlatGatewayEvent =
  | { type: "user_question"; goalId?: string; questionId?: string; question?: string }
  | { type: "user_feedback"; goalId?: string; targetId?: string }
  | { type: "goal_created"; goalId?: string; projectDir?: string }
  | { type: "state_change"; goalId?: string; patch?: any; projectDir?: string }
  | { type: "phase_transition"; goalId?: string; phase?: string }
  | { type: "memory_written"; id?: string }
  | { type: "memory_energy_changed" }
  | { type: "memory_distillation_complete" }
  | { type: "automation_triggered"; ruleId?: string }
  | { type: "automation_completed"; ruleId?: string }
  | { type: "project_registered"; projectDir: string }
  | { type: "runtime_switched"; runtime: string; previous: string | null }
  | { type: "mafw_commands_changed" }
  | { type: `plugin:${string}`; [key: string]: any }

/** /api/events 上一帧的完整 union（剥壳前） */
export type GatewayEvent = OpencodeEventEnvelope | FlatGatewayEvent

/** 剥壳后的统一视图（desktop `raw?.data || raw` 的产物） */
export type UnwrappedEvent = OpencodeEventData | FlatGatewayEvent

/**
 * 穷尽性守卫：switch/if-chain 末端调用。所有 union 成员都被分支消费后
 * 残余类型为 never 才编译通过；gateway 新增事件类型时，调用点编译报错，
 * 精确指向需要接线的位置。
 */
export function assertNever(x: never, context?: string): never {
  throw new Error(
    `Unhandled event${context ? ` at ${context}` : ""}: ${JSON.stringify(x)}`
  )
}
```

`packages/gateway-sdk/src/index.ts` 追加：

```ts
export * from "./events"
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/gateway-sdk && bun test && bun run typecheck`
Expected: 全部 PASS（含既有 71 个），typecheck 0 error

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/events.ts packages/gateway-sdk/src/events.test.ts packages/gateway-sdk/src/index.ts
git commit -m "feat(sdk): canonical GatewayEvent union + assertNever exhaustiveness guard"
```

---

### Task 2: gateway 事件链路矩阵 + 遍历门禁测试

**Files:**
- Create: `gateway/src/runtime/event-flow-matrix.ts`
- Test: `gateway/tests/unit/runtime/event-flow-matrix.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `RUNTIME_EVENT_TYPES` / `FLAT_EVENT_TYPES`（经相对路径 `../../../packages/gateway-sdk/src/events` import——纯 TS 零依赖，ts-jest 可直接编译）
- Produces:
  - `EVENT_FLOW_MATRIX: Record<string, EventFlowRow>`
  - `EventFlowRow { normalizeFacet: string[]; modeA: 'passthrough'|'rewrite'|'drop'; desktop: 'handled'|'ignore'; tui: 'handled'|'ignore'; note?: string }`
  - `assertMatrixComplete(): string[]`（返回问题列表，空 = 通过）

- [ ] **Step 1: Write the failing test**

`gateway/tests/unit/runtime/event-flow-matrix.test.ts`：

```ts
import { EVENT_FLOW_MATRIX, assertMatrixComplete } from '../../../src/runtime/event-flow-matrix';
import { RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES } from '../../../../packages/gateway-sdk/src/events';

describe('event flow matrix', () => {
  it('covers every canonical runtime event type', () => {
    for (const t of RUNTIME_EVENT_TYPES) {
      expect(EVENT_FLOW_MATRIX[t]).toBeDefined();
    }
  });

  it('covers every flat broadcast type', () => {
    for (const t of FLAT_EVENT_TYPES) {
      expect(EVENT_FLOW_MATRIX[t]).toBeDefined();
    }
  });

  it('has no stale rows for removed event types', () => {
    const known = new Set<string>([...RUNTIME_EVENT_TYPES, ...FLAT_EVENT_TYPES]);
    for (const key of Object.keys(EVENT_FLOW_MATRIX)) {
      expect(known.has(key) || key.startsWith('plugin:')).toBe(true);
    }
  });

  it('every cell is explicitly filled (no empty dispositions)', () => {
    expect(assertMatrixComplete()).toEqual([]);
  });

  it('normalize.ts facet consumers are a subset of matrix normalizeFacet claims', () => {
    // session.idle 必须声明 chatSignal+broadcast 两个 facet 消费（index.ts 现状）
    expect(EVENT_FLOW_MATRIX['session.idle'].normalizeFacet).toContain('chatSignal');
    expect(EVENT_FLOW_MATRIX['session.idle'].normalizeFacet).toContain('broadcast');
    // session.idle 在 Mode A 被改写为 message.complete（MafwShell 注释印证）
    expect(EVENT_FLOW_MATRIX['session.idle'].modeA).toBe('rewrite');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/event-flow-matrix.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write implementation**

`gateway/src/runtime/event-flow-matrix.ts`（完整 38 行事件 × 4 列；值依据 2026-09-18 勘察：normalize.ts 消费分支、index.ts 广播改写、MafwShell onmessage 分支、TUI chat-store/app）：

```ts
/**
 * 事件链路矩阵 —— 每个 canonical 事件在每一跳的消费处置，显式声明。
 *
 * 列：
 *   normalizeFacet — gateway normalize.ts 抽出的切面（step/chatSignal/broadcast/compaction/toolCommand），空数组 = 仅透传
 *   modeA          — Mode A 全局广播处置：passthrough 原样 / rewrite 改写（如 session.idle→message.complete）/ drop 不广播
 *   desktop / tui  — 客户端消费：handled = 有分支；ignore = 显式不消费（有意）
 *
 * 新增事件类型时必须在此加行（SDK union 扩展 → 遍历测试变红指向本文件），
 * 填每一格时即完成"这个事件每一跳怎么办"的通盘思考。
 */

export interface EventFlowRow {
  normalizeFacet: string[];
  modeA: 'passthrough' | 'rewrite' | 'drop';
  desktop: 'handled' | 'ignore';
  tui: 'handled' | 'ignore';
  note?: string;
}

const R = (
  normalizeFacet: string[],
  modeA: EventFlowRow['modeA'],
  desktop: EventFlowRow['desktop'],
  tui: EventFlowRow['tui'],
  note?: string,
): EventFlowRow => ({ normalizeFacet, modeA, desktop, tui, ...(note ? { note } : {}) });

export const EVENT_FLOW_MATRIX: Record<string, EventFlowRow> = {
  // ---- 会话生命周期 ----
  'session.created':      R([], 'passthrough', 'handled', 'ignore', 'desktop 走 planSessionEvent invalidate'),
  'session.updated':      R([], 'passthrough', 'handled', 'ignore', 'desktop patch 标题/时间；pi agent_start 映射为此（空壳无 info，planner 忽略）'),
  'session.deleted':      R([], 'passthrough', 'handled', 'ignore', 'desktop remove + closeSession'),
  'session.idle':         R(['chatSignal', 'broadcast'], 'rewrite', 'handled', 'handled', 'Mode A 改写为 message.complete；desktop 的 session.idle 分支是防御性兜底'),
  'session.error':        R(['chatSignal', 'broadcast'], 'passthrough', 'handled', 'handled', 'Mode A 改写为 message.error'),
  'session.compacting':   R(['compaction'], 'passthrough', 'ignore', 'ignore', '仅 pi 发；gateway 触发 turnCompress flush'),
  'session.compacted':    R(['compaction'], 'passthrough', 'handled', 'ignore', 'desktop 记录 compactionMarks'),
  // ---- 消息流 ----
  'message.updated':      R(['step', 'chatSignal'], 'passthrough', 'handled', 'ignore', 'desktop 建消息骨架/替换乐观 user 消息'),
  'message.part.updated': R(['step', 'chatSignal', 'toolCommand'], 'passthrough', 'handled', 'handled', '最高频事件'),
  'message.part.delta':   R([], 'passthrough', 'handled', 'ignore', 'opencode ≥1.18 流式增量'),
  'message.complete':     R([], 'passthrough', 'handled', 'handled', 'Mode A 由 session.idle 改写而来'),
  'message.part.complete':R([], 'passthrough', 'handled', 'ignore', ''),
  'message.error':        R(['chatSignal'], 'passthrough', 'handled', 'ignore', 'Mode A 由 session.error 改写而来'),
  'message.aborted':      R([], 'passthrough', 'handled', 'ignore', ''),
  // ---- 问答/审批 ----
  'question.asked':       R([], 'passthrough', 'handled', 'ignore', 'desktop flow card'),
  'question.replied':     R([], 'passthrough', 'handled', 'ignore', ''),
  'question.rejected':    R([], 'passthrough', 'handled', 'ignore', ''),
  'permission.asked':     R([], 'passthrough', 'handled', 'handled', 'TUI 有 once/always/reject overlay'),
  'permission.replied':   R([], 'passthrough', 'handled', 'ignore', ''),
  // ---- 数据面 ----
  'todo.updated':         R([], 'passthrough', 'handled', 'ignore', ''),
  'trajectory.event':     R([], 'passthrough', 'handled', 'ignore', 'desktop 滚动窗口 200'),
  'trajectory.turn':      R([], 'passthrough', 'handled', 'ignore', ''),
  // ---- legacy/internal ----
  'session.next.step.ended':     R(['step'], 'passthrough', 'ignore', 'ignore', 'legacy 兜底（opencode <1.18）'),
  'session.next.reasoning.ended':R([], 'passthrough', 'ignore', 'ignore', '插件 obs 捕获用，客户端不消费'),
  'session.next.tool.failed':    R([], 'passthrough', 'ignore', 'ignore', '插件 obs 捕获用'),
  // ---- 扁平顶层广播 ----
  'user_question':              R([], 'passthrough', 'handled', 'ignore', 'desktop setActiveQuestion + 通知'),
  'user_feedback':              R([], 'passthrough', 'ignore', 'ignore', ''),
  'goal_created':               R([], 'passthrough', 'ignore', 'ignore', 'desktop Goals 页 15s 轮询'),
  'state_change':               R([], 'passthrough', 'ignore', 'ignore', '同上'),
  'phase_transition':           R([], 'passthrough', 'ignore', 'ignore', '同上'),
  'memory_written':             R([], 'passthrough', 'ignore', 'ignore', ''),
  'memory_energy_changed':      R([], 'passthrough', 'ignore', 'ignore', ''),
  'memory_distillation_complete':R([], 'passthrough', 'ignore', 'ignore', ''),
  'automation_triggered':       R([], 'passthrough', 'ignore', 'ignore', 'Automations 页 10s 轮询'),
  'automation_completed':       R([], 'passthrough', 'ignore', 'ignore', '同上'),
  'project_registered':         R([], 'passthrough', 'handled', 'ignore', 'desktop projectsRev++ 重拉 Rail'),
  'runtime_switched':           R([], 'passthrough', 'handled', 'ignore', 'desktop 重置 chat workspace'),
  'mafw_commands_changed':      R([], 'passthrough', 'ignore', 'ignore', 'desktop ChatPane 另行消费补全'),
};

const VALID_MODE_A = new Set(['passthrough', 'rewrite', 'drop']);
const VALID_CONSUMPTION = new Set(['handled', 'ignore']);

/** 返回矩阵完整性的问题列表；空数组 = 通过。 */
export function assertMatrixComplete(): string[] {
  const issues: string[] = [];
  for (const [type, row] of Object.entries(EVENT_FLOW_MATRIX)) {
    if (!Array.isArray(row.normalizeFacet)) issues.push(`${type}: normalizeFacet must be an array`);
    if (!VALID_MODE_A.has(row.modeA)) issues.push(`${type}: invalid modeA '${row.modeA}'`);
    if (!VALID_CONSUMPTION.has(row.desktop)) issues.push(`${type}: invalid desktop '${row.desktop}'`);
    if (!VALID_CONSUMPTION.has(row.tui)) issues.push(`${type}: invalid tui '${row.tui}'`);
  }
  return issues;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/event-flow-matrix.test.ts --runInBand`
Expected: PASS（5 个用例）。若 `session.idle` modeA 断言与 index.ts 实际改写逻辑不符，以 index.ts:1037 现状为准修正矩阵（matrix 反映现状，不改行为）。

- [ ] **Step 5: 全量回归**

Run: `cd gateway && npm test`
Expected: 全量 PASS（记录通过数，向用户汇报）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/event-flow-matrix.ts gateway/tests/unit/runtime/event-flow-matrix.test.ts
git commit -m "feat(gateway): event flow matrix with completeness gate test"
```

---

### Task 3: desktop MafwShell onmessage 穷尽 narrowing + assertNever

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:1320-1640`
- Test: `packages/desktop/src/renderer/mafw/session-events.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `assertNever` / `UnwrappedEvent`（`@mafw/sdk`）
- Produces: `IGNORED_AT_SHELL: readonly string[]`（从 MafwShell 模块导出，供 Task 4 回放测试断言）

- [ ] **Step 1: Write the failing test**

`packages/desktop/src/renderer/mafw/session-events.test.ts` 追加（验证"显式忽略清单"与 SDK union 的关系）：

```ts
import { test, expect } from "bun:test"
import { RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES } from "@mafw/sdk"
import { IGNORED_AT_SHELL } from "./MafwShell"

test("IGNORED_AT_SHELL entries are real canonical types", () => {
  const known = new Set<string>([...RUNTIME_EVENT_TYPES, ...FLAT_EVENT_TYPES])
  for (const t of IGNORED_AT_SHELL) {
    expect(known.has(t)).toBe(true)
  }
})

test("planner-consumed lifecycle types are not in the ignore list", () => {
  for (const t of ["session.created", "session.updated", "session.deleted"]) {
    expect(IGNORED_AT_SHELL).not.toContain(t)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && bun test src/renderer/mafw/session-events.test.ts`
Expected: FAIL（`IGNORED_AT_SHELL` 未导出）

- [ ] **Step 3: Write implementation**

MafwShell.tsx 三处改动（最小侵入，不改任何分支行为）：

(a) 文件顶部 import 与忽略清单导出：

```ts
import { assertNever } from "@mafw/sdk"

/**
 * MafwShell onmessage 显式不消费的事件（有意 ignore，非遗漏）。
 * 每加一个类型到 SDK union，typecheck 会强迫把它归入"有分支"或进此清单。
 */
export const IGNORED_AT_SHELL = [
  "user_feedback", "goal_created", "state_change", "phase_transition",
  "memory_written", "memory_energy_changed", "memory_distillation_complete",
  "automation_triggered", "automation_completed",
  "mafw_commands_changed", "session.compacting",
  "session.next.step.ended", "session.next.reasoning.ended", "session.next.tool.failed",
] as const
```

(b) onmessage 尾部 media_speak 块改为带 return 的 if（保持逻辑不变，仅补 return），其后追加：

```ts
      // 显式忽略清单（desktop 轮询或其他组件消费；见 IGNORED_AT_SHELL 注释）
      if ((IGNORED_AT_SHELL as readonly string[]).includes(event.type)) return
      // 插件自定义事件与 session.next.tool.* 前缀（media_speak 已处理）
      if (event.type?.startsWith("plugin:")) return
      if (event.type?.startsWith("session.next.tool.")) return
      // 穷尽性守卫：SDK union 新增类型时此处编译报错，指向本函数
      assertNever(event.type as never, "MafwShell.onmessage")
```

注意：`assertNever(event.type as never)` 的编译期强制依赖 `event` 被标注为 `UnwrappedEvent` 且前置分支用字面量比较 narrowing。`event` 当前是 `any`（剥壳产物），需要：

```ts
      const event = (raw?.data || raw) as import("@mafw/sdk").UnwrappedEvent
```

若 narrowing 在超长 if-chain 上不可靠（TS 对 `startsWith` 前缀分支不 narrow），退化方案：`assertNever(event.type as never)` 保持运行期兜底，编译期强制由 (c) 的独立类型级检查承担：

(c) 新增纯类型级穷尽检查（文件底部，永不执行的函数体）：

```ts
// 类型级穷尽检查：SDK union 新增类型时，本函数编译报错。
// 运行时无开销（函数体不执行实际逻辑）。
function _typecheckShellCoverage(e: import("@mafw/sdk").UnwrappedEvent): void {
  type Handled =
    | "user_question" | "project_registered" | "runtime_switched"
    | "session.created" | "session.updated" | "session.deleted"
    | "question.asked" | "question.replied" | "question.rejected"
    | "permission.asked" | "permission.replied" | "session.compacted"
    | "trajectory.event" | "trajectory.turn" | "todo.updated"
    | "message.updated" | "message.part.delta" | "message.part.updated"
    | "message.complete" | "message.part.complete"
    | "session.idle" | "session.error" | "message.error" | "message.aborted"
  type Ignored = typeof IGNORED_AT_SHELL[number]
  type PluginOrPrefix = `plugin:${string}` | `session.next.tool.${string}`
  const _exhaustive: Exclude<
    Exclude<import("@mafw/sdk").UnwrappedEvent["type"], Handled | Ignored>,
    PluginOrPrefix
  > = e.type as never
  void _exhaustive
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/desktop && bun test src/renderer/mafw/ && bun run typecheck`
Expected: 全 PASS，tsgo 0 error。若 typecheck 报 `_exhaustive` 赋值错误 = 清单与 union 不一致，按报错补齐（这正是机制生效）。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/session-events.test.ts
git commit -m "feat(desktop): exhaustive event coverage guard in MafwShell onmessage"
```

---

### Task 4: 端到端回放测试（gateway golden + desktop planner 回放）

**Files:**
- Create: `gateway/tests/fixtures/events/runtime-raw-session.jsonl`、`gateway/tests/unit/runtime/event-replay.test.ts`
- Create: `packages/desktop/src/renderer/mafw/fixtures/broadcast-session.jsonl`、`packages/desktop/src/renderer/mafw/event-replay.test.ts`

**Interfaces:**
- Consumes: gateway `normalizeOpencodeEvent`（gateway/src/runtime/normalize.ts）、`opencodeBroadcast`（event-broadcast.ts）、desktop `planSessionEvent`（session-events.ts）
- Produces: 两份 golden fixture（后续新事件类型入库时各自扩一行场景）

- [ ] **Step 1: Write the failing test（gateway 侧）**

fixture `gateway/tests/fixtures/events/runtime-raw-session.jsonl`（一行一个 runtime 原生事件，模拟一次完整回合）：

```jsonl
{"type":"session.updated","properties":{"sessionID":"s1","info":{"id":"s1","title":"demo","directory":"/p"}}}
{"type":"message.updated","properties":{"info":{"id":"m1","role":"user","sessionID":"s1"}}}
{"type":"message.part.updated","properties":{"part":{"id":"p1","messageID":"m2","sessionID":"s1","type":"text","text":"你"}}}
{"type":"message.part.updated","properties":{"part":{"id":"p2","messageID":"m2","sessionID":"s1","type":"step-finish","reason":"stop","tokens":{"input":1,"output":2}}}}
{"type":"session.idle","properties":{"sessionID":"s1"}}
```

`gateway/tests/unit/runtime/event-replay.test.ts`：

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';
import { opencodeBroadcast } from '../../../src/runtime/event-broadcast';

describe('event replay (golden)', () => {
  it('runtime raw events normalize to expected facet sequence', () => {
    const lines = readFileSync(join(__dirname, '../../fixtures/events/runtime-raw-session.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));
    const facets = lines.map((e) => normalizeOpencodeEvent(e));
    // 回合完整性：恰好一个 step 结算、一个 idle 广播
    expect(facets.filter((f) => f.step).length).toBe(1);
    expect(facets.filter((f) => f.broadcast === 'idle').length).toBe(1);
    // 每个事件都产出了合法 facet 形状
    for (const f of facets) {
      expect(typeof f.type).toBe('string');
      expect(['idle', 'error', 'passthrough']).toContain(f.broadcast);
    }
  });

  it('broadcast envelopes match wire contract (flat keys, no undefined leaking)', () => {
    const env = opencodeBroadcast({ type: 'session.idle', sessionID: 's1' });
    expect(env.type).toBe('opencode_event');
    expect(env.data.type).toBe('session.idle');
    expect('internal' in env.data).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** 

Run: `cd gateway && npx jest tests/unit/runtime/event-replay.test.ts --runInBand`
Expected: FAIL（fixture 缺失或断言不符则按 normalize 现状修 fixture——回放测试反映现状，不改行为）

- [ ] **Step 3: desktop 侧回放测试**

fixture `packages/desktop/src/renderer/mafw/fixtures/broadcast-session.jsonl`（剥壳后形态）：

```jsonl
{"type":"session.created","properties":{"info":{"id":"s9","title":"new chat","directory":"/p"}}}
{"type":"session.updated","properties":{"sessionID":"s9","info":{"id":"s9","title":"renamed","time":{"updated":123}}}}
{"type":"session.deleted","properties":{"sessionID":"s9"}}
```

`packages/desktop/src/renderer/mafw/event-replay.test.ts`：

```ts
import { test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { planSessionEvent, type RawSessionEvent } from "./session-events"

test("broadcast replay: lifecycle sequence produces invalidate→patch→remove", () => {
  const lines = readFileSync(join(__dirname, "fixtures/broadcast-session.jsonl"), "utf8")
    .trim().split("\n").map(l => JSON.parse(l) as RawSessionEvent)
  const actions = lines.map(planSessionEvent)
  expect(actions[0]).toEqual({ kind: "invalidate", directory: "/p" })
  expect(actions[1].kind).toBe("patch")
  if (actions[1].kind === "patch") expect(actions[1].patch.title).toBe("renamed")
  expect(actions[2]).toEqual({ kind: "remove", id: "s9" })
})

test("replay: hidden worker session produces none", () => {
  const action = planSessionEvent({
    type: "session.created",
    properties: { info: { id: "w1", title: "# Memory Indexing", directory: "/p" } },
  })
  expect(action.kind).toBe("none")
})
```

- [ ] **Step 4: Run both suites**

Run: `cd gateway && npx jest tests/unit/runtime/event-replay.test.ts --runInBand`；`cd packages/desktop && bun test src/renderer/mafw/event-replay.test.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/fixtures/events/ gateway/tests/unit/runtime/event-replay.test.ts packages/desktop/src/renderer/mafw/fixtures/ packages/desktop/src/renderer/mafw/event-replay.test.ts
git commit -m "test: golden replay fixtures for gateway normalize + desktop planner"
```

---

### Task 5: desktop dev 事件检查器（trace 环 + 调试浮层）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/event-trace.ts`（纯模块：环形缓冲 + 分支标记）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（每个分支末尾一行 `traceEvent(event, '<branch>')`；Ctrl+Shift+E 开关浮层）
- Create: `packages/desktop/src/renderer/mafw/components/EventInspector.tsx`（SolidJS 浮层）
- Test: `packages/desktop/src/renderer/mafw/event-trace.test.ts`

**Interfaces:**
- Produces:
  - `traceEvent(event: { type?: string; sessionID?: string }, branch: string): void`（MafwShell 每分支调用）
  - `getTrace(): TraceEntry[]`（最近 100 条，新→旧）
  - `TraceEntry { at: number; type: string; sessionID?: string; branch: string }`
  - `clearTrace(): void`

- [ ] **Step 1: Write the failing test**

`packages/desktop/src/renderer/mafw/event-trace.test.ts`：

```ts
import { test, expect, beforeEach } from "bun:test"
import { traceEvent, getTrace, clearTrace } from "./event-trace"

beforeEach(() => clearTrace())

test("records entries newest-first with branch label", () => {
  traceEvent({ type: "session.idle", sessionID: "s1" }, "chat:idle")
  traceEvent({ type: "permission.asked", sessionID: "s1" }, "flow-card")
  const t = getTrace()
  expect(t.length).toBe(2)
  expect(t[0].type).toBe("permission.asked")
  expect(t[1].branch).toBe("chat:idle")
})

test("ring buffer caps at 100 entries", () => {
  for (let i = 0; i < 130; i++) traceEvent({ type: "message.part.delta" }, "chat:delta")
  expect(getTrace().length).toBe(100)
})

test("malformed events are recorded not thrown", () => {
  traceEvent({}, "unknown")
  traceEvent(null as any, "unknown")
  expect(getTrace().length).toBe(2)
  expect(getTrace()[1].type).toBe("(unknown)")
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/desktop && bun test src/renderer/mafw/event-trace.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement trace 模块**

`packages/desktop/src/renderer/mafw/event-trace.ts`：

```ts
/**
 * SSE 事件 trace 环 —— dev 事件检查器的数据源。
 * MafwShell onmessage 每个分支末尾调用 traceEvent 标记"谁消费了它"。
 * 生产环境开销可忽略（单数组 unshift + 截断）。
 */

export interface TraceEntry {
  at: number
  type: string
  sessionID?: string
  branch: string
}

const CAP = 100
const ring: TraceEntry[] = []

export function traceEvent(event: { type?: string; sessionID?: string } | null, branch: string): void {
  ring.unshift({
    at: Date.now(),
    type: event?.type || "(unknown)",
    sessionID: event?.sessionID,
    branch,
  })
  if (ring.length > CAP) ring.length = CAP
}

export function getTrace(): TraceEntry[] {
  return [...ring]
}

export function clearTrace(): void {
  ring.length = 0
}
```

- [ ] **Step 4: MafwShell 接线 + 检查器浮层**

MafwShell.tsx：onmessage 每个 return 分支前加一行 traceEvent（约 15 处插入，例如 `if (event.type === "permission.asked") { traceEvent(event, "flow-card:permission"); ... }`；尾部 assertNever 前加 `traceEvent(event, "miss")`——**"miss" 分支就是漏接线事件的可视化**）。EventInspector.tsx：固定右下浮层（SolidJS，`Show` 受控于 MafwShell 的 `showInspector` signal；Ctrl+Shift+E toggle），表格列：时间 / type / sessionID 尾 8 位 / branch，branch 为 `miss` 的行红色高亮。组件样式用现有 v2 组件约定，不新增裸 `<button>`（关闭按钮用 ButtonV2）。

- [ ] **Step 5: Run tests + typecheck + 手测**

Run: `cd packages/desktop && bun test src/renderer/mafw/ && bun run typecheck`
Expected: 全 PASS。手测：`bun run dev` 起桌面端，发一条消息，Ctrl+Shift+E 看 trace 流无 miss 行。

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/event-trace.ts packages/desktop/src/renderer/mafw/event-trace.test.ts packages/desktop/src/renderer/mafw/components/EventInspector.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): dev event inspector with per-branch trace ring"
```

---

## Self-Review 记录

- **范围覆盖**：① SDK union+assertNever → Task 1+3；② 矩阵+门禁测试 → Task 2；③ 回放测试 → Task 4；④ dev 检查器 → Task 5。✓
- **占位符扫描**：Task 5 Step 4 的 15 处 traceEvent 插入是机械重复，执行时逐分支添加即可（分支标签命名规则：`flow-card:*` / `chat:*` / `rail:*` / `notify:*` / `miss`）。其余代码均完整。
- **类型一致性**：`UnwrappedEvent` / `assertNever` / `IGNORED_AT_SHELL` / `TraceEntry` 跨任务签名一致；`assertMatrixComplete` 在 Task 2 测试与实现一致。
- **已知风险**：Task 3 的 if-chain narrowing 可能因 `startsWith` 前缀分支失效——已内置退化方案（Step 3c 的独立类型级函数承担编译期强制，assertNever 保持运行期兜底）。matrix 中 TUI 列只核对了 chat-store/app 两个文件，执行 Task 2 时如发现 TUI 实际消费更多类型，以代码现状修正矩阵。

## 执行偏差记录（2026-09-18，inline 执行）

1. **Task 2 矩阵修正**：`session.error` / `message.error` 的 modeA 经 index.ts:1037-1043 核实为 if/else-if 严格改写——`session.error` 是 `rewrite`（自身不再透传，改写为 message.error）；`message.error` 自身 broadcast=passthrough 另有透传（与 session.error 双发）。
2. **Task 3 三处重设计**（原方案的 `assertNever(event.type as never)` 恒编译通过，且运行时尾巴会误伤经 else-if 链合法落到尾部的 `message.part.updated`）：
   - `IGNORED_AT_SHELL` / `isTailAccountedAtShell` / `assertShellEventCoverage` 放纯模块 `session-events.ts`（避免测试 import 2783 行组件）；
   - 编译期强制改用 **switch 残余窄化**（default 分支赋值给 `plugin:${string}`，SDK 新增类型未归类即 TS2322）；
   - 运行期兜底降级为 **warn + trace("miss")**（不抛错），并覆盖 `!sid` 早退路径（否则新扁平广播事件被静默吞掉不告警）。
3. **守卫实弹演练**：临时向 SDK union 注入 `session.future.thing` → desktop typecheck 精确红在 session-events.ts:189 → 还原。编译期强制已证实生效。
4. **Task 5**：miss 检测合并进 `missTrace()` 局部函数，`!sid` 早退与尾部两处调用；trace 埋点 17 处（含 `chat:stream` 链合并 1 处）。
