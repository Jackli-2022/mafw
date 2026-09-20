# Desktop 结构拆分（阶段一：绞杀者）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MafwShell.tsx（2805 行）的 SSE 分发与会话工作区状态抽成独立带类型模块，desktop 测试接入 CI；零行为变更。

**Architecture:** 绞杀者模式——新模块建在 `packages/desktop/src/renderer/mafw/sse/` 与 `workspace/` 下，handlers 为 deps 注入的纯路由，store 迁移收敛为纯 reducer 函数；MafwShell 逐步瘦身为布局壳。每个任务先写测试（bun:test），行为钉扎优先。

**Tech Stack:** SolidJS 1.9 / bun test / TypeScript（tsgo typecheck）/ electron-vite。

**Spec:** `docs/superpowers/specs/2026-09-20-desktop-ux-refactor-design.md`（仅阶段一部分；四个交互切片各自后续出 plan）。

## Global Constraints

- 测试框架 **bun:test**（`import { describe, expect, test } from "bun:test"`），与 desktop 既有测试一致；不用 jest/vitest
- **零行为变更**：每个任务完成后 `bun test` 全绿 + `npx electron-vite build` 通过 + 手动冒烟（见 Task 7 清单）
- 新文件**不加** `// @ts-nocheck`；从 MafwShell 移出的代码保持原逻辑逐字，只允许 deps 参数化替换
- UI 组件禁用裸 `<button>`/`<input>`，用 `@mafw/ui/v2/*`（本阶段基本不碰 UI）
- 每任务独立 commit，commit message 格式 `refactor(desktop): ...` / `test(desktop): ...` / `ci: ...`
- 行号引用基于 commit `13ad8348`（spec 提交点），仅作定位锚；以 `event.type ===` 分支内容为准
- 工作目录所有命令在仓库根 `C:\work\work-loop\opencode-plugin-mafw` 执行，除非另注

---

### Task 1: desktop 测试接线（test script + CI）

desktop 已有 50+ 个 bun 测试文件（`packages/desktop/src/**/*.test.ts`、`packages/desktop/tests/*.test.ts`），但无 `test` script、不在 CI。本任务接线并处理已知坏测试。

**Files:**
- Modify: `packages/desktop/package.json`（scripts 加 `"test"`）
- Modify: `package.json`（root scripts 加 `"test:desktop"`）
- Modify: `.github/workflows/ci.yml`（加 Test desktop step）
- Modify（可能）: `packages/desktop/electron-builder.config.test.ts`（已知坏：引用不存在的 `resources/linux/opencode-desktop.desktop`，AGENTS.md §6.6 有记录）

**Interfaces:**
- Produces: `npm run test:desktop`（root）与 `cd packages/desktop && bun test` 全绿，CI 三端变四端

- [ ] **Step 1: 先跑现状，记录失败清单**

Run: `cd packages/desktop; bun test`
Expected: 大部分通过；记录所有 failing 测试文件与用例名。已知候选：`electron-builder.config.test.ts` 的 legacy launcher 用例。**除此之外的任何失败先停下来报告，不要继续**（说明基线比预期差，需用户决策）。

- [ ] **Step 2: 处理已知坏测试**

读 `packages/desktop/electron-builder.config.test.ts`，确认失败用例确为引用不存在文件的 legacy launcher 断言（AGENTS.md §6.6 声明"已知坏"）。删除该 describe/test 块（文件其余断言保留），文件头注释更新说明删除原因与日期。

- [ ] **Step 3: 重跑确认全绿**

Run: `cd packages/desktop; bun test`
Expected: 全绿，0 fail

- [ ] **Step 4: 加 test scripts**

`packages/desktop/package.json` scripts 块加（紧随 `"typecheck"` 后）：

```json
    "test": "bun test",
```

root `package.json` scripts 块加（紧随 `"test:tui"` 后）：

```json
    "test:desktop": "cd packages/desktop && bun test"
```

- [ ] **Step 5: 验证 root 入口**

Run: `npm run test:desktop`
Expected: 与 Step 3 相同的绿

- [ ] **Step 6: CI 加 step**

`.github/workflows/ci.yml` 在 `- name: Test TUI` 块之后追加：

```yaml
      - name: Test desktop
        run: npm run test:desktop
```

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/package.json package.json .github/workflows/ci.yml packages/desktop/electron-builder.config.test.ts
git commit -m "ci: wire desktop bun tests into CI (drop known-bad legacy launcher case)"
```

---

### Task 2: SSE dispatcher 骨架 + core/lifecycle 处理器

建 `sse/` 模块。dispatcher 是纯路由：解析后的事件对象进、经 handler 链、副作用全走注入 deps。本任务只迁移**无 sid 依赖**的分支（MafwShell.tsx:1297-1353）+ missTrace 尾部；sid 相关分支留在原处，后续任务迁移。

**Files:**
- Create: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`
- Create: `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（onmessage 前半段替换为 dispatcher 调用）

**Interfaces:**
- Consumes: `planSessionEvent` / `isTailAccountedAtShell` / `RawSessionEvent`（`../session-events`，已存在）；`traceEvent`（`../event-trace`，已存在）
- Produces:
  - `dispatchShellEvent(event: unknown, deps: ShellEventDeps): void`——后续任务的 handler 组挂进 `EXTRA_HANDLERS`
  - `interface ShellEventDeps { core: CoreDeps; lifecycle: LifecycleDeps }`（后续任务扩展此接口加 `flowCards`/`dock`/`chat` 字段）
  - `type SidHandler = (event: any, sid: string, deps: ShellEventDeps) => boolean`——Task 3-5 的处理器签名；返回 true = 已消费
  - `const EXTRA_HANDLERS: SidHandler[]`——Task 3-5 各自 push 自己的处理器（dispatcher 在 core/lifecycle 之后、missTrace 之前遍历）

**Step 1: 写失败测试**

Create `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { dispatchShellEvent, type ShellEventDeps } from "./dispatcher"

