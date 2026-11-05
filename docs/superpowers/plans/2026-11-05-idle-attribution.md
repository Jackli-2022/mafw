# NodeDriver idle 归属（turn attribution）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 plan/execute/review 节点只把「属于本回合的 idle」当作完成信号——没有本回合活动的 idle 直接忽略且不消耗 grace，有活动的 idle 立即收账（无产物则 `artifact_missing`），grace 超时降为纯兜底。

**Architecture:** 派发时记 `dispatchSeq`；任何 `part.updated` / `message.updated` 为该会话累加 `activitySeq`；idle 到达时比较两个序号——`activitySeq` 没动过就是陈旧 idle，动过就是本回合结束。改动集中在 `NodeDriver`（三张表 + idle 分支）与 `index.ts` 的一处事件接线。

**Tech Stack:** TypeScript、jest、既有 `NodeDriver` / `handleOpencodeEvent`。

**Spec:** `docs/research/2026-11-05-turn-idle-attribution-research.md`（业界四级阶梯：归属 > 类型化 idle > 状态复查 > 超时兜底；本计划实现第 1 级，保留第 4 级作兜底）

**相关既有实现：** `gateway/src/core/goal/driver.ts` 的 `onSessionIdle` / `isStaleReuseIdle` / `armReuseGraceTimer`（commit `15aeda0d`）

## Global Constraints

- 行为变更 TDD：先写失败测试、跑出 RED，再实现，跑出 GREEN。
- gateway 测试：`cd gateway && npx jest tests/unit/goal --runInBand`；类型门禁 `npx tsc --noEmit -p tsconfig.json`。
- 不 push、不发布；部署走 `npm run build && npm run deploy:local` + `~/.mafw/pending-restart.json`。
- 节点「无产物完成」是**合法**的（结构化交卷）——产物不是完成信号，只有活动归属是。
- `reuseIdleGrace` 与 `reuseGraceMs` 保留，但降级为「有活动却迟迟没有 idle」的兜底。

## Review Focus

- **讨论回合的迟到 idle** 紧跟在新节点派发之后到达时，节点不能被判成功或失败，也不能消耗 grace。
- **结构化交卷**（`mafw_submit_result`，无文件产物）必须仍然算完成——不能因为改判据又退回去。
- **真回合结束但没有任何产物**时，必须在秒级判 `artifact_missing`，而不是等 90s/30min。
- **同一会话连续复用**（plan → execute 复用同一 discussion 会话）时，上一节点的活动不能算到下一节点头上。
- **非复用会话**（Builder/Reviewer 独立会话）行为完全不变。

---

### Task 1: 会话活动记账

**Files:**
- Modify: `gateway/src/core/goal/driver.ts`（新增两张 Map 与 `noteSessionActivity`）
- Modify: `gateway/src/index.ts`（`handleOpencodeEvent` 的 `part.updated` / `message.updated` 分支调用它）
- Test: `gateway/tests/unit/goal/session-activity.test.ts`

**Interfaces:**
- Produces:
  - `NodeDriver.noteSessionActivity(sessionID: string): void` —— 该会话有一次属于当前回合的活动
  - 内部：`private dispatchSeq = new Map<string, number>()`、`private activitySeq = new Map<string, number>()`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/goal/session-activity.test.ts
import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';

