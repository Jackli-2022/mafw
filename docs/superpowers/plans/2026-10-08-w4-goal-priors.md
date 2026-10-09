# 第三批：W4 goal 级先验（能力账本 → plan 节点）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).
> 范围：路线图 W4（接线侧）。D3 surprise 门控 / D4a 做梦预取 / D2 / A2 / L3 各自成后续 plan。

**Goal:** 把 L1 能力账本 + L2 失败谱注入 goal 编排的 **plan 节点 prompt**——规划时看到"我在这类任务上的历史与反复失败模式"，主动规避（自我认知闭环的消费点）。

**Architecture:** `capabilityPriorBlock()` 纯函数（capability-ledger.ts）→ `NodePromptCtx.priorBlock` 注入 plan 节点 prompt（node-prompts.ts）→ `DriverDeps.capabilityPrior?()` 提供内容（driver.ts）→ index.ts 接线（读 goal_outcomes + index）。全部 fail-open。

**Tech Stack:** gateway TS（jest --runInBand）。无新依赖、无 LLM。

## Global Constraints
- TDD 先红后绿；每 task commit；改 index.ts 必跑 root `npm run build`
- 测试 import `../../../src/...`；全量门禁 `cd gateway; npx jest --runInBand`（基线 1771）

---

### Task 1: `capabilityPriorBlock` 纯函数

**Files:** Modify `gateway/src/orchestration/capability-ledger.ts`; Test `gateway/tests/unit/orchestration/capability-ledger.test.ts`（追加）

**Interfaces:** Produces `capabilityPriorBlock(ledger: CapabilityLedger, taxonomy: FailurePattern[]): string`

- [ ] **Step 1: 失败测试**

```typescript
import { ... , capabilityPriorBlock } from '../../../src/orchestration/capability-ledger';

describe('capabilityPriorBlock', () => {
  it('renders history summary + recurrent failure patterns', () => {
    const block = capabilityPriorBlock(
      { total: 4, passRate: 0.5, avgRounds: 3.2, avgCostUsd: 0.18, thumbsUp: 1, thumbsDown: 1, byFailureKind: { max_retries: 2 } },
      [{ pattern: 'serve 崩溃后事件订阅必须重连', count: 2, energy: 0.9, id: 'm1' }],
    );
    expect(block).toContain('历史 PASS 率 50%');
    expect(block).toContain('平均 3.2 轮');
    expect(block).toContain('serve 崩溃后事件订阅必须重连');
    expect(block).toContain('回避');
  });
  it('empty book → empty string', () => {
    expect(capabilityPriorBlock({ total: 0, passRate: 0, avgRounds: 0, avgCostUsd: 0, thumbsUp: 0, thumbsDown: 0, byFailureKind: {} }, [])).toBe('');
  });
});
```

- [ ] **Step 2: 红 → Step 3: 实现**（`total===0 && taxonomy.length===0 → ''`；否则渲染 `### 你在此类任务上的历史（自我认知账本）...` + 失败模式行 `[×count] pattern`）
- [ ] **Step 4: 绿 → Step 5: Commit** `feat(ledger): capabilityPriorBlock renderer (L1+L2 -> prompt block)`

---

### Task 2: plan 节点 prompt 注入

**Files:** Modify `gateway/src/core/goal/node-prompts.ts`（`NodePromptCtx.priorBlock?` + plan 分支插入）; Test `gateway/tests/unit/core/goal/node-prompts.test.ts`（若不存在则新建）

- [ ] **Step 1: 失败测试**

```typescript
import { renderNodePrompt } from '../../../../src/core/goal/node-prompts';
const ctx = (extra = {}) => ({ goalId: 'g1', projectDir: '/p', mafwDir: '/m', round: 1, maxRounds: 3, charterPath: '/m/goals/g1.md', requestPath: '/m/requests/g1.json', ...extra });

it('plan prompt includes priorBlock when provided', () => {
  const p = renderNodePrompt('plan', ctx({ priorBlock: '### 历史\nPASS 率 50%' }));
  expect(p).toContain('PASS 率 50%');
});
it('plan prompt omits priorBlock when absent', () => {
  expect(renderNodePrompt('plan', ctx())).not.toContain('历史');
});
it('execute prompt never includes priorBlock', () => {
  expect(renderNodePrompt('execute', ctx({ priorBlock: 'X' }))).not.toContain('X');
});
```

- [ ] **Step 2: 红 → Step 3: 实现**（plan 分支：`ctx.priorBlock` 插在 docs 之后、任务之前）
- [ ] **Step 4: 绿 → Step 5: Commit** `feat(goal): inject capability prior block into plan node prompt`

---

### Task 3: driver deps + index 接线

**Files:** Modify `gateway/src/core/goal/driver.ts`（`DriverDeps.capabilityPrior?: () => string | null` + executeNode ctx 传 `priorBlock`）; Modify `gateway/src/index.ts`（NodeDriver 构造传 `capabilityPrior`）

- [ ] **Step 1: driver 接线**（executeNode：`priorBlock: this.deps.capabilityPrior?.() ?? undefined`）
- [ ] **Step 2: index 接线**（`capabilityPrior: () => { try { const { buildCapabilityLedger, buildFailureTaxonomy, capabilityPriorBlock } = require('./orchestration/capability-ledger'); const led = buildCapabilityLedger(this.getGatewayDb().listGoalOutcomes({ limit: 200 })); const tax = buildFailureTaxonomy(this.memoryService?.harmonicIndex.getIndex().entries ?? []); return capabilityPriorBlock(led, tax) || null; } catch { return null; } }`）
- [ ] **Step 3: `npm run build` + 全量 jest 绿 → Step 4: Commit** `feat(goal): wire capabilityPrior into NodeDriver`

---

### Task 4: 文档 + 门禁
- [ ] AGENTS.md §5.22 补 W4 一行；路线图 §5 勾销 W4
- [ ] 全量 `npx jest --runInBand` + root `npm run build` 绿 → Commit `docs: W4 landed`

---

## Self-Review
- 覆盖 W4 全链（纯函数→prompt→driver→index）；D3/D4a/D2/A2/L3 明确留后续 plan
- 类型一致：`capabilityPriorBlock` 签名、`NodePromptCtx.priorBlock`、`DriverDeps.capabilityPrior` 跨 task 一致
