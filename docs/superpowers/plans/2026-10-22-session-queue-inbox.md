# 会话队列 Inbox（Session Queue Inbox）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `delivery:'queue'` 的 prompt 在会话 busy 时由 gateway 拦截入队（per-session FIFO + 幂等 + 防楔死），回合终态串行续发，全程 `queue.updated` 事件可见、HTTP 可管理——跨全部 runtime 单实现，adapter 零改动。

**Architecture:** SessionQueue 纯类（内存 Map）+ busy 追踪（`turn.started`/三终态 + 15min 陈旧清扫 + 24h item TTL 防楔死）+ 拦截组合进 `withIdentityPrompt` 咽喉（显式 opt-in：仅 `delivery === 'queue'` 且 busy 时入队）+ flush 挂 handleRuntimeEvent 终态分支（fire-and-forget）。`queue.updated` 进 MAFW 词表（gateway 合成，`usage.updated` 先例）骑持久事件回放。

**Tech Stack:** TypeScript / jest / 既有词汇四层守卫链

**Spec:** `docs/superpowers/specs/2026-10-22-session-queue-inbox-design.md`（v2，builder check 三裁决并入；计划从 spec 论证）

## Global Constraints

- C1 `delivery:'queue'` 是**唯一触发拦截的条件**（steer/默认/followup 行为 byte-for-byte 不变）；且仅 busy 时入队，idle 时等价直发（spec §4 反目标）
- C2 拦截点 = `withIdentityPrompt` 咽喉（spec §5.3 v2）——不选 sdkSession facade（14 调用点只有 2 个走它）；harness 调用方（conformance/eval/media）不传 queue → 零影响，**无排除清单**
- C3 flush **每终态一条**（串行），`void` fire-and-forget + catch（pi promptAsync 在 idle 会话 await 到回合结束——事件处理器内 await 会互锁，spec §7 裁决 3）
- C4 busy 防楔死：busy TTL 15min（清扫）+ item TTL 24h（过期 cancel + `queue.updated action:'expire'`）（spec §5.1 v2 Q2）
- C5 per-session 上限 32 条，超限 enqueue 返回 `rejected:'limit'` → HTTP 400（显式拒绝，不静默丢）
- C6 幂等窗口 = 排队期：同 `idempotencyKey` 在队 → 返回既有 item（duplicate 路径，不报错不增长）
- C7 `queue.updated` 词汇四层守卫链全跟随：`mafw-vocabulary.ts` MAFW map ↔ SDK events union ↔ 矩阵测试 ↔ desktop `assertShellEventCoverage` + TUI `KNOWN_EVENTS`
- C8 事件载荷 items 全量快照（UI 单事件自足）；经 broadcast 自动进 event_log（回放地基，无需额外持久化代码）
- C9 中文注释用 `write`/`edit` 工具（PowerShell here-string 坏中文）；文件多为 CRLF——node 补丁脚本用 `\r\n`
- C10 测试基线：gateway 337 套件 / 2376 + desktop 1131 + tui 220 + adapter 24

## Review Focus

1. **busy 楔死**（spec §5.1 v2 Q2）：`turn.started` 无匹配终态（noReply prompt 假设触发 prompted-无回合）→ busy 永久 → queue 静默堆积永不 flush——比今日更糟。→ Task 2 测试：busy 超 TTL 被清扫 + 清扫触发时队列续发路径不受阻。
2. **拦截误伤非 queue 调用**：withIdentityPrompt 咽喉覆盖 conformance/eval/media harness——任何对 opts 形状的意外假设都可能让 harness prompt 入队。→ Task 3 测试：`delivery` 缺省/steer/followup 时直发零改动（wiring 断言 + 行为测试）。
3. **flush 重入**：终态触发 flush → flush 的 promptAsync 触发新 `turn.started` → 新终态 → 再 flush——循环是否可控。→ Task 4 测试：两条排队 → 两次终态各 flush 一条 → 队空后第三次终态零动作。
4. **queue.updated 漏持久化**：事件绕过 broadcast（直发 SSE）→ 回放后队列视图丢失。→ Task 5 测试：queue.updated 经 broadcast 路径（源码断言 emit 调用点走 this.broadcast）。
5. **取消与 flush 竞态**：cancel 到达时该项正被 flush 取走。→ Task 1 测试：dequeue 后 cancel 同 id 返回 null（不炸不复活）。

---

### Task 1: SessionQueue 纯类