it('counts activity only for the session it was noted on', async () => {
  const h = makeHarness();
  seedGoal(h, 'g1');
  await h.driver.advance('g1');
  const sid = h.load('g1')!.nodeSession!.id;

  expect(h.driver['activitySeq'].get(sid) ?? 0).toBe(0);
  h.driver.noteSessionActivity(sid);
  expect(h.driver['activitySeq'].get(sid)).toBe(1);
  h.driver.noteSessionActivity('ses_other');
  expect(h.driver['activitySeq'].get(sid)).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/goal/session-activity.test.ts --runInBand`
Expected: FAIL — `h.driver.noteSessionActivity is not a function`

- [ ] **Step 3: Implement**

`noteSessionActivity(sessionID)`：`this.activitySeq.set(sessionID, (this.activitySeq.get(sessionID) ?? 0) + 1)`。
派发节点时（现有 `this.reuseIdleGrace.delete(sessionId); this.clearReuseGraceTimer(sessionId);` 旁边）记 `this.dispatchSeq.set(sessionId, this.activitySeq.get(sessionId) ?? 0)` —— 即「派发那一刻的活动水位」。
`index.ts` 在 `handleOpencodeEvent` 处理 `part.updated` / `message.updated` 且 `sessionID` 属于在飞节点时调用 `goalDriver.noteSessionActivity(sessionID)`（fail-open，不影响主链）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/goal/session-activity.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/src/index.ts gateway/tests/unit/goal/session-activity.test.ts
git commit -m "feat(gateway): track per-session activity watermark for idle attribution"
```

---

### Task 2: idle 按活动归属判定

**Files:**
- Modify: `gateway/src/core/goal/driver.ts`（idle 分支；`isStaleReuseIdle` 仅在「有活动」分支里作为二级判据保留）
- Test: `gateway/tests/unit/goal/idle-attribution.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `activitySeq` / `dispatchSeq`
- Produces: `private hasTurnActivity(sessionId: string): boolean` —— `activitySeq > dispatchSeq`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/goal/idle-attribution.test.ts
import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';

it('ignores an idle that arrives before any activity from this dispatch', async () => {
  const h = makeHarness({ reuseGraceMs: 10 });
  h.deps.existingNodeSession = (_g, node) => (node === 'plan' ? 'ses_tech_lead' : null);
  seedGoal(h, 'g1', { patch: { planReview: 'auto' } });
  await h.driver.advance('g1');

  await h.fireIdle('ses_tech_lead');          // 陈旧 idle：本回合还没有任何活动
  await new Promise((r) => setTimeout(r, 60));

  const st = h.load('g1')!;
  expect(st.nextAction).toBe('RUNNING_plan'); // 既没收账也没失败
});

it('fails fast when the turn had activity but produced nothing', async () => {
  const h = makeHarness({ reuseGraceMs: 10 });
  h.deps.existingNodeSession = (_g, node) => (node === 'plan' ? 'ses_tech_lead' : null);
  seedGoal(h, 'g1', { patch: { planReview: 'auto' } });
  await h.driver.advance('g1');

  h.driver.noteSessionActivity('ses_tech_lead'); // 本回合确实跑过
  await h.fireIdle('ses_tech_lead');
  await new Promise((r) => setTimeout(r, 30));

  const st = h.load('g1')!;
  expect(st.nextAction).toBe('FAILED');
  expect(String(st.lastError ?? '')).toContain('artifact_missing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/goal/idle-attribution.test.ts --runInBand`
Expected: 第一个用例 FAIL（当前会走 grace 定时器并判 `artifact_missing`）

- [ ] **Step 3: Implement**

idle 分支改成：

```
if (ev === 'idle') {
  if (!this.hasTurnActivity(sessionId)) return true;   // 陈旧 idle：不消耗 grace、不 arm 定时器
  if (this.isStaleReuseIdle(...)) {                     // 有活动但产物还是旧版：保留原有 grace 语义
    …structured 检查 + armReuseGraceTimer…
    return true;
  }
  void this.completeNode(goalId, sessionId);            // 真结束：无产物 → artifact_missing
  return false;
}
```

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal --runInBand`
Expected: PASS（含既有 `plan-package-driver` 的复用会话用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/tests/unit/goal/idle-attribution.test.ts
git commit -m "fix(gateway): attribute idle to the dispatched turn instead of guessing from artifacts"
```

---

### Task 3: grace 降级为兜底 + 真机冒烟

**Files:**
- Modify: `gateway/src/core/goal/driver.ts`（仅注释与默认值）
- Test: 既有 `plan-package-driver.test.ts`（不改）

- [ ] **Step 1: 确认兜底语义**

`armReuseGraceTimer` 只在「有活动 + 产物仍旧」分支调用；把默认 `reuseGraceMs` 从 90s 降到 30s，并在注释里写明：**陈旧 idle 不 arm 定时器**，此定时器只处理「回合有活动但既没写产物也没交卷且再没 idle」。

- [ ] **Step 2: 全量门禁**

Run: `cd gateway && npx jest tests/unit/goal --runInBand && npx tsc --noEmit -p tsconfig.json`
Expected: 全绿 + rc=0

- [ ] **Step 3: 部署**

```bash
cd gateway && npm run build && npm run deploy:local
# 写 ~/.mafw/pending-restart.json（action=restart, delayMs=3000）
```

- [ ] **Step 4: 真机冒烟（两条都要）**

1. 正常路径：建一个 quick Goal（带 acceptance）→ 应正常跑完并产出文件，`goal-eval.json` 由 driver 派生。
2. 陈旧 idle 路径：观察日志里同一 discussion 会话的迟到 idle 不再让节点失败，节点继续等待本回合活动。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts AGENTS.md
git commit -m "docs: record idle attribution and grace backstop"
```
