# 持久事件回放（Persistent Event Replay）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gateway 全局事件流（Mode A）获得持久日志 + 断点续传——broadcast 分配单调 seq（SSE `id:` 行 + 双层 `seq` 字段），`GET /api/events` 经 `Last-Event-ID` 头 / `?since=` 参数重放后直播，零客户端改动。

**Architecture:** `EventStore`（新模块，注入 better-sqlite3 句柄，`event_log` 表 AUTOINCREMENT）在 `broadcast()` 单点同步分配 seq（fail-open）；`/api/events` 路由的 attach 用缓冲-排水模式消除重放/直播竞态（无 await 区间完成）。newest-window 回放契约：范围 `(since, headSeq]` 内最新 limit 行升序写，回放尾行恒 = headSeq，洞在起点一侧由 `firstReplayedSeq` 显式暴露。

**Tech Stack:** TypeScript / better-sqlite3 ^12（RETURNING 支持）/ jest

**Spec:** `docs/superpowers/specs/2026-10-22-persistent-event-replay-design.md`（v2，builder check 3 裁决已并入；计划从 spec 论证，两者一起读）

## Global Constraints

- C1 `part.delta` **不入库不占 seq**（spec §5.1 v2 Q3）——seq 空间只由持久事件消耗，连续无跳号（截断检测的可靠性前提）
- C2 seq **双层放置**：信封顶层 + `data` 内（当 data 是 object；spec §5.2 v2 Q2）——注入在 `mafwBroadcast()` 返回之后
- C3 **AUTOINCREMENT 显式**（spec §5.1）——普通 rowid 在全删后从 1 重用，与陈旧游标碰撞会静默漏帧
- C4 broadcast 与 attach 的 seq 分配/查询全部**同步**（better-sqlite3 同步 API；attach 1-5 步之间不得有 await 让出点）
- C5 全路径 **fail-open**：store 缺席/写失败/prune 失败 → 无 `id:` 直播（现状行为）；启动永不被事件日志卡死
- C6 `?since=` 优先于 `Last-Event-ID` 头；垃圾值 → 视为无游标纯直播（不 400）
- C7 greeting `{type:'connected', timestamp, vocab:'v2', headSeq, firstReplayedSeq?, truncated?}` additive；不经 broadcast 不持久化
- C8 中文注释文件用 `write`/`edit` 工具修改（PowerShell here-string 会坏中文——本轮实证过）
- C9 测试基线：gateway 334 套件 / desktop 1131 / tui 220 / adapter 24

## Review Focus

1. **prune 后 seq 重用**（spec §7 裁决 3）：20k 窗口裁掉旧行后，若 seq 从 1 重用，持有 lastEventId=5000 的重连客户端收不到任何回放且无截断信号。→ Task 1 测试：prune 后 append 的 seq 仍大于被删行的 seq。
2. **回放/直播衔接处丢帧或重复**（spec §5.3 竞态论证）：attach 期间并发 broadcast 的帧既不在 DB 也不在 buffer = 丢；两边都有 = 重。→ Task 3 竞态钉扎测试：连接后同步突发 broadcast，收到的持久事件恰好各一次。
3. **非持久帧（part.delta）排水重复**：buffer 里的 delta 帧无 seq，排水规则"直接写出"若误用 seq 比较会全丢。→ Task 3 混排测试：delta 帧与持久帧交错突发，delta 全到且不重。
4. **limit 截断静默漏中间段**（spec §7 裁决 8）：oldest-first 形状会让 lastEventId 跳到回放末行而中间有洞不可检测。→ Task 1 测试：`replaySince(since, limit)` 在范围超 limit 时返回的 rows 是**最新** limit 行且 `firstReplayedSeq > since + 1`。
5. **信封事件消费方看不见 seq**（spec §7 裁决 9）：只放顶层时 desktop/SDK 剥壳后 `data.seq` 缺失。→ Task 2 测试：mafw_event 信封帧的 `data.seq` 存在。

---

### Task 1: EventStore（新模块）

**Files:**
- Create: `gateway/src/events/event-store.ts`
- Modify: `gateway/src/memory/gateway-db.ts:77`（加 `getStore(): Database.Database` 句柄 getter）
- Test: `gateway/tests/unit/events/event-store.test.ts`（新建）

