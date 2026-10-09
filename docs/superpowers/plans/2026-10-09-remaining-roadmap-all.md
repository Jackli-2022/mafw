# 脑启发记忆演化：剩余路线全量实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 路线图 §5 全部剩余项的实施计划（D3 已有独立计划 `2026-10-09-d3-laya-three-way-gate.md`）。按依赖与测量可达性排序：D2 → D4a → A2 → A1 → L3 → P1.5 →（spec-first）D5 / A5 / D4b →（远期大纲）D6/D7/L4/W3。

**Architecture:** 所有新后台管线统一形态：纯函数核心（可测）+ 薄 cron 接线 + `PipelineBudget` 门控 + `PipelineHeartbeat` 记录 + observe-first（默认不改变行为，数据攒够 + 用户批准才开闸）。所有 laya 接入点三值输出（确定是/确定否/不知道→LLM），τ 独立校准。

**Tech Stack:** TypeScript（gateway）、jest、cron automation rules、laya sidecar、RetrievalEventBuffer、gateway.db。

## Global Constraints

- TDD：每 Task 先红后绿；测试 import 路径 `tests/unit/<sub>/` 用 `../../../src/`。
- **jest 不 typecheck `gateway/src/index.ts`**——凡改 index.ts 的 Task 必须跑 root `npm run build`。
- 每条新管线：默认关闭或 observe-only；开闸 = 数据分析 + 用户显式批准（同 D3 纪律）。
- 每条新 LLM 管线必须接 `budget: this.getPipelineBudget()`（`recall/pipeline-budget.ts`）。
- 每条新管线必须接 heartbeat `record(name, ...)` 并在 `recall/pipeline-heartbeat.ts` 登记预期间隔。
- 中文内容只经 write/edit 工具落盘。
- commit 用 repo 根相对路径；全量门禁 `cd gateway && npx jest --runInBand`（当前基线 **1786**）。
- 设计依据：`docs/research/2026-10-08-brain-like-roadmap.md` §2.5/§2.6/§3/§4/§5。

---

## Phase A：D2 检索即重写（reconsolidation 消费 worker）

**Goal:** 被检索且被使用的记忆进入 24h labile 窗口（已有）后，每日管线主动用"更新的相关记忆"对照，需重写则经 supersedes 链更新——知识更新延迟从"等 turnCompress 撞上"缩到每日兜底。

**现状事实：** `recall/reconsolidation.ts`：`getReconsolidationQueue()`（mark/isEligible/listEligible/consume，模块单例）+ `shouldReconsolidate(verdict, targetId)` 预测误差门。反馈路径已 mark；**消费端缺失**。

### Task A1: ReconsolidatePipeline 纯逻辑 + 测试

**Files:**
- Create: `gateway/src/recall/reconsolidate-pipeline.ts`
- Test: `gateway/tests/unit/recall/reconsolidate-pipeline.test.ts`

**Interfaces:**
- Consumes: `ReconsolidationQueue`（`recall/reconsolidation.ts`）、`HarmonicIndexManager.getIndex()`、`PipelineBudgetLike`。
- Produces: `ReconsolidatePipeline`（`runOnce(): Promise<{checked:number;rewritten:number;skipped:number}>`）；`selectNewerRelated(unit, entries, now)` 纯函数。index.ts 接线依赖类名与选项字段名。

- [ ] **Step 1: 写失败测试**

