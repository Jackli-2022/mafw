# B1 交错回放二期 + Consolidation 修复 + B4 奖励调制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 S2 交错回放骨架补成完整闭环：need 驱动的回放采样（检索事件 → 回放优先级）、last_replayed 防霸屏、ConsolidationService 零 UPDATE 审计与修复、goal 奖励调制 energy（B4）。

**Architecture:** turn-pipeline 已有 `priorKnowledgeFor`（BM25 top-k*3 选取）与 reconcile prompt——本期不推翻，只升级选取信号：候选池仍由 BM25 召回，重排键改为 `need × gain × 1/energy`（need 来自 Plan A 的 `RetrievalEventBuffer.needFor`），排除近期已回放条目并盖 `last_replayed` 戳；ConsolidationService 先加判定对日志（Task 1）供审计（Task 2 决策检查点），修复后再把回放 prompt 与批量裁判对齐；B4 在 `archiveGoal(COMPLETED)` 时对 goal 关联记忆小步加能（不对称：失败不罚）。

**Tech Stack:** TypeScript (gateway, CJS), jest, 无新依赖。

**依据:** `docs/research/2026-09-29-memory-gap-abc-survey.md` §2（B1/B4）+ §4 行动清单。
**前置依赖:** Plan `2026-09-29-dormant-mechanisms-wiring.md` Task 1（`retrieval-events.ts` 的 `needFor`）。Task 3-4 需要它；Task 1-2 可先行。

## Global Constraints

- TDD：每个任务先写失败测试
- 回放只作对照证据：worker prompt 中旧记忆永远是"reconcile 参考"，不重写原文（防 domain shortcut，arXiv:2607.22994）
- 回放配额有上限（防 Adaptive RR 的 plasticity loss，arXiv:2310.07418）；`last_replayed` 戳防 primacy bias（arXiv:2502.00802）
- B4 不对称：COMPLETED 才加能，失败/取消不降能（防错误归因）；逐条 clamp ≤ 1.0
- ConsolidationService 修改保持 fail-open（judge 失败绝不阻塞写入）
- 测试命令统一 `cd gateway && npx jest --runInBand <path>`；提交前 `npm run build`
- 不用 PowerShell 写/改源文件，用 edit/write 工具

---

### Task 1: Consolidation 判定对日志（审计数据源）

**Files:**
- Modify: `gateway/src/memory/consolidation-service.ts`（judged pair 落日志 + 采样留存）
- Test: `gateway/tests/unit/memory/consolidation-pairs.test.ts`（新建；现有 consolidation 测试文件先 `grep -rn "ConsolidationService" tests/` 定位，追加亦可）

**Interfaces:**
- Produces: `ConsolidationDeps.onPair?: (pair: JudgedPair) => void`；`export interface JudgedPair { newId: string; newAbstraction: string; candidateIds: string[]; candidateAbstractions: string[]; cosines: number[]; verdict: 'update' | 'create' | 'separate' | 'skip'; ts: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// 判官被调用时 onPair 收到完整判定对（new 抽象 + 候选抽象 + cosine + verdict）
it('emits a JudgedPair for every judged call', async () => {
  // 用现有测试的 fake store/vectors/provider 模式构造：
  // 新条目 + 1 个 cosine 0.85 候选 + fake LLM 返回 {"action":"create"}
  // 断言 onPair 恰好一次：verdict='create'、cosines=[0.85]、abstractions 非空
});
it('skips (no candidates) do not emit pairs', async () => { /* 无候选 → 不调用 onPair */ });
```

- [ ] **Step 2: Run to verify it fails** — `cd gateway && npx jest --runInBand tests/unit/memory/consolidation-pairs.test.ts` → FAIL

- [ ] **Step 3: Implement**

`consolidation-service.ts`：类型 + deps + 在判官调用点（UPDATE/CREATE/SEPARATE 分支汇合处）构造 pair 回调：

