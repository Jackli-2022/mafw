# 后台任务面板（P0-3）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** desktop 显示 opencode v2 已有后台能力：composer 上方 work bar（存在感）+ RightDock「后台」tab（详情/输出/终止/跳转）+ 完成通知（P0-1 通道）+ 「全部转后台」入口，全链零 gateway/runtime/词汇改动。

**Architecture:** 与 P0-1 子代理面板同构——纯 reducer tracker（`background-tracker.ts`）+ 纯检测器（`background-detect.ts`）+ Solid 单例 store + dispatcher 观察 handler（恒不消费）+ fetch 注入 reconcile + 两个 UI 面。数据源：part 元数据（`state.metadata.status:"running"`）+ synthetic 完成消息 + `/api/shell` 对账（gateway 兜底反代）。

**Tech Stack:** SolidJS / Electron desktop（packages/desktop），node --test + `@mafw/test-shim`（测试 import 用 `bun:test`），tsgo 类型门，electron-vite build。

**Spec:** `docs/superpowers/specs/2026-10-22-background-task-panel-design.md`（rev1，含 builder check 五条修订——执行前必读）

## Global Constraints

- renderer 只走 `window.api`（desktop AGENTS）；禁裸 `<button>`/`<input>`/裸 `title`——用 `ButtonV2`/`TooltipV2` 等（work bar 行可用可点 div，仓内 SubagentDock 先例）
- CSS 全走主题 token，禁字面值；reduced-motion 护栏
- 测试命令（packages/desktop  cwd）：单文件 `node --import tsx --import ../../packages/test-shim/register.mjs --test <path>`；全量 `npm test`；类型 `npx tsgo --noEmit -p tsconfig.json`
- tracker/detect/reconcile 为纯模块（无 Solid/DOM 依赖），now 可注入
- 通知：toast 恒发、OS 限隐藏时、两类（子代理+后台）共享同一 `createNotifyGate(10_000)` 实例；cancelled/对账收敛静默
- 每 Task 一次 commit，main 分支 inline（用户既定工作流）

## Review Focus

1. **synthetic 消息 wire 形状与源码假设偏差** → 宽容判定（`type==="synthetic"` 或 缺 `role` 且 `metadata.source` 存在）漏匹配则完成永不显示——Task 0 探针 + Task 2 宽容分支测试
2. **前台 blocking 的工具 part（`state.status:"running"`）被误建后台行**——detect 只认 `state.completed + metadata.status:"running"`——Task 2 测试
3. **serve 重启后 `/api/shell` 变空 + `shell.get` 404** → running 行应静默收敛 cancelled 而非假活——Task 5 测试
4. **多任务同刻完成 → OS 通知洪泛**——共享 10s 门（子代理+后台合计）——Task 3 通知测试 + Task 5 接线
5. **水合与 live 竞态**（同 part 两路到达/终态先于观察到达）→ 幂等、不降级——Task 1 测试

---

### Task 0: wire 实证探针（REST-only，零 LLM）

**Files:**
- Create: `docs/research/2026-10-22-background-wire-probe.md`

**目的：** 钉死 `/api/shell` 系列经 gateway 反代（:3000）的可达性与响应形状；零 LLM、零用户会话触碰。**Go/No-Go 门禁：反代不可达 → 停下找用户重估（spec §7 唯一允许的 gateway 改动点）。** synthetic/part 帧形状不靠 LLM 探测（守 P0-1 边界），以 v2.1.0 源码为据 + 检测器宽容判定兜底。

- [ ] **Step 1: 探 `GET /api/shell`**（经 gateway :3000；401 则读 `~/.config/mafw/config.yaml` 的 apiToken 带 `Authorization: Bearer`；location 参数先不传，403/400 再试 `?directory=<项目路径>`/`?location=`）

- [ ] **Step 2: 生命周期探针**：`POST /api/shell` body `{"command":"ping 127.0.0.1 -n 3"}`（Windows 原生 ~2s 命令；按返回形状调整 body 键：command/cwd）→ 记录 `Shell.Info` 形状 → 立即 `GET /api/shell/:id`（running 态字段）→ 等 4s 再 get（exited 态字段、exit code 键名）→ `GET /api/shell/:id/output`（游标分页形状）→ `DELETE /api/shell/:id`（终止语义与响应码）→ 再 get（移除后 404 形状）

