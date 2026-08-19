# Agent 轨迹统计 + 桌面侧边栏（Trajectory Sidebar）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网关累积 opencode agent 轨迹（回合+工具+推理+模型切换+真实 tokens/cost）入 SQLite 并暴露 API；desktop 统一右侧 dock（任务/轨迹双 tab）实时展示。

**Architecture:** 网关新增 `TrajectoryStore`（挂 `GatewayDatabase`，SQLite 两表：`trajectory_events` append-only 流水 + `trajectory_turns` 回合聚合），在 `handleOpencodeEvent` 三个 hook 点（`message.part.updated` / `message.updated` / `session.idle`）累积并 broadcast `trajectory.event`；新端点 `GET /api/sessions/{id}/trajectory` 供桌面拉取（支持分页/rebuild）。桌面 MafwShell 把现有 TaskList dock 迁入统一 `RightDock`（tabs: 任务/轨迹），新 `TrajectoryDock` 组件展示回合列表+可展开事件时间线，SSE 实时 upsert。

**Tech Stack:** better-sqlite3（网关已用）、Node http 路由（网关原生）、SolidJS + @opencode-ai/ui（desktop）、Electron IPC + gateway-sdk。

## Global Constraints

- 网关事件源：opencode ≥1.18 事件流（`message.part.updated` 的 ToolPart/StepFinishPart、`message.updated`、`session.idle`；`session.next.step.ended` 已停发，不做依赖）
- 事件 shape 见 SDK v1 `types.gen.d.ts`：`ToolPart = { id, sessionID, messageID, type:"tool", callID, tool, state: ToolState }`；`ToolState` 四态 pending/running/completed/error（各含 `time.start/end`、`input`、`output`/`error`）；`StepFinishPart = { id, messageID, reason, cost, tokens:{input,output,reasoning,cache:{read,write}} }`；`AssistantMessage = { id, sessionID, role:"assistant", parentID, modelID, providerID, cost, tokens, finish }`；`UserMessage = { id, sessionID, role:"user", time, agent, model }`
- `GatewayDatabase`（`gateway/src/memory/gateway-db.ts`）单例经 `index.ts:199` `getGatewayDb()` 懒构造；`nextTurnId(session_id)`/`currentTurnId(session_id)` 从 `t1_observations` 取 MAX——轨迹表独立建表但 turn_id 语义对齐
- API 路由正则锚定必须 `(?:\?|$)`（AGENTS.md §6.5）
- 网关写轨迹失败 try/catch 日志，**绝不**抛回 `handleOpencodeEvent` 主流程
- 桌面 UI 约定：无裸 `<button>`/`<input>`/裸 `title`；一律 `ButtonV2`/`TooltipV2`（`openDelay={300}`）；样式进 `mafw.css`（`mafw-*` 类 + theme tokens）；数字 `tabular-nums`
- `project_id` = `evt.directory`（GlobalEvent 字段）
- token/cost 一律用 opencode 真实上报值，不做估算
- 测试框架 jest（`npm run test:unit`）；网关单测用 `fs.mkdtempSync` 隔离（不污染 `~/.mafw`）

---

### Task 1: 网关 — 轨迹表结构 + TrajectoryStore 写入

**Files:**
- Create: `gateway/src/trajectory/types.ts`（类型 + 常量）
- Create: `gateway/src/trajectory/trajectory-store.ts`
- Modify: `gateway/src/memory/gateway-db.ts`（新增两表 DDL）
- Test: `tests/unit/gateway/trajectory-store.test.ts`

**Interfaces:**
- Consumes: `GatewayDatabase`（`gateway-db.ts` 现有类）
- Produces:
  - `types.ts`: `TrajectoryEventType`（union）、`TrajectoryEvent`（接口）、`TrajectoryTurn`（接口）、`TokenCounts`（接口）
  - `trajectory-store.ts`: `class TrajectoryStore { constructor(db: GatewayDatabase, projectDir: string) }`、`recordEvent(evt: Omit<TrajectoryEvent, 'id'>): void`、`upsertTurn(turn: TrajectoryTurn): void`、`getSessionTrajectory(sessionID: string, opts: { limit: number; beforeTurn?: number }): { turns: TrajectoryTurn[]; events: TrajectoryEvent[] }`、`deleteSession(sessionID: string): void`、`pruneOlderThan(days: number): void`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/gateway/trajectory-store.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';
import { TrajectoryEvent } from '../../../gateway/src/trajectory/types';

let dir: string;
let db: GatewayDatabase;
let store: TrajectoryStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-test-'));
  db = new GatewayDatabase(path.join(dir, 'gateway.db'));
  store = new TrajectoryStore(db, '/proj');
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function evt(partial: Partial<TrajectoryEvent>): Omit<TrajectoryEvent, 'id'> {
  return { sessionID: 's1', turnID: 1, seq: 1, eventType: 'tool_start', timeMs: Date.now(), ...partial } as any;
}

test('recordEvent writes events and orders by (turn_id, seq)', () => {
  store.recordEvent(evt({ turnID: 1, seq: 1, eventType: 'tool_start', toolName: 'bash' }));
  store.recordEvent(evt({ turnID: 1, seq: 2, eventType: 'tool_end', toolName: 'bash', durationMs: 1500 }));
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.events).toHaveLength(2);
  expect(r.events[0].eventType).toBe('tool_start');
  expect(r.events[1].durationMs).toBe(1500);
});

test('upsertTurn replaces by (session_id, turn_id)', () => {
  store.upsertTurn({ projectID: '/proj', sessionID: 's1', turnID: 1, turnStartMs: 100, turnEndMs: 200, durationMs: 100, toolCount: 1, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.1, finish: 'stop', model: 'm1', agent: 'build', userText: 'hi' });
  store.upsertTurn({ projectID: '/proj', sessionID: 's1', turnID: 1, turnStartMs: 100, turnEndMs: 250, durationMs: 150, toolCount: 2, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.2, finish: 'stop', model: 'm1', agent: 'build', userText: 'hi' });
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.turns).toHaveLength(1);
  expect(r.turns[0].cost).toBe(0.2);
  expect(r.turns[0].durationMs).toBe(150);
});

test('getSessionTrajectory paginates by beforeTurn and filters events', () => {
  for (const t of [1, 2, 3]) {
    store.upsertTurn({ projectID: '/proj', sessionID: 's1', turnID: t, turnStartMs: t * 100, turnEndMs: t * 200, durationMs: 100, toolCount: 1, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0, finish: 'stop', model: 'm', agent: 'build', userText: 't' + t });
    store.recordEvent(evt({ turnID: t, seq: 1, eventType: 'tool_start', toolName: 'bash' }));
  }
  const page = store.getSessionTrajectory('s1', { limit: 2, beforeTurn: 3 });
  expect(page.turns.map(x => x.turnID)).toEqual([2, 1]);
  expect(page.events.map(e => e.turnID)).toEqual([2, 1]);
});

test('deleteSession removes all rows for a session', () => {
  store.recordEvent(evt({ turnID: 1, seq: 1 }));
  store.upsertTurn({ projectID: '/proj', sessionID: 's1', turnID: 1, turnStartMs: 1, turnEndMs: 2, durationMs: 1, toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0, finish: 'stop', model: 'm', agent: 'build', userText: 'x' });
  store.deleteSession('s1');
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.turns).toHaveLength(0);
  expect(r.events).toHaveLength(0);
});