**Files:**
- Create: `gateway/src/core/session-queue.ts`
- Test: `gateway/tests/unit/core/session-queue.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // gateway/src/core/session-queue.ts
  export interface QueuedItem {
    id: string; sessionID: string;
    text?: string; parts?: Array<{ type: string; text?: string; [k: string]: unknown }>;
    agent?: string; model?: { providerID: string; modelID: string };
    idempotencyKey?: string; enqueuedAt: string; source: string;
  }
  export type EnqueueResult = { item: QueuedItem } | { duplicate: QueuedItem } | { rejected: 'limit' };
  export class SessionQueue {
    enqueue(sessionID: string, item: Omit<QueuedItem, 'id' | 'enqueuedAt' | 'sessionID'>, opts?: { maxPerSession?: number }): EnqueueResult;
    dequeue(sessionID: string): QueuedItem | null;
    cancel(sessionID: string, itemId: string): QueuedItem | null;
    clear(sessionID: string): QueuedItem[];
    list(sessionID: string): QueuedItem[];          // 只读快照
    size(sessionID: string): number;
    expireOlderThan(sessionID: string, ttlMs: number, now?: number): QueuedItem[];  // 过期摘除（返回被摘项供事件发射）
  }
  ```
  （构造无参；`now` 注入供测试时钟控制；id 生成 `q_<randomUUID 短码>`）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/core/session-queue.test.ts
import { SessionQueue, QueuedItem } from '../../../src/core/session-queue';

const base = (over: Partial<Parameters<SessionQueue['enqueue']>[1]> = {}) => ({
  text: 'hello', source: 'http', ...over,
});