- [ ] **Step 3: 探 `POST /api/session/:id/background`**（用一个不存在会话 id 即可——只需确认路由可达性：404 session-not-found = 可达；405/网关 404 HTML = 被 MAFW 路由拦截，No-Go）

- [ ] **Step 4: 落盘 + commit**：`docs/research/2026-10-22-background-wire-probe.md` 记录每个端点的 请求/响应形状/状态码，附录钉死字段表（供 Task 2/5 实现对照）；commit `docs(desktop): background wire probe - shell REST surface verified`

---

### Task 1: background-tracker 纯 reducer

**Files:**
- Create: `packages/desktop/src/renderer/mafw/background-tracker.ts`
- Test: `packages/desktop/src/renderer/mafw/background-tracker.test.ts`

**Interfaces:**
- Produces（后续任务依赖这些签名）：

```ts
export type BgType = "shell" | "subagent"
export type BgStatus = "running" | "completed" | "failed" | "cancelled"
export interface BackgroundRow {
  id: string            // shell: shellID；subagent: 子会话 id
  type: BgType
  sessionID: string     // 父会话（作用域过滤键）
  label: string         // command / description
  status: BgStatus
  startedAt: number
  endedAt?: number
}
export type BackgroundEvent =
  | { kind: "bg-observed"; row: { id: string; type: BgType; sessionID: string; label: string } }
  | { kind: "bg-terminal"; id: string; terminal: "completed" | "failed" | "cancelled"; at?: number
      meta?: { type: BgType; sessionID: string; label: string }; source?: "synthetic" | "turn" | "probe" | "user" }
  | { kind: "bg-snapshot"; shells: Array<{ id: string; command: string; sessionID?: string }> }
export function applyBackgroundEvent(rows: BackgroundRow[], ev: BackgroundEvent, now?: number): BackgroundRow[]
export function collectNewTerminals(prev: BackgroundRow[], next: BackgroundRow[]): BackgroundRow[]
export function rowsForSession(rows: BackgroundRow[], sid: string): BackgroundRow[]
export function countRunning(rows: BackgroundRow[]): number
```

- [ ] **Step 1: 写失败测试**（语义钉扎，逐条对应 spec §5.1 规则表）

