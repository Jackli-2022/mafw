# 第二批：反馈闭环（L1 能力账本 + L2 失败谱结构化 + A4 选择压力回流）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).
> 说明：原路线图 Plan 2 含 D3/D4a（写入门控 / 做梦预取）——二者是设计重的独立 LLM 子系统，按 writing-plans 拆为 Plan 3。本计划只做"既有数据/信号的聚合"（零新 LLM 子系统）。

**Goal:** 把 goal_outcomes 与蒸馏产物变成可消费的自我认知账本（L1 能力账本 + L2 失败谱），并让 reflection 看到自己过去产物的下游使用情况（A4 选择压力回流）。

**Architecture:** 纯聚合函数（`capability-ledger.ts`，deps 注入可测）+ 只读端点 `GET /api/agent/capabilities` 暴露；A4 在 reflection prompt 组装处追加"产物命中反馈"块。

**Tech Stack:** gateway TS（jest --runInBand）。无新依赖、无 LLM。

## Global Constraints

- TDD 先红后绿；每 task 结束 commit；jest 不 typecheck index.ts → 改 index.ts 必跑 root `npm run build`
- 测试 import `../../../src/...`；中文只经 write/edit 落盘
- 全量门禁 `cd gateway; npx jest --runInBand`（基线 1764）

---

### Task 1: L1 能力账本聚合（纯函数）

**Files:** Create `gateway/src/orchestration/capability-ledger.ts`; Test `gateway/tests/unit/orchestration/capability-ledger.test.ts`

**Interfaces:** Produces `buildCapabilityLedger(outcomes: LedgerOutcome[]): CapabilityLedger`，形状见实现。

- [ ] **Step 1: 失败测试**

```typescript
import { buildCapabilityLedger } from '../../../src/orchestration/capability-ledger';

describe('buildCapabilityLedger', () => {
  it('aggregates pass rate, avg rounds, and failure-kind breakdown', () => {
    const led = buildCapabilityLedger([
      { goal_id: 'g1', verdict: 'PASS', rounds: 2, total_cost: 0.1, thumbs_up: 1, thumbs_down: 0, failure_kind: null },
      { goal_id: 'g2', verdict: 'FAIL', rounds: 5, total_cost: 0.3, thumbs_up: 0, thumbs_down: 0, failure_kind: 'max_retries' },
      { goal_id: 'g3', verdict: 'PASS', rounds: 4, total_cost: 0.2, thumbs_up: 0, thumbs_down: 0, failure_kind: null },
      { goal_id: 'g4', verdict: 'ERROR', rounds: 1, total_cost: 0.05, thumbs_up: 0, thumbs_down: 1, failure_kind: 'max_retries' },
    ]);
    expect(led.total).toBe(4);
    expect(led.passRate).toBeCloseTo(0.5);
    expect(led.avgRounds).toBeCloseTo(3);
    expect(led.avgCostUsd).toBeCloseTo(0.1625);
    expect(led.thumbsUp).toBe(1);
    expect(led.thumbsDown).toBe(1);
    expect(led.byFailureKind).toEqual({ max_retries: 2 });
  });

  it('empty → zeroed ledger (no NaN)', () => {
    const led = buildCapabilityLedger([]);
    expect(led).toMatchObject({ total: 0, passRate: 0, avgRounds: 0, avgCostUsd: 0, byFailureKind: {} });
  });
});
```

- [ ] **Step 2: 红** — `cd gateway; npx jest tests/unit/orchestration/capability-ledger.test.ts`
- [ ] **Step 3: 实现**

```typescript
// L1 能力账本：goal_outcomes 的确定性聚合（零 LLM）。回答"我擅长什么"。
// 任务类型分桶是已知缺口（goal 无类型维度）——v1 用 verdict/failure_kind 维度。
export interface LedgerOutcome {
  goal_id: string; verdict: string; rounds?: number; total_cost?: number | null;
  thumbs_up?: number; thumbs_down?: number; failure_kind?: string | null;
}

export interface CapabilityLedger {
  total: number; passRate: number; avgRounds: number; avgCostUsd: number;
  thumbsUp: number; thumbsDown: number; byFailureKind: Record<string, number>;
}

export function buildCapabilityLedger(outcomes: LedgerOutcome[]): CapabilityLedger {
  const total = outcomes.length;
  const byFailureKind: Record<string, number> = {};
  let passes = 0, sumRounds = 0, sumCost = 0, up = 0, down = 0;
  for (const o of outcomes) {
    if (o.verdict === 'PASS') passes++;
    sumRounds += o.rounds ?? 0;
    sumCost += o.total_cost ?? 0;
    up += o.thumbs_up ?? 0;
    down += o.thumbs_down ?? 0;
    if (o.failure_kind) byFailureKind[o.failure_kind] = (byFailureKind[o.failure_kind] ?? 0) + 1;
  }
  return {
    total,
    passRate: total ? passes / total : 0,
    avgRounds: total ? sumRounds / total : 0,
    avgCostUsd: total ? sumCost / total : 0,
    thumbsUp: up,
    thumbsDown: down,
    byFailureKind,
  };
}
```

- [ ] **Step 4: 绿 → Step 5: Commit** `feat(ledger): L1 capability ledger aggregation (goal_outcomes)`

---

### Task 2: L2 失败谱结构化（纯函数）

**Files:** Modify `capability-ledger.ts`（追加）; Test 同文件追加 describe

**Interfaces:** Produces `buildFailureTaxonomy(entries): Array<{ pattern: string; count: number; energy: number; id: string }>`

- [ ] **Step 1: 失败测试**