```typescript
import { ReconsolidatePipeline, selectNewerRelated } from '../../../src/recall/reconsolidate-pipeline';
import { InMemoryReconsolidationQueue } from '../../../src/recall/reconsolidation';

const entry = (id: string, cues: string[], created: string) => ({
  id, type: 'semantic', primary_abstraction: `abs ${id}`, cue_anchors: cues,
  energy: 0.8, salience: 1, created_at: created, filePath: `memory/concepts/semantic/x-${id}.md`,
} as any);

describe('selectNewerRelated', () => {
  const now = Date.parse('2026-10-09T00:00:00Z');
  test('picks newer entries sharing a cue anchor, excludes self and superseded', () => {
    const unit = entry('m1', ['gateway', 'deploy'], '2026-10-01T00:00:00Z');
    const entries = [
      entry('m1', ['gateway'], '2026-10-02T00:00:00Z'),                                   // self
      entry('m2', ['gateway'], '2026-10-05T00:00:00Z'),                                   // match
      { ...entry('m3', ['deploy'], '2026-10-06T00:00:00Z'), superseded_by: 'm9' },        // superseded
      entry('m4', ['unrelated'], '2026-10-07T00:00:00Z'),                                 // no shared cue
      entry('m5', ['gateway'], '2026-09-01T00:00:00Z'),                                   // older than unit
    ];
    expect(selectNewerRelated(unit, entries, now).map((e: any) => e.id)).toEqual(['m2']);
  });
  test('caps at 5 by recency', () => {
    const unit = entry('m1', ['x'], '2026-09-01T00:00:00Z');
    const entries = Array.from({ length: 8 }, (_, i) =>
      entry(`n${i}`, ['x'], `2026-10-0${i + 1}T00:00:00Z`));
    expect(selectNewerRelated(unit, entries, now).length).toBe(5);
  });
});

describe('ReconsolidatePipeline.runOnce', () => {
  const makePipeline = (opts: { verdict: string; budgetDeny?: boolean }) => {
    const queue = new InMemoryReconsolidationQueue();
    queue.mark('m1', 'retrieved');
    const prompts: string[] = [];
    const written: any[] = [];
    const unit = {
      id: 'm1', type: 'semantic', primary_abstraction: 'abs m1', cue_anchors: ['gateway'],
      memory_value: '旧事实', energy: 0.8, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    };
    const pipe = new ReconsolidatePipeline({
      queue,
      index: { getIndex: () => ({ entries: [entry('m2', ['gateway'], '2026-10-05T00:00:00Z')] }) } as any,
      readMemory: async (id) => (id === 'm1' ? unit as any : null),
      readRelated: async (id) => ({ id, memory_value: `新事实 ${id}` } as any),
      worker: { prompt: async (p: string) => { prompts.push(p); return opts.verdict; } } as any,
      writeSuperseding: async (oldId, content) => { written.push({ oldId, content }); return 'new-id'; },
      budget: { allow: () => !opts.budgetDeny },
      maxPerRun: 10,
    });
    return { pipe, prompts, written, queue };
  };

  test('rewrite verdict → supersedes chain write + consume', async () => {
    const { pipe, written, queue } = makePipeline({ verdict: '{"action":"rewrite","content":"新事实 m2 已取代旧事实"}' });
    const r = await pipe.runOnce();
    expect(r).toEqual({ checked: 1, rewritten: 1, skipped: 0 });
    expect(written[0].oldId).toBe('m1');
    expect(queue.isEligible('m1')).toBe(false); // consumed
  });

  test('keep verdict → no write, still consumed', async () => {
    const { pipe, written, queue } = makePipeline({ verdict: '{"action":"keep"}' });
    const r = await pipe.runOnce();
    expect(r).toEqual({ checked: 1, rewritten: 0, skipped: 0 });
    expect(written.length).toBe(0);
    expect(queue.isEligible('m1')).toBe(false);
  });

  test('budget deny → zero work, queue untouched', async () => {
    const { pipe, queue } = makePipeline({ verdict: '{}', budgetDeny: true });
    const r = await pipe.runOnce();
    expect(r).toEqual({ checked: 0, rewritten: 0, skipped: 0 });
    expect(queue.isEligible('m1')).toBe(true);
  });

  test('worker garbage JSON → skipped, consumed (no retry storm)', async () => {
    const { pipe, queue } = makePipeline({ verdict: 'not json' });
    const r = await pipe.runOnce();
    expect(r.skipped).toBe(1);
    expect(queue.isEligible('m1')).toBe(false);
  });

  test('no newer related → skip without worker call', async () => {
    const { pipe, prompts } = makePipeline({ verdict: '{}' });
    (pipe as any).opts.index = { getIndex: () => ({ entries: [] }) };
    const r = await pipe.runOnce();
    expect(r).toEqual({ checked: 0, rewritten: 0, skipped: 1 });
    expect(prompts.length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑红** `cd gateway; npx jest tests/unit/recall/reconsolidate-pipeline.test.ts 2>&1 | Select-Object -Last 5` → FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// D2 consumer: entries in the reconsolidation (labile) window are checked
// once daily against NEWER memories sharing a cue anchor. A worker decides
// keep/rewrite; rewrite goes through the supersedes chain. Budget-gated;
// every eligible id is consumed exactly once per pass (no retry storms).
import { HarmonicIndexEntry, HarmonicUnit } from '../core/memory/harmonic-types';
import { ReconsolidationQueue } from './reconsolidation';
import { PipelineBudgetLike } from './pipeline-budget';

export interface ReconsolidateDeps {
  queue: ReconsolidationQueue;
  index: { getIndex(): { entries: HarmonicIndexEntry[] } };
  readMemory: (id: string) => Promise<HarmonicUnit | null>;
  readRelated: (id: string) => Promise<{ id: string; memory_value: string } | null>;
  worker: { prompt(text: string, system: string): Promise<string> };
  writeSuperseding: (oldId: string, content: string) => Promise<string>;
  budget?: PipelineBudgetLike;
  maxPerRun?: number; // default 10
  maxRelated?: number; // default 5
}

/** Newer, live entries sharing ≥1 cue anchor with the unit, capped by recency. */
export function selectNewerRelated(
  unit: { id: string; cue_anchors: string[]; created_at: string },
  entries: HarmonicIndexEntry[],
  now: number,
  cap = 5,
): HarmonicIndexEntry[] {
  const unitCreated = new Date(unit.created_at).getTime();
  const cues = new Set(unit.cue_anchors ?? []);
  return entries
    .filter((e) => e.id !== unit.id && !e.superseded_by)
    .filter((e) => (e.cue_anchors ?? []).some((c) => cues.has(c)))
    .filter((e) => {
      const c = e.created_at ? new Date(e.created_at).getTime() : 0;
      return c > unitCreated && c <= now;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, cap);
}

const SYSTEM = `You are reviewing whether an existing long-term memory needs rewriting given newer related memories. Reply with ONLY JSON: {"action":"keep"} or {"action":"rewrite","content":"<merged updated memory text>"}. Rewrite only when the newer material contradicts or clearly evolves the old one; mere re-encounter = keep.`;

export class ReconsolidatePipeline {
  constructor(private opts: ReconsolidateDeps) {}

  async runOnce(): Promise<{ checked: number; rewritten: number; skipped: number }> {
    const result = { checked: 0, rewritten: 0, skipped: 0 };
    if (this.opts.budget && !this.opts.budget.allow('reconsolidate')) return result;
    const ids = this.opts.queue.listEligible().slice(0, this.opts.maxPerRun ?? 10);
    const entries = this.opts.index.getIndex().entries;
    const now = Date.now();
    for (const id of ids) {
      this.opts.queue.consume(id);
      const unit = await this.opts.readMemory(id);
      if (!unit || unit.superseded_by) { result.skipped++; continue; }
      const related = selectNewerRelated(unit, entries, now, this.opts.maxRelated ?? 5);
      if (related.length === 0) { result.skipped++; continue; }
      const relatedTexts: string[] = [];
      for (const r of related) {
        const u = await this.opts.readRelated(r.id);
        if (u) relatedTexts.push(`- ${u.memory_value}`);
      }
      if (relatedTexts.length === 0) { result.skipped++; continue; }
      result.checked++;
      const text = `EXISTING MEMORY:\n${unit.memory_value}\n\nNEWER RELATED MEMORIES:\n${relatedTexts.join('\n')}`;
      let verdict: { action?: string; content?: string } | null = null;
      try {
        const reply = await this.opts.worker.prompt(text, SYSTEM);
        verdict = JSON.parse(reply.replace(/```json|```/g, '').trim());
      } catch { verdict = null; }
      if (verdict?.action === 'rewrite' && typeof verdict.content === 'string' && verdict.content.trim()) {
        await this.opts.writeSuperseding(id, verdict.content.trim());
        result.rewritten++;
      } else if (verdict?.action === 'keep') {
        // no-op
      } else {
        result.skipped++;
      }
    }
    return result;
  }
}
```