```ts
import { describe, expect, test } from "bun:test"
import { applyBackgroundEvent, collectNewTerminals, rowsForSession, countRunning, type BackgroundRow } from "./background-tracker"

const obs = (id: string, type: "shell" | "subagent" = "shell", sid = "s1", label = "npm run dev") =>
  ({ kind: "bg-observed", row: { id, type, sessionID: sid, label } }) as const

describe("bg-observed", () => {
  test("建 running 行；重复观察幂等（不回退、不重复）", () => {
    let rows = applyBackgroundEvent([], obs("sh1"), 1000)
    expect(rows).toEqual([{ id: "sh1", type: "shell", sessionID: "s1", label: "npm run dev", status: "running", startedAt: 1000 }])
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "sh1", terminal: "completed", source: "synthetic" }, 2000)
    rows = applyBackgroundEvent(rows, obs("sh1"), 3000) // 终态后再观察 → 不回退
    expect(rows[0]).toMatchObject({ status: "completed", endedAt: 2000 })
  })
})

describe("bg-terminal", () => {
  test("三值转换 + 终态幂等不回退", () => {
    let rows = applyBackgroundEvent([], obs("sh1"), 1000)
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "sh1", terminal: "failed", source: "synthetic" }, 2000)
    expect(rows[0]).toMatchObject({ status: "failed", endedAt: 2000 })
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "sh1", terminal: "completed", source: "probe" }, 3000)
    expect(rows[0]!.status).toBe("failed")
  })
  test("行不存在 + meta → 建终态行（重启后首见即完成态）", () => {
    const rows = applyBackgroundEvent([], { kind: "bg-terminal", id: "sh9", terminal: "completed", at: 500, source: "synthetic", meta: { type: "shell", sessionID: "s1", label: "老任务" } }, 9000)
    expect(rows[0]).toMatchObject({ id: "sh9", status: "completed", startedAt: 500, endedAt: 500, label: "老任务" })
  })
  test("行不存在 + 无 meta → no-op", () => {
    expect(applyBackgroundEvent([], { kind: "bg-terminal", id: "x", terminal: "completed" }, 1)).toEqual([])
  })
  test("turn 来源只收敛 subagent 行（不碰 shell 行）", () => {
    let rows = applyBackgroundEvent([], obs("sh1", "shell"), 1000)
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "sh1", terminal: "completed", source: "turn" }, 2000)
    expect(rows[0]!.status).toBe("running") // turn 来源对 shell 行无效
    let rows2 = applyBackgroundEvent([], obs("child1", "subagent"), 1000)
    rows2 = applyBackgroundEvent(rows2, { kind: "bg-terminal", id: "child1", terminal: "completed", source: "turn" }, 2000)
    expect(rows2[0]).toMatchObject({ status: "completed", endedAt: 2000 })
  })
  test("turn.aborted → cancelled", () => {
    let rows = applyBackgroundEvent([], obs("c1", "subagent"), 1000)
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "c1", terminal: "cancelled", source: "turn" }, 1500)
    expect(rows[0]!.status).toBe("cancelled")
  })
})

describe("bg-snapshot", () => {
  test("补缺失 running 行；不回退已有行；不产生终态", () => {
    let rows = applyBackgroundEvent([], obs("sh1"), 1000)
    rows = applyBackgroundEvent(rows, { kind: "bg-snapshot", shells: [
      { id: "sh1", command: "npm run dev", sessionID: "s1" },   // 已有 → 不动
      { id: "sh2", command: "python serve.py", sessionID: "s2" }, // 补 running
    ] }, 5000)
    expect(rows.length).toBe(2)
    expect(rows.find(r => r.id === "sh2")).toMatchObject({ status: "running", label: "python serve.py", sessionID: "s2", type: "shell" })
    expect(rows.find(r => r.id === "sh1")!.startedAt).toBe(1000)
  })
})

describe("collectNewTerminals / 视图助手", () => {
  test("只计 live running→终态转换（snapshot/无行新建不计）", () => {
    const before: BackgroundRow[] = [{ id: "a", type: "shell", sessionID: "s1", label: "t", status: "running", startedAt: 1 }]
    const after: BackgroundRow[] = [
      { id: "a", type: "shell", sessionID: "s1", label: "t", status: "completed", startedAt: 1, endedAt: 2 },
      { id: "b", type: "shell", sessionID: "s1", label: "u", status: "completed", startedAt: 0, endedAt: 0 },
    ]
    expect(collectNewTerminals(before, after).map(r => r.id)).toEqual(["a"])
  })
  test("rowsForSession 过滤 + countRunning 全局计数", () => {
    const rows: BackgroundRow[] = [
      { id: "a", type: "shell", sessionID: "s1", label: "t", status: "running", startedAt: 1 },
      { id: "b", type: "subagent", sessionID: "s2", label: "u", status: "completed", startedAt: 0, endedAt: 2 },
    ]
    expect(rowsForSession(rows, "s1").map(r => r.id)).toEqual(["a"])
    expect(countRunning(rows)).toBe(1)
  })
  test("排序 startedAt 倒序", () => {
    let rows = applyBackgroundEvent([], obs("a"), 1000)
    rows = applyBackgroundEvent(rows, obs("b"), 2000)
    expect(rows.map(r => r.id)).toEqual(["b", "a"])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**
Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/background-tracker.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `background-tracker.ts`**（头部注释写语义契约：tracker 全局、作用域过滤在消费方、终态幂等不回退、turn 来源只收敛 subagent 行、snapshot 只补不判死）

- [ ] **Step 4: 跑测试确认通过**（同 Step 2 命令，全绿）

- [ ] **Step 5: Commit** `feat(desktop): background tracker pure reducer`

---

### Task 2: background-detect 纯检测器

**Files:**
- Create: `packages/desktop/src/renderer/mafw/background-detect.ts`
- Test: `packages/desktop/src/renderer/mafw/background-detect.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `BackgroundEvent`
- Produces:

