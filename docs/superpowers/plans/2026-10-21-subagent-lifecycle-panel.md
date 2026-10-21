# Subagent Lifecycle Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 子代理的「存在感 / 运行状态 / 完成提醒」三层信号进入 desktop：RightDock「子代理」tab + 终态通知 + 一键跳转子会话。

**Architecture:** 纯 desktop 侧从既有 canonical 事件推导（session.created parentID / turn 三元组 / session.deleted），零 gateway 与词汇表改动。核心是一个纯 reducer（`subagent-tracker.ts`）+ 通知构造/门（`subagent-notify.ts`）+ Solid 单例 store（`subagent-store.ts`），经 dispatcher 新增 `subagents` deps 组喂入；UI 挂在现有 RightDock；对账轮询（15s + SSE 重连即触发）自愈断线漏终态。

**Tech Stack:** SolidJS、desktop SSE dispatcher（deps 注入）、node --test + @mafw/test-shim（`bun:test` import 可用）。

**Spec:** `docs/superpowers/specs/2026-10-21-subagent-lifecycle-panel-design.md`（rev2）

## Global Constraints

- **仅 opencode runtime**：pi 无子代理能力（无 task 工具、children() 恒空桩）——面板在 pi 下恒空是合法状态，不做特判。
- **零 gateway 改动、零 canonical 词汇改动**（不碰 5 点 guard chain；消费的都是既有事件类型）。
- 文案中文；面板 tab 标签硬编码（RightDock 现无 i18n 层，勿引入）。
- 通知规则（写死）：completed/failed → toast 恒发 + `document.hidden` 时 OS 通知（10s 全局门）；**aborted 静默**；每子代理至多一次终态通知（由「running→终态」转换定义，snapshot 补的历史行不算）。
- CSS 走主题 token，禁字面值；UI 组件走 `@mafw/ui/v2/*`（禁裸 `<button>`/`<input>`）。
- 测试命令（均从 `packages/desktop` 运行）：单文件 `node --import tsx --import ../../packages/test-shim/register.mjs --test <path>`；全量 `npm test`。
- 每 Task 末尾提交（`feat(desktop): ...` 格式，直接 master）。

## Review Focus

按最可能咬人的顺序，各配测试（见对应 Task）：

1. SSE 断线跨度恰好覆盖子代理终态 → 重连/15s 对账必须收敛，**不留假活行**（Task 1 `child-last-message` 用例 + Task 6 接线）。
2. 并发子代理齐完成 → OS 通知洪泛（Claude #11716 教训）——10s 全局门只限 OS，toast 不丢（Task 2 `createNotifyGate` 用例）。
3. 用户中断父会话 → 子会话 `turn.aborted` → 僵尸行（Task 1 终态用例：aborted 落行、`buildTerminalNotice` 返回 null 静默）。
4. 父会话 revert / 外部删除子会话（`session.deleted`）→ running 行收敛（Task 1 deleted 用例）。
5. children API 返回**无状态**会话对象（无 running/completed 字段）→ snapshot 补历史行标 completed、不得把未知态标 running、不得把已有 running 行降级、**不得触发完成通知**（Task 1 snapshot 用例 + `collectNewTerminals` 的「prev 不存在不计」用例）。

---

### Task 1: subagent-tracker 纯 reducer

**Files:**
- Create: `packages/desktop/src/renderer/mafw/subagent-tracker.ts`
- Test: `packages/desktop/src/renderer/mafw/subagent-tracker.test.ts`

**Interfaces:**
- Produces（后续任务全部依赖这些名字与形状）：