- [ ] **Step 4: 跑绿** → 同上命令，7 例 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/reconsolidate-pipeline.ts gateway/tests/unit/recall/reconsolidate-pipeline.test.ts
git commit -m "feat: D2 reconsolidation consumer pipeline (keep/rewrite via supersedes)"
```

### Task A2: cron 接线 + heartbeat + 门禁

**Files:**
- Modify: `gateway/src/recall/pipeline-rules.ts`（加规则）
- Modify: `gateway/src/recall/pipeline-heartbeat.ts`（登记 `memory:reconsolidate` 1 DAY）
- Modify: `gateway/src/index.ts`（action 注册闭包）

**Interfaces:**
- Consumes: Task A1 的 `ReconsolidatePipeline`；`getReconsolidationQueue()`；`HarmonicUnitFileStore.write`（supersedes 语义经 unit 字段）。
- Produces: 规则 `memory-reconsolidate`，cron `30 4 * * *` UTC（decay 3:30 / review 周日 4:00 之后）。

- [ ] **Step 1: pipeline-rules.ts RULES 加一行**

```typescript
  { id: 'memory-reconsolidate', schedule: '30 4 * * *', timezone: 'UTC', action: 'memory:reconsolidate' },
```

- [ ] **Step 2: pipeline-heartbeat.ts 间隔表加** `'memory:reconsolidate': 1 * DAY`（对齐现有条目写法）。

- [ ] **Step 3: index.ts 注册 action**（`registerMemoryPipelineActions` 同区，仿 memory:review 闭包）：

```typescript
      engine.registerAction('memory:reconsolidate', async () => {
        try {
          if (!this.memoryService) return;
          const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
          const pipe = new ReconsolidatePipeline({
            queue: getReconsolidationQueue(),
            index: this.memoryService.harmonicIndex,
            readMemory: (id) => store.read(id),
            readRelated: (id) => store.read(id),
            worker: this.getPool().getWorker('reconsolidate', 'reflect'),
            writeSuperseding: async (oldId, content) => {
              const old = await store.read(oldId);
              const id = generateHarmonicId();
              await store.write({
                id, type: old?.type ?? 'semantic',
                primary_abstraction: content.slice(0, 80),
                cue_anchors: [...(old?.cue_anchors ?? []), 'reconsolidated'],
                memory_value: content,
                energy: Math.max(0.8, old?.energy ?? 0.8),
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              } as HarmonicUnit);
              await store.markSuperseded(oldId, id);
              return id;
            },
            budget: this.getPipelineBudget(),
          });
          const r = await pipe.runOnce();
          this.heartbeat?.record('memory:reconsolidate', { ok: true, counts: r });
          log.info(`[Reconsolidate] checked=${r.checked} rewritten=${r.rewritten} skipped=${r.skipped}`);
        } catch (err: any) {
          this.heartbeat?.record('memory:reconsolidate', { ok: false, error: err?.message });
          log.warn(`[Reconsolidate] failed: ${err?.message || err}`);
        }
      });
```

（`getReconsolidationQueue`/`ReconsolidatePipeline`/`generateHarmonicId` 的 import 加到 index.ts 对应 import 区；`generateHarmonicId` 来自 `core/memory/harmonic-types`。）

- [ ] **Step 4: 门禁** `npm run build`（root，exit 0）+ `cd gateway; npx jest --runInBand 2>&1 | Select-Object -Last 4`

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/pipeline-rules.ts gateway/src/recall/pipeline-heartbeat.ts gateway/src/index.ts
git commit -m "feat: wire memory:reconsolidate daily cron + heartbeat + budget gate"
```

---

## Phase B：D4a 做梦预取（nightly dream prefetch）

**Goal:** 每晚对最近活跃会话生成"明天最可能问"的查询并预建 R8 快照——次日首轮边界 recall 直接命中快照（~3ms）而非实时检索。

**现状事实：** `IndexScanService.prefetch(sessionID, query)` 现成（节流 60s/会话，快照 TTL 10min——**注意：快照 10min 过期，夜间预取需把快照 TTL 对 dream 快照延长或早晨重刷**——v1 改为：dream 不写快照，只把生成的查询存 kv，首次 obs/capture 时优先用 dream 查询做预取）。

### Task B1: dream 查询生成纯逻辑 + 测试

**Files:**
- Create: `gateway/src/recall/dream-prefetch.ts`
- Test: `gateway/tests/unit/recall/dream-prefetch.test.ts`

**Interfaces:**
- Produces: `selectDreamSessions(turns, opts): string[]`（近 24h 有完成回合、非内部角色、按活跃度 top 5）；`parseDreamQueries(reply, max): string[]`（从 worker 回复解析 ≤3 条查询，每行一条，过滤空/超长>200）；`DREAM_SYSTEM` 常量。index.ts 依赖这三个导出。

- [ ] **Step 1: 写失败测试**