```typescript
import { buildFailureTaxonomy } from '../../../src/orchestration/capability-ledger';

it('clusters cat:failure/correction entries by primary_abstraction, drops superseded', () => {
  const t = buildFailureTaxonomy([
    { id: 'm1', energy: 0.9, primary_abstraction: 'serve 崩溃后事件订阅必须重连', cue_anchors: ['cat:failure'] },
    { id: 'm2', energy: 0.7, primary_abstraction: 'serve 崩溃后事件订阅必须重连', cue_anchors: ['cat:failure'] },
    { id: 'm3', energy: 0.8, primary_abstraction: '别的坑', cue_anchors: ['cat:correction'] },
    { id: 'm4', energy: 0.9, primary_abstraction: '不收', cue_anchors: ['cat:insight'] },
    { id: 'm5', energy: 0.9, primary_abstraction: '已取代', cue_anchors: ['cat:failure'], superseded_by: 'm1' },
  ]);
  expect(t).toHaveLength(2);
  const top = t[0];
  expect(top.pattern).toBe('serve 崩溃后事件订阅必须重连');
  expect(top.count).toBe(2);
  expect(top.energy).toBeCloseTo(0.9); // 组内最高
  expect(top.id).toBe('m1');           // 代表 id = 组内最高能
});
```

- [ ] **Step 2: 红 → Step 3: 实现**（过滤 `cat:failure`/`cat:correction` 且未 superseded；按 primary_abstraction 分组，取组内最高能条目为代表；按 count 降序）

- [ ] **Step 4: 绿 → Step 5: Commit** `feat(ledger): L2 failure taxonomy structuring (cat: anchors)`

---

### Task 3: 能力端点 `GET /api/agent/capabilities`

**Files:** Create `gateway/src/routes/capability.ts`; Test `gateway/tests/unit/routes/capability.test.ts`

**Interfaces:** Consumes Task1/2; `handleCapabilities(deps)` → `{ ledger, failureTaxonomy }`

- [ ] **Step 1: 失败测试**

```typescript
import { handleCapabilities } from '../../../src/routes/capability';

it('combines ledger from outcomes with taxonomy from index', async () => {
  const r = await handleCapabilities({
    listOutcomes: () => [{ goal_id: 'g1', verdict: 'PASS', rounds: 1 }],
    getIndex: () => ({ entries: [{ id: 'm1', energy: 0.9, primary_abstraction: '坑', cue_anchors: ['cat:failure'] }] }),
    limit: 200,
  });
  expect(r.ledger.total).toBe(1);
  expect(r.failureTaxonomy[0].pattern).toBe('坑');
});
```

- [ ] **Step 2: 红 → Step 3: 实现**（deps 注入；fail-open 在接线处）

- [ ] **Step 4: 绿 → Step 5: Commit** `feat(routes): GET /api/agent/capabilities (ledger + failure taxonomy)`

---

### Task 4: index.ts 接线

**Files:** Modify `gateway/src/index.ts`（priors 路由之后）

- [ ] **Step 1: 接线**（`require('./routes/capability')`；deps：`listOutcomes: () => this.getGatewayDb().listGoalOutcomes({ limit: 200 })`、`getIndex: () => this.memoryService?.harmonicIndex.getIndex() ?? { entries: [] }`）
- [ ] **Step 2: `npm run build` + 全量 jest 绿 → Step 3: Commit** `feat: wire GET /api/agent/capabilities`

---

### Task 5: A4 选择压力回流（reflection prompt）

**Files:** Modify `gateway/src/recall/reflection.ts`（`ReflectionOptions` 加 `needFor?` + `selectionFeedbackBlock` 纯函数 + reflectSession prompt 追加）; Test `gateway/tests/unit/recall/reflection-selection.test.ts`

**Interfaces:** Produces `selectionFeedbackBlock(items: Array<{ text: string; need: number }>): string`

- [ ] **Step 1: 失败测试**

```typescript
import { selectionFeedbackBlock } from '../../../src/recall/reflection';

it('renders used vs unused distilled insights for next-round calibration', () => {
  const block = selectionFeedbackBlock([
    { text: '被反复使用的洞察', need: 5 },
    { text: '从未被使用的洞察', need: 0 },
  ]);
  expect(block).toContain('被反复使用的洞察');
  expect(block).toContain('命中 5');
  expect(block).toContain('从未被使用的洞察');
  expect(block).toContain('未被检索');
  expect(block).toContain('合并或删除');
});

it('empty items → empty string', () => {
  expect(selectionFeedbackBlock([])).toBe('');
});
```

- [ ] **Step 2: 红 → Step 3: 实现** 纯函数 + `ReflectionOptions.needFor?: (id) => number` + reflectSession 里对 `source_session_id === sessionID && (type semantic|procedural)` 的既有条目取 need，拼块追加到 distill prompt
- [ ] **Step 4: 绿 + 全量 → Step 5: Commit** `feat(reflection): A4 selection-pressure feedback (downstream need into prompt)`

---

### Task 6: 文档 + 门禁

- [ ] AGENTS.md 追加 L1/L2/A4 段；路线图 §5 勾销 L1/L2/A4
- [ ] `cd gateway; npx jest --runInBand` + root `npm run build` 全绿 → Commit

---

## Self-Review

- 覆盖：L1（T1）/L2（T2）/端点（T3-4）/A4（T5）；D3/D4a 明确移 Plan 3（已声明）
- 类型一致：`buildCapabilityLedger`/`buildFailureTaxonomy`/`handleCapabilities`/`selectionFeedbackBlock` 签名跨 task 一致
- 缺口：任务类型分类器仍缺（L1 只有 verdict/failure_kind 维度）——W4 注入时再补或接受粗粒度