test('pruneOlderThan deletes rows older than N days', () => {
  // created_at is unixepoch (seconds); inject an old row directly via a raw insert
  const oldTurn = { projectID: '/proj', sessionID: 'old', turnID: 1, turnStartMs: 1, turnEndMs: 2, durationMs: 1, toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0, finish: 'stop', model: 'm', agent: 'build', userText: 'x' };
  (db as any).db.prepare(`INSERT INTO trajectory_turns (project_id, session_id, turn_id, turn_start_ms, turn_end_ms, duration_ms, tool_count, tool_error_count, reasoning_count, agent_switch_count, tokens, cost, finish, model, agent, user_text, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(oldTurn.projectID, oldTurn.sessionID, oldTurn.turnID, oldTurn.turnStartMs, oldTurn.turnEndMs, oldTurn.durationMs, oldTurn.toolCount, oldTurn.toolErrorCount, oldTurn.reasoningCount, oldTurn.agentSwitchCount, JSON.stringify(oldTurn.tokens), oldTurn.cost, oldTurn.finish, oldTurn.model, oldTurn.agent, oldTurn.userText, Math.floor(Date.now() / 1000) - 20 * 86400);
  store.pruneOlderThan(14);
  const r = store.getSessionTrajectory('old', { limit: 50 });
  expect(r.turns).toHaveLength(0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/unit/gateway/trajectory-store.test.ts`
Expected: FAIL（模块不存在 / 表不存在）

- [ ] **Step 3: 建表 DDL（gateway-db.ts）**

在 `gateway/src/memory/gateway-db.ts` 的 `this.db.exec(...)` 块中追加：

```typescript
      CREATE TABLE IF NOT EXISTS trajectory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        tool_name TEXT,
        call_id TEXT,
        tool_state TEXT,
        agent TEXT,
        model TEXT,
        input_summary TEXT,
        output_summary TEXT,
        error TEXT,
        tokens TEXT,
        cost REAL,
        finish TEXT,
        time_ms REAL NOT NULL,
        duration_ms REAL,
        created_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_traj_evt_session ON trajectory_events(session_id, turn_id, seq);
      CREATE INDEX IF NOT EXISTS idx_traj_evt_ttl ON trajectory_events(created_at);

      CREATE TABLE IF NOT EXISTS trajectory_turns (
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id INTEGER NOT NULL,
        turn_start_ms REAL NOT NULL,
        turn_end_ms REAL,
        duration_ms REAL,
        tool_count INTEGER DEFAULT 0,
        tool_error_count INTEGER DEFAULT 0,
        reasoning_count INTEGER DEFAULT 0,
        agent_switch_count INTEGER DEFAULT 0,
        tokens TEXT,
        cost REAL DEFAULT 0,
        finish TEXT,
        model TEXT,
        agent TEXT,
        user_text TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (session_id, turn_id)
      );
      CREATE INDEX IF NOT EXISTS idx_traj_turn_ttl ON trajectory_turns(created_at);
```

- [ ] **Step 4: 实现 TrajectoryStore + types**

`gateway/src/trajectory/types.ts`:

```typescript
export const TRAJECTORY_EVENT_TYPES = [
  'tool_start', 'tool_update', 'tool_end',
  'reasoning_start', 'reasoning_end',
  'agent_switch', 'model_switch',
  'step_finish', 'turn_start', 'turn_end',
  'text_start', 'text_end',
] as const;
export type TrajectoryEventType = (typeof TRAJECTORY_EVENT_TYPES)[number];

export interface TokenCounts {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface TrajectoryEvent {
  id?: number;
  projectID: string;
  sessionID: string;
  turnID: number;
  seq: number;
  eventType: TrajectoryEventType;
  toolName?: string;
  callID?: string;
  toolState?: 'running' | 'completed' | 'error';
  agent?: string;
  model?: string;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
  tokens?: TokenCounts;
  cost?: number;
  finish?: string;
  timeMs: number;
  durationMs?: number;
}

export interface TrajectoryTurn {
  projectID: string;
  sessionID: string;
  turnID: number;
  turnStartMs: number;
  turnEndMs: number | null;
  durationMs: number | null;
  toolCount: number;
  toolErrorCount: number;
  reasoningCount: number;
  agentSwitchCount: number;
  tokens: TokenCounts;
  cost: number;
  finish: string | null;
  model: string | null;
  agent: string | null;
  userText: string;
}
```

`gateway/src/trajectory/trajectory-store.ts`:

```typescript
import { GatewayDatabase } from '../memory/gateway-db';
import { TrajectoryEvent, TrajectoryTurn, TokenCounts } from './types';

const EMPTY_TOKENS: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

function rowToEvent(row: any): TrajectoryEvent {
  return {
    id: row.id,
    projectID: row.project_id,
    sessionID: row.session_id,
    turnID: row.turn_id,
    seq: row.seq,
    eventType: row.event_type,
    toolName: row.tool_name ?? undefined,
    callID: row.call_id ?? undefined,
    toolState: row.tool_state ?? undefined,
    agent: row.agent ?? undefined,
    model: row.model ?? undefined,
    inputSummary: row.input_summary ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    error: row.error ?? undefined,
    tokens: row.tokens ? JSON.parse(row.tokens) : undefined,
    cost: row.cost ?? undefined,
    finish: row.finish ?? undefined,
    timeMs: row.time_ms,
    durationMs: row.duration_ms ?? undefined,
  };
}

function rowToTurn(row: any): TrajectoryTurn {
  return {
    projectID: row.project_id,
    sessionID: row.session_id,
    turnID: row.turn_id,
    turnStartMs: row.turn_start_ms,
    turnEndMs: row.turn_end_ms,
    durationMs: row.duration_ms,
    toolCount: row.tool_count,
    toolErrorCount: row.tool_error_count,
    reasoningCount: row.reasoning_count,
    agentSwitchCount: row.agent_switch_count,
    tokens: row.tokens ? JSON.parse(row.tokens) : { ...EMPTY_TOKENS },
    cost: row.cost,
    finish: row.finish,
    model: row.model,
    agent: row.agent,
    userText: row.user_text,
  };
}

export class TrajectoryStore {
  constructor(
    private db: GatewayDatabase,
    private projectID: string,
  ) {}

  private get rawDb(): any {
    return (this.db as any).db;
  }

  recordEvent(evt: Omit<TrajectoryEvent, 'id'>): void {
    this.rawDb
      .prepare(
        `INSERT INTO trajectory_events
         (project_id, session_id, turn_id, seq, event_type, tool_name, call_id, tool_state,
          agent, model, input_summary, output_summary, error, tokens, cost, finish, time_ms, duration_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        evt.projectID, evt.sessionID, evt.turnID, evt.seq, evt.eventType,
        evt.toolName ?? null, evt.callID ?? null, evt.toolState ?? null,
        evt.agent ?? null, evt.model ?? null, evt.inputSummary ?? null,
        evt.outputSummary ?? null, evt.error ?? null,
        evt.tokens ? JSON.stringify(evt.tokens) : null,
        evt.cost ?? null, evt.finish ?? null, evt.timeMs, evt.durationMs ?? null,
      );
  }

  upsertTurn(turn: TrajectoryTurn): void {
    this.rawDb
      .prepare(
        `INSERT INTO trajectory_turns
         (project_id, session_id, turn_id, turn_start_ms, turn_end_ms, duration_ms,
          tool_count, tool_error_count, reasoning_count, agent_switch_count,
          tokens, cost, finish, model, agent, user_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(session_id, turn_id) DO UPDATE SET
           turn_end_ms = excluded.turn_end_ms,
           duration_ms = excluded.duration_ms,
           tool_count = excluded.tool_count,
           tool_error_count = excluded.tool_error_count,
           reasoning_count = excluded.reasoning_count,
           agent_switch_count = excluded.agent_switch_count,
           tokens = excluded.tokens,
           cost = excluded.cost,
           finish = excluded.finish,
           model = excluded.model,
           agent = excluded.agent,
           user_text = excluded.user_text`,
      )
      .run(
        turn.projectID, turn.sessionID, turn.turnID, turn.turnStartMs, turn.turnEndMs, turn.durationMs,
        turn.toolCount, turn.toolErrorCount, turn.reasoningCount, turn.agentSwitchCount,
        JSON.stringify(turn.tokens), turn.cost, turn.finish, turn.model, turn.agent, turn.userText,
      );
  }

  getSessionTrajectory(
    sessionID: string,
    opts: { limit: number; beforeTurn?: number },
  ): { turns: TrajectoryTurn[]; events: TrajectoryEvent[] } {
    const turns = this.rawDb
      .prepare(
        `SELECT * FROM trajectory_turns WHERE session_id = ?
         ${opts.beforeTurn ? 'AND turn_id < ?' : ''}
         ORDER BY turn_id DESC LIMIT ?`,
      )
      .all(...(opts.beforeTurn ? [sessionID, opts.beforeTurn, opts.limit] : [sessionID, opts.limit])) as any[];
    const minTurn = turns.length > 0 ? turns[turns.length - 1].turn_id : 0;
    const events = turns.length > 0
      ? (this.rawDb
          .prepare(
            `SELECT * FROM trajectory_events
             WHERE session_id = ? AND turn_id >= ?
             ORDER BY turn_id ASC, seq ASC`,
          )
          .all(sessionID, minTurn) as any[]).map(rowToEvent)
      : [];
    return {
      turns: turns.map(rowToTurn),
      events,
    };
  }

  deleteSession(sessionID: string): void {
    this.rawDb.prepare('DELETE FROM trajectory_events WHERE session_id = ?').run(sessionID);
    this.rawDb.prepare('DELETE FROM trajectory_turns WHERE session_id = ?').run(sessionID);
  }

  pruneOlderThan(days: number): void {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    this.rawDb.prepare('DELETE FROM trajectory_events WHERE created_at < ?').run(cutoff);
    this.rawDb.prepare('DELETE FROM trajectory_turns WHERE created_at < ?').run(cutoff);
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx jest tests/unit/gateway/trajectory-store.test.ts`
Expected: PASS（5 个测试）

- [ ] **Step 6: 提交**

```bash
git add gateway/src/trajectory/ gateway/src/memory/gateway-db.ts tests/unit/gateway/trajectory-store.test.ts
git commit -m "feat(gateway): trajectory store with SQLite tables (events + turns)"
```

---

### Task 2: 网关 — 事件 hook 累积（TrajectoryCollector）

**Files:**
- Create: `gateway/src/trajectory/collector.ts`
- Test: `tests/unit/gateway/trajectory-collector.test.ts`

**Interfaces:**
- Consumes: `TrajectoryStore`（Task 1）、`GatewayDatabase.nextTurnId/currentTurnId`
- Produces: `class TrajectoryCollector { constructor(store: TrajectoryStore, db: GatewayDatabase, projectID: string) }`、`handleEvent(type: string, props: any, directory?: string): TrajectoryEvent | null`（返回新事件供广播）、`onIdle(sessionID: string): TrajectoryTurn | null`、`getLastTurn(sessionID: string): number`、`seq(sessionID: string): number`

**规则（从 spec §3.3）：**
- `message.part.updated`：
  - ToolPart（`part.type === 'tool'`）：`pending/running` → `tool_start`（callID 去重，首见）；`completed/error` → `tool_end`（durationMs = time.end - time.start，summary 截断 500）
  - StepFinishPart（`part.type === 'step-finish'`）→ `step_finish`（按 `messageID` 去重）
  - reasoning part（`part.type === 'reasoning'`）→ 按 part id 首/末次出现 → `reasoning_start` / `reasoning_end`
- `message.updated`：
  - user → `turn_start`（分配 turn_id，user_text 截断 300）
  - assistant → `model_switch`（modelID 变化时，比对 lastTurn 记录的 model）+ step_finish 兜底（该 messageID 无 step_finish 事件才写）
- `session.idle` → `onIdle` 聚合 `trajectory_turns` upsert

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/gateway/trajectory-collector.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';
import { TrajectoryCollector } from '../../../gateway/src/trajectory/collector';

let dir: string;
let db: GatewayDatabase;
let store: TrajectoryStore;
let col: TrajectoryCollector;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-col-'));
  db = new GatewayDatabase(path.join(dir, 'gateway.db'));
  store = new TrajectoryStore(db, '/proj');
  col = new TrajectoryCollector(store, db, '/proj');
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('user message starts a turn; tool + step-finish parts accumulate; idle aggregates', () => {
  // user message → turn_start (turn 1)
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'u1', role: 'user', time: { created: 1000 }, model: { modelID: 'm1' }, agent: 'build' } });
  // tool part pending → tool_start
  col.handleEvent('message.part.updated', { sessionID: 's1', part: { sessionID: 's1', messageID: 'a1', type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'running', input: {}, time: { start: 1000 }, title: 'ls' } } });
  // tool completed → tool_end
  col.handleEvent('message.part.updated', { sessionID: 's1', part: { sessionID: 's1', messageID: 'a1', type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'completed', input: {}, output: 'file1', title: 'ls', metadata: {}, time: { start: 1000, end: 2500 } } } });
  // step-finish → step_finish
  col.handleEvent('message.part.updated', { sessionID: 's1', part: { sessionID: 's1', messageID: 'a1', type: 'step-finish', reason: 'stop', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } } } });
  // idle → turn_end + upsert
  const turn = col.onIdle('s1');
  expect(turn).not.toBeNull();
  expect(turn!.toolCount).toBe(1);
  expect(turn!.cost).toBe(0.05);
  expect(turn!.durationMs).not.toBeNull();

  const r = store.getSessionTrajectory('s1', { limit: 50 });
  const types = r.events.map(e => e.eventType);
  expect(types).toContain('turn_start');
  expect(types).toContain('tool_start');
  expect(types).toContain('tool_end');
  expect(types).toContain('step_finish');
  expect(r.events.find(e => e.eventType === 'tool_end')!.durationMs).toBe(1500);
  expect(r.turns[0].userText).toBe('hello');
});

test('step-finish dedup: message.updated assistant fallback does not double count', () => {
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'u1', role: 'user', time: { created: 1000 }, model: { modelID: 'm1' }, agent: 'build' } });
  // step-finish via part
  col.handleEvent('message.part.updated', { sessionID: 's1', part: { sessionID: 's1', messageID: 'a1', type: 'step-finish', reason: 'stop', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } } } });
  // assistant message.updated fallback (same messageID)
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'a1', role: 'assistant', parentID: 'u1', modelID: 'm1', providerID: 'p1', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } }, finish: 'stop', time: { created: 1000, completed: 2500 } } });
  const turn = col.onIdle('s1');
  expect(turn!.cost).toBe(0.05); // not 0.10

  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.events.filter(e => e.eventType === 'step_finish')).toHaveLength(1);
});

test('reasoning start/end by part id', () => {
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'u1', role: 'user', time: { created: 1000 }, model: { modelID: 'm1' }, agent: 'build' } });
  col.handleEvent('message.part.updated', { sessionID: 's1', part: { sessionID: 's1', messageID: 'a1', id: 'r1', type: 'reasoning', text: 'think...', time: { start: 1000 } } });
  col.handleEvent('message.part.updated', { sessionID: 's1', part: { sessionID: 's1', messageID: 'a1', id: 'r1', type: 'reasoning', text: 'think... done', time: { start: 1000, end: 3000 } } });
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  const rs = r.events.filter(e => e.eventType === 'reasoning_start');
  const re = r.events.filter(e => e.eventType === 'reasoning_end');
  expect(rs).toHaveLength(1);
  expect(re).toHaveLength(1);
  expect(re[0].durationMs).toBe(2000);
});

test('model_switch on assistant message when model changes', () => {
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'u1', role: 'user', time: { created: 1000 }, model: { modelID: 'm1' }, agent: 'build' } });
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'a1', role: 'assistant', parentID: 'u1', modelID: 'm2', providerID: 'p1', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, finish: 'stop', time: { created: 1000, completed: 2000 } } });
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.events.some(e => e.eventType === 'model_switch' && e.model === 'm2')).toBe(true);
});

test('session.idle without preceding turn uses currentTurnId fallback', () => {
  const turn = col.onIdle('s1');
  // no user message → no turn_start; onIdle returns null (no events to aggregate)
  expect(turn).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/unit/gateway/trajectory-collector.test.ts`
Expected: FAIL（collector 不存在）

- [ ] **Step 3: 实现 TrajectoryCollector**

`gateway/src/trajectory/collector.ts`:

```typescript
import { GatewayDatabase } from '../memory/gateway-db';
import { TrajectoryStore } from './trajectory-store';
import { TrajectoryEvent, TrajectoryTurn, TokenCounts, TrajectoryEventType } from './types';

const SUMMARY_MAX = 500;
const USER_TEXT_MAX = 300;

function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

interface TurnState {
  turnID: number;
  turnStartMs: number;
  toolCount: number;
  toolErrorCount: number;
  reasoningCount: number;
  agentSwitchCount: number;
  tokens: TokenCounts;
  cost: number;
  finish: string | null;
  model: string | null;
  agent: string | null;
  userText: string;
  userMessageID: string | null;
  stepFinishMessageIDs: Set<string>;
  toolCallIDs: Set<string>;
  reasoningPartIDs: Set<string>;
  lastModel: string | null;
}

export class TrajectoryCollector {
  private turns = new Map<string, TurnState>();
  private seqCounters = new Map<string, number>();

  constructor(
    private store: TrajectoryStore,
    private db: GatewayDatabase,
    private projectID: string,
  ) {}

  private seq(sessionID: string): number {
    const n = (this.seqCounters.get(sessionID) || 0) + 1;
    this.seqCounters.set(sessionID, n);
    return n;
  }

  private stateFor(sessionID: string, turnID?: number): TurnState {
    let s = this.turns.get(sessionID);
    if (!s) {
      s = {
        turnID: turnID ?? this.db.currentTurnId(sessionID) || 1,
        turnStartMs: Date.now(),
        toolCount: 0,
        toolErrorCount: 0,
        reasoningCount: 0,
        agentSwitchCount: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0,
        finish: null,
        model: null,
        agent: null,
        userText: '',
        userMessageID: null,
        stepFinishMessageIDs: new Set(),
        toolCallIDs: new Set(),
        reasoningPartIDs: new Set(),
        lastModel: null,
      };
      this.turns.set(sessionID, s);
    }
    return s;
  }

  private emit(sessionID: string, s: TurnState, eventType: TrajectoryEventType, extra: Partial<TrajectoryEvent> = {}): TrajectoryEvent {
    const evt: Omit<TrajectoryEvent, 'id'> = {
      projectID: this.projectID,
      sessionID,
      turnID: s.turnID,
      seq: this.seq(sessionID),
      eventType,
      timeMs: Date.now(),
      ...extra,
    };
    this.store.recordEvent(evt);
    this.store.pruneOlderThan(14); // TTL cleanup piggyback
    return evt as TrajectoryEvent;
  }

  handleEvent(type: string, props: any, directory?: string): TrajectoryEvent | null {
    const projectID = directory || this.projectID;
    if (projectID !== this.projectID) return null; // only own project (defensive)

    const sessionID = props?.info?.sessionID || props?.part?.sessionID || props?.sessionID;
    if (!sessionID) return null;

    // ── message.updated ──
    if (type === 'message.updated') {
      const info = props?.info;
      if (!info) return null;
      if (info.role === 'user') {
        const s = this.stateFor(sessionID, this.db.nextTurnId(sessionID));
        s.turnStartMs = info.time?.created || Date.now();
        s.userMessageID = info.id;
        s.userText = truncate(info?.summary?.body || '', USER_TEXT_MAX) || '';
        return this.emit(sessionID, s, 'turn_start');
      }
      if (info.role === 'assistant') {
        const s = this.stateFor(sessionID);
        // model switch: only when changed from previous assistant model
        if (info.modelID && s.lastModel && info.modelID !== s.lastModel) {
          s.agentSwitchCount++; // count model switches too
          const evt = this.emit(sessionID, s, 'model_switch', { model: info.modelID });
          s.lastModel = info.modelID;
          return evt;
        }
        s.lastModel = info.modelID || s.lastModel;
        s.model = info.modelID || s.model;
        // step_finish fallback (dedup by messageID)
        if (!s.stepFinishMessageIDs.has(info.id) && info.finish && info.tokens) {
          s.stepFinishMessageIDs.add(info.id);
          s.tokens = addTokens(s.tokens, info.tokens);
          s.cost += info.cost || 0;
          s.finish = info.finish;
          const evt = this.emit(sessionID, s, 'step_finish', {
            model: info.modelID,
            tokens: info.tokens,
            cost: info.cost,
            finish: info.finish,
          });
          return evt;
        }
        return null;
      }
      return null;
    }

    // ── message.part.updated ──
    if (type === 'message.part.updated') {
      const part = props?.part;
      if (!part) return null;
      const s = this.stateFor(sessionID);

      if (part.type === 'tool') {
        const st = part.state;
        if (!st) return null;
        if (st.status === 'running' || st.status === 'pending') {
          if (s.toolCallIDs.has(part.callID)) return null; // dedup
          s.toolCallIDs.add(part.callID);
          const evt = this.emit(sessionID, s, 'tool_start', {
            toolName: part.tool,
            callID: part.callID,
            inputSummary: truncate(summarizeInput(st.input), SUMMARY_MAX),
          });
          return evt;
        }
        if (st.status === 'completed' || st.status === 'error') {
          s.toolCount++;
          if (st.status === 'error') s.toolErrorCount++;
          const duration = st.time ? st.time.end - st.time.start : undefined;
          const evt = this.emit(sessionID, s, 'tool_end', {
            toolName: part.tool,
            callID: part.callID,
            toolState: st.status,
            outputSummary: truncate(st.output || st.error, SUMMARY_MAX),
            error: st.status === 'error' ? truncate(st.error, SUMMARY_MAX) : undefined,
            durationMs: duration,
          });
          return evt;
        }
        return null;
      }
      if (part.type === 'step-finish') {
        if (s.stepFinishMessageIDs.has(part.messageID)) return null; // dedup
        s.stepFinishMessageIDs.add(part.messageID);
        s.tokens = addTokens(s.tokens, part.tokens);
        s.cost += part.cost || 0;
        s.finish = part.reason;
        const evt = this.emit(sessionID, s, 'step_finish', {
          tokens: part.tokens,
          cost: part.cost,
          finish: part.reason,
        });
        return evt;
      }

      if (part.type === 'reasoning') {
        if (!s.reasoningPartIDs.has(part.id)) {
          s.reasoningPartIDs.add(part.id);
          s.reasoningCount++;
          const evt = this.emit(sessionID, s, 'reasoning_start');
          // If end time already present, emit end immediately
          if (part.time?.end) {
            const end = this.emit(sessionID, s, 'reasoning_end', {
              durationMs: part.time.end - (part.time.start || part.time.end),
            });
            return end;
          }
          return evt;
        } else {
          // end sighting
          const evt = this.emit(sessionID, s, 'reasoning_end', {
            durationMs: part.time?.end ? part.time.end - (part.time.start || part.time.end) : undefined,
          });
          return evt;
        }
      }

      return null;
    }

      if (part.type === 'text' && part.text && s.userMessageID === part.messageID) {
        // user message text arrives as text parts on the user message
        if (!s.userText) {
          s.userText = truncate(part.text, USER_TEXT_MAX) || '';
        }
        return null;
      }

      return null;
    }

  onIdle(sessionID: string): TrajectoryTurn | null {
    const s = this.turns.get(sessionID);
    if (!s) return null;
    s.finish = s.finish || 'idle';
    const turn: TrajectoryTurn = {
      projectID: this.projectID,
      sessionID,
      turnID: s.turnID,
      turnStartMs: s.turnStartMs,
      turnEndMs: Date.now(),
      durationMs: Date.now() - s.turnStartMs,
      toolCount: s.toolCount,
      toolErrorCount: s.toolErrorCount,
      reasoningCount: s.reasoningCount,
      agentSwitchCount: s.agentSwitchCount,
      tokens: s.tokens,
      cost: s.cost,
      finish: s.finish,
      model: s.model,
      agent: s.agent,
      userText: s.userText,
    };
    this.store.upsertTurn(turn);
    this.emit(sessionID, s, 'turn_end');
    this.turns.delete(sessionID);
    return turn;
  }
}

function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cache: { read: a.cache.read + b.cache.read, write: a.cache.write + b.cache.write },
  };
}

function summarizeInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  try {
    const s = JSON.stringify(input);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/unit/gateway/trajectory-collector.test.ts`
Expected: PASS（5 个测试）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/trajectory/collector.ts tests/unit/gateway/trajectory-collector.test.ts
git commit -m "feat(gateway): trajectory event collector with turn aggregation"
```

---

### Task 3: 网关 — handleOpencodeEvent 接线 + broadcast trajectory.event

**Files:**
- Modify: `gateway/src/index.ts`（初始化、hook 点、broadcast、session 删除联动）

**Interfaces:**
- Consumes: `TrajectoryCollector`（Task 2）
- Produces: 网关启动时构造 collector；`handleOpencodeEvent` 内调 `collector.handleEvent(type, props, evt?.directory)` → 返回值非空则 `broadcast({ type: 'opencode_event', data: { type: 'trajectory.event', properties: ret, sessionID } })`；`session.idle` 分支调 `collector.onIdle(sessionID)` 后广播 turn；`DELETE /api/session/{id}` 调 `store.deleteSession`

- [ ] **Step 1: 初始化**

在 `gateway/src/index.ts` `initServices()`（line ~1169 之后）加：

```typescript
    // Trajectory tracking (agent trajectory stats + desktop sidebar)
    const trajDb = this.getGatewayDb();
    const trajStore = new (await import('./trajectory/trajectory-store')).TrajectoryStore(trajDb, projectDir);
    this.trajectoryStore = trajStore;
    this.trajectoryCollector = new (await import('./trajectory/collector')).TrajectoryCollector(trajStore, trajDb, projectDir);
```

在类字段区（`gatewayDbInstance` 附近）加：

```typescript
  private trajectoryStore: import('./trajectory/trajectory-store').TrajectoryStore | null = null;
  private trajectoryCollector: import('./trajectory/collector').TrajectoryCollector | null = null;
```

（注意：如果 index.ts 是同步加载模块，可直接顶部 import；若动态 import 更符合现有模式则用上面的形式。项目已有 `(await import(...))` 先例则沿用。）

- [ ] **Step 2: hook 点接线（handleOpencodeEvent）**

在 `gateway/src/index.ts` `handleOpencodeEvent`（line ~663）中，stepProps 处理**之前**插入：

```typescript
    // Path T: trajectory accumulation — writes SQLite + broadcasts trajectory.event
    try {
      const collector = this.trajectoryCollector;
      if (collector) {
        const trajEvt = collector.handleEvent(type, props, evt?.directory);
        if (trajEvt) {
          this.broadcast({ type: 'opencode_event', data: { type: 'trajectory.event', properties: trajEvt, sessionID } });
        }
      }
    } catch (err: any) {
      log.warn(`[Trajectory] handle failed (non-fatal): ${err.message}`);
    }
```

在 `session.idle` 分支（line ~722）内、`drainStepInjections` 之后加：

```typescript
      try {
        if (this.trajectoryCollector) {
          const turn = this.trajectoryCollector.onIdle(sessionID);
          if (turn) {
            this.broadcast({ type: 'opencode_event', data: { type: 'trajectory.turn', properties: turn, sessionID } });
          }
        }
      } catch (err: any) {
        log.warn(`[Trajectory] idle aggregation failed (non-fatal): ${err.message}`);
      }
```

- [ ] **Step 3: 会话删除联动**

在 `DELETE /api/session/{id}` 分支（line ~3003）内、`await this.sdkSession.delete(sessionID);` 之后加：

```typescript
            try { this.trajectoryStore?.deleteSession(sessionID); } catch (err: any) { log.warn(`[Trajectory] delete failed: ${err.message}`); }
```

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit -p gateway/tsconfig.json`（或项目现有 typecheck 命令）
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add gateway/src/index.ts
git commit -m "feat(gateway): wire trajectory collector into event stream + broadcast"
```

---

### Task 4: 网关 — GET /api/sessions/{id}/trajectory API（含 rebuild）

**Files:**
- Create: `gateway/src/trajectory/api.ts`（端点处理函数）
- Modify: `gateway/src/index.ts`（挂路由 + rebuild 调用 SDK messages）
- Test: `tests/unit/gateway/trajectory-api.test.ts`

**Interfaces:**
- Consumes: `TrajectoryStore.getSessionTrajectory()`、`opencodeClient.session.messages()`
- Produces: 路由 `GET /api/sessions/{id}/trajectory?limit=50&before_turn=123&rebuild=1` → `{ turns, events }`；rebuild 用 messages 的 `info.parts` 重建 tool/step-finish/reasoning

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/gateway/trajectory-api.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';
import { handleTrajectoryRequest } from '../../../gateway/src/trajectory/api';

let dir: string; let db: GatewayDatabase; let store: TrajectoryStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-api-'));
  db = new GatewayDatabase(path.join(dir, 'gateway.db'));
  store = new TrajectoryStore(db, '/proj');
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function req(url: string, messagesMock?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const q = new URL(url, 'http://localhost').searchParams;
    const opts = { limit: Number(q.get('limit') || 50), beforeTurn: q.get('before_turn') ? Number(q.get('before_turn')) : undefined, rebuild: q.get('rebuild') === '1' };
    handleTrajectoryRequest({ store, url: q, opts, messages: messagesMock })
      .then((result: any) => resolve({ status: 200, body: result }))
      .catch((err: any) => resolve({ status: 500, body: { error: err.message } }));
  });
}

test('empty session returns empty arrays (fail-open)', async () => {
  const r = await req('/api/sessions/s1/trajectory');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ turns: [], events: [] });
});

test('rebuild=1 reconstructs tool + step-finish events from messages', async () => {
  const messagesMock = {
    data: [
      { id: 'u1', info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 }, agent: 'build', model: { modelID: 'm1' } }, parts: [{ id: 't1', type: 'text', text: 'hello' }] },
      { id: 'a1', info: { id: 'a1', sessionID: 's1', role: 'assistant', parentID: 'u1', modelID: 'm1', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } }, finish: 'stop' }, parts: [
        { id: 'p1', messageID: 'a1', type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'completed', input: {}, output: 'out', title: 'ls', metadata: {}, time: { start: 1000, end: 2500 } } },
        { id: 'p2', messageID: 'a1', type: 'step-finish', reason: 'stop', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } } },
      ]},
    ],
  };
  const r = await req('/api/sessions/s1/trajectory?rebuild=1', messagesMock);
  expect(r.status).toBe(200);
  expect(r.body.turns).toHaveLength(1);
  const types = r.body.events.map((e: any) => e.eventType);
  expect(types).toContain('tool_start');
  expect(types).toContain('tool_end');
  expect(types).toContain('step_finish');
  const toolEnd = r.body.events.find((e: any) => e.eventType === 'tool_end');
  expect(toolEnd.durationMs).toBe(1500);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/unit/gateway/trajectory-api.test.ts`
Expected: FAIL（api.ts 不存在）

- [ ] **Step 3: 实现 api.ts**

`gateway/src/trajectory/api.ts`:

```typescript
import { TrajectoryStore } from './trajectory-store';
import { TrajectoryEvent, TrajectoryTurn, TokenCounts } from './types';

export interface TrajectoryRequestContext {
  store: TrajectoryStore;
  url: URL;
  opts: { limit: number; beforeTurn?: number; rebuild?: boolean };
  messages?: any; // { data: Array<{ id, info, parts }> } — from opencodeClient.session.messages
  projectID?: string;
}

export async function handleTrajectoryRequest(ctx: TrajectoryRequestContext): Promise<{ turns: TrajectoryTurn[]; events: TrajectoryEvent[] }> {
  const { store, opts } = ctx;
  let { turns, events } = store.getSessionTrajectory(ctx.sessionID, { limit: opts.limit, beforeTurn: opts.beforeTurn });
  if (opts.rebuild && turns.length === 0 && events.length === 0 && ctx.messages) {
    return rebuildFromMessages(store, ctx.sessionID, ctx.messages.data || [], ctx.projectID || '/proj');
  }
  return { turns, events };
}

function rebuildFromMessages(store: TrajectoryStore, sessionID: string, messages: any[], projectID: string): { turns: TrajectoryTurn[]; events: TrajectoryEvent[] } {
  const turns: TrajectoryTurn[] = [];
  const events: TrajectoryEvent[] = [];
  let seq = 0;
  const emit = (partial: Partial<TrajectoryEvent>): void => {
    seq++;
    events.push({ projectID, sessionID, turnID: 0, seq, timeMs: Date.now(), ...partial } as TrajectoryEvent);
  };

  const userMessages = messages.filter((m: any) => m?.info?.role === 'user');
  userMessages.forEach((um: any, idx: number) => {
    const turnID = idx + 1;
    const s = um.info;
    const startMs = s?.time?.created || Date.now();
    emit({ turnID, eventType: 'turn_start', timeMs: startMs });
    const assistant = messages.find((m: any) => m?.info?.role === 'assistant' && m?.info?.parentID === um.id);
    if (!assistant) return;
    const ai = assistant.info;
    const parts = assistant.parts || [];
    let toolCount = 0, toolErrorCount = 0, reasoningCount = 0, agentSwitchCount = 0;
    const tokens: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    let cost = 0, finish: string | null = null, model: string | null = ai?.modelID || null, agent: string | null = s?.agent || null;

    for (const p of parts) {
      if (p?.type === 'tool') {
        const st = p.state;
        emit({ turnID, eventType: 'tool_start', toolName: p.tool, callID: p.callID, timeMs: st?.time?.start || startMs, inputSummary: summarize(st?.input) });
        if (st?.status === 'completed' || st?.status === 'error') {
          toolCount++;
          if (st.status === 'error') toolErrorCount++;
          emit({ turnID, eventType: 'tool_end', toolName: p.tool, callID: p.callID, toolState: st.status, outputSummary: truncate(st.output || st.error, 500), error: st.status === 'error' ? truncate(st.error, 500) : undefined, durationMs: st.time ? st.time.end - st.time.start : undefined, timeMs: st.time?.end || startMs });
        }
      } else if (p?.type === 'step-finish') {
        emit({ turnID, eventType: 'step_finish', tokens: p.tokens, cost: p.cost, finish: p.reason, timeMs: startMs });
        tokens.input += p.tokens?.input || 0; tokens.output += p.tokens?.output || 0;
        tokens.reasoning += p.tokens?.reasoning || 0;
        tokens.cache.read += p.tokens?.cache?.read || 0; tokens.cache.write += p.tokens?.cache?.write || 0;
        cost += p.cost || 0; finish = p.reason;
      } else if (p?.type === 'reasoning') {
        reasoningCount++;
        emit({ turnID, eventType: 'reasoning_start', timeMs: p.time?.start || startMs });
        emit({ turnID, eventType: 'reasoning_end', durationMs: p.time?.end ? p.time.end - (p.time.start || p.time.end) : undefined, timeMs: p.time?.end || startMs });
      }
    }
    turns.push({
      projectID, sessionID, turnID, turnStartMs: startMs, turnEndMs: ai?.time?.completed || null,
      durationMs: ai?.time?.completed ? ai.time.completed - startMs : null,
      toolCount, toolErrorCount, reasoningCount, agentSwitchCount,
      tokens, cost, finish, model, agent,
      userText: summarize(s?.summary?.body || s?.agent || ''),
    });
  });

  if (turns.length > 0) {
    for (const t of turns) store.upsertTurn(t);
    for (const e of events) store.recordEvent(e);
  }
  return { turns, events };
}

function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function summarize(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return truncate(s, 500);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/unit/gateway/trajectory-api.test.ts`
Expected: PASS（2 个测试）

- [ ] **Step 5: 挂路由到 index.ts**

在 `GET /api/sessions/{id}/todo` 分支（line ~3104）之后加：

```typescript
        // GET /api/sessions/{id}/trajectory —agent trajectory timeline (task/desktop)
        const trajectoryMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/trajectory(?:\?|$)/);
        if (trajectoryMatch && req.method === 'GET') {
          const id = trajectoryMatch[1];
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '50', 10), 200);
            const beforeTurn = parsedUrl.searchParams.get('before_turn') ? Number(parsedUrl.searchParams.get('before_turn')) : undefined;
            const rebuild = parsedUrl.searchParams.get('rebuild') === '1';
            const store = this.trajectoryStore;
            if (!store) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ turns: [], events: [] }));
              return;
            }
            const { handleTrajectoryRequest } = await import('./trajectory/api');
            let messages: any = null;
            if (rebuild) {
              const result = await this.opencodeClient?.session.messages({ path: { id }, query: { limit: 200 } });
              messages = { data: Array.isArray(result?.data) ? result.data : [] };
            }
            const result = await handleTrajectoryRequest({
              store,
              url: parsedUrl,
              opts: { limit, beforeTurn, rebuild },
              messages,
              projectID: this.projectDir || '.',
              sessionID: id,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            log.warn(`[Trajectory] fetch failed (non-fatal): ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ turns: [], events: [] }));
          }
          return;
        }