function makeDeps() {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const deps: ShellEventDeps = {
    core: {
      trace: rec("trace"),
      notify: rec("notify"),
      warn: rec("warn"),
      setActiveQuestion: rec("setActiveQuestion"),
      bumpProjectsRev: rec("bumpProjectsRev"),
      onRuntimeSwitched: rec("onRuntimeSwitched"),
    },
    lifecycle: {
      invalidate: rec("invalidate"),
      patch: rec("patch"),
      retitleOpenTab: rec("retitleOpenTab"),
      remove: rec("remove"),
      closeIfOpen: rec("closeIfOpen"),
    },
  }
  return { deps, calls }
}

describe("dispatchShellEvent: core events", () => {
  test("user_question → setActiveQuestion + notify", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "user_question", question: "去哪？" }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace", "setActiveQuestion", "notify"])
    expect(calls[1].args[0]).toMatchObject({ type: "user_question" })
  })

  test("project_registered → bumpProjectsRev", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "project_registered", projectDir: "C:\\p" }, deps)
    expect(calls.map(c => c.name)).toContain("bumpProjectsRev")
  })

  test("runtime_switched → onRuntimeSwitched", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "runtime_switched", runtime: "pi" }, deps)
    expect(calls.map(c => c.name)).toContain("onRuntimeSwitched")
  })
})

describe("dispatchShellEvent: session lifecycle", () => {
  test("session.created → lifecycle.invalidate", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.created", sessionID: "s1", properties: { sessionID: "s1", info: { id: "s1", title: "t", directory: "C:\\p" } } }, deps)
    expect(calls.map(c => c.name)).toContain("invalidate")
  })

  test("session.updated with title → patch + retitleOpenTab", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.updated", sessionID: "s1", properties: { sessionID: "s1", info: { id: "s1", title: "new" } } }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace", "patch", "retitleOpenTab"])
    expect(calls[2].args).toEqual(["s1", "new"])
  })

  test("session.deleted → remove + closeIfOpen", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.deleted", sessionID: "s1" }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace", "remove", "closeIfOpen"])
  })

  test("internal session event → only trace (planner none)", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.created", sessionID: "s1", internal: true, properties: { info: { id: "s1", title: "w" } } }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace"])
  })
})

describe("dispatchShellEvent: tail", () => {
  test("unknown type → warn + trace(miss)", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "brand_new_event", sessionID: "s1" }, deps)
    expect(calls.map(c => c.name)).toContain("warn")
    expect(calls.find(c => c.name === "trace")!.args[1]).toBe("miss")
  })

  test("ignored type (user_feedback) → no warn", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "user_feedback", sessionID: "s1" }, deps)
    expect(calls.some(c => c.name === "warn")).toBe(false)
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd packages/desktop; bun test src/renderer/mafw/sse/dispatcher.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现 dispatcher**

Create `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`：

