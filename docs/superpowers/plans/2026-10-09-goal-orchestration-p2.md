# Goal 编排 P2：前端节点泳道图 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面端 Goal 详情从「charter + 会话列表」升级为节点级执行可视化：泳道（阶段 × loop）+ 点格子内联明细 + `goal_node` SSE 实时刷新。

**Architecture:** 新增纯逻辑模块 `goal-timeline.ts`（buildGoalLanes/状态映射/时长格式，bun 可测）+ 展示组件 `GoalTimelineLane.tsx`；`GoalDetailOverlay.tsx` 接 P1 的 `goals.timeline(goalId)` 与 `goals.retryNode`；SSE dispatcher 顶层消费 `goal_node`/`goal_created`/`phase_transition` → bump 模块单例 `goalsRev` signal 触发重拉。

**Tech Stack:** SolidJS + Electron renderer（`packages/desktop`）、`@mafw/ui` V2 组件、bun:test、`@mafw/sdk`（P1 已提供 `goals.timeline/retryNode` + `GoalTimeline/GoalNodeRunInfo` 类型）。

**Spec:** `docs/superpowers/specs/2026-10-09-goal-orchestration-p2-design.md`（决策 D1-D6 为本计划依据）。

## Global Constraints

- **仅 Desktop**（`packages/desktop`）；**不动 gateway/SDK**（P1 API 已足够）
- 测试：`cd packages/desktop && bun test`（bun:test 风格，纯逻辑模块与 src 同目录/邻接 `.test.ts`）；类型检查 `cd packages/desktop && npm run typecheck`
- UI 约定（§5.10）：禁止裸 `<button>`/`<input>`/裸 `title`，一律 `@mafw/ui/v2/*`（`ButtonV2`/`TooltipV2`/`LoaderV2`）；`@ts-nocheck` 是这些组件既有做法（沿用）
- renderer 只经 `window.api`（preload 暴露）；不直连 gateway
- 顶层 SSE 广播事件形状扁平（无 `data` 键）；`goal_node` 无 `sessionID`，必须在 dispatcher 的 sid 分发**之前**消费
- 每 task 一次 commit；只 add task 列出的文件（仓库有并行 agent 会话）
- 交付报告：新增测试数 + `bun test` 全量通过数 + `npm run typecheck` 干净

## 文件结构

```
packages/desktop/src/
  renderer/mafw/
    goal-timeline.ts            # 新：纯逻辑（可测）
    goal-timeline.test.ts       # 新：bun 单测
    goals-rev.ts                # 新：模块单例 signal（SSE→UI 刷新）
    components/GoalTimelineLane.tsx   # 新：泳道 + 内联明细（props 驱动）
    components/GoalDetailOverlay.tsx  # 改：接入 lane + 实时 + 动作
    sse/dispatcher.ts           # 改：CoreDeps.onGoalEvent + goal 事件顶层分支
    sse/dispatcher.test.ts      # 改：补 onGoalEvent + goal_node 用例
    MafwShell.tsx               # 改：core deps 注入 onGoalEvent → bumpGoalsRev
    pages/Dashboard.tsx         # 改（可选）：effect 依赖 goalsRev 实时刷新
    mafw.css                    # 改：泳道样式类
  preload/
    mafw-api.ts                 # 改：goals 段加 timeline/retryNode
    mafw-types.ts               # 改：goals 段类型
```

---

### Task 1: 纯逻辑模块 `goal-timeline.ts`

**Files:**
- Create: `packages/desktop/src/renderer/mafw/goal-timeline.ts`
- Test: `packages/desktop/src/renderer/mafw/goal-timeline.test.ts`

**Interfaces:**
- Consumes: 无（纯函数）
- Produces: `NodeRun`、`CellTone`、`LaneCell`、`Lane`、`PHASES`、`buildGoalLanes(nodes, maxRounds)`、`cellTone(run)`、`formatDuration(ms)`、`cellSummary(run, now?)`、`artifactRef(node, goalId, loop)`——Task 4/5 消费

- [ ] **Step 1: 写失败测试**