```

注意：`handleTrajectoryRequest` 需要 `sessionID` 字段——更新 api.ts 的 `TrajectoryRequestContext` 加 `sessionID: string`。

- [ ] **Step 6: 验证编译**

Run: `npx tsc --noEmit -p gateway/tsconfig.json`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add gateway/src/trajectory/api.ts gateway/src/index.ts tests/unit/gateway/trajectory-api.test.ts
git commit -m "feat(gateway): trajectory API endpoint with rebuild support"
```

---

### Task 5: SDK — MafwClient.trajectory + 类型

**Files:**
- Modify: `opencode-dev/packages/gateway-sdk/src/types.ts`（加 TrajectoryTurn/Event + SessionNamespace.trajectory）
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts`（加 session.trajectory 方法）

- [ ] **Step 1: types.ts 加类型**

在 `types.ts` `Todo` 接口后加：

```typescript
export interface TrajectoryTokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface TrajectoryTurn {
  turnID: number
  turnStartMs: number
  turnEndMs: number | null
  durationMs: number | null
  toolCount: number
  toolErrorCount: number
  reasoningCount: number
  agentSwitchCount: number
  tokens: TrajectoryTokens
  cost: number
  finish: string | null
  model: string | null
  agent: string | null
  userText: string
}

export interface TrajectoryEvent {
  seq: number
  turnID: number
  eventType: string
  toolName?: string
  callID?: string
  toolState?: 'running' | 'completed' | 'error'
  agent?: string
  model?: string
  inputSummary?: string
  outputSummary?: string
  error?: string
  tokens?: TrajectoryTokens
  cost?: number
  finish?: string
  timeMs: number
  durationMs?: number
}

