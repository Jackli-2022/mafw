# T2-2 回合级软暂停（RunState）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会话忙时可暂停（abort + 续跑简报落库 + 队列闸门），之后可恢复（合成续跑提示开启新回合）或放弃；状态跨重启保留、事件/桌面同步。

**Architecture:** gateway.db `run_states` + `RunStateService`（持久状态机）+ `RunCoordinator`（编排 abort/settle/brief/队列闸门/启动恢复，deps 注入可测）；HTTP 四路由 + canonical `run.updated`；SDK/preload/桌面 run-store 与暂停条。零 runtime 新动词。

**Tech Stack:** TypeScript gateway (jest)、SQLite、@mafw/sdk、SolidJS。

**Spec:** `docs/superpowers/specs/2026-10-26-t2-runstate-soft-suspend-design.md`

## Global Constraints

- 版本 `v4.38.0`；push/发布需用户确认。
- 不假装进程级挂起：语义是 abort + 续跑简报；文案必须诚实。
- additive only：不改现有 abort/queue/turn 事件语义；`flushSessionQueue` 仅前置闸门早退。
- fail-open：`run.updated` 广播失败不影响状态落库；桌面拉取失败不阻塞聊天。
- 路由正则容忍 query string `(?:\?|$)`（AGENTS §6.5）。
- 词汇单源六处同步（SDK events ↔ MAFW ↔ matrix ↔ TUI ↔ desktop 覆盖）。
- 每会话单活跃 run；暂停中公共 prompt 一律入队。
- 测试命令：gateway `cd gateway && npx jest <path> --runInBand`；全量加 `--forceExit`；SDK/TUI/desktop 各自 `npm test`。

## Review Focus

1. **pi 的 promptAsync 阻塞语义**：resume 必须先落 `resumed` 状态再 fire-and-forget 发送；发送失败 reopen→suspended（否则终态先到，run 永久活跃）。
2. **abort 终态延迟**：suspend 等 settle（终态或 5s）；resume 要求 settled；延迟的 abort 终态不得把新 `resumed` run 标成 cancelled（先 settled 才允许 resume）。
3. **暂停期间其它发入口**：公共 `promptAsync` 在 suspended 时强制入队；`/prompt`/`/command` 409；内部 noReply 通知放行（已知边界）。
4. **重启恢复**：`suspended` 重挂闸门；`resumed` → cancelled（僵尸清理）；startup reconcile 有测试。
5. **brief 取到的是暂停点而非上一回合**：suspend 在 abort 后重取 messages 构建；跳过 `[MAFW 续跑]` 前缀的合成 user 消息。

---