```ts
// 工具 part → bg-observed；非后台/非目标工具 → null
export function detectBackgroundPart(part: any, sessionID: string): BackgroundEvent | null
// synthetic 完成消息 → bg-terminal（宽容判定）；普通消息 → null
export function detectSyntheticTerminal(info: any, sessionID: string): BackgroundEvent | null
// 历史水合回放：items=[{info, parts}]（可乱序）→ 按 time.created 升序的事件流
export function scanHistoryForBackground(items: any[], sessionID: string): BackgroundEvent[]
// blocking 检测：最新消息中前台 running 的 shell/subagent part
export function findBlockingWork(messages: any[], parts: Record<string, any[]>): Array<{ type: BgType; label: string }>
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { detectBackgroundPart, detectSyntheticTerminal, scanHistoryForBackground, findBlockingWork } from "./background-detect"

const bgShellPart = { type: "tool", tool: "shell", state: { status: "completed", metadata: { status: "running", shellID: "sh1" }, input: { command: "npm run dev" } } }
const bgSubPart = { type: "tool", tool: "subagent", state: { status: "completed", metadata: { status: "running", sessionID: "child1" }, input: { description: "调研登录" } } }

describe("detectBackgroundPart", () => {
  test("shell/subagent 后台 part → bg-observed（label 取 input.command/description）", () => {
    expect(detectBackgroundPart(bgShellPart, "s1")).toEqual({ kind: "bg-observed", row: { id: "sh1", type: "shell", sessionID: "s1", label: "npm run dev" } })
    expect(detectBackgroundPart(bgSubPart, "s1")).toEqual({ kind: "bg-observed", row: { id: "child1", type: "subagent", sessionID: "s1", label: "调研登录" } })
  })
  test("前台 blocking part（state.running）不判后台（Review Focus #2）", () => {
    expect(detectBackgroundPart({ ...bgShellPart, state: { status: "running", input: { command: "x" } } }, "s1")).toBeNull()
  })
  test("completed 但无 metadata.status=running → null；非目标工具 → null", () => {
    expect(detectBackgroundPart({ ...bgShellPart, state: { status: "completed", input: {} } }, "s1")).toBeNull()
    expect(detectBackgroundPart({ type: "tool", tool: "edit", state: bgShellPart.state }, "s1")).toBeNull()
  })
})

describe("detectSyntheticTerminal", () => {
  test("shell 完成：type=synthetic + metadata.source=shell → completed（消项键 shellID 优先、jobID 兜底）", () => {
    const info = { id: "m1", type: "synthetic", text: "done", metadata: { source: "shell", shellID: "sh1", command: "npm run dev" } }
    expect(detectSyntheticTerminal(info, "s1")).toEqual({ kind: "bg-terminal", id: "sh1", terminal: "completed", source: "synthetic", meta: { type: "shell", sessionID: "s1", label: "npm run dev" } })
  })
  test("宽容判定：缺 type/role 但 metadata.source 存在也识别（Review Focus #1）", () => {
    const info = { id: "m2", metadata: { source: "subagent", childID: "c9" } }
    expect(detectSyntheticTerminal(info, "s1")).toMatchObject({ kind: "bg-terminal", id: "c9", terminal: "completed", meta: { type: "subagent" } })
  })
  test("失败信号（state/error 字段或文本）→ failed；cancelled → cancelled", () => {
    const errInfo = { id: "m3", type: "synthetic", metadata: { source: "shell", shellID: "sh1", state: "error" } }
    expect(detectSyntheticTerminal(errInfo, "s1")).toMatchObject({ terminal: "failed" })
  })
  test("普通 user/assistant 消息 → null", () => {
    expect(detectSyntheticTerminal({ id: "m4", role: "assistant" }, "s1")).toBeNull()
  })
})

describe("scanHistoryForBackground / findBlockingWork", () => {
  test("水合回放：parts → observed、synthetic → terminal，按时间升序；与既有行幂等", () => {
    const items = [
      { info: { id: "m2", type: "synthetic", time: { created: 200 }, metadata: { source: "shell", shellID: "sh1" } }, parts: [] },
      { info: { id: "m1", role: "assistant", time: { created: 100 } }, parts: [bgShellPart] },
    ]
    const evs = scanHistoryForBackground(items, "s1")
    expect(evs.map(e => e.kind)).toEqual(["bg-observed", "bg-terminal"]) // 升序回放
  })
  test("blocking：最新未完成 assistant 消息的 running shell/subagent part", () => {
    const msgs = [{ id: "m9", role: "assistant", time: { created: 1 } }] // 无 completed
    const parts = { m9: [{ type: "tool", tool: "shell", state: { status: "running", input: { command: "npm test" } } }] }
    expect(findBlockingWork(msgs, parts)).toEqual([{ type: "shell", label: "npm test" }])
    expect(findBlockingWork([{ id: "m9", role: "assistant", time: { created: 1, completed: 2 } }], parts)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**（命令同 Task 1，路径换 background-detect）
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `background-detect.ts`**
要点：synthetic 失败判定——`metadata.state === "error"` 或 `metadata.error` 存在 → failed；`"cancelled"` → cancelled；缺省 completed（实证未覆盖的字段差异记注释，宽容方向 = 完成）。`scanHistoryForBackground` 先按 `info.time?.created ?? 0` 升序排序再扫描。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit** `feat(desktop): background detection from part metadata + synthetic messages`

---

### Task 3: background-store + background-notify

**Files:**
- Create: `packages/desktop/src/renderer/mafw/background-store.ts`、`background-notify.ts`
- Test: `background-store.test.ts`、`background-notify.test.ts`

**Interfaces:**
- Consumes: Task 1 全部 + P0-1 `createNotifyGate`（`./subagent-notify`）
- Produces:

```ts
// background-store.ts（模式同 subagent-store.ts）
export function backgroundRows(): BackgroundRow[]
export function ingestBackgroundEvent(ev: BackgroundEvent, now?: number): void
export function onBackgroundTerminal(cb: (row: BackgroundRow) => void): () => void
export function resetBackgroundStore(): void