```ts
// packages/desktop/src/renderer/mafw/goal-timeline.test.ts
import { describe, expect, test } from "bun:test"
import { buildGoalLanes, cellTone, formatDuration, cellSummary, artifactRef, type NodeRun } from "./goal-timeline"

const node = (p: Partial<NodeRun>): NodeRun => ({
  runId: 1, loop: 1, node: "plan", attempt: 1, status: "succeeded",
  sessionId: "s1", startedAt: "2026-10-09T00:00:00Z", finishedAt: "2026-10-09T00:00:02Z",
  durationMs: 2000, outcome: "waves=2", error: null, tokensInput: 1, tokensOutput: 1, costUsd: null,
  ...p,
})

describe("cellTone", () => {
  test("succeeded → ok；failed/timeout/aborted → fail；running → running；null → idle", () => {
    expect(cellTone(node({ status: "succeeded" }))).toBe("ok")
    expect(cellTone(node({ status: "failed" }))).toBe("fail")
    expect(cellTone(node({ status: "timeout" }))).toBe("fail")
    expect(cellTone(node({ status: "aborted" }))).toBe("fail")
    expect(cellTone(node({ status: "running", finishedAt: null }))).toBe("running")
    expect(cellTone(null)).toBe("idle")
  })
  test("review succeeded 但 outcome=FAIL/ERROR → fail（verdict 覆盖）", () => {
    expect(cellTone(node({ node: "review", status: "succeeded", outcome: "FAIL" }))).toBe("fail")
    expect(cellTone(node({ node: "review", status: "succeeded", outcome: "ERROR" }))).toBe("fail")
    expect(cellTone(node({ node: "review", status: "succeeded", outcome: "PASS" }))).toBe("ok")
  })
})

describe("formatDuration", () => {
  test("null/负/非数 → '—'", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(-5)).toBe("—")
    expect(formatDuration(NaN)).toBe("—")
  })
  test("45s / 3m12s / 1h04m", () => {
    expect(formatDuration(45_000)).toBe("45s")
    expect(formatDuration(192_000)).toBe("3m12s")
    expect(formatDuration(3_840_000)).toBe("1h04m")
  })
})

describe("cellSummary", () => {
  test("review → outcome；execute → outcome + $cost；plan → outcome", () => {
    expect(cellSummary(node({ node: "review", status: "succeeded", outcome: "PASS" }))).toBe("PASS")
    expect(cellSummary(node({ node: "execute", status: "succeeded", outcome: "receipts=2", costUsd: 0.41 }))).toBe("receipts=2 · $0.41")
    expect(cellSummary(node({ node: "plan", status: "succeeded", outcome: "waves=3" }))).toBe("waves=3")
  })
  test("running → '已用 X'（注入 now 保证确定性）", () => {
    const now = Date.parse("2026-10-09T00:10:00Z")
    const r = node({ status: "running", finishedAt: null, startedAt: "2026-10-09T00:04:00Z" })
    expect(cellSummary(r, now)).toBe("已用 6m")
  })
  test("null → ''", () => { expect(cellSummary(null)).toBe("") })
})

describe("buildGoalLanes", () => {
  test("列数 = max(maxRounds, 出现的最大 loop)；缺失格 idle", () => {
    const { loops, lanes } = buildGoalLanes([node({ loop: 1 }), node({ loop: 2, node: "execute" })], 3)
    expect(loops).toEqual([1, 2, 3])
    expect(lanes.map(l => l.node)).toEqual(["plan", "execute", "review"])
    const planL3 = lanes[0].cells[2]
    expect(planL3.latest).toBeNull()
    expect(planL3.tone).toBe("idle")
  })
  test("(loop,node) 多 attempt 归同格：latest=最大 attempt，attempts 升序", () => {
    const runs = [
      node({ runId: 1, loop: 1, node: "execute", attempt: 1, status: "timeout" }),
      node({ runId: 2, loop: 1, node: "execute", attempt: 2, status: "succeeded" }),
    ]
    const { lanes } = buildGoalLanes(runs, 1)
    const cell = lanes.find(l => l.node === "execute")!.cells[0]
    expect(cell.attempts.map(a => a.attempt)).toEqual([1, 2])
    expect(cell.latest!.attempt).toBe(2)
    expect(cell.tone).toBe("ok")
  })
})

describe("artifactRef", () => {
  test("per-loop 引用（相对路径）", () => {
    expect(artifactRef("plan", "g1", 1)!.ref).toBe("waves.json")
    expect(artifactRef("execute", "g1", 2)!.ref).toBe("receipts/g1/loop-2-receipt.json")
    expect(artifactRef("review", "g1", 2)!.ref).toBe("reviews/g1-loop2.md")
    expect(artifactRef("askUser", "g1", 1)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/goal-timeline.test.ts`
Expected: FAIL — `Cannot find module "./goal-timeline"`

- [ ] **Step 3: 实现**