```ts
export type SubagentStatus = "running" | "completed" | "failed" | "aborted"
export interface SubagentRow {
  childID: string; parentID: string; title: string; agent: string
  status: SubagentStatus; startedAt: number; endedAt?: number
}
export type TrackerEvent =
  | { kind: "session-created"; info: { id: string; parentID: string; title?: string } }
  | { kind: "session-updated"; sessionID: string; title: string }
  | { kind: "turn-terminal"; sessionID: string; terminal: "completed" | "failed" | "aborted" }
  | { kind: "session-deleted"; sessionID: string }
  | { kind: "children-snapshot"; parentID: string; children: Array<{ id: string; title?: string; time?: { created?: number; updated?: number } }> }
  | { kind: "child-last-message"; childID: string; message: { role: string; time?: { completed?: number }; error?: unknown } | null }
export function parseAgentFromTitle(title: string): string
export function applySubagentEvent(rows: SubagentRow[], ev: TrackerEvent, now?: number): SubagentRow[]
export function collectNewTerminals(prev: SubagentRow[], next: SubagentRow[]): SubagentRow[]
export function isTrackedChildSession(rows: SubagentRow[], sid: string): boolean
export function childrenNeedingProbe(rows: SubagentRow[]): string[]
```

- [ ] **Step 1: 写失败测试**（覆盖每条规则）`subagent-tracker.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { applySubagentEvent, collectNewTerminals, parseAgentFromTitle, isTrackedChildSession, childrenNeedingProbe, type SubagentRow } from "./subagent-tracker"

const created = (id: string, parent: string, title?: string) =>
  ({ kind: "session-created", info: { id, parentID: parent, title } }) as const

describe("parseAgentFromTitle", () => {
  test("标题尾 @agent 解析", () => {
    expect(parseAgentFromTitle("调研登录流程 @explore")).toBe("explore")
  })
  test("无 @ 缺省", () => { expect(parseAgentFromTitle("随便写写")).toBe("子代理") })
})

describe("applySubagentEvent", () => {
  test("session-created 建 running 行；无 parentID 不建", () => {
    let rows = applySubagentEvent([], created("c1", "p1", "任务 @a"), 1000)
    expect(rows).toEqual([{ childID: "c1", parentID: "p1", title: "任务 @a", agent: "a", status: "running", startedAt: 1000 }])
    rows = applySubagentEvent(rows, { kind: "session-created", info: { id: "x", parentID: "" } }, 1000)
    expect(rows.length).toBe(1)
  })
  test("session-updated 刷新标题与 agent，不动其他行", () => {
    let rows = applySubagentEvent([], created("c1", "p1", "旧 @a"), 1000)
    rows = applySubagentEvent(rows, { kind: "session-updated", sessionID: "c1", title: "新 @b" }, 2000)
    expect(rows[0]).toMatchObject({ title: "新 @b", agent: "b", status: "running" })
  })
  test("turn-terminal 三值；首个终态生效（幂等）", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "turn-terminal", sessionID: "c1", terminal: "completed" }, 2000)
    expect(rows[0]).toMatchObject({ status: "completed", endedAt: 2000 })
    rows = applySubagentEvent(rows, { kind: "turn-terminal", sessionID: "c1", terminal: "failed" }, 3000)
    expect(rows[0]!.status).toBe("completed") // 不回退
  })
  test("turn.aborted → aborted 止住僵尸行", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "turn-terminal", sessionID: "c1", terminal: "aborted" }, 1500)
    expect(rows[0]).toMatchObject({ status: "aborted", endedAt: 1500 })
  })
  test("session.deleted 收敛 running 行（aborted）", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "session-deleted", sessionID: "c1" }, 1200)
    expect(rows[0]).toMatchObject({ status: "aborted", endedAt: 1200 })
  })
  test("children-snapshot：补历史 completed 行；不回退、不标 running、endedAt 取 time.updated", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "children-snapshot", parentID: "p1", children: [
      { id: "c1", title: "在跑 @a" },                                   // 已存在 → 不动
      { id: "c2", title: "老任务 @b", time: { created: 100, updated: 200 } }, // 补历史
    ] }, 5000)
    const c1 = rows.find(r => r.childID === "c1")!
    const c2 = rows.find(r => r.childID === "c2")!
    expect(c1.status).toBe("running")
    expect(c2).toMatchObject({ status: "completed", startedAt: 100, endedAt: 200 })
  })
  test("child-last-message 自愈：assistant 且 time.completed → completed；error → failed；否则不动", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "child-last-message", childID: "c1", message: { role: "assistant", time: {} } }, 2000)
    expect(rows[0]!.status).toBe("running") // 未完不误判
    rows = applySubagentEvent(rows, { kind: "child-last-message", childID: "c1", message: { role: "assistant", time: { completed: 2500 } } }, 3000)
    expect(rows[0]).toMatchObject({ status: "completed", endedAt: 2500 })
  })
  test("排序：startedAt 倒序", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, created("c2", "p1"), 2000)
    expect(rows.map(r => r.childID)).toEqual(["c2", "c1"])
  })
})

describe("collectNewTerminals（通知来源）", () => {
  test("只计 running→终态；snapshot 补的历史行不计", () => {
    const before: SubagentRow[] = [
      { childID: "a", parentID: "p", title: "t", agent: "x", status: "running", startedAt: 1 },
    ]
    const after: SubagentRow[] = [
      { childID: "a", parentID: "p", title: "t", agent: "x", status: "completed", startedAt: 1, endedAt: 2 },
      { childID: "b", parentID: "p", title: "hist", agent: "x", status: "completed", startedAt: 0, endedAt: 0 }, // prev 无 → 不计
    ]
    expect(collectNewTerminals(before, after).map(r => r.childID)).toEqual(["a"])
  })
  test("aborted 也在集合内（静默与否由通知层决定）", () => {
    const before: SubagentRow[] = [{ childID: "a", parentID: "p", title: "t", agent: "x", status: "running", startedAt: 1 }]
    const after: SubagentRow[] = [{ childID: "a", parentID: "p", title: "t", agent: "x", status: "aborted", startedAt: 1, endedAt: 2 }]
    expect(collectNewTerminals(before, after).length).toBe(1)
  })
})

describe("isTrackedChildSession / childrenNeedingProbe", () => {
  const rows: SubagentRow[] = [
    { childID: "c1", parentID: "p", title: "t", agent: "x", status: "running", startedAt: 1 },
    { childID: "c2", parentID: "p", title: "t", agent: "x", status: "completed", startedAt: 0, endedAt: 2 },
  ]
  test("tracked child 判定", () => { expect(isTrackedChildSession(rows, "c1")).toBe(true); expect(isTrackedChildSession(rows, "zz")).toBe(false) })
  test("probe 只含 running 行", () => { expect(childrenNeedingProbe(rows)).toEqual(["c1"]) })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/subagent-tracker.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `subagent-tracker.ts`**

规则（实现体照此，`now` 默认 `Date.now()`）：
- `parseAgentFromTitle`：`/@([^\s@]+)\s*$/` 取尾段；不匹配返回 `"子代理"`。
- `session-created`：`parentID` 假值返回原数组；childID 已存在不重复建。
- `session-updated`：按 childID 更新 title + 重解析 agent；不存在不动。
- `turn-terminal`：仅 running 行生效，落 `status`（"completed"|"failed"|"aborted"）+ `endedAt = now`。
- `session-deleted`：仅 running 行 → `aborted` + `endedAt = now`（其余不动）。
- `children-snapshot`：拼缺失 id 的历史行 `{status:"completed", startedAt: time?.created ?? now, endedAt: time?.updated ?? startedAt}`；**不动已有行**。
- `child-last-message`：仅 running 行；`message` 为 null 或非 assistant 或 `time.completed` 非数字 → 不动；否则 `completed`/`failed`（`message.error` truthy）+ `endedAt = time.completed`。
- 出口统一 `sort((a,b) => b.startedAt - a.startedAt)`。
- `collectNewTerminals`：`next` 中终态且 `prev` 同 id 行存在且为 `running` 的集合。
- 头注释写语义契约（读取方依赖：tracker 全局、作用域过滤在消费方）。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/subagent-tracker.ts packages/desktop/src/renderer/mafw/subagent-tracker.test.ts
git commit -m "feat(desktop): subagent tracker pure reducer (lifecycle/vocabulary-free)"
```