export interface TrajectoryResponse {
  turns: TrajectoryTurn[]
  events: TrajectoryEvent[]
}
```

在 `SessionNamespace` 接口加：

```typescript
  trajectory(params: { path: { id: string }; query?: { limit?: number; before_turn?: number; rebuild?: boolean } }): Promise<TrajectoryResponse>
```

- [ ] **Step 2: client.ts 加方法**

在 `session.messages` 后加：

```typescript
    trajectory: async (
      params: { path: { id: string }; query?: { limit?: number; before_turn?: number; rebuild?: boolean } },
    ): Promise<TrajectoryResponse> => {
      const q = new URLSearchParams()
      if (params.query?.limit) q.set('limit', String(params.query.limit))
      if (params.query?.before_turn) q.set('before_turn', String(params.query.before_turn))
      if (params.query?.rebuild) q.set('rebuild', '1')
      const data = await this.request<{ turns: TrajectoryTurn[]; events: TrajectoryEvent[] }>(`/api/sessions/${params.path.id}/trajectory?${q}`)
      return { turns: data.turns || [], events: data.events || [] }
    },
```

- [ ] **Step 3: 编译检查**

Run: `cd opencode-dev/packages/gateway-sdk && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add opencode-dev/packages/gateway-sdk/src/types.ts opencode-dev/packages/gateway-sdk/src/client.ts
git commit -m "feat(sdk): add sessions.trajectory API to MafwClient"
```

---

### Task 6: 桌面 — IPC + preload 通道

**Files:**
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts`（加 `trajectory` 到 sessions）
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts`（加 invoke）
- Modify: `opencode-dev/packages/desktop/src/main/mafw-ipc.ts`（无需改——`mafw-invoke` 已通用派发到 MafwClient namespace；但确认 `@mafw/sdk` 类型导出）

- [ ] **Step 1: mafw-types.ts 加方法**

在 `sessions` 接口加：

```typescript
      trajectory: (sessionID: string, query?: { limit?: number; before_turn?: number; rebuild?: boolean }) => Promise<import('@mafw/sdk').TrajectoryResponse>