```typescript
import { selectDreamSessions, parseDreamQueries } from '../../../src/recall/dream-prefetch';

describe('selectDreamSessions', () => {
  const turn = (sid: string, ageH: number) => ({
    session_id: sid, turn_id: 1, status: 'completed',
    last_ts: Date.now() / 1000 - ageH * 3600,
  });
  test('picks sessions active within 24h, excludes internal roles, top 5 by recency', () => {
    const turns = [
      turn('s-recent', 1), turn('s-old', 30), turn('s-internal', 2),
      ...Array.from({ length: 6 }, (_, i) => turn(`s-${i}`, i + 2)),
    ];
    const ids = selectDreamSessions(turns as any, {
      now: Date.now(), maxSessions: 5, windowMs: 24 * 3600_000,
      isInternal: (sid) => sid === 's-internal',
    });
    expect(ids).not.toContain('s-old');
    expect(ids).not.toContain('s-internal');
    expect(ids).toContain('s-recent');
    expect(ids.length).toBeLessThanOrEqual(5);
  });
  test('empty input → empty', () => {
    expect(selectDreamSessions([], { now: Date.now(), maxSessions: 5, windowMs: 86400_000, isInternal: () => false })).toEqual([]);
  });
});

describe('parseDreamQueries', () => {
  test('parses one query per line, trims, drops empties and >200 chars, caps at max', () => {
    const reply = '用户下次可能问 gateway 部署状态\n\n' + 'x'.repeat(300) + '\n记忆系统的预算帽生效了吗\n第三条查询\n第四条查询';
    expect(parseDreamQueries(reply, 3)).toEqual([
      '用户下次可能问 gateway 部署状态',
      '记忆系统的预算帽生效了吗',
      '第三条查询',
    ]);
  });
  test('garbage → empty', () => {
    expect(parseDreamQueries('', 3)).toEqual([]);
    expect(parseDreamQueries('\n\n', 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑红** `cd gateway; npx jest tests/unit/recall/dream-prefetch.test.ts 2>&1 | Select-Object -Last 4` → FAIL

- [ ] **Step 3: 实现**

```typescript
// D4a dream prefetch: nightly, per recently-active session, a worker
// generates the 3 most likely next-session queries; the first obs/capture
// of the day prefetches them into R8 snapshots.
export interface DreamTurn { session_id: string; status: string; last_ts?: number }

export function selectDreamSessions(
  turns: DreamTurn[],
  opts: { now: number; maxSessions: number; windowMs: number; isInternal: (sid: string) => boolean },
): string[] {
  const latest = new Map<string, number>();
  for (const t of turns) {
    if (t.status !== 'completed' || !t.last_ts) continue;
    const tsMs = t.last_ts * 1000;
    if (opts.now - tsMs > opts.windowMs) continue;
    if (opts.isInternal(t.session_id)) continue;
    latest.set(t.session_id, Math.max(latest.get(t.session_id) ?? 0, tsMs));
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.maxSessions).map(([sid]) => sid);
}

export function parseDreamQueries(reply: string, max: number): string[] {
  return (reply ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length <= 200)
    .slice(0, max);
}

export const DREAM_SYSTEM = `Given the tail of a coding-agent session transcript, list the 3 most likely questions or tasks the user will open with next time. One per line, no numbering, no commentary.`;
```

- [ ] **Step 4: 跑绿** → 4 例 PASS

- [ ] **Step 5: Commit** `git add gateway/src/recall/dream-prefetch.ts gateway/tests/unit/recall/dream-prefetch.test.ts; git commit -m "feat: D4a dream session selection + query parsing"`

### Task B2: cron 接线 + 首捕获消费

**Files:**
- Modify: `gateway/src/recall/pipeline-rules.ts`（`memory-dream` 规则 `0 2 * * *` UTC）
- Modify: `gateway/src/recall/pipeline-heartbeat.ts`（`memory:dream` 1 DAY）
- Modify: `gateway/src/index.ts`（action 闭包 + obs/capture 消费 dream 查询）

**Interfaces:**
- Consumes: Task B1 三导出；kv scope `dream-queries`（key=sessionID, value=`{queries:string[], generatedAt}`）；`scanService.prefetch`。
- Produces: `/api/obs/capture` 的 user_input 分支：若 kv 有该会话 dream 查询 → 逐条 `scanService.prefetch(sessionID, q)` 后删除 kv（一次性消费）。

- [ ] **Step 1: 规则 + heartbeat 登记**（写法同 Task A2 Step 1/2，id `memory-dream`、action `memory:dream`、schedule `0 2 * * *`）

- [ ] **Step 2: index.ts action 闭包**

```typescript
      engine.registerAction('memory:dream', async () => {
        try {
          if (!this.scanService) return;
          const db = this.getGatewayDb();
          const sids = selectDreamSessions(db.listTurns(), {
            now: Date.now(), maxSessions: 5, windowMs: 24 * 3600_000,
            isInternal: (sid) => this.internalSessionRoles.has(sid),
          });
          let generated = 0;
          for (const sid of sids) {
            if (!this.getPipelineBudget().allow('dream')) break;
            const tail = db.readSessionObservations(sid, 20) // 若方法名不同以实际为准：取该会话最近 20 条观察
              .map((o: any) => o.content).filter(Boolean).join('\n').slice(-3000);
            if (!tail.trim()) continue;
            const worker = this.getPool().getWorker(`dream-${sid}`, 'reflect');
            const reply = await worker.prompt(`SESSION TAIL:\n${tail}`, DREAM_SYSTEM, config.recall.workerModel, 'memory-curator');
            const queries = parseDreamQueries(reply, 3);
            if (queries.length > 0) { db.kvSet('dream-queries', sid, { queries, generatedAt: Date.now() }); generated++; }
          }
          this.heartbeat?.record('memory:dream', { ok: true, counts: { sessions: sids.length, generated } });
        } catch (err: any) {
          this.heartbeat?.record('memory:dream', { ok: false, error: err?.message });
        }
      });
```

- [ ] **Step 3: obs/capture user_input 分支消费**（在现有快照防抖触发处旁）：

```typescript
        try {
          const dq = this.getGatewayDb().kvGet<{ queries: string[] }>('dream-queries', sessionID);
          if (dq?.queries?.length && this.scanService) {
            this.getGatewayDb().kvDelete('dream-queries', sessionID);
            for (const q of dq.queries) this.scanService.prefetch(sessionID, q);
          }
        } catch { /* fail-open */ }