---

### Task 2: 通知构造与限频门

**Files:**
- Create: `packages/desktop/src/renderer/mafw/subagent-notify.ts`
- Test: `packages/desktop/src/renderer/mafw/subagent-notify.test.ts`

**Interfaces:**
- Consumes: `SubagentRow`（Task 1）
- Produces:

```ts
export interface TerminalNotice { toast: string; os?: { title: string; body: string } }
export function buildTerminalNotice(row: SubagentRow, opts: { hidden: boolean }): TerminalNotice | null
export function createNotifyGate(windowMs?: number): (now: number) => boolean
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { buildTerminalNotice, createNotifyGate } from "./subagent-notify"

const row = (status: any, title = "调研登录 @explore") => ({ childID: "c1", parentID: "p", title, agent: "explore", status, startedAt: 0, endedAt: 1 })

describe("buildTerminalNotice", () => {
  test("completed：toast 恒有；hidden 时附 OS", () => {
    expect(buildTerminalNotice(row("completed"), { hidden: false })).toEqual({ toast: "子代理完成：调研登录 @explore" })
    expect(buildTerminalNotice(row("completed"), { hidden: true })!.os).toEqual({ title: "MAFW：子代理完成", body: "调研登录 @explore" })
  })
  test("failed：失败语义文案", () => {
    expect(buildTerminalNotice(row("failed"), { hidden: false })!.toast).toBe("子代理失败：调研登录 @explore")
  })
  test("aborted / running：null（静默）", () => {
    expect(buildTerminalNotice(row("aborted"), { hidden: true })).toBeNull()
    expect(buildTerminalNotice(row("running"), { hidden: true })).toBeNull()
  })
})

describe("createNotifyGate（OS 通知 10s 全局门）", () => {
  test("窗口内只放一条，窗口外放行", () => {
    const gate = createNotifyGate(10_000)
    expect(gate(0)).toBe(true)
    expect(gate(9_999)).toBe(false)
    expect(gate(10_000)).toBe(true)
    expect(gate(10_001)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/subagent-notify.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `subagent-notify.ts`**

`buildTerminalNotice`：`completed` → `{toast: \`子代理完成：${row.title}\`}`；`failed` → `子代理失败：`；其余 null。`hidden` 时补 `os: { title: "MAFW：子代理完成"|"MAFW：子代理失败", body: row.title }`。`createNotifyGate`：闭包记 `lastAllowed`（初值 `-Infinity`），`now - lastAllowed >= windowMs` 时放行并更新。

- [ ] **Step 4: 跑测试确认通过**（同 Step 2，PASS）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/subagent-notify.ts packages/desktop/src/renderer/mafw/subagent-notify.test.ts
git commit -m "feat(desktop): subagent terminal notice builder + OS notify gate"
```

---

### Task 3: 单例 store

**Files:**
- Create: `packages/desktop/src/renderer/mafw/subagent-store.ts`
- Test: `packages/desktop/src/renderer/mafw/subagent-store.test.ts`

**Interfaces:**
- Consumes: `applySubagentEvent` / `collectNewTerminals` / `TrackerEvent`（Task 1）
- Produces:

```ts
export function subagentRows(): SubagentRow[]
export function ingestSubagentEvent(ev: TrackerEvent, now?: number): void
export function onSubagentTerminal(cb: (row: SubagentRow) => void): () => void  // 返回注销函数
export function resetSubagentStore(): void  // 测试用
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test, beforeEach } from "bun:test"
import { subagentRows, ingestSubagentEvent, onSubagentTerminal, resetSubagentStore } from "./subagent-store"