### Task 1: DB 层 — `run_states` 表与方法

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`（DDL 追加；方法加在 session_checkpoints 群后）
- Test: `gateway/tests/unit/gateway-db-runs.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RunStateRow {
  id: string; session_id: string; project_dir: string;
  status: string; reason: string | null; brief_json: string;
  created_at: string; suspended_at: string;
  resumed_at: string | null; finished_at: string | null;
}
insertRunState(row: RunStateRow): void
getRunState(id: string): RunStateRow | undefined
getActiveRunState(sessionId: string): RunStateRow | undefined   // status IN ('suspended','resumed') ORDER BY created_at DESC LIMIT 1
listActiveRunStates(): RunStateRow[]                            // startup reconcile
updateRunState(id: string, patch: Partial<Pick<RunStateRow,'status'|'resumed_at'|'finished_at'|'reason'>>): void
pruneRunStates(sessionId: string, keep: number): number          // 仅删终态，按 created_at 保最新 keep
deleteRunStates(sessionId: string): void
```

- [ ] **Step 1: 写失败测试** — insert/get 往返（含 null 字段）；getActive 只取 suspended/resumed 且最新；update 局部更新；prune 只删终态、保留活跃；delete 按会话；listActive 跨会话。
- [ ] **Step 2: 跑确认失败** — `cd gateway && npx jest tests/unit/gateway-db-runs.test.ts --runInBand`，期望方法不存在。
- [ ] **Step 3: 实现** — DDL `CREATE TABLE IF NOT EXISTS run_states (...)` + `CREATE INDEX idx_run_states ON run_states(session_id, created_at)`；方法用 prepared statements；prune：`DELETE ... WHERE session_id=? AND status NOT IN ('suspended','resumed') AND id NOT IN (SELECT id FROM run_states WHERE session_id=? AND status NOT IN (...) ORDER BY created_at DESC LIMIT ?)`。
- [ ] **Step 4: 跑绿**。
- [ ] **Step 5: Commit** — `feat(run): run_states table + db methods`。

---

### Task 2: 纯函数 — 续跑简报与提示模板

**Files:**
- Create: `gateway/src/core/run/run-brief.ts`
- Test: `gateway/tests/unit/run/run-brief.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ResumeBrief {
  lastUserText: string;        // ≤600 chars
  lastAssistantTail: string;   // ≤1200 chars（最后一条 assistant 的最后一个 text part 尾部）
  anchorMessageID: string;     // 最后一条 user（非合成）id
  queuedCount: number;
}
export function buildResumeBrief(messages: any[], queuedCount: number): ResumeBrief | null
// - unwrap {info,parts}；按 time.created 升序（同分原序）
// - user 文本 = parts 中 type==='text' 的 text 拼接；跳过 text 前缀 '[MAFW 续跑]'
// - 无可用 user → null；无 assistant → lastAssistantTail=''
export const RESUME_PREFIX = '[MAFW 续跑]'
export function composeResumePrompt(brief: ResumeBrief): string
// 固定模板（见 spec §5.2）：含 lastUserText / lastAssistantTail，指令“从断点继续，不重复已完成步骤”
```

- [ ] **Step 1: 写失败测试** — 正常两消息；跳过合成前缀；多 parts join；截断（600/1200）；无 user → null；空 assistant tail；`{info}` 信封；乱序按 created 排序。
- [ ] **Step 2: 跑确认失败**（模块不存在）。
- [ ] **Step 3: 实现 run-brief.ts** — 复用 turn-diff 的 `unwrapMessage/createdOf/roleOf`（已导出）。
- [ ] **Step 4: 跑绿**。
- [ ] **Step 5: Commit** — `feat(run): resume brief + prompt composition (pure)`。

---

### Task 3: RunStateService — 持久状态机

**Files:**
- Create: `gateway/src/core/run/run-state-service.ts`
- Test: `gateway/tests/unit/run/run-state-service.test.ts`

**Interfaces:**
- Consumes: Task 1 db、Task 2 brief、Task 4 事件名（先以字面量 `'run.updated'`，Task 4 换常量）。
- Produces:

```ts
export type RunStatus = 'suspended' | 'resumed' | 'completed' | 'failed' | 'cancelled'
export interface RunState { id; sessionID; projectDir; status; reason?; brief: ResumeBrief; createdAt; suspendedAt; resumedAt?; finishedAt? }
export class RunStateError extends Error { constructor(public status: number, message: string) }
export interface RunStateServiceDeps {
  db: RunDbDeps; broadcast(e: any): void; now(): string; newId(): string;
  eventName?: string;   // 默认 'run.updated'
}
export class RunStateService {
  suspend(input: { sessionID; projectDir; reason?; brief }): RunState
  //   active 已存在 → RunStateError(409,'run already active'); insert; prune(20); broadcast {type:eventName, properties:{sessionID, run}}
  resume(id: string): RunState        // suspended→resumed（否则 409）；resumedAt=now；broadcast
  reopen(id: string, reason?: string): RunState  // resumed→suspended（恢复发送失败回滚）
  finish(sessionID: string, outcome:'completed'|'failed'|'cancelled'): RunState | null
  //   仅 resumed run → 终态；返回更新后的 run 并广播
  discard(id: string): RunState       // suspended|resumed→cancelled；广播
  active(sessionID): RunState | null
  listActive(): RunState[]
  deleteForSession(sessionID): void
}
export function toRunDto(row: RunStateRow): RunState
```

- [ ] **Step 1: 写失败测试** — suspend 落库+广播+prune；重复 suspend 409；resume 状态与 resumedAt；reopen；finish 只作用 resumed（suspended 不结束）；discard 两态；active/listActive；delete。
- [ ] **Step 2: 跑确认失败**。
- [ ] **Step 3: 实现**（deps 注入；brief 直接存 JSON）。
- [ ] **Step 4: 跑绿**。
- [ ] **Step 5: Commit** — `feat(run): RunStateService state machine`。

---

### Task 4: 词汇链 — `run.updated`

**Files:** `packages/gateway-sdk/src/events.ts`（RUNTIME_EVENT_TYPES）、`gateway/src/runtime/mafw-vocabulary.ts`、`gateway/src/runtime/event-flow-matrix.ts`、`packages/tui/src/store/connection.ts`、`packages/desktop/src/renderer/mafw/session-events.ts`（**先 IGNORED_AT_SHELL**，Task 8 接 dispatcher 后转 handled）
- Test: `gateway/tests/unit/runtime/vocabulary-sync.test.ts`、`event-flow-matrix.test.ts`、TUI event-coverage、desktop session-events

**Interfaces:** canonical `run.updated`；载荷 `{sessionID, run: RunState}`；信封 `mafwBroadcast`；本任务只加事件名（类型在 Task 7 引入）。

- [ ] **Step 1: 先只加 SDK 侧事件名 → 跑 vocabulary-sync 看红**
- [ ] **Step 2: 五处补齐**（MAFW `runUpdated`；matrix `R([], 'passthrough', 'ignore', 'ignore', ...)`；TUI KNOWN_EVENTS；desktop IGNORED_AT_SHELL）
- [ ] **Step 3: 跑绿** — gateway sync/matrix；TUI；desktop session-events。
- [ ] **Step 4: Commit** — `feat(vocab): run.updated canonical event`。

---

### Task 5: RunCoordinator — 编排（suspend/resume/settle/闸门/恢复）

**Files:**
- Create: `gateway/src/core/run/run-coordinator.ts`
- Test: `gateway/tests/unit/run/run-coordinator.test.ts`（全 mock：runtime/service/busy/queue/timer）

**Interfaces:**
- Consumes: Task 2/3、runtime contract（abort/messages/promptAsync/get）。
- Produces:

```ts
export interface RunCoordinatorDeps {
  runtime(): { capabilities?; session: { abort; messages; promptAsync; get } } | null;
  service: RunStateService;
  isBusy(sid: string): boolean;
  queueSize(sid: string): number;
  flushQueue(sid: string): void;
  now(): number;                 // ms（settle 计时）
  wait(ms: number): Promise<void>;
  log?: (msg: string) => void;
}
export class RunCoordinator {
  isSuspended(sid: string): boolean
  async suspend(sid: string, reason?: string): Promise<RunState>
  //  1 能力门（abort+runStateApi）→ 503；2 active→409；3 busy 优先，非 busy 仍尝试
  //  4 预取 messages 找 user 锚点（无 → 409，不 abort）
  //  5 suspended.add；6 abort；失败→删闸门+409/502
  //  7 settle：轮询 isBusy 直到 false 或 5s（wait 注入）
  //  8 重取 messages → brief（null → 删闸门 + 409 'cannot build resume brief'）
  //  9 service.suspend → settled.add
  async resume(sid: string, runId?: string): Promise<{ run: RunState; prompted: true }>
  //  busy→409；run 非 suspended→404/409；未 settled→409 'still stopping'
  //  service.resume 先落库；suspended.delete；fire-and-forget promptAsync(composeResumePrompt)
  //  失败 async：service.reopen + suspended.add + log
  async discard(sid: string, runId?: string): Promise<RunState>
  //  active 无→404；busy 且 status=resumed→409；service.discard；suspended.delete；flushQueue
  onTerminal(sid: string, type: 'completed'|'failed'|'aborted'): void
  //  settled.add(sid)；有 resumed run → service.finish(映射)
  reconcile(): void
  //  listActive：suspended→suspended.add+settled.add；resumed→service.finish('cancelled')
  deleteForSession(sid): void   // service.deleteForSession + 清两个 Set
}
```

- [ ] **Step 1: 写失败测试** — 覆盖 Review Focus 1/2/4/5：suspend 先 set 闸门再 abort（调用顺序断言）；abort 失败清闸门；settle 轮询（wait mock）；brief 在 abort 后构建（messages 调用序）；resume 先 resume 后 send；send 失败 reopen；未 settled resume 409；onTerminal 只 finish resumed、abort 终态只 settle；discard flush；reconcile 两态。
- [ ] **Step 2: 跑确认失败 → 实现 → 跑绿**。
- [ ] **Step 3: Commit** — `feat(run): RunCoordinator (suspend/resume/settle/reconcile)`。

---

### Task 6: HTTP 路由 + 接线（prompt 闸门 / 终态 / 启动恢复 / 删除联动）

**Files:**
- Create: `gateway/src/routes/session-run.ts`
- Modify: `gateway/src/routes/route-catalog.ts`（四行：session.suspend/resume/run/discardRun）、`gateway/src/routes/wave1-handlers.ts`、`gateway/src/index.ts`（coordinator 构造、finished/terminal hook、flush 闸门、promptAsync/prompt/command 闸门、busy 时间戳刷新、启动 reconcile、session.delete cleanup、事件广播）
- Test: `gateway/tests/unit/routes/session-run.test.ts`、`gateway/tests/unit/run/run-wiring.test.ts`

**Interfaces:**
- Produces:

```
POST /api/sessions/:id/suspend          body {reason?}                    → {run}
POST /api/sessions/:id/resume           body {runId?}                     → {run, prompted:true}
GET  /api/sessions/:id/run                                                → {run|null}
POST /api/sessions/:id/run/discard      body {runId?}                     → {run}
能力门 runStateApi → 503；RunStateError.status 透传；busy/未落定 409
```

- 路由 handler 照 `session-checkpoints.ts`；能力门 `runStateApi`；全部委托 coordinator。
- index：
  - 构造 `RunStateService` + `RunCoordinator`（deps 读 `busySessions`/`sessionQueue`/`flushSessionQueue`/runtime thunk/`Date.now`/setTimeout）
  - `handleRuntimeEvent` 三终态分支：`coordinator.onTerminal(sessionID, ...)`；任意事件刷新 busy 时间戳
  - `flushSessionQueue` 首行：`if (coordinator.isSuspended(sid)) return;`
  - promptAsync 路由：`delivery==='queue' && busy` → 入队；新增 `coordinator.isSuspended(sid)` → 强制入队（忽略 delivery）；prompt/command 路由 suspended → 409
  - 启动 reconcile（init 后、server 前）
  - session.delete cleanup 增 `coordinator.deleteForSession`
- catalog 四条；emit-openapi + SDK gen。
- `runStateApi` 能力位：`fullCapabilities` true；pi plugin capabilities true（若 pi caps 显式）——缺省 false/undefined → 503。

- [ ] **Step 1: 写失败测试** — 路由：503/404/409/200（mock coordinator）；wiring 单测（若可行：导出 `applyRunPromptGate` 纯 helper 测 suspended→enqueue）。
- [ ] **Step 2: 实现 → 跑绿**。
- [ ] **Step 3: 跑 gateway 全量**（预计 2780+）。
- [ ] **Step 4: Commit** — `feat(run): HTTP routes + gateway wiring (gates, terminal, reconcile)`。

---

### Task 7: SDK + preload

**Files:** `packages/gateway-sdk/src/types.ts`、`client.ts`、`client.test.ts`；`packages/desktop/src/preload/mafw-api.ts`、`mafw-types.ts`；`packages/gateway-sdk/src/events.test.ts`（事件计数）

**Interfaces:**
```ts
export type RunStatus = ...
export interface ResumeBrief {...}
export interface RunState {...}
session.suspend({path:{id}, body?:{reason?}}): Promise<{run: RunState}>
session.resume({path:{id}, body?:{runId?}}): Promise<{run: RunState; prompted: true}>
session.run({path:{id}}): Promise<{run: RunState | null}>
session.discardRun({path:{id}, body?:{runId?}}): Promise<{run: RunState}>
// preload: window.api.mafw.sessions.{suspend,resume,run,discardRun}
```

- [ ] **Step 1: RED（client.test 四方法）→ 实现 → SDK 全绿**（含事件计数 +1）
- [ ] **Step 2: desktop tsgo**。
- [ ] **Step 3: Commit** — `feat(sdk): run suspend/resume surface + preload`。

---

### Task 8: Desktop — run-store + 暂停按钮/暂停条

**Files:**
- Create: `packages/desktop/src/renderer/mafw/run-store.ts`、`run-banner.ts`
- Modify: `sse/dispatcher.ts`（run dep → onEvent）、`MafwShell.tsx`/dispatch 接线（有 run dep 注入处）、`ChatPane.tsx`（忙时「暂停」按钮；暂停条 恢复/放弃；mount/切换拉 GET run）、`session-events.ts`（IGNORED → handled + switch case）、`event-flow-matrix.ts`（desktop 列 ignore → handled）、`mafw.css`
- Test: `run-store.test.ts`、`run-banner.test.ts`、`dispatcher.test.ts` 增量、`session-events.test.ts`

**Interfaces:**
```ts
// run-store: per-session RunState|null；set/clear；signals
// run-banner(run, busy): { text: string; canResume: boolean; canDiscard: boolean } | null
// dispatcher deps.run.onEvent(run) ← run.updated
```
- 暂停条在 composer 上方（复用 queue bar 样式），显示 `已暂停 · <brief.lastUserText 截断>` + 恢复/放弃；busy 时暂停按钮（与现有停止/中断并排）。
- 能力门 `caps.runStateApi === true`。
- [ ] **Step 1: 纯逻辑 RED → 实现 → 绿**
- [ ] **Step 2: ChatPane/接线 → tsgo + desktop 全量 + build**
- [ ] **Step 3: Commit** — `feat(desktop): pause/resume run bar + run store`。

---

### Task 9: 收尾 — 全量验证、v4.38.0、部署、真机冒烟

**Files:** `package.json`、`AGENTS.md`、`gateway/scripts/smoke-runstate.mjs`（新增）

- [ ] **Step 1: 全量矩阵** — gateway、SDK、TUI、desktop、session-ui；根 build；desktop tsgo+build。
- [ ] **Step 2: 版本 4.38.0 + AGENTS 条目（Batch 10/T2-2：commits、测试计数、冒烟结果）**
- [ ] **Step 3: 提交 `chore(release): v4.38.0 — run soft-suspend`**
- [ ] **Step 4: 部署** — pack/install/重启/版本。
- [ ] **Step 5: 真机冒烟**（`gateway/scripts/smoke-runstate.mjs`）：
  1. 临时 git repo + 会话；`POST /config mode=full-access`
  2. prompt 让 agent 跑 `sleep 20`；轮询尝试 suspend 直到 200（最多 10s）
  3. 断言 run.status=suspended、brief.lastUserText 含原始请求；队列 size 不续跑（暂停中发一条 delivery:queue → 200 queued 且无新回合）
  4. resume → 200 {prompted:true}；等待回合完成；run 终态 completed（GET run 返回 null）；历史含 `[MAFW 续跑]`
  5. 闲时 suspend → 409；重复 suspend → 409
  6. cleanup
- [ ] **Step 6: 汇报** — 版本/哈希/测试计数/冒烟；不 push。