```

（kvDelete 若无此方法名以 gateway-db.ts 实际 API 为准——先 Select-String 确认 kv 删除方法名再写。）

- [ ] **Step 4: 门禁** root `npm run build` + gateway 全量 jest 绿

- [ ] **Step 5: Commit** `git add gateway/src/recall/pipeline-rules.ts gateway/src/recall/pipeline-heartbeat.ts gateway/src/index.ts; git commit -m "feat: D4a nightly dream prefetch wired (kv handoff to first capture)"`

---

## Phase C：A2 真并行草稿-验证（tentative 抽象）

**Goal:** turnCompress 允许产 ≤1 条**低置信 tentative** 跨集抽象（cue_anchor 带 `tentative`，energy 封顶 0.35）；reflection 每日对这些草稿做**提升/否决**——快系统（小时）产草稿、慢系统（每日）验证，双系统真并行。

### Task C1: turnCompress prompt 放开 tentative + 能量封顶

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`（TOOL_EXTRACTION_SYSTEM 补段 + 写入后处理）
- Test: `gateway/tests/unit/recall/tentative-energy.test.ts`（新）+ 现有 turn-pipeline 套件回归

**Interfaces:**
- Produces: `capTentativeEnergy(unit)` 纯函数（cue_anchors 含 `tentative` → energy ≤0.35）；index.ts `onMemoryWritten` 或 TurnPipeline 写后处理调用点。

- [ ] **Step 1: 写失败测试**

```typescript
import { capTentativeEnergy } from '../../../src/recall/turn-pipeline';

describe('capTentativeEnergy', () => {
  const unit = (cues: string[], energy: number) => ({ cue_anchors: cues, energy }) as any;
  test('tentative anchor caps energy at 0.35', () => {
    expect(capTentativeEnergy(unit(['tentative', 'gateway'], 0.9).bind ? unit(['tentative'], 0.9) : unit(['tentative'], 0.9)).energy).toBe(0.35);
  });
  test('non-tentative untouched', () => {
    expect(capTentativeEnergy(unit(['gateway'], 0.9)).energy).toBe(0.9);
  });
  test('already-low tentative untouched', () => {
    expect(capTentativeEnergy(unit(['tentative'], 0.2)).energy).toBe(0.2);
  });
});
```

（第一个测试断言写工整：`const u = { cue_anchors: ['tentative','gateway'], energy: 0.9 } as any; expect(capTentativeEnergy(u).energy).toBe(0.35);`）

- [ ] **Step 2: 跑红** → FAIL（函数未导出）

- [ ] **Step 3: 实现**

turn-pipeline.ts 加导出 + prompt 段：

```typescript
/** A2: tentative draft abstractions (fast-system output awaiting slow-system
 *  validation) are capped at 0.35 energy until reflection promotes them. */
export function capTentativeEnergy<T extends { cue_anchors?: string[]; energy: number }>(unit: T): T {
  if ((unit.cue_anchors ?? []).includes('tentative') && unit.energy > 0.35) {
    return { ...unit, energy: 0.35 };
  }
  return unit;
}
```

TOOL_EXTRACTION_SYSTEM 的"Division of labor"段后追加：

```typescript
 + `\nException — draft abstractions: if the session's facts strongly suggest ONE cross-episode pattern, you MAY record it as type=semantic with the literal cue anchor "tentative" and importance <= 4. At most one per batch. The daily reflection pipeline will promote or discard it.`
```

接线：`HarmonicUnitFileStore.write` 的写路径在 index.ts `onMemoryWritten` 链上——在 turnCompress worker 写回处（routeAndWrite 之后）套 `capTentativeEnergy`。若 routeAndWrite 内聚更好：在 `memory/route-write.ts` 的写前 hook 里调用（改一处，测试跟着 route-write.test.ts 走）。

- [ ] **Step 4: 跑绿 + route-write/turn-pipeline 套件回归** → PASS

- [ ] **Step 5: Commit** `git add gateway/src/recall/turn-pipeline.ts gateway/src/memory/route-write.ts gateway/tests/unit/recall/tentative-energy.test.ts; git commit -m "feat: A2 tentative draft abstractions (energy-capped, reflection-validated)"`

### Task C2: reflection 提升/否决 tentative

**Files:**
- Modify: `gateway/src/recall/reflection.ts`（tentative 收集 + prompt 段 + 判定处理）
- Test: `gateway/tests/unit/recall/reflection-tentative.test.ts`（新）

**Interfaces:**
- Consumes: Task C1 的 `tentative` 锚点约定。
- Produces: `collectTentative(entries, now, maxAgeDays): HarmonicIndexEntry[]`；`applyTentativeVerdicts(verdicts, deps)`——promote: 移除 `tentative` 锚 + energy→0.7 + 加 `verified:YYYY-MM-DD`；reject: energy→0.05 + 锚换 `rejected`。

- [ ] **Step 1: 写失败测试**

```typescript
import { collectTentative, applyTentativeVerdicts } from '../../../src/recall/reflection';

const entry = (id: string, cues: string[], ageDays: number) => ({
  id, cue_anchors: cues, energy: 0.35, salience: 1,
  created_at: new Date(Date.now() - ageDays * 86400_000).toISOString(),
} as any);

describe('collectTentative', () => {
  test('picks tentative-anchored live entries', () => {
    const now = Date.now();
    const entries = [entry('t1', ['tentative'], 2), entry('n1', ['normal'], 2), { ...entry('t2', ['tentative'], 1), superseded_by: 'x' }];
    expect(collectTentative(entries, now).map((e: any) => e.id)).toEqual(['t1']);
  });
});