```ts
// packages/desktop/src/renderer/mafw/goal-timeline.ts
// Goal 执行状态纯逻辑：泳道装配 / 状态映射 / 时长与摘要格式。
// 数据形状 = P1 timeline API node（GET /api/goals/:id/timeline → nodes[]）。

export interface NodeRun {
  runId: number
  loop: number
  node: string
  attempt: number
  status: string // running|succeeded|failed|timeout|aborted
  sessionId: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  outcome: string | null
  error: string | null
  tokensInput: number | null
  tokensOutput: number | null
  costUsd: number | null
}

export type CellTone = "ok" | "running" | "fail" | "idle"

export interface LaneCell {
  node: string
  loop: number
  latest: NodeRun | null
  attempts: NodeRun[]
  tone: CellTone
}

export interface Lane { node: string; cells: LaneCell[] }

export const PHASES = ["plan", "execute", "review"] as const

export function cellTone(run: NodeRun | null): CellTone {
  if (!run) return "idle"
  if (run.status === "running") return "running"
  if (run.status === "succeeded") {
    // review 的 verdict 在 outcome（PASS/FAIL/ERROR）——FAIL/ERROR 覆盖为 fail
    if (run.node === "review" && run.outcome && run.outcome !== "PASS") return "fail"
    return "ok"
  }
  return "fail" // failed | timeout | aborted
}

export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs ? `${m}m${String(rs).padStart(2, "0")}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${String(rm).padStart(2, "0")}m`
}

export function cellSummary(run: NodeRun | null, now: number = Date.now()): string {
  if (!run) return ""
  if (run.status === "running") {
    const ms = run.startedAt ? now - Date.parse(run.startedAt) : null
    return `已用 ${formatDuration(ms)}`
  }
  if (run.node === "review") return run.outcome ?? (run.error ? "见明细" : "")
  if (run.node === "execute") {
    const cost = run.costUsd != null ? ` · $${run.costUsd.toFixed(2)}` : ""
    return `${run.outcome ?? ""}${cost}`.trim()
  }
  return run.outcome ?? ""
}

export function buildGoalLanes(nodes: NodeRun[], maxRounds: number): { loops: number[]; lanes: Lane[] } {
  const maxSeen = nodes.reduce((m, n) => Math.max(m, n.loop), 0)
  const maxLoop = Math.max(maxRounds || 0, maxSeen, 1)
  const loops = Array.from({ length: maxLoop }, (_, i) => i + 1)
  const lanes: Lane[] = PHASES.map((node) => ({
    node,
    cells: loops.map((loop) => {
      const attempts = nodes
        .filter((n) => n.node === node && n.loop === loop)
        .sort((a, b) => a.attempt - b.attempt)
      const latest = attempts.length ? attempts[attempts.length - 1] : null
      return { node, loop, latest, attempts, tone: cellTone(latest) }
    }),
  }))
  return { loops, lanes }
}

/** 产物引用（相对路径，按 P1 命名约定推导；桌面无 mafwDir，故为相对引用）。 */
export function artifactRef(node: string, goalId: string, loop: number): { label: string; ref: string } | null {
  if (node === "plan") return { label: "waves.json", ref: "waves.json" }
  if (node === "execute") return { label: `loop-${loop}-receipt.json`, ref: `receipts/${goalId}/loop-${loop}-receipt.json` }
  if (node === "review") return { label: `${goalId}-loop${loop}.md`, ref: `reviews/${goalId}-loop${loop}.md` }
  return null
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/goal-timeline.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/goal-timeline.ts packages/desktop/src/renderer/mafw/goal-timeline.test.ts
git commit -m "feat(goal-p2): timeline lane pure logic (buildGoalLanes/tones/duration/summary)"
```

---

### Task 2: SSE dispatcher 接 `goal_node` → `onGoalEvent`

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（core deps 满足新接口；signal 由 Task 3 的 goals-rev 提供）
- Create: `packages/desktop/src/renderer/mafw/goals-rev.ts`（本 task 顺带建，供 dispatcher 测试不依赖 Solid？——见下）

**Interfaces:**
- Consumes: 无
- Produces: `CoreDeps.onGoalEvent(event: unknown): void`；`goals-rev.ts` 的 `goalsRev()` / `bumpGoalsRev()`——Task 5 消费

> 注：`goals-rev.ts` 依赖 Solid（`createSignal`），而 dispatcher 测试是纯 bun（DI 注入）——测试只断言 `core.onGoalEvent` 被调用，不 import goals-rev。MafwShell 侧把 `bumpGoalsRev` 注入 `onGoalEvent`。

- [ ] **Step 1: 写失败测试（dispatcher）**

在 `dispatcher.test.ts` 的 `makeDeps` core 中加 `onGoalEvent: rec("onGoalEvent")`，并新增：

```ts
describe("dispatchShellEvent: goal events", () => {
  test("goal_node 顶层消费 → onGoalEvent，不 missTrace", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "goal_node", goalId: "g1", node: "execute", transition: "finished" }, deps)
    expect(calls.some(c => c.name === "onGoalEvent")).toBe(true)
    expect(calls.filter(c => c.name === "warn").length).toBe(0)
  })
  test("goal_created / phase_transition 同样触发 onGoalEvent", () => {
    for (const type of ["goal_created", "phase_transition"]) {
      const { deps, calls } = makeDeps()
      dispatchShellEvent({ type, goalId: "g1" }, deps)
      expect(calls.some(c => c.name === "onGoalEvent")).toBe(true)
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/sse/dispatcher.test.ts`
Expected: FAIL — missing `onGoalEvent` on deps（TS 报错）+ 断言失败