**Interfaces:**
- Consumes: `BetterSqlite3.Database`（`better-sqlite3` 的 `Database` 类型）
- Produces:
  ```typescript
  // gateway/src/events/event-store.ts
  export const NON_PERSISTED_EVENT_TYPES: ReadonlySet<string>;  // 含 'part.delta'
  export interface StoredEnvelope { seq: number; ts: string; type: string; sessionId: string | null; envelope: unknown }
  export class EventStore {
    constructor(db: BetterSqlite3.Database);
    append(envelope: { type: string; [k: string]: any }): number | null;   // 非持久类型/异常 → null
    headSeq(): number;                                                     // 空表 0
    replaySince(since: number, limit: number): { rows: StoredEnvelope[]; firstReplayedSeq: number | null };
    maybePrune(retention: number, everyN?: number): void;                  // 每 everyN 次 append 检查一次；无行可删跳过
  }
  ```
- DDL（表 + 索引）由 EventStore 构造函数 `CREATE TABLE IF NOT EXISTS` 自建（不进 GatewayDatabase 的 exec 块——该文件职责是既有表；事件表是 EventStore 的私有 schema）。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/events/event-store.test.ts
import Database from 'better-sqlite3';
import { EventStore, NON_PERSISTED_EVENT_TYPES } from '../../../src/events/event-store';

function makeStore() {
  const db = new Database(':memory:');
  return new EventStore(db);
}