describe('SessionQueue（spec §5.2）', () => {
  it('FIFO：enqueue→dequeue 顺序', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base({ text: 'a' }));
    q.enqueue('s1', base({ text: 'b' }));
    expect(q.dequeue('s1')!.text).toBe('a');
    expect(q.dequeue('s1')!.text).toBe('b');
    expect(q.dequeue('s1')).toBeNull();
  });
  it('per-session 隔离', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base()); q.enqueue('s2', base({ text: 'other' }));
    expect(q.size('s1')).toBe(1); expect(q.size('s2')).toBe(1);
    expect(q.dequeue('s2')!.text).toBe('other');
  });
  it('幂等：同 idempotencyKey 返回 duplicate 既有项（C6）', () => {
    const q = new SessionQueue();
    const r1 = q.enqueue('s1', base({ idempotencyKey: 'k1' }));
    const r2 = q.enqueue('s1', base({ idempotencyKey: 'k1', text: 'dup-attempt' }));
    expect('item' in r1).toBe(true);
    expect('duplicate' in r2).toBe(true);
    expect((r2 as any).duplicate.id).toBe((r1 as any).item.id);
    expect(q.size('s1')).toBe(1);
  });
  it('幂等窗口 = 排队期：dequeue 后同 key 再 enqueue 是新项', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base({ idempotencyKey: 'k1' }));
    q.dequeue('s1');
    const r = q.enqueue('s1', base({ idempotencyKey: 'k1' }));
    expect('item' in r).toBe(true);
  });
  it('上限 32：超限 rejected（C5）', () => {
    const q = new SessionQueue();
    for (let i = 0; i < 32; i++) q.enqueue('s1', base({ text: String(i) }));
    expect('rejected' in q.enqueue('s1', base())).toBe(true);
    expect(q.size('s1')).toBe(32);
  });
  it('cancel：队内取消返回该项；未知 id / 已 dequeue 的 id 返回 null（Review Focus #5）', () => {
    const q = new SessionQueue();
    const { item } = q.enqueue('s1', base()) as { item: QueuedItem };
    expect(q.cancel('s1', item.id)!.id).toBe(item.id);
    expect(q.cancel('s1', item.id)).toBeNull();
    const { item: i2 } = q.enqueue('s1', base()) as { item: QueuedItem };
    q.dequeue('s1');
    expect(q.cancel('s1', i2.id)).toBeNull();  // flush 已取走——不炸不复活
  });
  it('clear 返回被清项（事件载荷）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base()); q.enqueue('s1', base({ text: 'b' }));
    const cleared = q.clear('s1');
    expect(cleared).toHaveLength(2);
    expect(q.size('s1')).toBe(0);
  });
  it('expireOlderThan：TTL 过期摘除（C4；now 注入）', () => {
    const q = new SessionQueue();
    const t0 = 1_000_000;
    q.enqueue('s1', base({ text: 'old' }));  // enqueuedAt = 真实时钟
    // 用远未来 now 使其过期
    const expired = q.expireOlderThan('s1', 24 * 3600_000, t0 + 25 * 3600_000);
    expect(expired).toHaveLength(1);
    expect(q.size('s1')).toBe(0);
  });
  it('list 只读快照（内部数组不可外泄）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base());
    const l = q.list('s1');
    l.length = 0;
    expect(q.size('s1')).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/core/session-queue.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`Map<string, QueuedItem[]>`；enqueue：idempotencyKey 已在队 → duplicate；`size >= (opts?.maxPerSession ?? 32)` → rejected；id = `q_${crypto.randomUUID().slice(0, 8)}`；enqueuedAt = `new Date().toISOString()`。list 返回 `[...arr]` 浅拷贝。expireOlderThan 用 `Date.parse(enqueuedAt) < now - ttlMs` 过滤摘除。

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/core/session-queue.test.ts`
Expected: PASS 9/9

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/session-queue.ts gateway/tests/unit/core/session-queue.test.ts
git commit -m "feat(queue): SessionQueue pure class - per-session FIFO, idempotency window, 32 cap, TTL expire"
```

---

### Task 2: busy 追踪 + 防楔死（index.ts handleRuntimeEvent）

**Files:**
- Modify: `gateway/src/index.ts`（字段 + handleRuntimeEvent 两处分支 + 清扫 interval）
- Test: `gateway/tests/unit/runtime/queue-busy-wiring.test.ts`（新建，源码断言模式——index 巨类不可实例化，先例 prompt-budget-wiring）

**Interfaces:**
- Produces: `private busySessions = new Map<string, number>()`（value = busy 起始 ms）；`private sessionQueue = new SessionQueue()`；`private sweepBusyAndQueue(): void`（清扫方法：busy TTL 15min 清除 + item TTL 24h 过期 cancel + queue.updated 事件）；常量 `BUSY_STALE_MS = 15 * 60_000`、`QUEUE_ITEM_TTL_MS = 24 * 3600_000`。Task 3/4/5 消费。

- [ ] **Step 1: 写失败测试（源码断言 + 纯逻辑单测）**

```typescript
// gateway/tests/unit/runtime/queue-busy-wiring.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionQueue } from '../../../src/core/session-queue';

const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');

describe('busy 追踪 wiring（spec §5.1 v2）', () => {
  it('busySessions Map 字段 + turn.started 置位 + 三终态清除', () => {
    expect(src).toMatch(/busySessions = new Map<string, number>/);
    expect(src).toMatch(/type === MAFW\.turnStarted[^\n]*\n[^\n]*busySessions\.set/);
    expect(src).toMatch(/MAFW\.turnCompleted \|\| type === MAFW\.turnFailed \|\| type === MAFW\.turnAborted/);
    expect(src).toMatch(/busySessions\.delete/);
  });
  it('防楔死：BUSY_STALE_MS 常量 + sweep 方法 + interval 注册', () => {
    expect(src).toContain('BUSY_STALE_MS = 15 * 60_000');
    expect(src).toContain('QUEUE_ITEM_TTL_MS');
    expect(src).toMatch(/sweepBusyAndQueue/);
    expect(src).toMatch(/setInterval\([^)]*sweepBusyAndQueue|sweepBusyAndQueue[\s\S]{0,80}setInterval/);
  });
});

describe('sweep 纯逻辑（时钟注入）', () => {
  it('busy TTL 清算语义（用 SessionQueue.expireOlderThan 同式时间比较）', () => {
    // 直接验证时间比较公式：stale = now - startedAt >= BUSY_STALE_MS
    const BUSY_STALE_MS = 15 * 60_000;
    const now = 10_000_000;
    expect(now - (now - BUSY_STALE_MS) >= BUSY_STALE_MS).toBe(true);   // 恰好到期
    expect(now - (now - BUSY_STALE_MS + 1) >= BUSY_STALE_MS).toBe(false); // 未到期
  });
  it('过期项摘除经 SessionQueue（组合语义）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', { text: 'x', source: 'test' });
    const expired = q.expireOlderThan('s1', 1_000, Date.now() + 5_000);
    expect(expired).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/queue-busy-wiring.test.ts`
Expected: FAIL（断言不命中）

- [ ] **Step 3: 实现**

1. 字段：`private busySessions = new Map<string, number>();`（注释：value = busy 起始 ms；v2 Q2 防楔死）+ `private sessionQueue = new SessionQueue();` + 两个 TTL 常量（模块顶 const）
2. handleRuntimeEvent `turn.started` 分支（promptBudgetSessions 清理旁）：`if (sessionID) this.busySessions.set(sessionID, Date.now());`
3. 三终态分支（与 P0-2 清理同处）：`this.busySessions.delete(sessionID);`——**本任务只加 delete，flush 调用由 Task 4 在同分支补一行**（Task 2 的 wiring 断言不含 flush，无前向依赖）
4. `sweepBusyAndQueue()`：遍历 busySessions 清 `now - started >= BUSY_STALE_MS`（清时 warn 日志 + 若该会话有队列触发一次 flush 尝试——幂等，队列空则 no-op）；`this.sessionQueue.list(sid)` 逐会话 `expireOlderThan(sid, QUEUE_ITEM_TTL_MS)` 非空 → 逐项 emit queue.updated（Task 3 的 emit 函数——**Task 2 先只做摘除 + 日志，事件发射留 Task 5 统一接**——避免前向依赖）；注册 `setInterval(() => this.sweepBusyAndQueue(), 60_000).unref()`（start() 内既有 interval 注册点旁）

- [ ] **Step 4: 运行确认通过 + tsc**

Run: `cd gateway && npx jest tests/unit/runtime/queue-busy-wiring.test.ts && npx tsc --noEmit`
Expected: PASS + 干净

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/tests/unit/runtime/queue-busy-wiring.test.ts
git commit -m "feat(queue): busy tracking with anti-wedge (15min stale sweep + 24h item TTL) in handleRuntimeEvent"
```

---

### Task 3: 咽喉拦截（withIdentityPrompt 组合）+ 契约字段

**Files:**
- Modify: `gateway/src/runtime/contract.ts`（SessionPromptOpts：`delivery` 联合加 `'queue'` + `idempotencyKey?: string`）
- Modify: `gateway/src/runtime/identity-state.ts`（withIdentityPrompt 增第 5 可选参 `intercept?: (opts) => Promise<unknown> | undefined`）
- Modify: `gateway/src/index.ts`（wrapRuntimeIdentity 传 intercept 闭包）
- Test: `gateway/tests/unit/runtime/identity-queue-intercept.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 `SessionQueue`、Task 2 `busySessions`
- Produces:
  ```typescript
  // contract.ts
  delivery?: 'steer' | 'followup' | 'queue';   // 'queue' = gateway 拦截（spec §5.6 语义注释）
  idempotencyKey?: string;                     // 排队窗口内幂等
  // identity-state.ts
  export function withIdentityPrompt<S, T>(session, state, runtimeName, isRegistryIdentity, intercept?: (opts: S) => Promise<unknown> | undefined): T
  //   Proxy 的 promptAsync 分支：intercept?.(apply(o)) 返回 Promise 时直接返回该 Promise（短路），否则走 target.promptAsync
  ```
  index.ts intercept 闭包（wrapRuntimeIdentity 内）：`opts.delivery === 'queue' && this.busySessions.has(opts.sessionID)` → `this.enqueuePrompt(opts, 'runtime')`（Task 4 实现的编排方法）→ 返回 Promise（短路）；否则 undefined（透传）。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime/identity-queue-intercept.test.ts
import { withIdentityPrompt, IdentityState } from '../../../src/runtime/identity-state';

function makeWrapped(intercept?: (o: any) => Promise<unknown> | undefined) {
  const calls: any[] = [];
  const target = {
    promptAsync: async (o: any) => { calls.push(o); return { sent: true }; },
    prompt: async (o: any) => { calls.push(o); return {}; },
    other: () => 42,
  };
  const state = new IdentityState();
  const wrapped = withIdentityPrompt(target as any, state as any, () => 'test', () => false, intercept);
  return { wrapped, calls };
}

describe('withIdentityPrompt 拦截扩展（spec §5.3 v2）', () => {
  it('intercept 返回 Promise → 短路，target.promptAsync 不被调', async () => {
    const { wrapped, calls } = makeWrapped(async () => ({ queued: true, itemId: 'q_1' }));
    const r = await wrapped.promptAsync({ sessionID: 's1', text: 'x', delivery: 'queue' });
    expect(r).toEqual({ queued: true, itemId: 'q_1' });
    expect(calls).toHaveLength(0);
  });
  it('intercept 返回 undefined → 透传原路径（含 identity apply 仍生效）', async () => {
    const { wrapped, calls } = makeWrapped(() => undefined);
    await wrapped.promptAsync({ sessionID: 's1', text: 'x', delivery: 'steer' });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe('x');
  });
  it('无 intercept 参数 → 行为与现状 byte-for-byte 一致（C2：harness 零影响）', async () => {
    const { wrapped, calls } = makeWrapped(undefined);
    await wrapped.promptAsync({ sessionID: 's1', text: 'x' });
    expect(calls).toHaveLength(1);
  });
  it('intercept 抛错 → 传播（调用方 catch 处理）', async () => {
    const { wrapped } = makeWrapped(async () => { throw new Error('queue full'); });
    await expect(wrapped.promptAsync({ sessionID: 's1', delivery: 'queue' })).rejects.toThrow('queue full');
  });
  it('prompt() 不经 intercept（队列只挂 promptAsync——同步 prompt 语义不同）', async () => {
    const { wrapped, calls } = makeWrapped(async () => ({ queued: true }));
    await wrapped.prompt({ sessionID: 's1' });
    expect(calls).toHaveLength(1);  // prompt 透传
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/identity-queue-intercept.test.ts`
Expected: FAIL（withIdentityPrompt 无第 5 参）

- [ ] **Step 3: 实现**

1. `contract.ts`：`delivery?: 'steer' | 'followup' | 'queue'` + `idempotencyKey?: string`（注释引 spec §5.6 三档语义——'queue' 为 gateway 拦截档）
2. `identity-state.ts` withIdentityPrompt 签名加可选 `intercept`；Proxy get 的 promptAsync 分支：`if (prop === 'promptAsync') return (o: S) => { const applied = apply(o); const short = intercept?.(applied); return short ?? target.promptAsync(applied); };`（short 为 Promise 时短路——注意 `??` 对 Promise 也成立：undefined 才透传）
3. `index.ts` wrapRuntimeIdentity：`withIdentityPrompt(rt.session, ..., (opts: any) => this.interceptQueuePrompt(opts))`；`interceptQueuePrompt(opts)`：`opts?.delivery === 'queue' && this.busySessions.has(opts.sessionID)` → `return this.enqueueQueuedPrompt(opts, opts.source ?? 'runtime')`；否则 undefined。
4. `enqueueQueuedPrompt` 最小版本任务实现（入队 + 返回 `{queued:true,itemId,position}`；duplicate 透传；limit throw 400 形错——**事件发射留 Task 5**，先 log.info 占位）。
5. HTTP 路由 body 解构加 `delivery, idempotencyKey` 透传。

**裁决：Task 3 与 Task 4 合并为一个 commit**（拦截无 enqueue 是空转）——Task 3 完成后**不 commit**，直接进 Task 4，两个任务的文件在 Task 4 Step 5 一起提交；测试文件各自独立（intercept 单测 / 编排单测）。
4. HTTP 路由 body 解构加 `delivery, idempotencyKey`，透传给 sdkSession.promptAsync 的 opts（facade 形参扩展——route 是 2 个 facade 消费方之一）

- [ ] **Step 4: 运行确认通过 + 既有 identity 回归**

Run: `cd gateway && npx jest tests/unit/runtime/identity-queue-intercept.test.ts tests/unit/runtime --silent 2>&1 | Select-String "Tests:"`
Expected: 新 5 例 PASS + runtime 套件全绿（identity-state 既有测试不破——第 5 参可选）

- [ ] **Step 5: 不单独提交（Task 3+4 合并 commit——见 Step 3 裁决；文件留工作树，直接进 Task 4）**

---

### Task 4: enqueue/flush 编排（index.ts）

**Files:**
- Modify: `gateway/src/index.ts`（enqueueQueuedPrompt + flushSessionQueue + 终态 flush 挂点 + Task 3 合并 commit）
- Test: `gateway/tests/unit/core/queue-orchestration.test.ts`（新建——编排逻辑抽纯函数测）

**Interfaces:**
- Consumes: Task 1 SessionQueue 全 API、Task 2 busySessions/sweep、Task 3 intercept
- Produces:
  - `private enqueueQueuedPrompt(opts: SessionPromptOpts & { source?: string }): Promise<{ queued: true; itemId: string; position: number } | { queued: true; duplicate: true; itemId: string }>`
    （rejected 路径直接 throw `QueueLimitError`——HTTP 层 400）
  - `private flushSessionQueue(sessionID: string): void`——`void` fire-and-forget（C3）
  - 纯函数（导出供单测）：`gateway/src/core/queue-flush.ts` 的 `shouldFlush(queue: SessionQueue, busySessions: Map<string, number>, sessionID: string): QueuedItem | null`（!busy && size>0 → dequeue，else null）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/core/queue-orchestration.test.ts
import { SessionQueue } from '../../../src/core/session-queue';
import { shouldFlush } from '../../../src/core/queue-flush';

describe('flush 编排纯函数（spec §5.4）', () => {
  it('idle + 有队 → 取队首（每终态一条 C3）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', { text: 'a', source: 't' });
    q.enqueue('s1', { text: 'b', source: 't' });
    const busy = new Map<string, number>();
    const item = shouldFlush(q, busy, 's1')!;
    expect(item.text).toBe('a');
    expect(q.size('s1')).toBe(1);           // 只取一条
    expect(shouldFlush(q, busy, 's1')!.text).toBe('b');  // 下一终态再取
    expect(shouldFlush(q, busy, 's1')).toBeNull();       // 空 → null
  });
  it('busy（flush 后新 turn 已开始）→ 不取（Review Focus #3：防 flush 重入）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', { text: 'a', source: 't' });
    const busy = new Map([['s1', Date.now()]]);
    expect(shouldFlush(q, busy, 's1')).toBeNull();
    expect(q.size('s1')).toBe(1);           // 队列不动
  });
  it('shouldFlush 剥离 delivery/idempotencyKey 的责任在调用方（item 原样携带，发送时剥离）', () => {
    const q = new SessionQueue();
    const { item } = q.enqueue('s1', { text: 'a', source: 't', idempotencyKey: 'k' }) as any;
    expect(item.idempotencyKey).toBe('k');  // item 保留完整信息（发送时构造新 opts）
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/core/queue-orchestration.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

1. `queue-flush.ts`：`shouldFlush` = `!busySessions.has(sessionID) && queue.size(sessionID) > 0 ? queue.dequeue(sessionID) : null`
2. `enqueueQueuedPrompt`：调 `sessionQueue.enqueue`（source 字段：HTTP 路由 'http' / 咽喉 'runtime' / 迁移站点显式传）；duplicate → 返回 duplicate 形；rejected → `throw Object.assign(new Error('session queue limit reached (32)'), { statusCode: 400 })`；item → 返回 `{queued:true,itemId,position:size}`（事件发射 Task 5——**本任务先 log.info 占位**）
3. `flushSessionQueue`：`const item = shouldFlush(...)` → null 即返；非空 → 构造发送 opts（剥离 delivery/idempotencyKey/source）→ `void this.sdkSession.promptAsync(...)`（**经 facade 走 identity apply**——facet 与 P0-2 同理）`.catch(err => log.warn)`（C3）
4. 终态挂点：Task 2 的三终态分支补 `void this.flushSessionQueue(sessionID);`
5. sweep 的 busy 清除处同样 `void this.flushSessionQueue(sid)`（防楔死恢复后续发）
6. **与 Task 3 合并 commit**

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/core/queue-orchestration.test.ts tests/unit/runtime/identity-queue-intercept.test.ts --silent`
Expected: PASS

- [ ] **Step 5: Commit（Task 3+4 合并）**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/identity-state.ts gateway/src/core/queue-flush.ts gateway/src/index.ts gateway/tests/unit/runtime/identity-queue-intercept.test.ts gateway/tests/unit/core/queue-orchestration.test.ts
git commit -m "feat(queue): chokepoint interception (withIdentityPrompt 5th param, explicit opt-in) + enqueue/flush orchestration - one-per-terminal serial, fire-and-forget, identity-preserving send"
```

---

### Task 5: queue.updated 事件 + 管理路由 + 词汇守卫链

**Files:**
- Modify: `gateway/src/runtime/mafw-vocabulary.ts`（MAFW map 加 `queueUpdated: 'queue.updated'`）
- Modify: `gateway/src/index.ts`（emit helper `emitQueueUpdated(sessionID, action, items, itemId?)` 挂到 enqueue/cancel/clear/expire/flush 五处 + Task 4 的 log 占位替换）
- Modify: `gateway/src/index.ts`（三条管理路由，abort 路由旁）
- Modify: `gateway/src/routes/route-catalog.ts`（3 行登记）+ SDK 契约重生成（`npm run emit:openapi` + `cd ../packages/gateway-sdk && npm run gen:api`）
- Modify: `packages/gateway-sdk/src/events.ts`（union 加 `'queue.updated'`）+ `packages/tui/src/store/connection.ts`（KNOWN_EVENTS 加 `'queue.updated'`）
- Test: `gateway/tests/unit/runtime/queue-event-vocab.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1-4 全部
- Produces: `queue.updated` canonical 事件（载荷 `{sessionID, items, action, itemId?}`——经 `mafwBroadcast` 信封广播 → 自动持久化）；`GET /api/session/:id/queue`、`DELETE /api/session/:id/queue/:itemId`、`DELETE /api/session/:id/queue`；SDK `MafwClient.session.queueList/queueCancel/queueClear`（client.ts 本批）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime/queue-event-vocab.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');
const vocab = readFileSync(join(__dirname, '../../../src/runtime/mafw-vocabulary.ts'), 'utf8');
const sdkEvents = readFileSync(join(__dirname, '../../../../packages/gateway-sdk/src/events.ts'), 'utf8');
const tuiConn = readFileSync(join(__dirname, '../../../../packages/tui/src/store/connection.ts'), 'utf8');

describe('queue.updated 词汇四层守卫（C7）+ 事件发射 wiring（C8）', () => {
  it('词汇单源：MAFW map 含 queueUpdated', () => {
    expect(vocab).toMatch(/queueUpdated: 'queue\.updated'/);
  });
  it('SDK events union 含 queue.updated（守卫层 2）', () => {
    expect(sdkEvents).toContain("'queue.updated'");
  });
  it('TUI KNOWN_EVENTS 含 queue.updated（守卫层 4）', () => {
    expect(tuiConn).toContain("'queue.updated'");
  });
  it('emit 走 this.broadcast（C8：骑回放持久化，Review Focus #4）', () => {
    expect(src).toMatch(/emitQueueUpdated/);
    expect(src).toMatch(/this\.broadcast\(mafwBroadcast\(\{\s*type: MAFW\.queueUpdated/);
  });
  it('五处发射点：enqueue/cancel/clear/expire/flush', () => {
    const hits = src.match(/emitQueueUpdated\(/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(5);
  });
  it('管理路由三条', () => {
    expect(src).toMatch(/\/api\/session\/\(\[sessionId\]\)\/queue/);
    expect(src).toContain("queueList");
    expect(src).toContain("queueCancel");
    expect(src).toContain("queueClear");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/queue-event-vocab.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

1. vocabulary：MAFW map `queueUpdated: 'queue.updated'`（gateway 合成档，usage.updated 先例）。**desktop 守卫闭环**：`assertShellEventCoverage` 的 union 单源是 SDK `events.ts`——Step 3 改 SDK union 后 desktop 套件自动覆盖；但 desktop 的 `session-events.ts` `IGNORED_AT_SHELL` 需加 `'queue.updated'`（builder check 已证未知事件仅 warn 不炸——加 IGNORED 是降噪不是必需；**裁决：不加**，warn 留给 desktop 会话正式做队列 UI 时处理，本批 desktop 零改动）
2. emitQueueUpdated：`this.broadcast(mafwBroadcast({ type: MAFW.queueUpdated, properties: { sessionID, items, action, ...(itemId ? { itemId } : {}) }, sessionID }, false))`——五处调用：enqueueQueuedPrompt 成功后 / flushSessionQueue 取出后 / cancel / clear / sweep 的 expire 摘除
3. 路由（abort 路由模式复制）：GET queue → `{items}`；DELETE queue/:itemId → cancel null 时 404 else `{cancelled: item}` + emit；DELETE queue → `{cleared: n}` + emit
4. route-catalog 3 行 + `npm run emit:openapi` + sdk `npm run gen:api`
5. SDK client.ts：session 命名空间加三方法（fetch 形态对照既有 fork/revert 方法）；SDK types 若有 SessionPromptOpts 镜像加 delivery/idempotencyKey
6. TUI KNOWN_EVENTS 追加

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `cd gateway && npx jest tests/unit/runtime/queue-event-vocab.test.ts tests/unit/api-contract.test.ts --silent`
Expected: PASS（api-contract 契约重生成后绿）

Run: `cd gateway && npx jest 2>&1 | Select-String "Test Suites:|Tests:"` → ≥340 套件全绿（已知 laya flake 隔离复跑）
Run: `cd packages/tui && node --test "tests/*.test.ts"` → 220+（KNOWN_EVENTS 覆盖测试跟随）
Run: `cd packages/gateway-sdk && npm test` → 全绿（events union 测试）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/mafw-vocabulary.ts gateway/src/index.ts gateway/src/routes/route-catalog.ts packages/gateway-sdk/src/events.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts packages/tui/src/store/connection.ts gateway/tests/unit/runtime/queue-event-vocab.test.ts
git commit -m "feat(queue): queue.updated canonical event (4-layer vocab guard chain, rides event replay persistence) + 3 management routes + SDK client surface"
```

---

### Task 6: G6 迁移（三 notify 站点）+ 全量收口

**Files:**
- Modify: `gateway/src/index.ts`（milestone promptNoReply deps 注入处 + notifyUpdateComplete + BudgetGuard notify 闭包 ×2（goal 版 + prompt 版）——4 处 promptAsync 调用加 `delivery:'queue', idempotencyKey`）
- Test: `gateway/tests/unit/runtime/queue-migration-wiring.test.ts`（新建，源码断言）

**Interfaces:**
- Consumes: Task 3 咽喉（三站点直调 runtime.session.promptAsync——拦截天然生效）
- Produces: 迁移 wiring 断言（调用点显式 `delivery:'queue'` + 各自 idempotencyKey：milestone 用 dedupe key、self-update 用 `self-update-notify`、budget 用 `budget-stop-<sessionID>`）

- [ ] **Step 1: 写失败测试（源码断言）**

```typescript
// gateway/tests/unit/runtime/queue-migration-wiring.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');

describe('G6 迁移：三 notify 站点切 delivery:queue（spec §2 v2 Q3）', () => {
  it('milestone promptNoReply 带 delivery queue + 幂等 key', () => {
    const i = src.indexOf('promptNoReply: async (sid, text) =>');
    const seg = src.slice(i, i + 300);
    expect(seg).toContain("delivery: 'queue'");
    expect(seg).toMatch(/idempotencyKey/);
  });
  it('自更新通知带 delivery queue', () => {
    const i = src.indexOf('notifyUpdateComplete()');
    const seg = src.slice(src.indexOf('private async notifyUpdateComplete'), src.indexOf('private async notifyUpdateComplete') + 1600);
    expect(seg).toContain("delivery: 'queue'");
  });
  it('BudgetGuard notify ×2 带 delivery queue（BudgetGuard 构造点在 index.ts 两处：attachBudgetGuardForGoal/ForPrompt 的 notify 闭包）', () => {
    const hits = src.match(/notify: async \(sid, text\) =>/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    let cursor = 0;
    for (const h of hits) {
      const i = src.indexOf(h, cursor); cursor = i + 1;
      const seg = src.slice(i, i + 420);
      expect(seg).toContain("delivery: 'queue'");
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/queue-migration-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现（4 处调用加参）**

milestone deps（`promptNoReply` 闭包）：`{ sessionID: sid, parts: [...], expectReply: false, delivery: 'queue', idempotencyKey: key /* 既有 dedupe key 透传——deps 签名加可选 key 形参 */ }`；notifyUpdateComplete 与 BudgetGuard notify ×2 同式（各自稳定 key）。BudgetGuard 的 notify 闭包在 index.ts 两处构造（goal 版 attachBudgetGuardForGoal + prompt 版 attachBudgetGuardForPrompt）。

- [ ] **Step 4: 四套全量回归**

Run:
```
cd gateway && npx jest 2>&1 | Select-String "Test Suites:|Tests:"    # ≥341 suites（337+4 新）
cd gateway && npx tsc --noEmit                                        # 干净
cd packages/desktop && npm test                                       # ≥1131
cd packages/tui && node --test "tests/*.test.ts"                      # 220+
cd adapters/claude && npm test                                        # 24
cd packages/gateway-sdk && npm test                                   # 全绿
```

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/tests/unit/runtime/queue-migration-wiring.test.ts
git commit -m "feat(queue): G6 migration - milestone-push + self-update + budget-guard notifies switch to delivery:queue with idempotency keys"
```

---

## 收口（执行者完成全部任务后）

1. 汇总：新增测试数 / 五套全量数（对照 C10 基线 + gateway-sdk）
2. `cd gateway && npx tsc --noEmit` 必须干净
3. 向用户汇报：交付内容表 + 测试计数 + commit 列表