beforeEach(() => resetSubagentStore())

describe("subagent store", () => {
  test("ingest 应用到 rows 并触发一次终态回调（aborted 也触发，通知层过滤）", () => {
    const seen: string[] = []
    const off = onSubagentTerminal(r => seen.push(`${r.childID}:${r.status}`))
    ingestSubagentEvent({ kind: "session-created", info: { id: "c1", parentID: "p", title: "t @a" } }, 1)
    ingestSubagentEvent({ kind: "turn-terminal", sessionID: "c1", terminal: "completed" }, 2)
    ingestSubagentEvent({ kind: "turn-terminal", sessionID: "c1", terminal: "failed" }, 3) // 幂等不回退 → 不再触发
    expect(seen).toEqual(["c1:completed"])
    expect(subagentRows()[0]!.status).toBe("completed")
    off()
    ingestSubagentEvent({ kind: "session-created", info: { id: "c2", parentID: "p" } }, 4)
    ingestSubagentEvent({ kind: "turn-terminal", sessionID: "c2", terminal: "failed" }, 5)
    expect(seen.length).toBe(1) // 注销后不再收
  })
  test("snapshot 补历史行不触发回调", () => {
    const seen: string[] = []
    onSubagentTerminal(r => seen.push(r.childID))
    ingestSubagentEvent({ kind: "children-snapshot", parentID: "p", children: [{ id: "old", title: "历史 @a" }] }, 1)
    expect(seen).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/subagent-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `subagent-store.ts`**

模块单例：`const [rows, setRows] = createSignal<SubagentRow[]>([])`（模式同 `goals-rev.ts`）；回调 `Set<(row) => void>`。`ingestSubagentEvent`：`next = applySubagentEvent(current, ev, now)` → `collectNewTerminals(current, next)` → `setRows(next)` → 逐个回调。头注释点名「tracker 全局；面板过滤在消费方」。

- [ ] **Step 4: 跑测试确认通过**（同 Step 2，PASS）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/subagent-store.ts packages/desktop/src/renderer/mafw/subagent-store.test.ts
git commit -m "feat(desktop): subagent store singleton with terminal callbacks"
```

---

### Task 4: dispatcher 接线（deps 组 + handler）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/subagents.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`（ShellEventDeps L30-37、session.* 分支 L108-121、EXTRA_HANDLERS L41-46）
- Test: `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`（既有文件加用例；无则建）

**Interfaces:**
- Consumes: `TrackerEvent`（Task 1）；`ingestSubagentEvent`（Task 3，测试里用 deps 替身，不直接 import）
- Produces:

```ts
// dispatcher.ts
export interface SubagentDeps { onEvent(ev: TrackerEvent): void }
export interface ShellEventDeps { /* 既有七组 */ subagents: SubagentDeps }
// handlers/subagents.ts
export function mapSessionLifecycleEvent(raw: any): import("../../subagent-tracker").TrackerEvent | null
export const handleSubagentEvent: SidHandler  // 永不消费（return false）
```

- [ ] **Step 1: 写失败测试**（dispatcher 级，deps 全替身）

```ts
import { describe, expect, test } from "bun:test"
import { dispatchShellEvent, type ShellEventDeps } from "./dispatcher"

function makeDeps() {
  const subagentEvents: any[] = []
  const deps = {
    core: { trace() {}, notify() {}, warn() {}, setActiveQuestion() {}, bumpProjectsRev() {}, onRuntimeSwitched() {}, onGoalEvent() {} },
    lifecycle: { invalidate() {}, patch() {}, retitleOpenTab() {}, remove() {}, closeIfOpen() {} },
    flowCards: { upsertCard() {}, resolveCard() {}, setPermissionMode() {}, setCompactionMark() {}, notify() {}, trace() {}, scheduleReconcile() {}, agentTitleOf: () => "", getAskCard: () => undefined },
    dock: { trace() {}, getTrajectoryEvents: () => [], setTrajectoryEvents() {}, setTrajectoryTurn() {}, setTodos() {} },
    chat: { trace() {}, getStore: () => ({ message: {}, part: {}, session_status: {} }), patchStore() {}, setSessionStatus() {}, markSessionDone() {}, setUserMsgId() {}, parentFallback: () => null, phase() {}, onTurnSettled() {}, notifyIdle() {}, mediaSpeak() {} },
    diff: { trace() {}, setSessionDiff() {} },
    subagents: { onEvent: (ev: any) => subagentEvents.push(ev) },
  } as unknown as ShellEventDeps
  return { deps, subagentEvents }
}

describe("dispatcher · subagents 组", () => {
  test("session.created 带 parentID → 转发（且既有 lifecycle 行为不变）", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "session.created", properties: { info: { id: "c1", parentID: "p1", title: "t @a" } } }, deps)
    expect(subagentEvents).toEqual([{ kind: "session-created", info: { id: "c1", parentID: "p1", title: "t @a" } }])
  })
  test("session.updated 子会话 → 转发 title；session.deleted → 转发", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "session.updated", properties: { info: { id: "c1", parentID: "p1", title: "新 @b" } } }, deps)
    dispatchShellEvent({ type: "session.deleted", properties: { sessionID: "c1" } }, deps)
    expect(subagentEvents).toEqual([
      { kind: "session-updated", sessionID: "c1", title: "新 @b" },
      { kind: "session-deleted", sessionID: "c1" },
    ])
  })
  test("turn 三元组 → onEvent turn-terminal（sid=child）", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "turn.completed", properties: { sessionID: "c1" } }, deps)
    expect(subagentEvents).toEqual([{ kind: "turn-terminal", sessionID: "c1", terminal: "completed" }])
  })
  test("非子会话事件不产生 subagent 转发（session.created 无 parentID）", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "session.created", properties: { info: { id: "s1", title: "普通" } } }, deps)
    expect(subagentEvents).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/sse/dispatcher.test.ts`
Expected: FAIL（`subagents` 组缺失 → 类型/断言失败）

- [ ] **Step 3: 实现**

`handlers/subagents.ts`：
- `mapSessionLifecycleEvent(raw)`：`session.created` → 有 `properties.info.parentID` 才产出（透传 id/parentID/title）；`session.updated` → `properties.info.title` 为 string 才产出 `session-updated`（sessionID 取 `raw.properties.sessionID || info.id`）；`session.deleted` → `sessionID = raw.sessionID || raw.properties?.sessionID || raw.properties?.info?.id`，无则不产出；其余 null。
- `handleSubagentEvent`：`turn.completed|turn.failed|turn.aborted` → `deps.subagents.onEvent({kind:"turn-terminal", sessionID: sid, terminal: <三元组后半>})`；**恒 `return false`**（不消费；chat-stream 已先跑）。

`dispatcher.ts`：
- `ShellEventDeps` 加 `subagents: SubagentDeps`；定义 `SubagentDeps { onEvent(ev: TrackerEvent): void }`（import type TrackerEvent）。
- session.* 分支（L108-121）：进入分支后先 `const ev = mapSessionLifecycleEvent(event); if (ev) deps.subagents.onEvent(ev)`，再走既有 `planSessionEvent` 逻辑（**行为不变，只加旁路**）。
- `EXTRA_HANDLERS.push(handleSubagentEvent)` 放最后。

- [ ] **Step 4: 跑测试确认通过 + 既有 dispatcher 用例不红**（同 Step 2；再 `npm test` 中 dispatcher/flow-cards/chat-stream 相关全部绿）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/sse/handlers/subagents.ts packages/desktop/src/renderer/mafw/sse/dispatcher.ts packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts
git commit -m "feat(desktop): dispatcher subagents deps group + lifecycle/turn mapping"
```

---

### Task 5: 面板 UI（dock tab + 组件 + 样式）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/dock-tab.ts`（L1-2）
- Modify: `packages/desktop/src/renderer/mafw/components/RightDock.tsx`（L22-26 触发器 + props）
- Create: `packages/desktop/src/renderer/mafw/components/SubagentDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（RightDock children L1849-1889 加分支；`subagentBadge` prop）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（面板样式）
- Test: 无独立单测（纯展示）；由全量套件 + 手工冒烟兜底

**Interfaces:**
- Consumes: `subagentRows()`（Task 3）、`formatDuration`（`../goal-timeline`，已导出）
- Produces: `SubagentDock` props `{ activeSessionId: string | null; onOpenSession: (id: string) => void }`；`RightDock` 新 prop `subagentBadge?: number`

- [ ] **Step 1: dock-tab 加值**

```ts
export type DockTab = "tasks" | "trajectory" | "usage" | "notes" | "changes" | "subagents"
export const DOCK_TABS: DockTab[] = ["tasks", "trajectory", "usage", "notes", "changes", "subagents"]
```

搜索既有引用 `DOCK_TABS` 的测试（如 `dock-tab` 契约测试）并同步。

- [ ] **Step 2: RightDock 触发器 + 徽标**

在 `TabsV2.List` 内追加：`<TabsV2.Trigger value="subagents">🤖 子代理{props.subagentBadge ? ` ${props.subagentBadge}` : ""}</TabsV2.Trigger>`；props 加 `subagentBadge?: number`。

- [ ] **Step 3: SubagentDock 组件**

```tsx
// props: { activeSessionId: string | null; onOpenSession: (id: string) => void }
// 数据：subagentRows().filter(r => r.parentID === props.activeSessionId)
// 计时：createEffect——存在 running 行时 setInterval 1s 更新 now signal，onCleanup 清理（模式同 ChatPane metaNow）
// 行渲染：agent 徽标（首字母）＋ title ＋ 右侧（running：formatDuration(now - startedAt)＋spinner 点；终态：formatDuration(endedAt - startedAt)＋状态字「完成/失败/已中止」）
// 行点击 → props.onOpenSession(childID)；ButtonV2/朴素 div 走既有 dock 行样式约定（参考 NotesDock 行结构）
// 空态：「本会话暂无子代理」
```

样式加 `mafw.css`（`.mafw-subagent-dock` / `.mafw-subagent-row` / `.mafw-subagent-status-*`），颜色用既有 token（`--text-*` / `--danger-text` / `--accent`），禁字面值。

- [ ] **Step 4: MafwShell 挂载**

RightDock children 追加（与 tasks 分支同形）：

```tsx
<div style={{ display: rightDockTab() === "subagents" ? "contents" : "none" }}>
  <SubagentDock activeSessionId={activeSessionId()} onOpenSession={(id) => void openSubagentSession(id)} />
</div>
```

RightDock 调用处传 `subagentBadge={subagentRows().filter(r => r.status === "running").length}`（import `subagentRows`）。

- [ ] **Step 5: 全量测试 + 构建验证**

Run: `npm test`（packages/desktop）Expected: 全绿（新增行数 = 既有 1051 + Task1-4 新用例）
Run: `npx electron-vite build` Expected: 成功

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/dock-tab.ts packages/desktop/src/renderer/mafw/components/RightDock.tsx packages/desktop/src/renderer/mafw/components/SubagentDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): subagent dock tab with live rows and jump-to-child"
```

---

### Task 6: 通知 / 轮询 / 重连对账接线 + notifyIdle 抑制

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（sseDeps L793-863；notifyIdle L850-856；source.onopen L880-887；onMount reconcileTimer L917-934）

**Interfaces:**
- Consumes: `ingestSubagentEvent` / `subagentRows` / `onSubagentTerminal` / `isTrackedChildSession` / `childrenNeedingProbe`（Task 1/3）、`buildTerminalNotice` / `createNotifyGate`（Task 2）

- [ ] **Step 1: sseDeps 接线**

`sseDeps` 加 `subagents: { onEvent: (ev) => ingestSubagentEvent(ev) }`。

- [ ] **Step 2: notifyIdle 抑制（既有行为变更）**

`deps.chat.notifyIdle` 实现（L850-856）首行加：`if (isTrackedChildSession(subagentRows(), sid)) return`（子代理终态由新通道通知，旧泛化通道让位）。

- [ ] **Step 3: 终态通知注册**

`onMount` 内：

```ts
const notifyGate = createNotifyGate(10_000)
const offSubagentNotify = onSubagentTerminal((row) => {
  const notice = buildTerminalNotice(row, { hidden: document.hidden })
  if (!notice) return
  showToastV2({ description: notice.toast, duration: 3000 })
  if (notice.os && notifyGate(Date.now())) notifyIfHidden(notice.os.title, notice.os.body)
})
onCleanup(offSubagentNotify)
```

- [ ] **Step 4: 对账函数 + 轮询 + 重连触发**

```ts
async function reconcileSubagents(): Promise<void> {
  const sid = activeSessionId()
  if (sid) {
    try {
      const children = await window.api.mafw.sessions.children(sid)
      ingestSubagentEvent({ kind: "children-snapshot", parentID: sid, children: Array.isArray(children) ? children : [] })
    } catch { /* fail-open */ }
  }
  for (const childID of childrenNeedingProbe(subagentRows())) {
    try {
      const data: any = await window.api.mafw.sessions.messages(childID, 1)
      const items = Array.isArray(data) ? data : data?.data
      const last = items?.[items.length - 1]
      const info = last?.info || last
      ingestSubagentEvent({ kind: "child-last-message", childID, message: info ? { role: info.role, time: info.time, error: info.error } : null })
    } catch { /* fail-open */ }
  }
}
```

- `onMount` 既有 `reconcileTimer`（60s 流卡对账）旁加 15s 定时器：仅当 `rightDockTab() === "subagents" || subagentRows().some(r => r.status === "running")` 时 `void reconcileSubagents()`；清理进既有 `onCleanup`。
- `source.onopen`（L880-887）在 `reconcileFlowCards()` 后加 `void reconcileSubagents()`。
- 会话切换即时 bootstrap：`createEffect(() => { activeSessionId(); void reconcileSubagents() })`（fetch 廉价，fail-open）。

- [ ] **Step 5: 全量测试 + 构建 + 手工冒烟**

Run: `npm test` Expected: 全绿。
Run: `npx electron-vite build` Expected: 成功。
手工冒烟（dev app：`npm run dev -- --remote-debugging-port=9222`，gateway adopt 3000）：
1. 主会话里让 agent 派一个 task 子代理 → 面板行出现、计时跳、tool 卡可点（跳子会话）
2. 子代理完成 → toast「子代理完成：…」；窗口最小化（hidden）时 OS 通知一条；连续多个子代理齐完成 → OS 通知 10s 内至多一条
3. 中断父会话（Esc）→ 子行落「已中止」且无通知
4. 面板 tab 徽标 = 全局 running 数；切到别的会话后回来，历史行 bootstrap 且不弹通知

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): subagent terminal notifications, reconcile polling, notifyIdle suppression"
```

---

## Self-Review 记录

- **Spec 覆盖**：§4.1 六信号 → Task 1（reducer）/Task 4（live 转发）/Task 6（snapshot+probe 对账）；§4.2 → Task 1；§4.3 → Task 4；§4.4 → Task 5；§4.5 → Task 2+6（含 notifyIdle 抑制）；§4.6 → Task 6；§5 文件清单逐条对应；§7 风险 2 的「time.completed 缺失不落终态」→ Task 1 child-last-message 用例。
- **类型一致性**：`TrackerEvent`/`SubagentRow`/`SubagentDeps` 全链同名；`collectNewTerminals` 的「prev 不存在不计」在 Task 1 测试与 Task 3 snapshot 测试双向钉扎。
- **Review Focus 映射**：五项各有所在 Task 的测试（见上表），无悬空。