```

- [ ] **Step 2: mafw-api.ts 加方法**

在 `sessions` 对象加：

```typescript
      trajectory: (sessionID, query?) => invoke("session", "trajectory", { path: { id: sessionID }, query: query || {} }),
```

- [ ] **Step 3: 验证 desktop 构建**

Run: `cd opencode-dev/packages/desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add opencode-dev/packages/desktop/src/preload/mafw-types.ts opencode-dev/packages/desktop/src/preload/mafw-api.ts
git commit -m "feat(desktop): expose sessions.trajectory via IPC preload"
```

---

### Task 7: 桌面 — 统一 RightDock（任务/轨迹双 tab）

**Files:**
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/components/RightDock.tsx`
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/components/TrajectoryDock.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`（state、渲染、Ctrl+T、窄视口降级）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（titlebar 双按钮）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`（样式）

**Interfaces:**
- Consumes: `window.api.mafw.sessions.trajectory()`（Task 6）、现有 `store.message/part`（MafwShell 内）、`TaskList`（现有组件）
- Produces: `RightDock`（props: `open, tab, width, onClose, onTab, children`）；`TrajectoryDock`（props: `sessionID, store, gatewayUrl`）；MafwShell 新 state `rightDockOpen` / `rightDockTab` / `rightDockWidth`（localStorage: `mafw-right-dock-open` / `mafw-right-dock-tab` / `mafw-right-dock-width`）