```ts
// SSE dispatcher：gateway /api/events 帧 → 类型化 handler 组。
// 纯路由；一切副作用经注入 deps，逐分支可单测（无 Solid / 无 DOM）。
// 分支语义逐字迁移自 MafwShell.tsx onmessage（commit 13ad8348，行 1297-1353、1361-1368）。
import { planSessionEvent, isTailAccountedAtShell, type RawSessionEvent } from "../session-events"

export interface CoreDeps {
  trace(event: { type?: string }, channel: string): void
  notify(title: string, body: string): void
  warn(message: string): void
  setActiveQuestion(q: unknown): void
  bumpProjectsRev(): void
  onRuntimeSwitched(): void
}

export interface LifecycleDeps {
  invalidate(): void
  patch(id: string, patch: { title?: string; time?: { updated?: number }; directory?: string; projectID?: string }): void
  /** 打开中的 tab 与 ChatPane 各持一份 title 副本，patch 带 title 时双写。 */
  retitleOpenTab(id: string, title: string): void
  remove(id: string): void
  /** 外部删除已打开的 tab 时关闭（active 回退、分屏摘叶由实现方负责）。 */
  closeIfOpen(id: string): void
}

export interface ShellEventDeps {
  core: CoreDeps
  lifecycle: LifecycleDeps
}

/** Task 3-5 的 sid 级处理器挂这里；返回 true = 已消费。 */
export type SidHandler = (event: any, sid: string, deps: ShellEventDeps) => boolean
export const EXTRA_HANDLERS: SidHandler[] = []

/** 语义与 MafwShell.tsx:1356-1360 一致：sid 可多形态承载。 */
export function sessionIdOf(event: any): string {
  return event?.sessionID
    || event?.properties?.sessionID
    || event?.properties?.part?.sessionID
    || event?.properties?.info?.sessionID
    || ""
}

function missTrace(event: any, deps: ShellEventDeps): void {
  if (!isTailAccountedAtShell(event.type)) {
    deps.core.warn(`[mafw] unhandled SSE event at shell: ${event.type}`)
    deps.core.trace(event, "miss")
  }
}

export function dispatchShellEvent(event: any, deps: ShellEventDeps): void {
  if (!event) return

  if (event.type === "user_question") {
    deps.core.trace(event, "notify:question")
    deps.core.setActiveQuestion(event)
    deps.core.notify("MAFW：Agent 需要你的回答", String(event.question || "").slice(0, 80))
    return
  }

  if (event.type === "project_registered") {
    deps.core.trace(event, "rail:projects")
    deps.core.bumpProjectsRev()
    return
  }

  if (event.type === "runtime_switched") {
    deps.core.trace(event, "rail:runtime")
    deps.core.onRuntimeSwitched()
    return
  }

  if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
    deps.core.trace(event, "rail:planner")
    const action = planSessionEvent(event as RawSessionEvent)
    if (action.kind === "invalidate") {
      deps.lifecycle.invalidate()
    } else if (action.kind === "patch") {
      deps.lifecycle.patch(action.id, action.patch)
      if (typeof action.patch.title === "string") deps.lifecycle.retitleOpenTab(action.id, action.patch.title)
    } else if (action.kind === "remove") {
      deps.lifecycle.remove(action.id)
      deps.lifecycle.closeIfOpen(action.id)
    }
    return
  }

  const sid = sessionIdOf(event)
  if (!sid) { missTrace(event, deps); return }

  for (const handler of EXTRA_HANDLERS) {
    if (handler(event, sid, deps)) return
  }

  missTrace(event, deps)
}
```

**Step 4: 跑测试确认通过**

Run: `cd packages/desktop; bun test src/renderer/mafw/sse/dispatcher.test.ts`
Expected: PASS（9 个用例）

**Step 5: MafwShell 接线**

`MafwShell.tsx` onmessage（1291 行起）：
1. 顶部 import 加 `import { dispatchShellEvent, type ShellEventDeps } from "./sse/dispatcher"`
2. 在组件内构建 deps（接线既有实现，逐字对应原分支体）：

```ts
    const sseDeps: ShellEventDeps = {
      core: {
        trace: traceEvent,
        notify: notifyIfHidden,
        warn: (m) => console.warn(m),
        setActiveQuestion: (q) => setActiveQuestion(q as QuestionData),
        bumpProjectsRev: () => setProjectsRev(v => v + 1),
        onRuntimeSwitched: () => {
          sessionStore.invalidate()
          void refreshMenus()
          resetChatWorkspace()
          if (currentProject()) reloadManagerSession(currentProject()!)
        },
      },
      lifecycle: {
        invalidate: () => sessionStore.invalidate(),
        patch: (id, patch) => sessionStore.patch(id, patch),
        retitleOpenTab: (id, title) => {
          setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s))
          setStore(prev => ({ ...prev, session: prev.session.map((x: any) => x.id === id ? { ...x, title } : x) }))
        },
        remove: (id) => sessionStore.remove(id),
        closeIfOpen: (id) => { if (sessions().some(s => s.id === id)) closeSession(id) },
      },
    }
```

3. onmessage 前半段替换——1297-1353 行的四个分支（user_question / project_registered / runtime_switched / session 生命周期）**删除**，改为在 `const event = raw?.data || raw` 之后：

```ts
      const before = ["user_question", "project_registered", "runtime_switched", "session.created", "session.updated", "session.deleted"]
      if (before.includes(event.type)) { dispatchShellEvent(event, sseDeps); return }
```

（sid 之后的分支本任务不动，逐字保留。注意：原 1361-1368 的 missTrace 定义保留——剩余分支还在用它。）

**Step 6: 全量验证**

Run: `cd packages/desktop; bun test`
Expected: 全绿（既有测试不受影响 + 新增 9 例）
Run: `cd packages/desktop; npx electron-vite build`
Expected: 构建成功

**Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/sse/ packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "refactor(desktop): SSE dispatcher skeleton — core + session lifecycle handlers"
```

---

### Task 3: flow-cards 处理器组（question/permission/compacted）

迁移 MafwShell.tsx:1371-1431 的七个分支（question.asked / permission.asked / permission_mode / session.compacted / question.replied / question.rejected / permission.replied）。

**Files:**
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.ts`
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`（`ShellEventDeps` 加 `flowCards: FlowCardDeps`；文件尾 `EXTRA_HANDLERS.push(handleFlowCardEvent)`——集中注册点，MafwShell 不再感知）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（删除已迁移分支；deps 加 flowCards 组）

**Interfaces:**
- Consumes: `mapPermissionCard` / `shouldNotify`（`../../components/permission-card-mapping`，已存在）；`mapAskCard` / `answersToRecord`（MafwShell 局部函数 998/1063 行——**本任务顺手把这两个函数移入 `flow-cards.ts` 导出**，MafwShell 的 reconcileFlowCards（1027/1045 行）与 SSE 恢复段（1286/1289 行）改为 import 使用）
- Produces: `handleFlowCardEvent: SidHandler`；`mapAskCard(req: any, createdAt: number): AskCardData`；`answersToRecord(answers: string[][], sid: string, cardId: string): Record<string, string[]>`
- `FlowCardDeps`：

```ts
export interface FlowCardDeps {
  upsertCard(sid: string, card: { kind: "ask" | "permission"; data: unknown }): void
  resolveCard(sid: string, id: string, resolution: { status: string; answers?: Record<string, string[]> }): void
  setPermissionMode(sid: string, mode: "manual" | "auto"): void
  setCompactionMark(sid: string, mark: { at: number; summary?: string }): void
  notify(title: string, body: string): void
  trace(event: { type?: string }, channel: string): void
  /** auto 决策兜底 5s 后对账（原 setTimeout 语义，注入便于测试）。 */
  scheduleReconcile(delayMs: number): void
}
```

**Step 1: 写失败测试** `flow-cards.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { handleFlowCardEvent, type FlowCardDeps } from "./flow-cards"
import type { ShellEventDeps } from "../dispatcher"