```typescript
export interface JudgedPair {
  newId: string; newAbstraction: string;
  candidateIds: string[]; candidateAbstractions: string[]; cosines: number[];
  verdict: 'update' | 'create' | 'separate' | 'skip'; ts: number;
}
// deps 增：onPair?: (pair: JudgedPair) => void;
// 判官返回解析成功后：
this.onPair?.({
  newId: unit.id, newAbstraction: unit.primary_abstraction,
  candidateIds: cands.map((c) => c.id), candidateAbstractions: cands.map((c) => c.abstraction),
  cosines: cands.map((c) => c.cosine), verdict: action, ts: Date.now(),
});
```

接线（index.ts 构造 ConsolidationService 处）：`onPair` 把 pair 逐行写 `~/.mafw/logs/consolidation-pairs.jsonl`（追加、fail-open try/catch、无轮转——个人规模审计够用）。

- [ ] **Step 4: Run to verify it passes** → PASS
- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/consolidation-service.ts gateway/tests/unit/memory/consolidation-pairs.test.ts
git commit -m "feat(memory): consolidation judged-pair logging for audit (B1 prerequisite)"
```

---

### Task 2: 审计检查点——零 UPDATE 根因判定（决策任务，不写产品代码）

**Files:**
- Create: `docs/research/2026-10-xx-consolidation-audit.md`（执行日日期前缀）

**Interfaces:** 消费 Task 1 的 `consolidation-pairs.jsonl` + MinHash 合并统计 + `/api/memory/stats`

- [ ] **Step 1: 采集证据（跑够 ≥3 天生产流量或手动触发 ≥20 次写入）**

Run: `node -e "..."`（读 `~/.mafw/logs/consolidation-pairs.jsonl` 统计 verdict 分布、cosine 直方图、候选抽象与 new 抽象的重叠度）；同时 `grep -c "MinHash" ~/.mafw/logs/mafw.log` 取合并侧计数，`/api/memory/stats` 取 consolidation 计数。

- [ ] **Step 2: 对照三个预设假设下结论（写入审计文档）**

| 假设 | 判据 | 处置 |
|---|---|---|
| H1 MinHash 抢先合并 | MinHash merge 次数 ≥ consolidation 候选数且 pairs 里 cosine > 0.85 的对在 MinHash 后已不存在 | **不修判官**——健康带重定义：update ratio 分母含 MinHash merges，写入 AGENTS §3.5 |
| H2 判官 CREATE 偏置 | pairs 样本人工抽查 ≥10 对：语义上应 UPDATE 的被判 create（尤其 evolving state 型） | 修 `JUDGE_SYSTEM`：UPDATE 判据前置强调"same subject + evolving/complementary = UPDATE even if details differ"；加 1-shot 示例；补 prompt 回归测试 |
| H3 cosine 0.8 过高 | cosine 直方图集中在 0.72-0.80 且人工判断应合并 | `minCosine` 0.8 → 0.75（config `consolidation.minCosine`，默认值改代码常量） |

- [ ] **Step 3: 按结论执行处置（若 H2/H3：TDD 小步修 + 测试 + commit；若 H1：只改文档与 stats 口径）**

- [ ] **Step 4: 检查点收尾** — 审计文档落盘，结论同步 AGENTS §3.5，commit

```bash
git add docs/research/2026-10-xx-consolidation-audit.md AGENTS.md
git commit -m "docs: consolidation zero-update audit findings (D-2)"
```

---

### Task 3: need 驱动的回放采样 + last_replayed 防霸屏

**Files:**
- Modify: `gateway/src/core/memory/harmonic-types.ts`（`HarmonicIndexEntry` 增 `last_replayed?: string`）
- Modify: `gateway/src/core/memory/harmonic-index.ts`（增 `stampReplayed(ids: string[], nowIso: string)`——批量盖戳，一次 save 由调用方管）
- Modify: `gateway/src/recall/turn-pipeline.ts`（`priorKnowledgeFor` 升级重排 + 排除窗；`TurnPipelineOptions` 增 `needFor?: (id: string) => number`；`runSession` 在构建 priorBlock 后对选中 id 盖戳）
- Test: `gateway/tests/unit/recall/turn-pipeline-replay.test.ts`

**Interfaces:**
- Consumes: `needFor`（Plan A Task 1，`RetrievalEventBuffer.needFor`）
- Produces: `replayPriorityForMemory(e: {id; energy; salience?}, need: number): number`（导出纯函数：`(1 + Math.log1p(need)) * (salience ?? 1) / Math.max(0.2, energy)`）；`priorKnowledgeFor(index, sessionID, query, k, opts?: { needFor?, now?, excludeReplayedMs? })`（缺省 opts = 旧行为，回滚安全）

- [ ] **Step 1: Write the failing test**

```typescript
import { replayPriorityForMemory, priorKnowledgeFor } from '../../../src/recall/turn-pipeline';