- [ ] **Step 3: 实现**

`dispatcher.ts` — `CoreDeps` 加字段：

```ts
export interface CoreDeps {
  trace(event: { type?: string }, channel: string): void
  notify(title: string, body: string): void
  warn(message: string): void
  setActiveQuestion(q: unknown): void
  bumpProjectsRev(): void
  onRuntimeSwitched(): void
  onGoalEvent(event: unknown): void
}
```

`dispatchShellEvent` 在 `runtime_switched` 分支之后、`session.created/updated/deleted` 之前插入：

```ts
  // Goal 编排事件（spec P2 §7）：goal_node 无 sessionID，必须在 sid 分发前消费。
  if (event.type === "goal_node" || event.type === "goal_created" || event.type === "phase_transition") {
    deps.core.trace(event, "goals:rev")
    deps.core.onGoalEvent(event)
    return
  }
```

新建 `goals-rev.ts`：

```ts
// packages/desktop/src/renderer/mafw/goals-rev.ts
// Goal 事件 → UI 刷新的模块单例 signal（SSE bump，Overlay/Dashboard 订阅重拉）。
import { createSignal } from "solid-js"

const [goalsRev, setGoalsRev] = createSignal(0)
export { goalsRev }
export function bumpGoalsRev(): void { setGoalsRev((v) => v + 1) }
```

`MafwShell.tsx` — import 并注入：

```ts
import { bumpGoalsRev } from "./goals-rev"
// ...
  const sseDeps: ShellEventDeps = {
    core: {
      trace: traceEvent,
      notify: notifyIfHidden,
      warn: (m) => console.warn(m),
      setActiveQuestion: (q) => setActiveQuestion(q as QuestionData),
      bumpProjectsRev: () => setProjectsRev(v => v + 1),
      onRuntimeSwitched: () => { /* 既有实现不动 */ },
      onGoalEvent: () => bumpGoalsRev(),
    },
    // ...
```

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `cd packages/desktop && bun test src/renderer/mafw/sse/ && npm run typecheck`
Expected: PASS；typecheck 干净

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/sse/dispatcher.ts packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts packages/desktop/src/renderer/mafw/goals-rev.ts packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(goal-p2): SSE goal events → goalsRev signal (dispatcher onGoalEvent)"
```

---

### Task 3: Preload 暴露 `timeline` / `retryNode`

**Files:**
- Modify: `packages/desktop/src/preload/mafw-api.ts`（goals 段）
- Modify: `packages/desktop/src/preload/mafw-types.ts`（goals 段 + import）

**Interfaces:**
- Consumes: `@mafw/sdk` 的 `goals.timeline/retryNode`（P1 已加）、`GoalTimeline` 类型
- Produces: `window.api.mafw.goals.timeline(id)`、`window.api.mafw.goals.retryNode(goalId, runId, opts)`——Task 5 消费

- [ ] **Step 1: 实现（preload 是薄透传，无单测；由 typecheck + 冒烟验证）**

`packages/desktop/src/preload/mafw-api.ts` goals 段（现有 list/get/... 之后）追加：

```ts
      timeline: (id) => invoke("goals", "timeline", id),
      retryNode: (goalId, runId, opts) => invoke("goals", "retryNode", goalId, runId, opts),
```

`packages/desktop/src/preload/mafw-types.ts`：import 列表加 `GoalTimeline`：

```ts
  Session, Project, TextPart, Goal, GoalCreateInput, GoalControlAction, GoalSessionInfo, GoalTimeline,
```
goals 段（现有签名之后）追加：

```ts
    timeline: (id: string) => Promise<GoalTimeline>
    retryNode: (goalId: string, runId: number, opts?: { confirm?: boolean }) => Promise<{ success: boolean; runId: number }>
```

- [ ] **Step 2: 类型检查**

Run: `cd packages/desktop && npm run typecheck`
Expected: 干净（若 `GoalTimeline` 未从 `@mafw/sdk` 导出，先确认 `packages/gateway-sdk/src/types.ts:583` 已导出——P1 已加）

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(goal-p2): preload exposes goals.timeline / retryNode"
```

---