function makeDeps() {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const flowCards: FlowCardDeps = {
    upsertCard: rec("upsertCard"), resolveCard: rec("resolveCard"),
    setPermissionMode: rec("setPermissionMode"), setCompactionMark: rec("setCompactionMark"),
    notify: rec("notify"), trace: rec("trace"), scheduleReconcile: rec("scheduleReconcile"),
  }
  const deps = { flowCards } as unknown as ShellEventDeps
  return { deps, calls }
}

describe("handleFlowCardEvent", () => {
  test("question.asked → upsertCard(ask) + notify", () => {
    const { deps, calls } = makeDeps()
    const consumed = handleFlowCardEvent({ type: "question.asked", properties: { id: "q1", question: "哪个文件？" } }, "s1", deps)
    expect(consumed).toBe(true)
    expect(calls.map(c => c.name)).toContain("upsertCard")
    expect(calls.map(c => c.name)).toContain("notify")
  })

  test("permission.asked 需人工 → notify；auto 兜底 → scheduleReconcile(5000)", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "permission.asked", properties: { id: "p1", permission: { tool: "bash" } } }, "s1", deps)
    expect(calls.map(c => c.name)).toContain("notify")

    const d2 = makeDeps()
    // mafwPolicy action auto-approve → autoResolved → 不 notify，走对账
    handleFlowCardEvent({ type: "permission.asked", properties: { id: "p2", permission: { tool: "bash" }, mafwPolicy: { action: "auto-approve", verdict: "safe", reason: "auto" } } }, "s1", d2.deps)
    expect(d2.calls.map(c => c.name)).not.toContain("notify")
    expect(d2.calls.find(c => c.name === "scheduleReconcile")!.args[0]).toBe(5000)
  })

  test("permission.replied always → allowed-always", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "permission.replied", properties: { id: "p1", reply: "always" } }, "s1", deps)
    expect(calls.find(c => c.name === "resolveCard")!.args[2]).toEqual({ status: "allowed-always" })
  })

  test("question.replied → answered + answersToRecord", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "question.replied", properties: { id: "q1", answers: [["a"]] } }, "s1", deps)
    expect(calls.find(c => c.name === "resolveCard")!.args[2]).toMatchObject({ status: "answered" })
  })

  test("permission_mode manual → setPermissionMode", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "permission_mode", sessionID: "s1", properties: { mode: "manual" } }, "s1", deps)
    expect(calls.find(c => c.name === "setPermissionMode")!.args).toEqual(["s1", "manual"])
  })

  test("session.compacted → setCompactionMark", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "session.compacted", properties: { summary: "s" } }, "s1", deps)
    expect(calls.map(c => c.name)).toContain("setCompactionMark")
  })

  test("unrelated type → not consumed", () => {
    const { deps } = makeDeps()
    expect(handleFlowCardEvent({ type: "todo.updated", properties: {} }, "s1", deps)).toBe(false)
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd packages/desktop; bun test src/renderer/mafw/sse/handlers/flow-cards.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现** `flow-cards.ts`——分支体从 MafwShell.tsx:1371-1431 逐字迁移，setter 调用替换为 deps 方法（`upsertCard`→`deps.upsertCard`、`notifyIfHidden`→`deps.notify`、`setPermissionModes`→`deps.setPermissionMode(sid, mode)`、`setCompactionMarks(prev=>…)`→`deps.setCompactionMark(sid, {at: Date.now(), summary})`、`setTimeout(() => reconcileFlowCards(), 5000)`→`deps.scheduleReconcile(5000)`）。`mapAskCard`/`answersToRecord` 从 MafwShell.tsx:998/1063 移入本文件导出（MafwShell 改 import）。handler 签名 `SidHandler`，未命中返回 false。

**Step 4: 跑测试确认通过**

Run: `cd packages/desktop; bun test src/renderer/mafw/sse/handlers/`
Expected: PASS

**Step 5: dispatcher + MafwShell 接线**

- `dispatcher.ts`：`ShellEventDeps` 加 `flowCards: FlowCardDeps`；文件尾 `EXTRA_HANDLERS.push(handleFlowCardEvent)`（import 自 `./handlers/flow-cards`）
- `MafwShell.tsx`：删除已迁移的七个分支；`sseDeps` 加 `flowCards` 组（逐字接线既有 `upsertCard`/`resolveCard`/`setPermissionModes`/`setCompactionMarks`/`notifyIfHidden`/`traceEvent`/`() => setTimeout(() => reconcileFlowCards(), 5000)`）；`mapAskCard`/`answersToRecord` 改 import

**Step 6: 全量验证**

Run: `cd packages/desktop; bun test`
Expected: 全绿
Run: `cd packages/desktop; npx electron-vite build`
Expected: 构建成功

**Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/sse/ packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "refactor(desktop): SSE flow-card handlers (question/permission/compacted)"
```

---

### Task 4: dock 处理器组（trajectory/todo）

迁移 MafwShell.tsx:1433-1458。trajectory dedup 与滚动窗口抽为纯函数。

**Files:**
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/dock.ts`
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/dock.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`（deps 加 `dock`，注册 handler）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（删分支、接线）

**Interfaces:**
- Produces:
  - `mergeTrajectoryEvent(prev: unknown[], props: { turnID?: unknown; turn_id?: unknown; seq?: unknown }): unknown[] | null`——重复（turnID/turn_id + seq 字符串化比对）返回 null；否则 `[...prev, props].slice(-200)`
  - `handleDockEvent: SidHandler`
  - `DockDeps { trace; setTrajectoryEvents(sid, events); setTrajectoryTurn(sid, props); setTodos(sid, list) }`

**Step 1: 写失败测试** `dock.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { mergeTrajectoryEvent, handleDockEvent, type DockDeps } from "./dock"
import type { ShellEventDeps } from "../dispatcher"

describe("mergeTrajectoryEvent", () => {
  test("new event appended", () => {
    expect(mergeTrajectoryEvent([{ turnID: 1, seq: 0 }], { turnID: 1, seq: 1 })).toHaveLength(2)
  })
  test("dup by (turnID, seq) → null", () => {
    expect(mergeTrajectoryEvent([{ turnID: 1, seq: 0 }], { turnID: "1", seq: "0" })).toBeNull()
  })
  test("rolling window keeps last 200", () => {
    const prev = Array.from({ length: 200 }, (_, i) => ({ turnID: 0, seq: i }))
    const merged = mergeTrajectoryEvent(prev, { turnID: 0, seq: 200 })!
    expect(merged).toHaveLength(200)
    expect((merged[199] as any).seq).toBe(200)
  })
})

describe("handleDockEvent", () => {
  function makeDeps() {
    const calls: { name: string; args: unknown[] }[] = []
    const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
    const dock: DockDeps = { trace: rec("trace"), setTrajectoryEvents: rec("setTrajectoryEvents"), setTrajectoryTurn: rec("setTrajectoryTurn"), setTodos: rec("setTodos") }
    return { deps: { dock } as unknown as ShellEventDeps, calls }
  }
  test("todo.updated with array → setTodos", () => {
    const { deps, calls } = makeDeps()
    expect(handleDockEvent({ type: "todo.updated", properties: { todos: [{ content: "x" }] } }, "s1", deps)).toBe(true)
    expect(calls.find(c => c.name === "setTodos")!.args[0]).toBe("s1")
  })
  test("todo.updated non-array → consumed, no setTodos", () => {
    const { deps, calls } = makeDeps()
    expect(handleDockEvent({ type: "todo.updated", properties: {} }, "s1", deps)).toBe(true)
    expect(calls.some(c => c.name === "setTodos")).toBe(false)
  })
  test("trajectory.turn → setTrajectoryTurn", () => {
    const { deps, calls } = makeDeps()
    expect(handleDockEvent({ type: "trajectory.turn", properties: { turnID: 3 } }, "s1", deps)).toBe(true)
    expect(calls.map(c => c.name)).toContain("setTrajectoryTurn")
  })
  test("unrelated → false", () => {
    const { deps } = makeDeps()
    expect(handleDockEvent({ type: "session.idle" }, "s1", deps)).toBe(false)
  })
})
```

注：trajectory.event 的"读 prev 再 merge"涉及读取现有信号值——`DockDeps.setTrajectoryEvents(sid, events)` 由 shell 侧 closure 负责读 `trajectoryLive()[sid]` 并调 `mergeTrajectoryEvent`？**不**——merge 是纯函数放 dock.ts，读旧值需要 shell 状态。接线方式：`dock.getTrajectoryEvents(sid): unknown[]` 读访问器也注入 deps，handler 内 `const merged = mergeTrajectoryEvent(deps.dock.getTrajectoryEvents(sid), props); if (merged) deps.dock.setTrajectoryEvents(sid, merged)`。deps 加 `getTrajectoryEvents(sid: string): unknown[]`。

**Step 2: 跑测试确认失败** → FAIL（模块不存在）

**Step 3: 实现 dock.ts**（分支体逐字迁移自 1433-1458；dedup/窗口逻辑收敛进 `mergeTrajectoryEvent`）

**Step 4: 跑测试确认通过** → PASS

**Step 5: dispatcher + MafwShell 接线**（同 Task 3 Step 5 模式：`dock.getTrajectoryEvents = (sid) => trajectoryLive()[sid] || []` 等）

**Step 6: 全量验证**（bun test 全绿 + electron-vite build）

**Step 7: Commit**

```bash
git commit -m "refactor(desktop): SSE dock handlers (trajectory/todo) + pure merge"
```

---

### Task 5: chat-stream 处理器组（消息流主链，最难）

迁移 MafwShell.tsx:1460-1643（message.updated / part.delta / part.updated / message.complete / part.complete / session.idle / session.error / message.error / message.aborted / session.next.tool.* / media_speak）。store 突变收敛为**纯 reducer**，handler 只做路由 + 副作用调用。

**Files:**
- Create: `packages/desktop/src/renderer/mafw/sse/chat-reducers.ts`（纯函数，无依赖）
- Create: `packages/desktop/src/renderer/mafw/sse/chat-reducers.test.ts`
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/chat-stream.ts`
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/chat-stream.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`（deps 加 `chat`，注册 handler）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（删分支、接线；onmessage 此时应只剩 JSON.parse + dispatchShellEvent）

**Interfaces:**
- Consumes: `mergeAssistantMessage`（`../message-model`，已存在）
- Produces（chat-reducers.ts，操作 store 形状 `{ message: Record<sid, any[]>; part: Record<msgId, any[]> }`，返回新状态或 null=无变化）：
  - `applyUserMessageArrival(state, sid, info)` → `{ message, part }`——乐观 user 消息替换（含 voiceStatus/voiceDuration 保留、parentID 重映射、parts 迁移），逐字自 1469-1499
  - `applyAssistantMessage(state, sid, info, parentFallback)` → `{ message } | null`——包 mergeAssistantMessage（1510 行"无变化保持引用"语义：mergeAssistantMessage 返回原数组即 null）
  - `applyPartDelta(state, sid, msgId, partID, delta)` → `{ part } | null`，逐字自 1529-1543
  - `applyPartUpsert(state, sid, part)` → `{ part }`——含乐观 text part 吸收（1558-1572）
  - `extractMediaSpeak(event, storeParts)` → `{ text: string; voice?: string } | null`，逐字自 1622-1642
- Produces（chat-stream.ts）：
  - `handleChatStreamEvent: SidHandler`
  - `ChatDeps`：

```ts
export interface ChatDeps {
  trace(event: { type?: string }, channel: string): void
  /** 读取当前 store（reducer 输入）。 */
  getStore(): { message: Record<string, any[]>; part: Record<string, any[]>; session_status: Record<string, any> }
  /** reducer 输出写回（shell 侧 setStore(prev => ({...prev, ...patch}))）。 */
  patchStore(patch: { message?: Record<string, any[]>; part?: Record<string, any[]> }): void
  setSessionStatus(sid: string, status: { type: "busy" | "idle" }): void
  markSessionDone(sid: string): void
  setUserMsgId(sid: string, msgId: string): void
  parentFallback(sid: string): string | null
  phase(sid: string, p: "writing"): void
  onTurnSettled(sid: string, opts: { expireCards: boolean }): void  // sendingResetters + queueFlushers (+ expireSessionCards)
  notifyIdle(sid: string): void  // 60s throttle + document.hidden 判断封装在 shell 侧
  mediaSpeak(sid: string, text: string, voice?: string): void
}
```

**Step 1: 写失败测试**（chat-reducers.test.ts 覆盖钉扎：乐观替换的 voice 字段保留/parentID 重映射/parts 迁移；delta 追加与新 part 创建；upsert 吸收 `user-` 前缀 text part；extractMediaSpeak 从 input 直取与 store parts 兜底两路）：

```ts
import { describe, expect, test } from "bun:test"
import { applyUserMessageArrival, applyPartDelta, applyPartUpsert, extractMediaSpeak } from "./chat-reducers"

describe("applyUserMessageArrival", () => {
  test("replaces optimistic user message, remaps parentIDs, migrates parts", () => {
    const state = {
      message: { s1: [
        { id: "user-1", role: "user", voiceStatus: "done", voiceDuration: 3 },
        { id: "a1", role: "assistant", parentID: "user-1" },
      ] },
      part: { "user-1": [{ id: "user-1-text", type: "text", text: "hi" }] },
    }
    const out = applyUserMessageArrival(state as any, "s1", { id: "m-real", role: "user", time: { created: 1 } })!
    const msgs = out.message.s1
    expect(msgs[0].id).toBe("m-real")
    expect((msgs[0] as any).voiceStatus).toBe("done")
    expect(msgs[1].parentID).toBe("m-real")
    expect(out.part["m-real"]).toHaveLength(1)
    expect(out.part["user-1"]).toBeUndefined()
  })

  test("duplicate real id → null (no change)", () => {
    const state = { message: { s1: [{ id: "m-real", role: "user" }] }, part: {} }
    expect(applyUserMessageArrival(state as any, "s1", { id: "m-real", role: "user" })).toBeNull()
  })

  test("no optimistic → append", () => {
    const state = { message: { s1: [] }, part: {} }
    const out = applyUserMessageArrival(state as any, "s1", { id: "m1", role: "user" })!
    expect(out.message.s1).toHaveLength(1)
  })
})

describe("applyPartDelta", () => {
  test("appends to existing text part", () => {
    const state = { message: {}, part: { m1: [{ id: "p1", type: "text", text: "he" }] } }
    const out = applyPartDelta(state as any, "s1", "m1", "p1", "llo")!
    expect(out.part.m1[0].text).toBe("hello")
  })
  test("creates part when missing", () => {
    const out = applyPartDelta({ message: {}, part: {} } as any, "s1", "m1", "p1", "hi")!
    expect(out.part.m1[0]).toMatchObject({ id: "p1", type: "text", text: "hi", sessionID: "s1" })
  })
  test("non-text existing part → null", () => {
    const state = { message: {}, part: { m1: [{ id: "p1", type: "tool" }] } }
    expect(applyPartDelta(state as any, "s1", "m1", "p1", "x")).toBeNull()
  })
})

describe("applyPartUpsert", () => {
  test("absorbs optimistic user text part with identical text", () => {
    const state = { message: {}, part: { m1: [{ id: "user-1-text", type: "text", text: "hi" }] } }
    const out = applyPartUpsert(state as any, "s1", { id: "real-p", type: "text", text: "hi", messageID: "m1" })!
    expect(out.part.m1).toHaveLength(1)
    expect(out.part.m1[0].id).toBe("real-p")
  })
})

describe("extractMediaSpeak", () => {
  test("reads text from properties.input", () => {
    expect(extractMediaSpeak({ properties: { input: { text: "说", voice: "茉莉" } } }, {})).toEqual({ text: "说", voice: "茉莉" })
  })
  test("falls back to store tool part", () => {
    const out = extractMediaSpeak({ assistantMessageID: "a1", properties: {} }, { a1: [{ type: "tool", tool: "mafw_media_speak", input: { text: "嗨" } }] })
    expect(out).toEqual({ text: "嗨", voice: undefined })
  })
  test("no text → null", () => {
    expect(extractMediaSpeak({ properties: {} }, {})).toBeNull()
  })
})
```

chat-stream.test.ts 覆盖：message.complete → setSessionStatus idle + markSessionDone + onTurnSettled(expireCards: true)；session.error → onTurnSettled(expireCards: true)；session.next.tool.* 带新 assistantMessageID → patchStore 追加 assistant 消息（parentID = parentFallback）；message.part.updated → phase('writing') + setSessionStatus busy + patchStore。

**Step 2: 跑测试确认失败** → FAIL

**Step 3: 实现 chat-reducers.ts + chat-stream.ts**（逐字迁移，setter→deps）

**Step 4: 跑测试确认通过** → PASS

**Step 5: 接线**——dispatcher 注册；MafwShell 删除 1460-1643 全部分支，onmessage 收敛为：

```ts
    es.onmessage = (e: MessageEvent) => {
      let raw: any
      try { raw = JSON.parse(e.data) } catch { return }
      const event = raw?.data || raw
      dispatchShellEvent(event, sseDeps)
    }
```

（Task 2 Step 5 的 `before` 门同时删除——全部事件都走 dispatcher。`sseDeps.chat` 接线既有实现：`getStore: () => store`、`patchStore: (p) => setStore(prev => ({ ...prev, ...p }))`、`onTurnSettled: (sid, o) => { sendingResetters[sid]?.(); if (o.expireCards) expireSessionCards(sid); queueFlushers[sid]?.() }`、`notifyIdle` 包 1594-1598 的 throttle 逻辑、`mediaSpeak: (sid, t, v) => mediaSpeakHandlers[sid]?.(t, v)` 等。）

**Step 6: 全量验证**（bun test + electron-vite build + **手动冒烟：发一条消息确认流式渲染、完成态、approval 卡正常**）

**Step 7: Commit**

```bash
git commit -m "refactor(desktop): SSE chat-stream handlers + pure store reducers"
```

---

### Task 6: SessionWorkspace store 抽取

把会话工作区状态（tabs / 消息 store / 回调注册表 / busy 队列桥）收敛为模块单例。**本任务只抽状态与注册表，不动分屏树**（splitViews/activeViewId 与布局持久化耦合深，留后续）。

**Files:**
- Create: `packages/desktop/src/renderer/mafw/workspace/session-workspace.ts`
- Create: `packages/desktop/src/renderer/mafw/workspace/session-workspace.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（sessions/activeSessionId/store/注册表改为 workspace 读写）
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（相关 props 改从 workspace 读——**仅替换明显成组的 props：store、session 列表、activeId、sending/phase/queue 注册**；其余 props 本任务不动）

**Interfaces:**
- Consumes: `ChatSession` 类型（MafwShell 局部，移入本文件导出）；`FlowCardRecord`（`../components/ChatPane` 已导出）
- Produces:

```ts
export interface SessionWorkspace {
  // tabs
  sessions(): ChatSession[]
  setSessions(fn: (prev: ChatSession[]) => ChatSession[]): void
  activeId(): string | null
  setActiveId(id: string | null): void
  // message store（createStore 形状不变，MafwShell/ChatPane 现有访问路径不变）
  store: { message: Record<string, any[]>; part: Record<string, any[]>; session_status: Record<string, any>; session_diff: Record<string, any> }
  patchStore(patch: Partial<SessionWorkspace["store"]>): void
  // per-session 回调注册表（原 anchorRegistry/sendingResetters/phaseUpdaters/queueFlushers/mediaSpeakHandlers）
  register(kind: RegistryKind, sid: string, fn: (...args: any[]) => void): void
  unregister(kind: RegistryKind, sid: string): void
  call(kind: RegistryKind, sid: string, ...args: any[]): void
}
export type RegistryKind = "sendingReset" | "phase" | "queueFlush" | "mediaSpeak" | "anchor"
export const workspace: SessionWorkspace
```

**Step 1: 写失败测试** `session-workspace.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { createSessionWorkspace } from "./session-workspace"

describe("session workspace", () => {
  test("tabs add/activate", () => {
    const ws = createSessionWorkspace()
    ws.setSessions(prev => [...prev, { id: "s1", title: "t" } as any])
    ws.setActiveId("s1")
    expect(ws.sessions()).toHaveLength(1)
    expect(ws.activeId()).toBe("s1")
  })

  test("patchStore merges top-level keys", () => {
    const ws = createSessionWorkspace()
    ws.patchStore({ session_status: { s1: { type: "busy" } } })
    expect(ws.store.session_status.s1.type).toBe("busy")
    ws.patchStore({ session_status: { s1: { type: "idle" } } })
    expect(ws.store.session_status.s1.type).toBe("idle")
  })

  test("registry register/call/unregister", () => {
    const ws = createSessionWorkspace()
    let called = 0
    ws.register("queueFlush", "s1", () => { called++ })
    ws.call("queueFlush", "s1")
    expect(called).toBe(1)
    ws.unregister("queueFlush", "s1")
    ws.call("queueFlush", "s1")
    expect(called).toBe(1)
  })
})
```

注：`createSessionWorkspace()` 工厂供测试隔离；`workspace` 单例 = `createSessionWorkspace()`（session-store.ts 同款模式）。

**Step 2: 跑测试确认失败** → FAIL

**Step 3: 实现 session-workspace.ts**——createSignal/createStore 在工厂内；`store` 字段即 MafwShell.tsx:86-95 的 createStore 初值逐字搬入。

**Step 4: 跑测试确认通过** → PASS

**Step 5: MafwShell/ChatPane 改读 workspace**——`sessions()`→`workspace.sessions()`、`setSessions`→`workspace.setSessions`、`store`→`workspace.store`、`setStore(prev=>…)` 整体替换为 `workspace.patchStore(...)` 的形状等价改写（注意 createStore 函数式更新语义：原 `setStore(prev => f(prev))` 改写为 `workspace.patchStore(f(workspace.store))`，reducer 已纯函数化后这是机械替换）；五个注册表对象替换为 `workspace.register/unregister/call`。grep 验证零残留：`sessions(` `setStore(` `sendingResetters` `phaseUpdaters` `queueFlushers` `mediaSpeakHandlers` `anchorRegistry` 在 MafwShell/ChatPane 中应只剩 workspace 调用。

**Step 6: 全量验证**（bun test + build + **手动冒烟：开两个会话 tab 切换、发消息、排队、关闭 tab**）

**Step 7: Commit**

```bash
git commit -m "refactor(desktop): session workspace store (tabs/message store/registries)"
```

---

### Task 7: 收尾——AGENTS.md 更新 + 全量验证

**Files:**
- Modify: `AGENTS.md`（§5.5 Desktop 前端小节加一段：renderer 新增 `mafw/sse/`（dispatcher + handlers，deps 注入可单测）与 `mafw/workspace/`（会话工作区单例）；事件接线改动点从 MafwShell onmessage 变为 `sse/dispatcher.ts` + `sse/handlers/*`）
- Modify: `packages/desktop/AGENTS.md`（如有需要补一句测试命令 `bun test`）

**Steps:**

- [ ] **Step 1: AGENTS.md 更新**（两处，内容如上）
- [ ] **Step 2: 全量测试** `npm run test:desktop` 全绿；`npm test`（gateway jest）与 `npm run test:tui` 确认无回归
- [ ] **Step 3: 构建** `cd packages/desktop; npx electron-vite build` 成功
- [ ] **Step 4: 手动冒烟清单**（`mafw daemon` + desktop dev 或已装实例）：
  1. 打开 app → WelcomeHome 正常、Rail 会话列表加载
  2. 发消息 → 流式渲染、完成态、token 状态
  3. 触发一次权限审批 → 卡片出现、once/always/reject 正常
  4. Ctrl+K 搜索会话、开第二个 tab、分屏、关闭 tab
  5. 另一客户端（TUI）改会话标题 → desktop tab 标题同步（planner 路径）
  6. Ctrl+Shift+E EventInspector 无红色 miss 事件
- [ ] **Step 5: Commit**

```bash
git commit -m "docs: AGENTS.md renderer sse/workspace structure"
```

---

## Self-Review 记录

- Spec 覆盖：本 plan 只覆盖 spec §2（阶段一）；spec §3-6 四切片各自后续出 plan（spec 已声明）
- 占位符：无 TBD；Task 3/4/5 的"逐字迁移"步骤均给出源行号锚（commit 13ad8348）与 deps 替换映射表
- 类型一致：`ShellEventDeps` 在 Task 2 定义为 `{core, lifecycle}`，Task 3-5 扩展加 `flowCards`/`dock`/`chat`；`SidHandler` 签名三处一致；`createSessionWorkspace` 工厂与 `workspace` 单例在 Task 6 定义、Task 6 消费
- Task 4 的 deps 在读旧值问题上已显式补 `getTrajectoryEvents` 访问器（见 Task 4 Step 1 注）