describe('EventStore（spec §5.1）', () => {
  it('append 分配单调递增 seq；headSeq 跟随', () => {
    const s = makeStore();
    const a = s.append({ type: 'session.created' })!;
    const b = s.append({ type: 'turn.completed', properties: { x: 1 } })!;
    expect(b).toBeGreaterThan(a);
    expect(s.headSeq()).toBe(b);
  
// wiring 断言（index.ts 实际调用——否则纯函数可能存在但未接线）：
import { readFileSync as rf } from 'fs';
import { join as pjoin } from 'path';
const idxSrc = rf(pjoin(__dirname, '../../../src/index.ts'), 'utf8');
describe('index.ts broadcast 接线（wiring）', () => {
  it('broadcast 走 enrichBroadcastFrame + eventStore.append', () => {
    expect(idxSrc).toContain('enrichBroadcastFrame(');
    expect(idxSrc).toMatch(/eventStore\?\.append\(/);
    expect(idxSrc).toMatch(/maybePrune\(/);
  });
  it('EventStore 初始化受 config.events.persist 门控（fail-open）', () => {
    expect(idxSrc).toMatch(/config\.events\.persist/);
  });
});
});
  it('part.delta 不入库不占 seq（C1：seq 空间连续）', () => {
    const s = makeStore();
    expect(s.append({ type: 'part.delta', properties: { delta: 'x' } })).toBeNull();
    const a = s.append({ type: 'part.updated' })!;
    expect(a).toBe(1); // delta 没消耗 seq
  });
  it('replaySince：全量 / 尾窗 / 空', () => {
    const s = makeStore();
    for (let i = 0; i < 5; i++) s.append({ type: 't' + i });
    expect(s.replaySince(0, 100).rows).toHaveLength(5);
    const { rows, firstReplayedSeq } = s.replaySince(3, 100);
    expect(rows.map(r => r.seq)).toEqual([4, 5]);
    expect(firstReplayedSeq).toBe(4);
    expect(s.replaySince(5, 100).rows).toEqual([]);
    expect(s.replaySince(5, 100).firstReplayedSeq).toBeNull();
  });
  it('replaySince 超限取最新 limit 行（Review Focus #4：newest-window）', () => {
    const s = makeStore();
    for (let i = 0; i < 10; i++) s.append({ type: 't' + i });
    const { rows, firstReplayedSeq } = s.replaySince(2, 3);
    expect(rows.map(r => r.seq)).toEqual([8, 9, 10]); // 最新 3 行，不是最旧
    expect(firstReplayedSeq).toBe(8);                  // > since+1 = 截断信号
  });
  it('replaySince 返回的信封可 JSON 还原（含 properties）', () => {
    const s = makeStore();
    s.append({ type: 'turn.completed', properties: { cost: 0.5 }, sessionID: 'ses_1' });
    const row = s.replaySince(0, 10).rows[0];
    expect(row.sessionId).toBe('ses_1');
    expect((row.envelope as any).properties.cost).toBe(0.5);
  });
  it('maybePrune：裁掉旧行后 seq 不重用（Review Focus #1）', () => {
    const s = makeStore();
    for (let i = 0; i < 5; i++) s.append({ type: 't' });
    s.maybePrune(2, 1); // 每 1 次 append 检查，保留 2 行
    const { rows } = s.replaySince(0, 100);
    expect(rows.map(r => r.seq)).toEqual([4, 5]);   // 只剩最新 2 行
    const next = s.append({ type: 'after-prune' })!;
    expect(next).toBe(6);                            // AUTOINCREMENT：不回填 3/4
  });
  it('append 异常 fail-open 返回 null（C5）', () => {
    const db = new Database(':memory:');
    const s = new EventStore(db);
    db.close(); // 句柄关闭后插入必炸
    expect(s.append({ type: 'x' })).toBeNull();
    expect(s.headSeq()).toBe(0);
  });
  it('NON_PERSISTED_EVENT_TYPES 含 part.delta', () => {
    expect(NON_PERSISTED_EVENT_TYPES.has('part.delta')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/events/event-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `gateway/src/events/event-store.ts`**

要点（签名见 Interfaces）：DDL 用 `INTEGER PRIMARY KEY AUTOINCREMENT`（C3）+ `idx_event_log_session(session_id, seq)` 索引；append：type ∈ NON_PERSISTED → null，否则 `INSERT ... RETURNING seq`（try/catch → null）；replaySince：`SELECT ... WHERE seq > ? ORDER BY seq DESC LIMIT ?` 后 reverse（newest-window）；firstReplayedSeq = rows[0]?.seq ?? null；maybePrune：计数器达 everyN 时 `DELETE FROM event_log WHERE seq <= (SELECT MAX(seq) FROM event_log) - ?`，计数器清零，DELETE 异常吞掉（C5）。`gateway-db.ts` 加 `getStore(): Database.Database { return this.db; }`。

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/events/event-store.test.ts`
Expected: PASS 8/8

- [ ] **Step 5: Commit**

```bash
git add gateway/src/events/event-store.ts gateway/src/memory/gateway-db.ts gateway/tests/unit/events/event-store.test.ts
git commit -m "feat(events): EventStore - persistent event_log with AUTOINCREMENT seq, part.delta excluded, newest-window replaySince, amortized prune"
```

---

### Task 2: broadcast 单点 seq 接线

**Files:**
- Modify: `gateway/src/index.ts:2782-2799`（broadcast）+ 构造/初始化区（EventStore 字段与实例化）+ config 类型与默认值
- Modify: `gateway/src/config.ts`（`GatewayConfig` 接口 + `defaults()` 各加 `events` 段）
- Test: `gateway/tests/unit/events/broadcast-seq.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `EventStore`、`GatewayDatabase.getStore()`
- Produces: `MafwScheduler`（或等价持有 broadcast 的类）新增 `private eventStore: EventStore | null`；broadcast 行为变化（seq 注入，见下）。config 新段：
  ```typescript
  events: { persist: boolean; logRetention: number; replayLimit: number; pruneEveryN: number }
  // 默认值：{ persist: true, logRetention: 20000, replayLimit: 2000, pruneEveryN: 1000 }
  ```

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/events/broadcast-seq.test.ts
// 直接单测 enrich 逻辑（不启动整个 gateway）：从 index.ts 提取的纯化——
// 若 index.ts 不可直接 import（它默认导出重对象），按仓库现有 index 相关测试的模式
// （参考 tests/unit/runtime/session-dir-wiring.test.ts 的源码断言模式），
// 用 wiring 断言 + 对 enrich 纯函数直测。裁决：broadcast 的 enrich 步骤抽成
// 导出的纯函数 `enrichBroadcastFrame(event, seq, now)` 放 src/events/broadcast-frame.ts，
// index.ts 调用它——index.ts 巨大且难实例化，纯函数直测是仓库既有先例（resolvePromptBudget 同模式）。
import { enrichBroadcastFrame } from '../../../src/events/broadcast-frame';

describe('enrichBroadcastFrame（spec §5.2 v2 Q2：双层放置）', () => {
  it('扁平事件：顶层 seq + timestamp', () => {
    const out = enrichBroadcastFrame({ type: 'runtime_switched', runtime: 'pi' }, 42, '2026-10-22T00:00:00Z');
    expect(out).toEqual({ type: 'runtime_switched', runtime: 'pi', timestamp: '2026-10-22T00:00:00Z', seq: 42 });
  });
  it('信封事件：顶层 + data 内 seq（Review Focus #5）', () => {
    const out = enrichBroadcastFrame({ type: 'mafw_event', data: { type: 'turn.completed', properties: {} } }, 7, 'T');
    expect(out.seq).toBe(7);
    expect((out.data as any).seq).toBe(7);
  });
  it('seq null：无 seq 键（现状形状，C5）', () => {
    const out = enrichBroadcastFrame({ type: 'part.delta', data: { type: 'part.delta' } }, null, 'T');
    expect('seq' in out).toBe(false);
    expect('seq' in (out.data as any)).toBe(false);
  });
  it('data 非 object（字符串/null）：只放顶层', () => {
    const out1 = enrichBroadcastFrame({ type: 'x', data: null }, 1, 'T');
    expect(out1.seq).toBe(1);
    expect(out1.data).toBeNull();
    const out2 = enrichBroadcastFrame({ type: 'x', data: 'str' }, 2, 'T');
    expect((out2 as any).seq).toBe(2);
    expect((out2 as any).data).toBe('str');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/events/broadcast-seq.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

1. 新建 `gateway/src/events/broadcast-frame.ts`：`export function enrichBroadcastFrame(event: { type: string; [k: string]: any }, seq: number | null, now: string): { type: string; [k: string]: any }`——浅拷贝 + timestamp + 双层 seq（data 为纯 object 时注入；null seq 不加键）
2. `config.ts`：`GatewayConfig` 接口 + `defaults()` 加 `events` 段（默认值见 Interfaces；注意 applyEnvOverrides 只遍历 defaults 存在的 key——加进 defaults 即自动获得 `MAFW_EVENTS_*` env 支持）
3. `index.ts`：`private eventStore: EventStore | null = null` 字段；初始化（`getGatewayDb()` 首次可达处或 initServices，`config.events.persist` false 或构造抛错 → 保持 null 并 warn 一次）；broadcast 改为：
   ```
   const seq = this.eventStore?.append(event) ?? null;
   const enriched = enrichBroadcastFrame(event, seq, new Date().toISOString());
   SSE: (seq !== null ? `id: ${seq}\n` : '') + `data: ${JSON.stringify(enriched)}\n\n`
   WS/pushGateway: enriched
   this.eventStore?.maybePrune(config.events.logRetention, config.events.pruneEveryN);
   ```
   （SSE 帧构造在现有循环外做一次字符串；res.write 保持 try/catch 现状）

- [ ] **Step 4: 运行确认通过 + 邻近回归**

Run: `cd gateway && npx jest tests/unit/events tests/unit/api-contract.test.ts --silent 2>&1 | Select-String "Tests:"`
Expected: events 套件 PASS + api-contract 绿（若 route-catalog 无涉则恒绿；broadcast 不在路由面）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/events/broadcast-frame.ts gateway/src/config.ts gateway/src/index.ts gateway/tests/unit/events/broadcast-seq.test.ts
git commit -m "feat(events): broadcast seq wiring - enrichBroadcastFrame pure fn (dual-layer seq), EventStore init fail-open, config events section"
```

---

### Task 3: 回放路由（缓冲-排水 attach）

**Files:**
- Create: `gateway/src/events/sse-attach.ts`
- Modify: `gateway/src/index.ts:6546-6566`（Mode A 分支改用 attach helper）
- Test: `gateway/tests/unit/events/sse-attach.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 `EventStore.replaySince/headSeq`；Task 2 `enrichBroadcastFrame`
- Produces:
  ```typescript
  // gateway/src/events/sse-attach.ts
  export interface SseAttachDeps {
    res: http.ServerResponse;
    store: EventStore | null;          // null = 纯直播（C5）
    replayLimit: number;
    writeFrame: (res: http.ServerResponse, frame: string) => void;  // 注入（index.ts 提供带 try/catch 的现写法）
  }
  export function parseSince(urlQuery: URLSearchParams, lastEventIdHeader: string | undefined): number | null;
  //   ?since=N 优先（非负整数）；Last-Event-ID 头次之；垃圾/缺省 → null
  export function attachGlobalSse(deps: SseAttachDeps): { write: (frame: string, seq: number | null) => void };
  //   写 SSE 头 + greeting（headSeq/firstReplayedSeq/truncated）→ 缓冲-排水重放 →
  //   返回 write(frame, seq)——seq 非空帧按 frame 原样写（含 id: 行，由调用方构造），
  //   无 seq 帧原样写。调用方（broadcast）把 per-connection 写经此入口路由。
  export function drainBuffer(buffer: Array<{ frame: string; seq: number | null }>, maxReplayed: number, writeFrame: (res: http.ServerResponse, frame: string) => void, res: http.ServerResponse): void;
  //   排水过滤规则（buffer 是 C4 无-await 约束的纵深防御）：seq > maxReplayed 或 seq === null → 写出；其余丢弃
  ```
  index.ts 的 `sseClients` 从 `Set<http.ServerResponse>` 改为 `Map<http.ServerResponse, { write(frame: string, seq: number | null): void }>`（attach 返回的 write 闭包）；broadcast 循环改走 map 条目的 write。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/events/sse-attach.test.ts
import { PassThrough } from 'stream';
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/events/event-store';
import { parseSince, attachGlobalSse, drainBuffer } from '../../../src/events/sse-attach';

function fakeRes() {
  const res = new PassThrough() as any;
  res.writeHead = () => res;
  res.chunks = [];
  res.on('data', (c: Buffer) => res.chunks.push(c.toString()));
  return res;
}
function parseFrames(res: any) {
  return res.chunks.join('').split('\n\n').filter((s: string) => s.trim()).map((s: string) => {
    const id = /(?:^|\n)id: (\d+)/.exec(s)?.[1];
    const data = /(?:^|\n)data: (.*)$/s.exec(s)?.[1];
    return { id: id ? Number(id) : null, data: data ? JSON.parse(data) : null, raw: s };
  });
}

describe('parseSince（C6）', () => {
  it('?since 优先于 header；垃圾 fail-open', () => {
    expect(parseSince(new URLSearchParams('since=42'), '7')).toBe(42);
    expect(parseSince(new URLSearchParams(''), '7')).toBe(7);
    expect(parseSince(new URLSearchParams('since=abc'), '7')).toBe(7);      // 垃圾参数回退 header
    expect(parseSince(new URLSearchParams('since=-3'), undefined)).toBeNull(); // 负数 = 无游标
    expect(parseSince(new URLSearchParams(''), 'garbage')).toBeNull();
    expect(parseSince(new URLSearchParams(''), undefined)).toBeNull();
  });
});

describe('attachGlobalSse（spec §5.3）', () => {
  function makeStore(n: number) {
    const s = new EventStore(new Database(':memory:'));
    for (let i = 0; i < n; i++) s.append({ type: 'persisted_' + i });
    return s;
  }
  it('无游标：greeting + 纯直播（现状行为）', () => {
    const store = makeStore(3);
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store, replayLimit: 100, writeFrame: (r, f) => r.write(f) });
    conn.write(`id: 4\ndata: {}\n\n`, 4);
    const frames = parseFrames(res);
    expect(frames[0].data.type).toBe('connected');
    expect(frames[0].data.headSeq).toBe(3);
    expect(frames[0].data.firstReplayedSeq).toBeUndefined();
    expect(frames).toHaveLength(2);
  });
  it('有游标：重放后直播，衔接无重无漏（Review Focus #2）', () => {
    const store = makeStore(5);
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store, replayLimit: 100, writeFrame: (r, f) => r.write(f), since: 0 });
    conn.write(`id: 6\ndata: {"type":"live"}\n\n`, 6); // 模拟 attach 后到达的直播帧
    const frames = parseFrames(res);
    expect(frames.map(f => f.id)).toEqual([null, 1, 2, 3, 4, 5, 6]);  // greeting 无 id，重放 1-5，直播 6
    expect(frames[0].data.firstReplayedSeq).toBe(1);
    expect(frames[0].data.truncated).toBeUndefined();
  });
  it('重放超 limit：newest-window + truncated 信号（Review Focus #4）', () => {
    const store = makeStore(10);
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store, replayLimit: 3, writeFrame: (r, f) => r.write(f), since: 2 });
    const frames = parseFrames(res);
    expect(frames.map(f => f.id).slice(1)).toEqual([8, 9, 10]);
    expect(frames[0].data.firstReplayedSeq).toBe(8);
    expect(frames[0].data.truncated).toBe(true);
  });
  it('drainBuffer：maxReplayed 过滤 + 无 seq 帧直写（Review Focus #3）', () => {
    // 诚实裁决（自审修正）：attach 全同步（C4）→ 生产中 attach 期间不可能有帧到达；
    // buffer 是"无 await 约束"的纵深防御（将来 attach 加 await 时承重）。其过滤规则
    // 抽为导出纯函数 drainBuffer 直测：seq > maxReplayed 写出、seq <= 丢弃、
    // 无 seq（part.delta/store 失败）直写（宁重勿漏）。
    const written: string[] = [];
    const res = fakeRes();
    const buffer = [
      { frame: 'f5', seq: 5 }, { frame: 'fd', seq: null }, { frame: 'f3', seq: 3 }, { frame: 'f7', seq: 7 },
    ];
    drainBuffer(buffer, 4, (r, f) => written.push(f), res);
    expect(written).toEqual(['f5', 'fd', 'f7']); // f3 被重放覆盖，丢弃
  });
  it('store null：greeting(headSeq 0) + 纯直播（C5）', () => {
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store: null, replayLimit: 100, writeFrame: (r, f) => r.write(f) });
    conn.write(`data: {"type":"x"}\n\n`, null);
    const frames = parseFrames(res);
    expect(frames[0].data.headSeq).toBe(0);
    expect(frames).toHaveLength(2);
  });
  it('游标= headSeq：零重放，纯直播', () => {
    const store = makeStore(4);
    const res = fakeRes();
    // via parseSince 注入不了 header——attachGlobalSse 接 since 值而非自己解析
    // （裁决：attach 接受 since 参数，index.ts 路由层先 parseSince——测试直传）
    const conn = attachGlobalSse({ res, store, replayLimit: 100, writeFrame: (r, f) => r.write(f), since: 4 } as any);
    conn.write(`id: 5\ndata: {}\n\n`, 5);
    const frames = parseFrames(res);
    expect(frames.map(f => f.id)).toEqual([null, 5]);
  });
});
```

（注：最后一条测试揭示 `attachGlobalSse` 需接受可选 `since?: number | null` 参数——路由层 parseSince 后传入；Interfaces 块以测试为准修正签名：`attachGlobalSse(deps: SseAttachDeps & { since?: number | null })`。）

```typescript
// 同文件追加（wiring 断言——参考 session-dir-wiring / prompt-budget-wiring 模式）：
import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');
describe('index.ts 回放接线（wiring）', () => {
  it('SSE 路由经 parseSince + attachGlobalSse', () => {
    expect(src).toContain('parseSince(');
    expect(src).toContain('attachGlobalSse(');
  });
  it('sseClients 为 Map（per-connection write 闭包）', () => {
    expect(src).toMatch(/sseClients[^
]*Map</);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/events/sse-attach.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `gateway/src/events/sse-attach.ts`**

- `parseSince(query, header)`：`?since` 非负整数优先（正则 `/^\d+$/`），否则 header 同规则，否则 null
- `attachGlobalSse`：
  1. 写 SSE 头（与 index.ts 现状同四字段）
  2. `buffer: Array<{ frame: string; seq: number | null }>` + `buffering = true`；构造 `write(frame, seq)` 闭包 = buffering 时 push，否则 `writeFrame(res, frame)`
  3. （`since != null && store` 时）`replaySince(since, limit)` → greeting（headSeq, firstReplayedSeq, truncated ⟺ firstReplayedSeq !== null && firstReplayedSeq > since + 1）→ 逐行 `id:`+`data:`（envelope 补 timestamp + 双层 seq 用 enrichBroadcastFrame——**store 里存的是原始形状，回放帧须与直播同形**）
  4. 无回放时 greeting 只带 headSeq
  5. `buffering = false`；排水：`maxReplayed = rows 尾行 seq ?? since`；buffer 中 `seq === null → 写出`，`seq > maxReplayed → 写出`，`seq <= maxReplayed → 丢弃`
  6. 返回 `{ write }`
  - 全程无 await（C4）；greeting 写在重放前
- `index.ts` 6546-6566 Mode A 分支：`parseSince(url.searchParams, req.headers['last-event-id'])` → `attachGlobalSse({res, store: this.eventStore, replayLimit: config.events.replayLimit, writeFrame, since})` → map 注册；`req.on('close')` 从 map 删。`sseClients` 类型改 `Map<res, write>`，broadcast 循环改 `for (const [client, write] of this.sseClients) { try { write(frame, seq) } catch { this.sseClients.delete(client) } }`（SSE 帧字符串构造一次，writeFrame 注入用统一闭包）

- [ ] **Step 4: 运行确认通过 + events 全套 + 关键邻近回归**

Run: `cd gateway && npx jest tests/unit/events --silent 2>&1 | Select-String "Tests:"`
Expected: 3 套件全 PASS（event-store + broadcast-seq + sse-attach）

Run: `cd gateway && npx jest tests/unit/mcp tests/unit/runtime --silent 2>&1 | Select-String "Tests:|FAIL"`
Expected: 全绿（broadcast/sseClients 类型改动不涉这些域；有 FAIL 即回归，修）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/events/sse-attach.ts gateway/src/index.ts gateway/tests/unit/events/sse-attach.test.ts
git commit -m "feat(events): replay-then-live SSE attach - buffer-drain race elimination, newest-window with firstReplayedSeq truncation contract, Last-Event-ID/since dual entry"
```

---

### Task 4: WS seq + Mode B deprecated 注记 + 全量回归收口

**Files:**
- Modify: `gateway/src/chat/chat-sessions.ts`（类 docstring 加 deprecated 注记——零行为改动）
- Test: 无新测试（WS enrich 已在 Task 2 的 enrichBroadcastFrame 覆盖——WS 帧即 enriched；Mode B 无行为变化）

**Interfaces:**
- Consumes: Task 2 broadcast 改造（WS 帧已带 seq——确认无需再改 index.ts 的 WS 分支：它已发送 enriched）
- Produces: 无

- [ ] **Step 1: chat-sessions.ts 类注释加 deprecated 注记**

```typescript
/**
 * @deprecated Mode B per-session delta 通道（message_delta/complete/error）——
 * 2026-10-22 侦察确认零源码消费方（desktop/TUI 均走 Mode A 全局流）。
 * 保留是兼容赌注；新消费方请用 Mode A（GET /api/events，支持 Last-Event-ID 续传）。
 */
```

- [ ] **Step 2: 确认 index.ts WS 分支无需改动**

读 index.ts 的 wsClients 广播段（broadcast 内）——Task 2 已把 WS 帧换成 enriched（含 seq）。若发现 WS 分支单独构造帧（非复用 enriched），统一为 enriched。此为验证步骤，无改动即过。

- [ ] **Step 3: gateway 全量回归**

Run: `cd gateway && npx jest 2>&1 | Select-String "Test Suites:|Tests:|FAIL"`
Expected: ≥337 套件全绿（334 基线 + 3 新）；已知偶发 flake（laya-client 等）隔离重跑即绿

Run: `cd gateway && npx tsc --noEmit`
Expected: 干净（P0 教训：gateway tsc 单独跑）

- [ ] **Step 4: 其余三套回归**

Run:
```
cd packages/desktop && npm test   # ≥1131（并行会话可能加新——不低于）
cd packages/tui && node --test "tests/*.test.ts"   # 220
cd adapters/claude && npm test    # 24
```
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/chat/chat-sessions.ts
git commit -m "chore(events): mark Mode B ChatSessionManager deprecated (zero consumers verified); WS frames carry seq via enriched payload (Task 2)"
```

---

## 收口（执行者完成全部任务后）

1. 汇总：新增测试数 / 四套全量数（对照 C9 基线）
2. `cd gateway && npx tsc --noEmit` 必须干净
3. 向用户汇报：交付内容表 + 测试计数 + commit 列表