// background-notify.ts
export interface BackgroundNotice { toast: string; os?: { title: string; body: string } }
export function buildBackgroundNotice(row: BackgroundRow, opts: { hidden: boolean }): BackgroundNotice | null
```

- [ ] **Step 1: 写失败测试**
  - store：ingest 应用 + 终态回调一次（幂等不回退不再触发）+ off 注销（镜像 subagent-store.test.ts 两例）
  - notify：`buildBackgroundNotice`——completed 显式 `后台任务完成：<label>`、failed `后台任务失败：<label>`、hidden 附 OS `{title:"MAFW：后台任务完成",body:label}`、cancelled/running → null；**通知层 kind 过滤语义注释**：subagent 行归 P0-1 通道（本 builder 也对 subagent 行返回非 null，过滤在 MafwShell 接线处——Task 5；此处测试钉扎 builder 本身不做 kind 区分）

- [ ] **Step 2: 跑确认失败** → **Step 3: 实现** → **Step 4: 跑确认通过**

- [ ] **Step 5: Commit** `feat(desktop): background store + terminal notice builder`

---

### Task 4: dispatcher 接线 + 水合摄取点

**Files:**
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/background.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`、`sse/dispatcher.test.ts`、`MafwShell.tsx`（sseDeps + loadSessionHistory 水合扫描——**同任务接线**，P0-1 Task 4 Ruling 先例：缺 deps 组会运行时崩溃）

**Interfaces:**
- Consumes: Task 2 检测器、Task 3 store
- Produces: `BackgroundDeps { onEvent(ev: BackgroundEvent): void }`；`ShellEventDeps.background`；`handleBackgroundEvent: SidHandler`（**恒 return false**）

- [ ] **Step 1: dispatcher.test.ts 加用例（失败先）**——makeDeps 加 `background: { onEvent: push }`（仿 P0-1 subagentEvents 模式），用例：
  - `part.updated` 后台 shell part → 转发 `bg-observed`（且 `backgroundRows` 无直接依赖——纯转发断言）
  - synthetic `message.updated`（无 role、metadata.source=shell）→ 转发 `bg-terminal`；且 chat-stream 既有行为不变（消息不进入 message store——既有 `!info.role` 消费分支断言不炸）
  - `turn.completed`（sid=child1）→ 转发 `{ kind:"bg-terminal", id:"child1", terminal:"completed", source:"turn" }`
  - 普通 part.updated（非后台）→ 零转发