### Task 4: 组件 `GoalTimelineLane.tsx`

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/GoalTimelineLane.tsx`

**Interfaces:**
- Consumes: Task 1 的 `Lane/LaneCell/formatDuration/cellSummary/artifactRef`；`@mafw/ui/v2/button-v2`
- Produces: `GoalTimelineLane(props)`——Task 5 渲染

- [ ] **Step 1: 实现（展示组件，仓库惯例不做全栈渲染测试）**

```tsx
// @ts-nocheck
// 泳道（阶段 × loop）+ 点格子内联明细。纯展示：数据与动作经 props 注入。
import { createSignal, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { formatDuration, cellSummary, artifactRef, type Lane } from "../goal-timeline"

const TONE_CLASS: Record<string, string> = {
  ok: "mafw-cell-ok", running: "mafw-cell-running", fail: "mafw-cell-fail", idle: "mafw-cell-idle",
}
const TONE_ICON: Record<string, string> = { ok: "✓", running: "●", fail: "✗", idle: "—" }

export function GoalTimelineLane(props: {
  goalId: string
  loops: number[]
  lanes: Lane[]
  artifacts?: { wavesPath?: string; reviewsDir?: string; receipts?: string[] }
  onOpenSession: (sid: string) => void
  onRetry: (runId: number, node: string) => void
  retrying: boolean
}) {
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const key = (node: string, loop: number) => `${node}:${loop}`
  const toggle = (node: string, loop: number) =>
    setExpanded((k) => (k === key(node, loop) ? null : key(node, loop)))

  const cellOf = (node: string, loop: number) =>
    props.lanes.find((l) => l.node === node)?.cells.find((c) => c.loop === loop)!

  return (
    <div class="mafw-lane-wrap">
      <div class="mafw-lane-grid" style={{ "grid-template-columns": `82px repeat(${props.loops.length}, minmax(140px, 1fr))` }}>
        {/* header row */}
        <div class="mafw-lane-corner">阶段 \ Loop</div>
        <For each={props.loops}>
          {(loop) => <div class="mafw-lane-colhead">Loop {loop}</div>}
        </For>

        {/* body: one lane row per phase, each with an optional expansion row */}
        <For each={props.lanes}>
          {(lane) => (
            <>
              <div class="mafw-lane-rowhead">{lane.node.toUpperCase()}</div>
              <For each={props.loops}>
                {(loop) => {
                  const cell = cellOf(lane.node, loop)
                  const latest = cell.latest
                  return (
                    <div class="mafw-lane-cellwrap">
                      <div
                        class={`mafw-lane-cell ${TONE_CLASS[cell.tone]}`}
                        onClick={() => latest && toggle(lane.node, loop)}
                      >
                        <div class="mafw-lane-cell-line1">
                          <span class="mafw-lane-cell-icon">{TONE_ICON[cell.tone]}</span>
                          <span>{latest ? formatDuration(latest.durationMs) : ""}</span>
                          <Show when={cell.attempts.length > 1}>
                            <span class="mafw-lane-attempt-badge">×{cell.attempts.length}</span>
                          </Show>
                          <Show when={expanded() === key(lane.node, loop)}>
                            <span class="mafw-lane-caret">▾</span>
                          </Show>
                        </div>
                        <div class="mafw-lane-cell-line2">{cellSummary(latest)}</div>
                      </div>
                    </div>
                  )
                }}
              </For>

              {/* inline expansion row spans all columns */}
              <Show when={
                lane.cells.find((c) => expanded() === key(c.node, c.loop))
              }>
                {(cell) => {
                  const run = () => cell().latest!
                  const art = () => artifactRef(lane.node, props.goalId, cell().loop)
                  return (
                    <div class="mafw-lane-expand" style={{ "grid-column": "1 / -1" }}>
                      <div class="mafw-lane-expand-head">
                        Loop {cell().loop} · {lane.node.toUpperCase()} 明细
                        <Show when={cell().attempts.length > 1}>
                          <span class="mafw-card-meta">（attempt {run().attempt}/{cell().attempts.length}）</span>
                        </Show>
                      </div>
                      <div class="mafw-lane-expand-grid">
                        <div>开始：{run().startedAt ? new Date(run().startedAt).toLocaleTimeString() : "—"}</div>
                        <div>结束：{run().finishedAt ? new Date(run().finishedAt).toLocaleTimeString() : "进行中"}</div>
                        <div>耗时：{formatDuration(run().durationMs)}</div>
                        <div>Token：in {run().tokensInput ?? "—"} / out {run().tokensOutput ?? "—"}</div>
                        <div>结果：{run().outcome ?? run().status}</div>
                        <div>成本：{run().costUsd != null ? `$${run().costUsd.toFixed(2)}` : "—"}</div>
                      </div>
                      <Show when={run().error}>
                        <div class="mafw-lane-expand-error">{run().error}</div>
                      </Show>
                      <Show when={lane.node === "review" && run().outcome && run().outcome !== "PASS"}>
                        <div class="mafw-lane-expand-error">feedback 见评审报告</div>
                      </Show>
                      <div class="mafw-lane-expand-actions">
                        <Show when={run().sessionId}>
                          <ButtonV2 variant="outline" size="small" onClick={() => props.onOpenSession(run().sessionId)}>打开会话</ButtonV2>
                        </Show>
                        <Show when={art()}>
                          <TooltipV2 content={art()!.ref}>
                            <ButtonV2
                              variant="outline" size="small"
                              onClick={() => { try { navigator.clipboard.writeText(art()!.ref) } catch { /* ignore */ } }}
                            >{art()!.label}</ButtonV2>
                          </TooltipV2>
                        </Show>
                        <Show when={["failed", "timeout", "aborted"].includes(run().status)}>
                          <ButtonV2
                            variant="contrast" size="small" disabled={props.retrying}
                            onClick={() => props.onRetry(run().runId, lane.node)}
                          >重跑此节点</ButtonV2>
                        </Show>
                        <Show when={lane.node === "execute"}>
                          <span class="mafw-card-meta">（execute 重跑需二次确认）</span>
                        </Show>
                      </div>
                    </div>
                  )
                }}
              </Show>
            </>
          )}
        </For>
      </div>

      <div class="mafw-goal-artifacts">
        <Show when={props.artifacts?.wavesPath}>
          <TooltipV2 content={props.artifacts!.wavesPath!}>
            <span class="mafw-artifact-chip" onClick={() => { try { navigator.clipboard.writeText(props.artifacts!.wavesPath!) } catch {} }}>waves.json</span>
          </TooltipV2>
        </Show>
        <Show when={props.artifacts?.reviewsDir}>
          <TooltipV2 content={props.artifacts!.reviewsDir!}>
            <span class="mafw-artifact-chip" onClick={() => { try { navigator.clipboard.writeText(props.artifacts!.reviewsDir!) } catch {} }}>reviews/</span>
          </TooltipV2>
        </Show>
      </div>
    </div>
  )
}
```

> 注：`TooltipV2` 的 props 以 `@mafw/ui/v2/tooltip-v2` 实际导出为准（若为 `openDelay` 必填，按 §5.10 统一 `openDelay={300}`）。`ButtonV2` 的 `variant` 取值以组件为准（contrast/outline/ghost）。

- [ ] **Step 2: 类型检查**

Run: `cd packages/desktop && npm run typecheck`
Expected: 干净（组件为 `@ts-nocheck`，主要校验 import 路径与 props 消费方 Task 5）

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/GoalTimelineLane.tsx
git commit -m "feat(goal-p2): GoalTimelineLane component (swimlane + inline node detail)"
```

---

### Task 5: `GoalDetailOverlay.tsx` 接入泳道 + 实时 + 动作

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（新增泳道样式类）

**Interfaces:**
- Consumes: Task 3 `window.api.mafw.goals.timeline/retryNode`；Task 4 `GoalTimelineLane`；Task 2 `goalsRev`；Task 1 `buildGoalLanes`
- Produces: 升级后的 GoalDetailOverlay

- [ ] **Step 1: 实现**

`GoalDetailOverlay.tsx` 整体替换数据与渲染段（保留 overlay/panel 外壳与 Esc 关闭）：

```tsx
// @ts-nocheck
import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { GoalTimelineLane } from "./GoalTimelineLane"
import { buildGoalLanes, formatDuration } from "../goal-timeline"
import { goalsRev } from "../goals-rev"

export function GoalDetailOverlay(props: { goalId: string | null; onClose: () => void; onOpenSession: (sid: string) => void }) {
  const [timeline, setTimeline] = createSignal<any>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [retrying, setRetrying] = createSignal(false)

  async function load(id: string) {
    setLoading(true); setError(null)
    try {
      const t = await window.api.mafw.goals.timeline(id)
      setTimeline(t)
    } catch (e: any) {
      setError(e?.message || String(e))
    }
    setLoading(false)
  }

  // 实时：goalId 或 goalsRev（SSE goal_node bump）变化 → 重拉；15s 轮询兜底
  createEffect(() => {
    const id = props.goalId
    void goalsRev() // 订阅信号
    if (!id) { setTimeline(null); setError(null); return }
    void load(id)
  })
  createEffect(() => {
    const id = props.goalId
    if (!id) return
    const t = setInterval(() => void load(id), 15000)
    onCleanup(() => clearInterval(t))
  })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  async function retry(runId: number, node: string) {
    const id = props.goalId!
    if (node === "execute" && !window.confirm("execute 重跑会再次执行写操作，确认重跑？")) return
    setRetrying(true)
    try {
      await window.api.mafw.goals.retryNode(id, runId, { confirm: node === "execute" })
      showToastV2({ description: "已触发重跑", duration: 2000 })
      void load(id)
    } catch (e: any) {
      showToastV2({ description: `重跑失败：${e?.message || e}`, duration: 3000 })
    }
    setRetrying(false)
  }

  const lanes = () => {
    const t = timeline()
    if (!t) return { loops: [], lanes: [] }
    return buildGoalLanes(t.nodes || [], t.goal?.maxRounds ?? 3)
  }
  const elapsed = () => {
    const t = timeline(); const nodes = t?.nodes || []
    const starts = nodes.map((n: any) => Date.parse(n.startedAt)).filter((x: number) => Number.isFinite(x))
    if (!starts.length) return null
    const lastFinished = nodes.filter((n: any) => n.finishedAt).map((n: any) => Date.parse(n.finishedAt))
    const end = lastFinished.length ? Math.max(...lastFinished) : Date.now()
    return end - Math.min(...starts)
  }

  return (
    <Show when={props.goalId}>
      <div class="mafw-goal-overlay" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
        <div class="mafw-goal-panel">
          <div class="mafw-goal-head">
            <div style={{ "min-width": 0 }}>
              <div class="mafw-card-title">{timeline()?.goal?.title || props.goalId}</div>
              <div class="mafw-card-meta">{timeline()?.goal?.goalId || props.goalId}</div>
            </div>
            <ButtonV2 variant="ghost" size="small" onClick={props.onClose} aria-label="关闭详情">✕</ButtonV2>
          </div>

          <Show when={!loading() && !error()} fallback={
            error()
              ? <div class="mafw-empty">加载失败：{error()} <ButtonV2 variant="outline" size="small" onClick={() => void load(props.goalId!)}>重试</ButtonV2></div>
              : <div style={{ display: "flex", gap: 8, padding: "32px 0", "justify-content": "center" }}><LoaderV2 width={16} height={16} /></div>
          }>
            <div class="mafw-goal-meta">
              <span class={`mafw-phase-badge ${timeline()?.goal?.verdict === "PASS" ? "mafw-phase-badge-ok" : timeline()?.goal?.phase === "FAILED" ? "mafw-phase-badge-fail" : "mafw-phase-badge-run"}`}>
                {timeline()?.goal?.phase}
              </span>
              <span class="mafw-card-meta">Loop {timeline()?.goal?.round ?? 0}/{timeline()?.goal?.maxRounds ?? "?"}</span>
              <Show when={elapsed() != null}><span class="mafw-card-meta">已用 {formatDuration(elapsed())}</span></Show>
              <Show when={timeline()?.goal?.verdict}><span class="mafw-card-meta">verdict {timeline()?.goal?.verdict}</span></Show>
            </div>

            <Show when={(timeline()?.nodes || []).length} fallback={<div class="mafw-empty">尚未开始执行</div>}>
              <GoalTimelineLane
                goalId={props.goalId!}
                loops={lanes().loops}
                lanes={lanes().lanes}
                artifacts={timeline()?.artifacts}
                onOpenSession={(sid) => { props.onClose(); props.onOpenSession(sid) }}
                onRetry={retry}
                retrying={retrying()}
              />
            </Show>

            <div class="mafw-goal-actions">
              <ButtonV2 variant="ghost" size="small" onClick={() => window.api.mafw.goals.control({ goalId: props.goalId, action: "ABORT" }).catch((e: any) => console.warn("[mafw]", e))}>取消 Goal</ButtonV2>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
```

`mafw.css` 追加（跟在既有 `mafw-goal-*` 规则之后）：

```css
.mafw-lane-wrap { margin-top: 10px; }
.mafw-lane-grid { display: grid; border: 1px solid var(--border, #2a2a30); border-radius: 10px; overflow: hidden; font-size: 12px; }
.mafw-lane-corner, .mafw-lane-colhead { background: var(--bg-2, #17171b); color: var(--text-weak, #888); padding: 6px 8px; }
.mafw-lane-colhead { border-left: 1px solid var(--border, #2a2a30); }
.mafw-lane-rowhead { padding: 10px 8px; color: var(--text-weak, #aaa); border-top: 1px solid var(--border, #2a2a30); }
.mafw-lane-cellwrap { padding: 7px; border-top: 1px solid var(--border, #2a2a30); border-left: 1px solid var(--border, #2a2a30); }
.mafw-lane-cell { border-radius: 7px; padding: 6px 8px; cursor: pointer; border: 1px solid transparent; }
.mafw-lane-cell-ok { background: #16241b; border-color: #2f5c40; color: #7ec78e; }
.mafw-lane-cell-running { background: #241d12; border-color: #5c4a2f; color: #e0b46a; }
.mafw-lane-cell-fail { background: #241616; border-color: #5c2f2f; color: #e08a8a; }
.mafw-lane-cell-idle { background: transparent; border-color: var(--border, #2a2a30); color: #666; }
.mafw-lane-cell-line1 { display: flex; gap: 6px; align-items: center; }
.mafw-lane-cell-line2 { color: var(--text-weak, #777); font-size: 11px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mafw-lane-attempt-badge { margin-left: auto; font-size: 10px; color: var(--text-weak, #888); }
.mafw-lane-caret { margin-left: auto; }
.mafw-lane-expand { background: var(--bg-2, #141418); border-top: 1px dashed var(--border, #3a3a42); padding: 12px 14px; }
.mafw-lane-expand-head { color: var(--text-weak, #bbb); margin-bottom: 8px; }
.mafw-lane-expand-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; color: var(--text-weak, #999); margin-bottom: 10px; }
.mafw-lane-expand-error { background: #1c1414; border-left: 3px solid #8a2b2b; padding: 6px 10px; border-radius: 4px; color: #c9a0a0; margin-bottom: 10px; }
.mafw-lane-expand-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.mafw-goal-artifacts { display: flex; gap: 8px; margin-top: 10px; }
.mafw-artifact-chip { font-size: 11px; background: var(--bg-2, #202027); border: 1px solid var(--border, #2a2a30); border-radius: 6px; padding: 2px 8px; cursor: pointer; color: var(--text-weak, #aaa); }
.mafw-goal-actions { margin-top: 12px; display: flex; gap: 8px; }
```

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `cd packages/desktop && npm run typecheck && bun test`
Expected: typecheck 干净；bun test 全绿

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(goal-p2): GoalDetailOverlay swimlane + realtime + node actions"
```

---

### Task 6: Dashboard 事件驱动刷新（可选）+ 冒烟 + 收尾

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Dashboard.tsx`（effect 依赖 `goalsRev`）

**Interfaces:**
- Consumes: Task 2 `goalsRev`

- [ ] **Step 1: Dashboard effect 加 goalsRev 依赖（顺带；低风险）**

`Dashboard.tsx` import 加 `import { goalsRev } from "../goals-rev"`；把现有 `createEffect(() => { fetchGoals(); const interval = setInterval(fetchGoals, 15000); ... })` 改为：

```tsx
  createEffect(() => {
    void goalsRev() // SSE goal 事件 → 触发一次拉取
    fetchGoals()
    const interval = setInterval(fetchGoals, 15000)
    onCleanup(() => clearInterval(interval))
  })
```

- [ ] **Step 2: 构建门禁 + 全量测试**

Run: `cd packages/desktop && npm run typecheck && bun test && npx electron-vite build`
Expected: 全绿；build 成功（三段 main/preload/renderer）

- [ ] **Step 3: 手工冒烟（记录结果；无自动化）**

1. `mafw daemon`（或已在跑的 gateway）+ 桌面端 `bun run dev`（或已构建 App）
2. 触发一个小 goal（manager `mafw_set_goal` 或 `/goal`）→ Goals 页点卡片 → 观察泳道格子出现、`goal_node` 事件驱动实时变化（plan→execute→review）
3. 点一个格子 → 明细展开（耗时/verdict/产物 chip/会话按钮）；点「打开会话」→ 聊天区打开该节点会话
4. 制造一次 FAIL（或等 review FAIL）→ 格子转红 → 「重跑此节点」→ toast + 刷新
5. 记录：泳道列数、实时延迟观感、明细字段是否够用

- [ ] **Step 4: 报告 + 更新 AGENTS.md**

- 报告新增测试数（goal-timeline + dispatcher 增量）+ `bun test` 全量通过数 + typecheck/build 结果
- `AGENTS.md` §5.22 追加 P2 段落：桌面 Goal 详情泳道（`goal-timeline.ts`/`GoalTimelineLane.tsx`）、`goalsRev` SSE 刷新、preload timeline/retryNode 接线

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages/Dashboard.tsx AGENTS.md
git commit -m "feat(goal-p2): dashboard event-driven refresh + P2 docs"
```

---

## Self-Review 清单

1. **Spec 覆盖**：D1 泳道(Task 1/4) ✅；D2 overlay(Task 5) ✅；D3 内联展开(Task 4) ✅；D4 仅 Desktop(全局约束) ✅；D5 SSE+轮询(Task 2/5) ✅；D6 产物 chip 复制(Task 1 artifactRef + Task 4) ✅；§8 preload(Task 3) ✅；§9 错误处理(toast/error 态 Task 5) ✅；§10 测试(Task 1/2 + 冒烟 Task 6) ✅
2. **类型一致性**：`Lane/LaneCell/NodeRun` Task 1 定义 → Task 4/5 消费；`goalsRev/bumpGoalsRev` Task 2 定义 → Task 5/6 消费；`timeline/retryNode` Task 3 定义 → Task 5 消费；`CoreDeps.onGoalEvent` Task 2 定义 + MafwShell 注入一致
3. **已知留白**（实现时按实况微调，不阻塞）：`ButtonV2/TooltipV2/LoaderV2` 的 prop 名以 `@mafw/ui/v2/*` 实际导出为准；`window.confirm` 若仓库有统一确认组件则替换（§5.10 只禁裸 button/input，不涉 confirm）；`@mafw/sdk` 未导出 `GoalTimeline` 时按 SDK 实际命名调整 import
4. **风险**：Task 4 组件是最大单点，人工冒烟（Task 6 Step 3）是唯一 UI 验证手段；loop 列多时横向滚动依赖 `.mafw-lane-grid` 的 `overflow`（窄屏可加 `overflow-x:auto` 于 `.mafw-lane-wrap`）