describe('applyTentativeVerdicts', () => {
  test('promote strips tentative, bumps energy, stamps verified', async () => {
    const writes: any[] = [];
    const deps = {
      read: async () => ({ id: 't1', cue_anchors: ['tentative', 'gateway'], energy: 0.35, memory_value: 'v', primary_abstraction: 'a', type: 'semantic' }) as any,
      write: async (u: any) => { writes.push(u); },
    };
    await applyTentativeVerdicts([{ id: 't1', verdict: 'promote' }], deps as any, new Date('2026-10-09T00:00:00Z'));
    expect(writes[0].cue_anchors).toContain('verified:2026-10-09');
    expect(writes[0].cue_anchors).not.toContain('tentative');
    expect(writes[0].energy).toBe(0.7);
  });
  test('reject demotes to 0.05 with rejected anchor', async () => {
    const writes: any[] = [];
    const deps = { read: async () => ({ id: 't1', cue_anchors: ['tentative'], energy: 0.35 }) as any, write: async (u: any) => { writes.push(u); } };
    await applyTentativeVerdicts([{ id: 't1', verdict: 'reject' }], deps as any, new Date());
    expect(writes[0].energy).toBe(0.05);
    expect(writes[0].cue_anchors).toContain('rejected');
    expect(writes[0].cue_anchors).not.toContain('tentative');
  });
});
```

- [ ] **Step 2: 跑红** → FAIL

- [ ] **Step 3: 实现**（reflection.ts 追加导出；`reflectSession` 的 prompt 组拼装处把 tentative 条目列进"DRAFT ABSTRACTIONS"段，worker 回复 JSON 解析 `{id, verdict}[]` 后调 `applyTentativeVerdicts`）：

```typescript
export function collectTentative(entries: HarmonicIndexEntry[], now: number): HarmonicIndexEntry[] {
  return entries.filter((e) => !e.superseded_by && (e.cue_anchors ?? []).includes('tentative'));
}

export interface TentativeVerdict { id: string; verdict: 'promote' | 'reject' }

export async function applyTentativeVerdicts(
  verdicts: TentativeVerdict[],
  deps: { read: (id: string) => Promise<HarmonicUnit | null>; write: (u: HarmonicUnit) => Promise<unknown> },
  now: Date,
): Promise<{ promoted: number; rejected: number }> {
  const out = { promoted: 0, rejected: 0 };
  const stamp = `verified:${now.toISOString().slice(0, 10)}`;
  for (const v of verdicts) {
    const unit = await deps.read(v.id);
    if (!unit) continue;
    const cues = (unit.cue_anchors ?? []).filter((c) => c !== 'tentative');
    if (v.verdict === 'promote') {
      await deps.write({ ...unit, cue_anchors: [...cues, stamp], energy: 0.7, updated_at: now.toISOString() });
      out.promoted++;
    } else if (v.verdict === 'reject') {
      await deps.write({ ...unit, cue_anchors: [...cues, 'rejected'], energy: 0.05, updated_at: now.toISOString() });
      out.rejected++;
    }
  }
  return out;
}
```

REFLECT_SYSTEM 追加：`If the input contains a DRAFT ABSTRACTIONS section, end your reply with a JSON line: {"drafts":[{"id":"...","verdict":"promote|reject"}]} — promote only drafts that hold up as cross-episode patterns.`

- [ ] **Step 4: 跑绿 + reflection 套件回归** → PASS

- [ ] **Step 5: Commit** `git add gateway/src/recall/reflection.ts gateway/tests/unit/recall/reflection-tentative.test.ts; git commit -m "feat: A2 reflection promotes/rejects tentative drafts"`

---

## Phase D：A1 阶梯补顶（insights → 公理候选 → 审批进 L5）

**Goal:** 周管线把高 need 的 semantic insights 蒸馏为公理候选，走 triage 审批后由既有 L5 commit 通道落库——阶梯顶端不再靠手动 `mafw_commit_heuristic`。

**形态复用 W2 skill-promotion 五段式**：扫描（纯函数闸门）→ worker 蒸馏 → staging → triage 草稿 → confirm 安装。

### Task D1: 候选扫描 + 蒸馏管线

**Files:**
- Create: `gateway/src/memory/axiom-distill.ts`
- Test: `gateway/tests/unit/memory/axiom-distill.test.ts`

**Interfaces:**
- Produces: `selectAxiomSources(entries, needFor, opts)`（type=semantic、live、need7d>0、age≥14d、按 need×energy top 20）；`parseAxiomCandidates(reply, max)`（≤3 条，每条 ≤200 字符）；index.ts 接线 + triage confirm 分支依赖导出。

- [ ] **Step 1: 写失败测试**

```typescript
import { selectAxiomSources, parseAxiomCandidates } from '../../../src/memory/axiom-distill';

const entry = (id: string, ageDays: number, type = 'semantic') => ({
  id, type, energy: 0.8, salience: 1,
  created_at: new Date(Date.now() - ageDays * 86400_000).toISOString(),
} as any);

describe('selectAxiomSources', () => {
  test('filters by type/liveness/age/need, ranks need*energy, caps', () => {
    const entries = [
      entry('ok1', 20), entry('young', 3), entry('epi', 30, 'episodic'),
      { ...entry('dead', 20), superseded_by: 'x' },
      ...Array.from({ length: 25 }, (_, i) => entry(`s${i}`, 30)),
    ];
    const needFor = (id: string) => (id === 'young' || id === 'epi' || id === 'dead' ? 99 : 1);
    const out = selectAxiomSources(entries, needFor, { now: Date.now(), minAgeDays: 14, cap: 20 });
    expect(out.map((e: any) => e.id)).not.toContain('young');
    expect(out.map((e: any) => e.id)).not.toContain('epi');
    expect(out.map((e: any) => e.id)).not.toContain('dead');
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out[0].id).toBeDefined();
  });
});