- [ ] **Step 1: 写 RightDock 容器**

```tsx
// opencode-dev/packages/desktop/src/renderer/mafw/components/RightDock.tsx
// @ts-nocheck
import { Show, splitProps } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

export function RightDock(props: {
  open: boolean
  tab: "tasks" | "trajectory"
  width: number
  onClose: () => void
  onTab: (tab: "tasks" | "trajectory") => void
  children: any
}) {
  return (
    <Show when={props.open}>
      <div class="mafw-right-dock" style={{ width: `${props.width}px` }}>
        <div class="mafw-right-dock-tabs">
          <ButtonV2
            variant={props.tab === "tasks" ? "contrast" : "ghost"}
            size="small"
            class="mafw-right-dock-tab"
            onClick={() => props.onTab("tasks")}
            aria-label="任务列表"
          >
            📋 任务
          </ButtonV2>
          <ButtonV2
            variant={props.tab === "trajectory" ? "contrast" : "ghost"}
            size="small"
            class="mafw-right-dock-tab"
            onClick={() => props.onTab("trajectory")}
            aria-label="轨迹时间线"
          >
            📊 轨迹
          </ButtonV2>
          <div class="mafw-right-dock-spacer" />
          <TooltipV2 value="关闭面板" openDelay={300}>
            <ButtonV2 variant="ghost" size="small" class="mafw-right-dock-close" onClick={props.onClose} aria-label="关闭面板">✕</ButtonV2>
          </TooltipV2>
        </div>
        <div class="mafw-right-dock-body">{props.children}</div>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: 写 TrajectoryDock**

```tsx
// opencode-dev/packages/desktop/src/renderer/mafw/components/TrajectoryDock.tsx
// @ts-nocheck
import { createEffect, createMemo, createSignal, createStore, For, Show, onCleanup } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