describe('replayPriorityForMemory', () => {
  it('need boosts, high energy dampens', () => {
    const base = { id: 'a', energy: 0.8, salience: 1 };
    expect(replayPriorityForMemory(base, 5)).toBeGreaterThan(replayPriorityForMemory(base, 0));
    expect(replayPriorityForMemory({ ...base, energy: 0.3 }, 0)).toBeGreaterThan(replayPriorityForMemory(base, 0));
  });
});

describe('priorKnowledgeFor with need + exclusion', () => {
  it('re-ranks BM25 candidates by need×gain×1/energy and takes top-k', () => { /* mkdtemp 索引：3 条候选，BM25 第 1 名 need=0/energy=0.95，第 2 名 need=6/energy=0.4 → 第 2 名进首位 */ });
  it('excludes entries replayed within the window, backfills when pool exhausted', () => { /* last_replayed=1h 前的条目被排除；仅剩它时仍可入选（不让空 prior） */ });
  it('no opts → identical to legacy behavior (BM25 order, no exclusion)', () => { /* */ });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd gateway && npx jest --runInBand tests/unit/recall/turn-pipeline-replay.test.ts` → FAIL

- [ ] **Step 3: Implement**

```typescript
// turn-pipeline.ts 追加导出：
export function replayPriorityForMemory(
  e: { id: string; energy: number; salience?: number },
  need: number,
): number {
  return (1 + Math.log1p(Math.max(0, need))) * (e.salience ?? 1) / Math.max(0.2, e.energy);
}

// priorKnowledgeFor 签名扩展（原查询/过滤链不变，选完全改为"候选池 → 重排 → 截断"）：
export function priorKnowledgeFor(
  index: HarmonicIndexManager, sessionID: string, query: string, k: number,
  opts?: { needFor?: (id: string) => number; now?: number; excludeReplayedMs?: number },
): HarmonicIndexEntry[] {
  if (k <= 0 || !query.trim()) return [];
  try {
    const pool = index.searchScored(query, k * 3, { retriever: 'bm25', graphExpand: true })
      .map((s) => s.entry)
      .filter((e) => e.source_session_id !== sessionID)
      .filter((e) => e.type !== 'episodic')
      .filter((e) => !e.superseded_by);
    if (!opts) return pool.slice(0, k); // legacy
    const now = opts.now ?? Date.now();
    const window = opts.excludeReplayedMs ?? 48 * 3600_000;
    const fresh = pool.filter((e) => {
      const t = e.last_replayed ? new Date(e.last_replayed).getTime() : 0;
      return t === 0 || now - t >= window;
    });
    const source = fresh.length >= k ? fresh : [...fresh, ...pool.filter((e) => !fresh.includes(e))];
    return [...source]
      .sort((a, b) => replayPriorityForMemory(b, opts.needFor?.(b.id) ?? 0)
                     - replayPriorityForMemory(a, opts.needFor?.(a.id) ?? 0))
      .slice(0, k);
  } catch { return []; }
}
```

`runSession` 内调用点改为：
```typescript
const prior = priorKnowledgeFor(this.opts.index, sessionID, transcript, this.opts.replayK ?? 5, {
  needFor: this.opts.needFor,
});
if (prior.length > 0) {
  this.opts.index.stampReplayed(prior.map((e) => e.id), new Date().toISOString());
}
```
`TurnPipelineOptions` 增：`needFor?: (id: string) => number;`。index.ts 构造 TurnPipeline 处传 `needFor: (id) => getRetrievalEventBuffer().needFor(id)`。

`harmonic-index.ts` 增：
```typescript
  stampReplayed(ids: string[], nowIso: string): void {
    const set = new Set(ids);
    for (const entry of this.index.entries) if (set.has(entry.id)) entry.last_replayed = nowIso;
  }
```
（持久化随 TurnPipeline 周期内的下一次 `save()` 落盘；若当轮无写路径 save，在 stampReplayed 末尾调 `this.save()`——按现有类内习惯选择，测试钉住"stamp 后 getIndex 可见"。）

- [ ] **Step 4: Run to verify it passes** → PASS
- [ ] **Step 5: Build + 回归 + Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/src/core/memory/harmonic-types.ts gateway/src/core/memory/harmonic-index.ts gateway/tests/unit/recall/turn-pipeline-replay.test.ts
git commit -m "feat(memory): need-driven replay sampling with last_replayed exclusion (B1)"
```

---

### Task 4: B4 — goal 奖励调制 energy（不对称小步）

**Files:**
- Create: `gateway/src/core/manager/goal-reward.ts`
- Modify: `archiveGoal` 所在文件（先 `grep -rn "export.*archiveGoal" gateway/src` 定位；AGENTS 记录其在 core/manager 体系内）
- Test: `gateway/tests/unit/core/manager/goal-reward.test.ts`

**Interfaces:**
- Produces: `goalRewardBonus(verdict: string): number`（COMPLETED → 0.08，其余 → 0）；`applyGoalReward(deps: { index: HarmonicIndexManager; sessions: string[] }, verdict: string, now?: number): { rewarded: number }`

- [ ] **Step 1: Write the failing test**

```typescript
import { goalRewardBonus, applyGoalReward } from '../../../../src/core/manager/goal-reward';

describe('goalRewardBonus', () => {
  it('asymmetric: only COMPLETED is rewarded, failure never punished', () => {
    expect(goalRewardBonus('COMPLETED')).toBe(0.08);
    expect(goalRewardBonus('FAILED')).toBe(0);
    expect(goalRewardBonus('CANCELLED')).toBe(0);
  });
});

describe('applyGoalReward', () => {
  it('bumps energy (clamped at 1.0) only for memories from the goal sessions', () => {
    // fake index：三条 entry，source_session_id 分别 s1/s2/other；sessions=['s1','s2']
    // verdict=COMPLETED → s1/s2 两条 +0.08（clamp），other 不动，返回 rewarded=2
  });
  it('skips near-ceiling entries (no wasted bonus)', () => { /* energy 0.97 → 1.0，rewarded 计数仍含 */ });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd gateway && npx jest --runInBand tests/unit/core/manager/goal-reward.test.ts` → FAIL

- [ ] **Step 3: Implement**

```typescript
// gateway/src/core/manager/goal-reward.ts
// B4: reward-modulated consolidation (Adcock 2006; Murayama & Kitagami 2014;
// ExpeL). Asymmetric by design: only COMPLETED goals reward their memories —
// failure never drains (misattribution: a failed goal contains correct facts).
// The bonus rides the replay loop: rewarded memories surface via the same
// need×gain priority (Mattar & Daw 2018).
import { HarmonicIndexManager } from '../../core/memory/harmonic-index';

export function goalRewardBonus(verdict: string): number {
  return verdict === 'COMPLETED' ? 0.08 : 0;
}

export function applyGoalReward(
  deps: { index: HarmonicIndexManager; sessions: string[] },
  verdict: string,
): { rewarded: number } {
  const delta = goalRewardBonus(verdict);
  if (delta <= 0) return { rewarded: 0 };
  const set = new Set(deps.sessions);
  let rewarded = 0;
  for (const entry of deps.index.getIndex().entries) {
    if (!entry.source_session_id || !set.has(entry.source_session_id)) continue;
    if (entry.superseded_by) continue;
    const room = Math.max(0, 1.0 - entry.energy);
    const applied = Math.min(delta, room);
    if (applied > 0) deps.index.updateEnergy(entry.id, applied);
    rewarded++;
  }
  return { rewarded };
}
```

`archiveGoal` 成功路径接线（COMPLETED 分支）：
```typescript
import { applyGoalReward } from './goal-reward';
// verdict === 'COMPLETED' 时（在 recordGoalOutcome 附近）：
const sessions = goalSessions(goalId).map((s) => s.sessionID); // 现有 goal_sessions 查询
const r = applyGoalReward({ index: this.indexManager, sessions }, verdict);
log.info(`[GoalReward] goal ${goalId}: rewarded ${r.rewarded} memories`);
```
（`goalSessions` 的实际查询函数名以 grep 结果为准；接线 fail-open try/catch，不影响 archive 主流程。）

- [ ] **Step 4: Run to verify it passes** → PASS
- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/manager/goal-reward.ts gateway/tests/unit/core/manager/goal-reward.test.ts <archiveGoal 文件>
git commit -m "feat(goal): reward-modulated energy for completed-goal memories (B4, asymmetric)"
```

---

### Task 5: 观测、验证与交付

**Files:**
- Modify: `/api/memory/stats` 相关（index.ts 或 dashboard/api.ts）——replay 覆盖计数（TurnPipelineResult 增 `replayed: number`）
- Modify: `gateway/src/recall/pipeline-heartbeat.ts` 无需动（memory:turnCompress 已有 counts）

- [ ] **Step 1: TDD — TurnPipelineResult 增 replayed 计数**（runSession 统计 prior.length 累加；测试断言 noop 会话 replayed=0、有 prior 时 = prior 条数）

- [ ] **Step 2: 手动触发一轮验证（gateway 构建部署后）**

Run: `mafw stop; npm pack; npm install -g jack200714-mafw-<ver>.tgz; mafw daemon` 后：
```bash
node -e "fetch('http://127.0.0.1:3000/api/memory/stats').then(r=>r.json()).then(j=>console.log(JSON.stringify(j.pipelines)))"
# 手动触发：mafw run-automation memory:turnCompress（或等小时 cron），观察 ~/.mafw/logs/mafw.log 的 [TurnPipeline] replayed 行
```
Expected: turnCompress counts 含 replayed>0；consolidation pairs jsonl 增长；无报错。

- [ ] **Step 3: 全量回归 + 构建门禁**

Run: `cd gateway && npm run build && npx jest --runInBand`
Expected: 全绿。**交付汇报：新增测试数 + 全量通过数**（用户惯例）。

- [ ] **Step 4: Commit + 更新 AGENTS.md**

AGENTS §3（B1 二期：need 驱动采样/last_replayed/goal reward）与 §5.13（turnCompress 行为变化）简述；commit。

```bash
git add -A gateway/src gateway/tests AGENTS.md
git commit -m "feat(memory): interleaved replay observability (B1 wrap-up)"
```

---

## Self-Review 结论

- 覆盖：B1 采样升级（Task 3）、consolidation 审计修复（Task 1-2）、B4（Task 4）、观测（Task 5）✓
- B2/B6（检索出口关系展开、回源证据链）为中期切片，**不在本计划**——按 survey §4 行动清单另行立项
- 类型一致：`needFor`（Plan A）→ `priorKnowledgeFor opts` → `replayPriorityForMemory`；`stampReplayed`/`goalRewardBonus`/`applyGoalReward` 签名各任务一致 ✓
- Task 2 是决策检查点（审计文档为交付物），H1 结论可能导致后续任务范围缩减——这是设计意图（健康带重定义后无需修判官）