describe('parseAxiomCandidates', () => {
  test('parses lines, caps at max, drops long/empty', () => {
    const reply = '公理一：任何后台管线必须 heartbeat\n' + 'y'.repeat(300) + '\n公理二：fail-open 是默认立场\n第四条\n第五条';
    const out = parseAxiomCandidates(reply, 3);
    expect(out.length).toBe(3);
    expect(out[0]).toContain('heartbeat');
  });
});
```

- [ ] **Step 2: 跑红** → FAIL

- [ ] **Step 3: 实现**

```typescript
// A1 ladder top-off: weekly, high-need semantic insights are distilled into
// axiom CANDIDATES that land in triage; confirmation commits them to L5 via
// the existing heuristic channel. The ladder's top rung is no longer manual.
import { HarmonicIndexEntry } from '../core/memory/harmonic-types';

export function selectAxiomSources(
  entries: HarmonicIndexEntry[],
  needFor: (id: string) => number,
  opts: { now: number; minAgeDays: number; cap: number },
): HarmonicIndexEntry[] {
  return entries
    .filter((e) => e.type === 'semantic' && !e.superseded_by)
    .filter((e) => {
      const c = e.created_at ? new Date(e.created_at).getTime() : 0;
      return c > 0 && opts.now - c >= opts.minAgeDays * 86400_000;
    })
    .map((e) => ({ e, score: needFor(e.id) * e.energy * (e.salience ?? 1) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.cap)
    .map((x) => x.e);
}

export function parseAxiomCandidates(reply: string, max: number): string[] {
  return (reply ?? '').split('\n').map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length <= 200)
    .slice(0, max);
}

export const AXIOM_SYSTEM = `Distill the following validated insights into at most 3 general axioms (patterns of patterns). One per line, no numbering. Each must be actionable guidance, not a restatement of any single insight.`;
```

- [ ] **Step 4: 跑绿** → PASS

- [ ] **Step 5: Commit** `git add gateway/src/memory/axiom-distill.ts gateway/tests/unit/memory/axiom-distill.test.ts; git commit -m "feat: A1 axiom candidate scan + parsing"`

### Task D2: 周管线接线 + triage 草稿 + confirm 提交 L5

**Files:**
- Modify: `gateway/src/recall/pipeline-rules.ts`（`axiom-distill` 周日 `0 6 * * 0` UTC）
- Modify: `gateway/src/recall/pipeline-heartbeat.ts`（`memory:axiomDistill` 7 DAY）
- Modify: `gateway/src/index.ts`（action 闭包 + triage confirm 的 axiomDraft 分支）

**Interfaces:**
- Consumes: Task D1 导出；W2 既有 `skillDraft` triage 模式（`POST /api/triage/:id/confirm` 分支）；L5 commit 通道（`mafw_commit_heuristic` 的持久化函数——接线时先 Select-String 找 `commitHeuristic` 实际函数名再调）。
- Produces: triage 草稿 `summary.axiomDraft: { candidates: string[], sourceIds: string[] }`；confirm 后每条 candidate 经 L5 通道提交。

- [ ] **Step 1: 规则 + heartbeat**（同 Task A2 Step 1/2 写法）

- [ ] **Step 2: index.ts action**：扫描 → 读全文拼 evidence → worker.prompt(evidence, AXIOM_SYSTEM, workerModel, 'memory-curator') → parseAxiomCandidates → 非空则写 triage 草稿（复用 W2 的 triage 写入函数，category `axiom-candidate`）→ heartbeat record。budget allow('axiomDistill') 门。

- [ ] **Step 3: triage confirm 分支**：`summary.axiomDraft` 存在时 → 对每个 candidate 调 L5 commit（energy 0.9，cue_anchors 带 `axiom-distilled` + 来源 id 尾 6 位）→ 源 insights 不动（它们仍是证据层）。

- [ ] **Step 4: 门禁** root build + gateway 全量 jest 绿

- [ ] **Step 5: Commit** `git add gateway/src/recall/pipeline-rules.ts gateway/src/recall/pipeline-heartbeat.ts gateway/src/index.ts; git commit -m "feat: A1 weekly axiom distillation wired (triage-gated L5 commit)"`

---

## Phase E：L3 知识边界（FOK 分主题阈值）

**Goal:** FOK 样本补 `topic` 字段 → 按主题拟合阈值 → `classifyFok` 用分主题阈值（全局兜底）——"我哪里不可信"变成可查询的边界地图。

**现状事实：** `recall/fok-samples.ts`（`FokEvent` inj/rdm 两形，`appendFokEvent`，`joinFokSamples` 纯函数）；`recall/fok-gate.ts`（`FokFitSample`、`fitFokThresholds`、`classifyFok`）。**topic 缺口确认**：inj 形无 topic。

### Task E1: 样本补 topic + join 传递

**Files:**
- Modify: `gateway/src/recall/fok-samples.ts`
- Test: 既有 fok-samples 测试文件（Select-String 定位：`gateway/tests/unit/recall/` 下 fok 相关）追加用例

- [ ] **Step 1: 写失败测试**：`FokEvent` inj 形加可选 `topic?: string`；`joinFokSamples` 输出的 `FokLabeledSample` 带 `topic`；无 topic 的旧行照常 join（向后兼容）。

```typescript
// 追加用例
test('inj topic flows through join; legacy lines without topic still join', () => {
  const lines = [
    JSON.stringify({ e: 'inj', ts: 1000, top1prob: 0.9, zone: 'inject', ids: ['a'], topic: 'gateway' }),
    JSON.stringify({ e: 'rdm', ts: 2000, id: 'a' }),
    JSON.stringify({ e: 'inj', ts: 1000, top1prob: 0.5, zone: 'inject', ids: ['b'] }),
  ];
  const out = joinFokSamples(lines);
  expect(out.find((s) => s.top1prob === 0.9)?.topic).toBe('gateway');
  expect(out.find((s) => s.top1prob === 0.5)?.topic).toBeUndefined();
});
```

- [ ] **Step 2: 跑红** → FAIL

- [ ] **Step 3: 实现**：`FokEvent` inj 加 `topic?: string`；`FokLabeledSample` 加 `topic?: string`；join 透传。

- [ ] **Step 4: 记录点接线**：快照路径记录 inj 处（recall-snapshot.ts 或调用 `appendFokEvent` 处）补 `topic: <top1 记忆的首个 cue_anchor>`（index entry 查询，fail-open 缺省 undefined）。

- [ ] **Step 5: 跑绿 + 全量** → PASS；Commit `feat: L3 fok samples carry topic (join-transparent, legacy-compatible)`

### Task E2: 分主题阈值拟合 + 消费

**Files:**
- Modify: `gateway/src/recall/fok-gate.ts`（`fitFokThresholdsByTopic`）
- Modify: `gateway/scripts/fok-calibrate.ts`（输出分主题表）
- Test: fok-gate 测试追加

- [ ] **Step 1: 写失败测试**

```typescript
test('per-topic fit when n>=30 else falls back to global', () => {
  const mk = (topic: string, n: number, prob: number, hit: boolean) =>
    Array.from({ length: n }, () => ({ top1prob: prob, hit, topic }));
  const samples = [
    ...mk('gateway', 30, 0.9, true), ...mk('gateway', 30, 0.2, false),
    ...mk('tiny', 5, 0.9, true), ...mk('tiny', 5, 0.1, false),
    ...mk(undefined as any, 40, 0.8, true), ...mk(undefined as any, 40, 0.3, false),
  ];
  const r = fitFokThresholdsByTopic(samples as any, { minPerTopic: 30 });
  expect(r.byTopic['gateway']).toBeDefined();
  expect(r.byTopic['tiny']).toBeUndefined(); // 样本不足 → 用 global
  expect(r.global).toBeDefined();
});
```

- [ ] **Step 2: 跑红** → FAIL

- [ ] **Step 3: 实现** `fitFokThresholdsByTopic(samples, {minPerTopic})`：按 topic 分组，n≥minPerTopic 的组调既有 `fitFokThresholds`，其余并入 global；返回 `{ byTopic: Record<string, FokThresholds>, global: FokThresholds | null }`。消费侧（快照判定处）：`thresholds = byTopic[topic] ?? global`。

- [ ] **Step 4: 门禁 + Commit** `feat: L3 per-topic FOK thresholds (global fallback)`

---

## Phase F：P1.5 laya 审批判定 —— 结论变更：暂缓，先补模型

**调研结论（2026-10-09 复核）：** 当前 sidecar 是 `Modusnsus/laya-nli-memory-conflict`（冲突专用 NLI checkpoint），对"bash 命令破坏性分类"是 **off-label 零样本**——laya 调研红线"零样本≈随机"直接命中。正确路径不是接现有模型，而是：

- [ ] **Step 1（唯一任务）**：审批决策数据积累——`applyApprovalPolicy` 出口处把 `{tool, pattern/commandText 摘要, verdict(allow/ask/deny), 用户后续 reply(once/always/reject), ts}` append 到 `~/.mafw/logs/approval-decisions.jsonl`（fail-open，纯记录零行为变化）。攒 ≥100 条后选/训合适 checkpoint，再按三值门接入。
- Files: `gateway/src/core/approval/hook.ts` + 测试 `gateway/tests/unit/core/approval-decision-log.test.ts`。
- 测试：记录函数纯逻辑（格式化/脱敏/fail-open）3 例。

---

## Phase G：D5 PPR 检索 —— spec-first

- [ ] **Task G1: 写 spec**（`docs/superpowers/specs/2026-XX-XX-d5-ppr-retrieval.md`）：实体共现图构建（cue_anchors 共现）、Personalized PageRank 与 BM25 的融合位置（R8 快照内，同 R2 dense 的 RRF 模式）、**测量面先行**：LongMemEval session 粒度 R@10 基线 0.949 为对照，改动必须走 `evaluation/` 探针验证。spec 经用户批准后才写实现计划。
- 依据：R6 邻居检索层"两粒度全零"的教训——图类增强先在基准上证明再加生产。

## Phase H：A5 抽象写回 schema —— spec-first

- [ ] **Task H1: 写 spec**：蒸馏产物更新 schema 簇代表条目（`memory/schema-clusters.ts` 的 Cluster 现只有读路径）——写回的冲突语义（簇代表被改写 vs 新增碎片）、与 MinHash/soft-supersede 的交互、回滚策略。spec 批准后才排实现。

## Phase I：D4b 反事实模拟 —— spec-first

- [ ] **Task I1: 写 spec**：plan 节点已注入 L1+L2（W4）；"反事实"的精确定义（对 plan 的每个 wave 问"若用 X 方案，历史上同类怎么败的"）依赖 L1 的任务类型维度（当前缺口：goal 无任务类型字段）——**前置：先给 goal charter 加任务类型字段**。spec 里先解这个依赖。

## Phase J：远期大纲（不排实现，仅记录触发条件）

| 项 | 触发条件 |
|---|---|
| W3 schema 驱动感知 | D5 上线且基准证明有效后 |
| D7 日记 / L4 自传 | 体验层需求出现时（桌面端"我的成长"视图立项时） |
| D6 | 同 D7 |
| ~~A3 强模型抽象~~ | 已搁置（用户判定非瓶颈，2026-10-08） |

---

## 执行顺序与门禁汇总

| 阶段 | 交付物 | 新增测试（估） | 依赖 |
|---|---|---|---|
| A D2 | reconsolidate 管线 + cron | ~10 | 无 |
| B D4a | dream 预取 + 首捕获消费 | ~6 | 无 |
| C A2 | tentative 生产 + 验证 | ~7 | 无 |
| D A1 | 公理蒸馏 + triage→L5 | ~6 | W2 triage 模式（已有） |
| E L3 | FOK 分主题 | ~5 | 样本积累（被动，不阻塞代码） |
| F P1.5 | 审批决策记录 | ~3 | 无（模型选型后置） |
| G/H/I | spec ×3 | 0 | 用户审 spec |

每阶段独立可交付、独立 commit 链；全部完成后统一 build + pack + 部署（版本 4.24.0）。