const fmtDur = (ms?: number | null): string => {
  if (!ms || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}
const fmtTokens = (n: number): string =>
  n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
const fmtCost = (c: number): string => `$${c.toFixed(4)}`

export function TrajectoryDock(props: {
  sessionID: string
  gatewayUrl: string
  onEvent: (e: any) => void   // for SSE trajectory.event injection
}) {
  const [state, setState] = createStore<{
    turns: any[]
    events: any[]
    expanded: Record<number, boolean>
    error: string | null
    loading: boolean
  }>({ turns: [], events: [], expanded: {}, error: null, loading: false })

  let loadedFor = ""
  const load = async (rebuild = false) => {
    if (!props.sessionID) return
    setState("loading", true)
    try {
      const r = await window.api.mafw.sessions.trajectory(props.sessionID, { limit: 50, rebuild })
      setState("turns", r.turns || [])
      setState("events", r.events || [])
      setState("error", null)
    } catch (e: any) {
      setState("error", e?.message || "加载失败")
    } finally {
      setState("loading", false)
    }
  }

  createEffect(() => {
    const sid = props.sessionID
    if (!sid) return
    if (loadedFor !== sid) { loadedFor = sid; void load() }
  })

  const toggleTurn = (id: number) => setState("expanded", id, (v) => !v)

  const eventsForTurn = (turnID: number) => state.events.filter((e) => e.turnID === turnID)

  const totalTools = () => state.turns.reduce((a, t) => a + t.toolCount, 0)
  const totalCost = () => state.turns.reduce((a, t) => a + t.cost, 0)

  return (
    <div class="mafw-trajectory-dock">
      <div class="mafw-trajectory-summary">
        <span>回合 {state.turns.length}</span>
        <span>工具 {totalTools()}</span>
        <span>成本 {fmtCost(totalCost())}</span>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" class="mafw-trajectory-refresh" onClick={() => void load(true)} aria-label="刷新">⟳</ButtonV2>
        </TooltipV2>
      </div>
      <Show when={state.error}>
        <div class="mafw-trajectory-error">{state.error}</div>
        <ButtonV2 variant="outline" size="small" onClick={() => void load()}>重试</ButtonV2>
      </Show>
      <Show when={!state.error && state.turns.length === 0 && !state.loading}>
        <div class="mafw-trajectory-empty">暂无轨迹数据<br />发送消息后此处显示 agent 轨迹</div>
      </Show>
      <div class="mafw-trajectory-list">
        <For each={state.turns}>
          {(t) => (
            <div class="mafw-trajectory-turn" classList={{ open: !!state.expanded[t.turnID] }}>
              <button type="button" class="mafw-trajectory-turn-head" onClick={() => toggleTurn(t.turnID)}>
                <span class="mafw-trajectory-turn-user">{t.userText || `回合 ${t.turnID}`}</span>
                <span class="mafw-trajectory-turn-kpis">
                  <span>{t.toolCount} 工具</span>
                  <span>{fmtDur(t.durationMs)}</span>
                  <span>{fmtTokens(t.tokens.input + t.tokens.output)} tok</span>
                  <span>{fmtCost(t.cost)}</span>
                </span>
                <Show when={t.finish === 'tool-calls' || t.finish === 'length'}>
                  <span class="mafw-trajectory-finish-badge">{t.finish}</span>
                </Show>
              </button>
              <Show when={state.expanded[t.turnID]}>
                <div class="mafw-trajectory-events">
                  <For each={eventsForTurn(t.turnID)}>
                    {(e) => (
                      <div class={`mafw-trajectory-event mafw-trajectory-${e.eventType}`}>
                        <span class="mafw-trajectory-event-icon">
                          {e.eventType === 'tool_start' && '⟳'}
                          {e.eventType === 'tool_end' && (e.toolState === 'error' ? '✗' : '✓')}
                          {e.eventType === 'reasoning_start' && '🧠'}
                          {e.eventType === 'reasoning_end' && '🧠'}
                          {e.eventType === 'model_switch' && '⇄'}
                          {e.eventType === 'agent_switch' && '⇄'}
                          {e.eventType === 'step_finish' && 'Σ'}
                        </span>
                        <span class="mafw-trajectory-event-main">
                          <Show when={e.toolName}>
                            <span class="mafw-trajectory-tool-name">{e.toolName}</span>
                          </Show>
                          <Show when={e.model}>
                            <span class="mafw-trajectory-model">{e.model}</span>
                          </Show>
                          <Show when={e.agent}>
                            <span class="mafw-trajectory-agent">Agent: {e.agent}</span>
                          </Show>
                          <Show when={e.outputSummary || e.error}>
                            <span class="mafw-trajectory-output">{e.error || e.outputSummary}</span>
                          </Show>
                          <Show when={e.cost !== undefined}>
                            <span class="mafw-trajectory-tokens">{fmtTokens(e.tokens?.input || 0)}/{fmtTokens(e.tokens?.output || 0)} tok · {fmtCost(e.cost)}</span>
                          </Show>
                        </span>
                        <Show when={e.durationMs !== undefined}>
                          <span class="mafw-trajectory-duration">{fmtDur(e.durationMs)}</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: MafwShell state + 渲染 + Ctrl+T**

在 `MafwShell.tsx` 加 state（`taskListOpen` 附近）：

```typescript
  const [rightDockOpen, setRightDockOpen] = createSignal(localStorage.getItem("mafw-right-dock-open") === "1")
  const [rightDockTab, setRightDockTab] = createSignal<"tasks" | "trajectory">(
    (localStorage.getItem("mafw-right-dock-tab") as "tasks" | "trajectory") || "tasks"
  )
  const [rightDockWidth, setRightDockWidth] = createSignal(Number(localStorage.getItem("mafw-right-dock-width")) || 320)

  const applyRightDock = (open: boolean, tab?: "tasks" | "trajectory") => {
    setRightDockOpen(open)
    if (tab) setRightDockTab(tab)
    try { localStorage.setItem("mafw-right-dock-open", open ? "1" : "0") } catch {}
    if (tab) { try { localStorage.setItem("mafw-right-dock-tab", tab) } catch {} }
  }
  const applyRightDockWidth = (w: number) => {
    setRightDockWidth(w)
    try { localStorage.setItem("mafw-right-dock-width", String(w)) } catch {}
  }
```

Ctrl+T 快捷键（`Ctrl+J` effect 附近）：

```typescript
  // Ctrl/Cmd+T: toggle right dock (trajectory/tasks tabs). Skip when typing.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "t") return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      e.preventDefault()
      setRightDockOpen(o => !o)
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })
```

渲染（TaskList dock 区之后、`</div>` 前，`mafw-chat-panes` 同级）：

```tsx
                <RightDock
                  open={rightDockOpen()}
                  tab={rightDockTab()}
                  width={rightDockWidth()}
                  onClose={() => applyRightDock(false)}
                  onTab={(t) => { applyRightDock(true, t) }}
                >
                  <Show when={rightDockTab() === "tasks"} fallback={
                    <TrajectoryDock sessionID={currentSessionID()} gatewayUrl={gatewayUrl()} onEvent={() => {}} />
                  }>
                    <TaskList
                      todos={todos[currentSessionID()] || []}
                      tokens={taskMetrics(currentSessionID()).tokens}
                      started={taskMetrics(currentSessionID()).started}
                      placement="dock"
                      onClose={() => applyRightDock(false)}
                      onPin={() => applyRightDock(false)}
                    />
                  </Show>
                </RightDock>
```

注意：现有 `tasksPlacement === "dock"` 分支（line ~1832）要移除，改由 RightDock 的 tasks tab 承担（`tasksPlacement` 的 bar 态保留）。

- [ ] **Step 4: ChatPane titlebar 双按钮**

在 `ChatPane.tsx` titlebar（`TaskBar` 之后、`Show when={props.todos...}` 之前）加：

```tsx
              <TooltipV2 value="任务列表" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-rightdock-btn" onClick={e => { e.stopPropagation(); props.onOpenRightDock("tasks") }} aria-label="任务列表">📋</ButtonV2>
              </TooltipV2>
              <TooltipV2 value="轨迹时间线" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-rightdock-btn" onClick={e => { e.stopPropagation(); props.onOpenRightDock("trajectory") }} aria-label="轨迹时间线">📊</ButtonV2>
              </TooltipV2>
```

ChatPane props 加：

```typescript
  onOpenRightDock: (tab: "tasks" | "trajectory") => void
```

MafwShell 传：

```tsx
                  onOpenRightDock={(tab) => applyRightDock(true, tab)}
```

- [ ] **Step 5: mafw.css 样式**

在 `mafw.css` 加：

```css
/* ── Right dock (unified tasks/trajectory) ── */
.mafw-right-dock {
  position: fixed; top: 38px; right: 0; bottom: 0;
  background: var(--bg-base);
  border-left: 1px solid var(--border-subtle);
  z-index: 70;
  display: flex; flex-direction: column;
  box-shadow: -4px 0 16px rgba(0,0,0,0.06);
}
.mafw-right-dock-tabs {
  display: flex; align-items: center; gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex: none;
}
.mafw-right-dock-tab { font-size: 12px; }
.mafw-right-dock-spacer { flex: 1; }
.mafw-right-dock-body { flex: 1; overflow-y: auto; min-height: 0; }
.mafw-trajectory-dock { height: 100%; display: flex; flex-direction: column; }
.mafw-trajectory-summary {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; font-size: 12px;
  color: var(--text-subtle);
  font-variant-numeric: tabular-nums;
  border-bottom: 1px solid var(--border-subtle);
}
.mafw-trajectory-empty { padding: 40px 16px; text-align: center; color: var(--text-subtle); font-size: 13px; line-height: 1.8; }
.mafw-trajectory-error { padding: 12px; color: var(--text-error, #e5484d); font-size: 12px; }
.mafw-trajectory-list { flex: 1; overflow-y: auto; padding: 6px; }
.mafw-trajectory-turn { border-bottom: 1px solid var(--border-subtle); }
.mafw-trajectory-turn-head {
  width: 100%; background: none; border: none; cursor: pointer;
  padding: 8px 10px; text-align: left;
  display: flex; flex-direction: column; gap: 4px;
}
.mafw-trajectory-turn-user { font-size: 12px; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mafw-trajectory-turn-kpis { display: flex; gap: 8px; font-size: 11px; color: var(--text-subtle); font-variant-numeric: tabular-nums; }
.mafw-trajectory-finish-badge { font-size: 10px; color: #f59e0b; border: 1px solid #f59e0b55; border-radius: 4px; padding: 0 4px; width: fit-content; }
.mafw-trajectory-events { padding: 0 10px 8px; }
.mafw-trajectory-event { display: flex; align-items: flex-start; gap: 6px; padding: 3px 0; font-size: 12px; }
.mafw-trajectory-event-icon { flex: none; width: 16px; text-align: center; color: var(--text-subtle); }
.mafw-trajectory-event-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mafw-trajectory-tool-name { font-weight: 500; color: var(--text-strong); }
.mafw-trajectory-model, .mafw-trajectory-agent { font-size: 11px; color: var(--text-subtle); }
.mafw-trajectory-output { font-size: 11px; color: var(--text-subtle); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.mafw-trajectory-tokens { font-size: 11px; color: var(--text-subtle); font-variant-numeric: tabular-nums; }
.mafw-trajectory-duration { flex: none; font-size: 11px; color: var(--text-subtle); font-variant-numeric: tabular-nums; }
.mafw-trajectory-turn.open .mafw-trajectory-turn-user { white-space: normal; }
```

- [ ] **Step 6: 构建验证**

Run: `cd opencode-dev/packages/desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw
git commit -m "feat(desktop): unified right dock with tasks/trajectory tabs"
```

---

### Task 8: 桌面 — SSE 实时 upsert trajectory.event

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`（EventSource onmessage 加分支）

**Interfaces:**
- Consumes: `TrajectoryDock`（Task 7）
- Produces: `trajectoryLive` signal（`Record<sessionID, TrajectoryEvent[]>`）+ `trajectoryTurnLive` signal；SSE 分支把 `trajectory.event`/`trajectory.turn` 按 sessionID 存，TrajectoryDock 消费

- [ ] **Step 1: 加 signal**

```typescript
  const [trajectoryLive, setTrajectoryLive] = createSignal<Record<string, any[]>>({})
  const [trajectoryTurnLive, setTrajectoryTurnLive] = createSignal<Record<string, any>>({})
```

- [ ] **Step 2: SSE onmessage 分支**

在 `es.onmessage`（MafwShell ~line 913）处理链加（在 `message.part.updated` 分支之前）：

```typescript
      if (event.type === "trajectory.event") {
        const sid = event.sessionID || event.properties?.sessionID
        if (!sid) return
        const prev = trajectoryLive()[sid] || []
        const evt = event.properties
        // dedup by (turnID, seq)
        if (!prev.some((e) => e.turnID === evt.turnID && e.seq === evt.seq)) {
          setTrajectoryLive({ ...trajectoryLive(), [sid]: [...prev, evt] })
        }
        return
      }
      if (event.type === "trajectory.turn") {
        const sid = event.sessionID || event.properties?.sessionID
        if (!sid) return
        setTrajectoryTurnLive({ ...trajectoryTurnLive(), [sid]: event.properties })
        return
      }
```

注意：`es.onmessage` 现有代码可能用了 `raw.data` JSON 解析后变量名不同，需按现有命名适配（`event.type` / `event.properties` / `event.sessionID`）。

- [ ] **Step 3: TrajectoryDock 接收 live 数据**

把 live signals 传入 TrajectoryDock，Dock 内 `createEffect` 合并：

```tsx
// in TrajectoryDock props add:
//   liveEvents?: any[]
//   liveTurn?: any | null
//   sessionID: string
createEffect(() => {
  const sid = props.sessionID
  if (!sid || !props.liveEvents) return
  const live = props.liveEvents.filter((e) => e.sessionID === sid)
  if (live.length === 0) return
  setState("events", (prev) => {
    const seen = new Set(prev.map((e) => `${e.turnID}:${e.seq}`))
    const merged = [...prev]
    for (const e of live) {
      if (!seen.has(`${e.turnID}:${e.seq}`)) { merged.push(e); seen.add(`${e.turnID}:${e.seq}`) }
    }
    return merged.sort((a, b) => a.turnID - b.turnID || a.seq - b.seq)
  })
})
createEffect(() => {
  const t = props.liveTurn
  if (!t) return
  setState("turns", (prev) => {
    const idx = prev.findIndex((x) => x.turnID === t.turnID)
    if (idx >= 0) return [...prev.slice(0, idx), t, ...prev.slice(idx + 1)]
    return [...prev, t].sort((a, b) => b.turnID - a.turnID)
  })
})
```

MafwShell 传：

```tsx
                    <TrajectoryDock
                      sessionID={currentSessionID()}
                      gatewayUrl={gatewayUrl()}
                      liveEvents={trajectoryLive()[currentSessionID()] || []}
                      liveTurn={trajectoryTurnLive()[currentSessionID()] || null}
                      onEvent={() => {}}
                    />
```

- [ ] **Step 4: 构建验证**

Run: `cd opencode-dev/packages/desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx opencode-dev/packages/desktop/src/renderer/mafw/components/TrajectoryDock.tsx
git commit -m "feat(desktop): live trajectory events via SSE upsert"
```

---

### Task 9: 手动验证 + 文档

**Files:**
- Modify: `README.md`（可选，加轨迹功能说明）

- [ ] **Step 1: 端到端手动验证**

```bash
# 1. 构建
npm run build
# 2. 启动 gateway
mafw start
# 3. 桌面应用打开，进入聊天，发一条消息（带工具调用）
# 4. 点 titlebar 📊 按钮 → dock 打开显示轨迹 tab
# 5. 验证：回合出现、工具调用行、tokens/cost 汇总、模型切换、reasoning 段
# 6. 再发一条消息 → 第二个回合实时追加（无需刷新）
# 7. 刷新桌面 / 重启 gateway → dock 重新打开，轨迹从 SQLite 恢复
# 8. 点 📋 tab → 任务列表正常（回归 TaskList 不破坏）
# 9. Ctrl+T toggle dock；窄视口 Esc 关闭
```

- [ ] **Step 2: 回归验证**

Run: `npm run test:unit`（全部网关单测 + 新增 trajectory 测试）
Expected: 全部 PASS

- [ ] **Step 3: 提交（如 README 有改动）**

```bash
git add README.md
git commit -m "docs: add trajectory sidebar to feature list"
```

---

## Self-Review

**Spec 覆盖检查：**
- §3 数据模型 → Task 1（表 + store）
- §3.3 数据流（hook 点、dedup、turn_start 兜底、project_id）→ Task 2（collector）
- §4 API（分页/before_turn/rebuild/fail-open/会话删除/TTL）→ Task 3+4
- §4 实时推送 trajectory.event → Task 3（broadcast）
- §5 UI（统一 dock + tab、双按钮、Ctrl+T、窄视口、样式约定）→ Task 7
- §5.4 数据接入（拉取+SSE+会话切换+分页）→ Task 8
- §6 错误处理（写失败不阻塞、重启恢复、拉取失败重试）→ Task 3（try/catch）+ Task 4（fail-open）+ Task 7（重试按钮）
- §7 测试 → Task 1/2/4 单测 + Task 9 手动
- §8 里程碑 → 任务顺序即里程碑

**类型一致性：**
- `TrajectoryStore.recordEvent/upsertTurn/getSessionTrajectory/deleteSession/pruneOlderThan` — 全计划一致
- `TrajectoryCollector.handleEvent/onIdle` — 一致
- `handleTrajectoryRequest` ctx 有 `sessionID` 字段（Task 4 Step 5 补充）
- `TrajectoryEvent`/`TrajectoryTurn` 网关侧字段（camelCase）+ SDK 侧（turnID）一致；SQLite 列 snake_case
- `TrajectoryDock` props：`sessionID/gatewayUrl/liveEvents/liveTurn` — Task 7/8 一致
- `RightDock` props：`open/tab/width/onClose/onTab/children` — 一致

**已知注意点（实现时留意，不阻塞）：**
- 用户消息文本：`turn_start` 时取 `info.summary?.body`（可能缺失）；`message.part.updated` 的 text part（`part.messageID === s.userMessageID`）补全 `user_text`——已在 collector 中处理（`text` 分支）
- `AssistantMessage` 无 `agent` 字段（agent 在 `UserMessage` 上）——collector 的 assistant 分支已移除 `info.agent` 读取；`agent` 值从 `turn_start` 的 user info 补（`userMessage.agent`），当前实现 `agent` 仅记录在 turn 里（rebuild 时从 user info 取）
- `session.next.*` v2 事件未纳入（spec 决定用 v1 part 流），reasoning 用 part 首末判定——若 serve 不发 reasoning part 的 end 时间戳，`reasoning_end` 只出现在下一次该 part 更新或 idle 时（可接受）
- 桌面 `es.onmessage` 现有变量命名为 `event`（`raw?.data || raw`）+ `sid` 提取（MafwShell.tsx:922-940）——Task 8 Step 2 需按此适配