- [ ] **Step 2: 跑确认失败**
- [ ] **Step 3: 实现**——`handlers/background.ts`（SidHandler 观察 part.updated/message.updated/turn.*，恒 false）；dispatcher：`BackgroundDeps` + `ShellEventDeps.background` + **`EXTRA_HANDLERS` 中 `handleBackgroundEvent` 必须置于 `handleChatStreamEvent` 之前**（chat-stream 消费 message.updated/part.updated，排在后面观察不到）；MafwShell：`sseDeps.background = { onEvent: ingestBackgroundEvent }` + import
- [ ] **Step 4: 跑确认通过**（dispatcher + handlers 全套）
- [ ] **Step 5: 水合摄取**——`loadSessionHistory`（MafwShell.tsx:995）merge 完成后：`scanHistoryForBackground(pageItems, sessionID).forEach(ingestBackgroundEvent)`；注意多页 backfill 循环每页都要扫（找 mergeRaw 的全部调用点）
- [ ] **Step 6: 全量 `npm test` 绿 + Commit** `feat(desktop): background dispatcher wiring + history hydration ingestion`

---

### Task 5: SDK/preload 管道 + reconcile + 通知接线

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts`（`shells` 命名空间 + `session.background`）、`packages/desktop/src/preload/mafw-api.ts` + `mafw-types.ts`
- Create: `packages/desktop/src/renderer/mafw/background-reconcile.ts` + `.test.ts`
- Modify: `MafwShell.tsx`（reconcile bootstrap/轮询 + onBackgroundTerminal 通知，共享 P0-1 门实例改名 `bgWorkNotifyGate`）

**Interfaces:**
- Produces:

```ts
// background-reconcile.ts
export interface BackgroundFetchers { listShells(): Promise<any[]>; getShell(id: string): Promise<any> }
export async function reconcileBackgroundOnce(opts: {
  fetchers: BackgroundFetchers
  trackedRunningShellIds(): string[]
  ingest: (ev: BackgroundEvent) => void
}): Promise<void>
// preload 新增：window.api.mafw.shells.{list,get,output,remove}、window.api.mafw.sessions.background(id)
```

- [ ] **Step 1: reconcile 失败测试**（fetch 注入，仿 subagent-reconcile.test.ts）：
  - 快照补行：`listShells` 返回 `[{id:"sh1",command:"npm run dev",metadata:{sessionID:"s1"}}]` → ingest `bg-snapshot`（shells 映射 `{id, command, sessionID: metadata?.sessionID}`）
  - Review Focus #3：tracked running `sh2` 不在快照 → `getShell("sh2")` 返回 exited/exit≠0 → `bg-terminal failed`；exit=0 → completed；404/error 形状 → cancelled；全部静默（source:"probe"）
  - `listShells` 抛错 → fail-open 零 ingest
- [ ] **Step 2: 跑确认失败 → Step 3: 实现 reconcile → Step 4: 跑确认通过**
- [ ] **Step 5: SDK + preload**——`client.ts` 加 `shells` 命名空间（`list()` GET `/api/shell`、`get(id)`、`output(id, offset?)`、`remove(id)` DELETE；Task 0 探针钉死 query/location 要求）与 `session.background(id)` POST `/api/session/:id/background`；preload `shells` 段 + `sessions.background` + `mafw-types.ts` 类型（仿既有 `runtime` 段模式；main ipc 是通用转发零改动——验证之）
- [ ] **Step 6: MafwShell 接线**——`reconcileBackground()` 包装（fetchers 用 `window.api.mafw.shells`，ingest=`ingestBackgroundEvent`）；`createEffect` 会话切换 bootstrap + 15s 轮询门（`rightDockTab()==="background"` 或存在 running 行）；`onMount` 注册 `onBackgroundTerminal`（**只 `row.type==="shell"`** → buildBackgroundNotice → toast 恒发 + OS 走共享门）；P0-1 的 `subagentNotifyGate` 改名 `bgWorkNotifyGate` 两回调共用；onCleanup 注销
- [ ] **Step 7: 全量门禁 + Commit**——`npm test` + `npx tsgo --noEmit -p tsconfig.json` + `npx electron-vite build` 全绿；commit `feat(desktop): background reconcile + shells SDK plumbing + terminal notifications`

---

### Task 6: UI——work bar + dock tab + 转后台

**Files:**
- Modify: `components/dock-tab.ts`（+ `"background"`）、`tests/dock-tab.test.ts`（契约 mini-TDD）、`components/RightDock.tsx`（trigger + `backgroundBadge?: number` prop）
- Create: `components/BackgroundDock.tsx`、`components/BackgroundWorkBar.tsx`、`background-capability.ts`（runtime 名缓存判定）
- Modify: `components/ChatPane.tsx`（`.mafw-input-area` 内 `.mafw-composer` 之前挂 work bar，+ props `onOpenBackgroundDock`）、`MafwShell.tsx`（ChatPane 传 prop + RightDock badge + dock 分支渲染 BackgroundDock）、`mafw.css`

**Interfaces:**
- Consumes: 全部前序（`backgroundRows`/`rowsForSession`/`countRunning`/`findBlockingWork`/`formatDuration`（goal-timeline）/`openSubagentSession`/`applyRightDock`）

- [ ] **Step 1: dock-tab 契约测试先改（红）**——`DOCK_TABS` 加 `"background"`（七栏）+ normalize 直通用例 → 跑确认红 → dock-tab.ts 加值 → 绿（P0-1 Task 5 mini-TDD 同款）
- [ ] **Step 2: `background-capability.ts`**——`canUseBackgroundApi(): Promise<boolean>` 模块级缓存 promise：`window.api.mafw.runtime.get()` 的 name === "opencode"；异常/未知 → false（fail-closed，spec §5.3）
- [ ] **Step 3: `BackgroundWorkBar.tsx`**——props `{ sessionID: string, onOpenDock: () => void }`；渲染逻辑：session running 行 0 且无 blocking → 不渲染；否则窄条（`⏳ 后台 N · <最近 label>`，点击 onOpenDock）；blocking 行（`canUseBackgroundApi()` 为真才显示）：`⏳ 前台运行中：<label>` + `[全部转后台]`（ButtonV2 ghost → `window.api.mafw.sessions.background(sessionID)` → toast 确认/失败，**不乐观改态**）；完成瞬间行变 ✅ 5s 后无 running 则淡出（`createPresence` + `--dur-surface`）；1s 计时跳复用 SubagentDock 模式
- [ ] **Step 4: `BackgroundDock.tsx`**——仿 SubagentDock：`rowsForSession(backgroundRows(), props.activeSessionId)`；shell 行点击展开输出预览（`shells.output(id)` 尾部 ~4KB 等宽渲染 + 「刷新」ButtonV2 + 「终止」ButtonV2 outline + 内联 confirm 对齐仓内 revert 模式 → `shells.remove(id)` → toast）；subagent 行点击 → `onOpenSession(childID)`；空态文案「本会话暂无后台任务」+ 引导
- [ ] **Step 5: 接线**——RightDock trigger `⚡ 后台` + badge；ChatPane `.mafw-input-area` 内 `.mafw-composer`（ChatPane.tsx:1351）**之前**挂 `<BackgroundWorkBar sessionID={props.sessionID} onOpenDock={props.onOpenBackgroundDock} />`（不进 `.mafw-composer-toolbar` 容器查询区——小窗口护栏）；MafwShell：ChatPane 调用点加 prop `onOpenBackgroundDock={() => applyRightDock(true, "background")}`、RightDock `backgroundBadge={countRunning(backgroundRows())}`、dock 分支（`rightDockTab()==="background"` → BackgroundDock）
- [ ] **Step 6: CSS**——`.mafw-bg-bar*` / `.mafw-bg-dock*` 全 token（仿 P0-1 subagent 段）；reduced-motion 护栏
- [ ] **Step 7: 全量门禁 + Commit**——`npm test` + tsgo + build 全绿；commit `feat(desktop): background work bar + dock tab + backgroundAll entry`

---

## Self-Review 记录

- spec 覆盖：§4 数据契约→Task 0/2；§5 架构→Task 1-5；§5.3 blocking/门→Task 2/6；§6.1 bar→Task 6；§6.2 dock→Task 6；§6.3 通知→Task 3/5；§7 风险→Task 0（实证）+各测试；§8 测试→各 Task Step；§10 实证→Task 0 ✓
- 类型一致性：BackgroundRow/BackgroundEvent/BgType/BackgroundDeps/buildBackgroundNotice/reconcileBackgroundOnce/canUseBackgroundApi 全文一致 ✓
- Review Focus 五条均有归属测试 ✓
- 顺序安全：Task 4 同任务接 sseDeps（P0-1 Ruling 已内化为计划步骤）✓
- 遗留取舍（executor 注意）：synthetic 失败判定字段以 Task 0 + 源码为准，检测器宽容；`startedAt` 用首见时间（spec §7 已声明）；pi 恒空合法
