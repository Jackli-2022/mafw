# Goal 预算创建面（P1 批次 2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 goal 预算参数面——`mafw_create_goal`/`mafw_set_goal` 接受 `budget: {maxTurns?, maxCostUsd?}` → request.json → state policySnapshot → P0 的 `attachBudgetGuardForGoal` 零改动生效。

**Architecture:** 纯参数透传链，无新契约。两个 handler 写 request.json 顶层 `budget`；`handleValidate`（state 初始化）与 `onGoalCreated`（policySnapshot 补写）两处从 request.json 读 budget 并入 policySnapshot。

**Tech Stack:** TypeScript (CJS)、Jest。

**Spec:** `docs/superpowers/specs/2026-09-14-runtime-contract-p1-batch-design.md` §E

## Global Constraints

- budget 字段可选，两者都缺时不写 request.budget、policySnapshot 不含 maxTurns/maxCostUsd（guard 缺省不启用语义不变）。
- 源码修改一律用 edit/write 工具（PowerShell 编码陷阱，板记忆 8cqp5f）。
- 每 task：失败测试 → 实现 → 通过 → commit（新文件同 commit）。

---

### Task 1: handler 参数面 + 工具 schema

**Files:**
- Modify: `gateway/src/mcp/handlers/create-goal.ts`
- Modify: `gateway/src/mcp/handlers/manager-set-goal.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`（mafw_create_goal schema + manager_set_goal 段）
- Test: `gateway/tests/unit/create-goal-budget.test.ts`（新建）

**Interfaces:**
- `budget?: { maxTurns?: number; maxCostUsd?: number }`——写入 request.json 顶层；两者都缺 → 不写 budget 键

- [ ] **Step 1: 写失败测试**

```ts
import { handleCreateGoal } from '../../src/mcp/handlers/create-goal';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-budget-'));
process.env.MAFW_PROJECT_DIR = tmp;

afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('mafw_create_goal budget passthrough', () => {
  it('writes request.budget when provided', async () => {
    const out = await handleCreateGoal({
      goalId: 'budget-1', title: 'T', charter: '# C',
      budget: { maxTurns: 12, maxCostUsd: 0.5 },
    } as any, {} as any);
    const request = JSON.parse(fs.readFileSync(path.join(tmp, '.mafw', 'requests', 'budget-1.json'), 'utf-8'));
    expect(request.budget).toEqual({ maxTurns: 12, maxCostUsd: 0.5 });
  });

  it('omits request.budget when absent', async () => {
    await handleCreateGoal({ goalId: 'budget-2', title: 'T', charter: '# C' } as any, {} as any);
    const request = JSON.parse(fs.readFileSync(path.join(tmp, '.mafw', 'requests', 'budget-2.json'), 'utf-8'));
    expect(request.budget).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- create-goal-budget`
Expected: FAIL（request.budget undefined）

- [ ] **Step 3: 实现两个 handler**

`create-goal.ts`（request 对象前加解析，request 字面量加 budget）：

```ts
    const budget = (args.budget as { maxTurns?: number; maxCostUsd?: number } | undefined);
    const hasBudget = budget && (typeof budget.maxTurns === 'number' || typeof budget.maxCostUsd === 'number');
```

request 字面量加 `...(hasBudget ? { budget } : {}),`。`manager-set-goal.ts` 同样两处。

`tool-registry.ts`：mafw_create_goal schema properties 加：

```ts
        budget: {
          type: "object",
          description: "Turn/cost budget for the goal session (BudgetGuard hard-stop)",
          properties: { maxTurns: { type: "number" }, maxCostUsd: { type: "number" } },
        },
```

（manager_set_goal 段若有同形 schema 同样加；实施时查。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- create-goal-budget`
Expected: PASS（2 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/handlers/create-goal.ts gateway/src/mcp/handlers/manager-set-goal.ts gateway/src/mcp/tool-registry.ts gateway/tests/unit/create-goal-budget.test.ts
git commit -m "feat(mcp): mafw_create_goal/set_goal budget parameter passthrough"
```

---

### Task 2: policySnapshot 合并（handleValidate + onGoalCreated）

**Files:**
- Modify: `gateway/src/index.ts`（两处）
- Test: `gateway/tests/unit/goal-budget-policy.test.ts`（新建，纯函数抽取测）

**Interfaces:**
- `mergeBudgetIntoSnapshot(snapshot, requestFile): snapshot`——从 `requests/<goalId>.json` 读 budget 并入；文件缺失/无 budget/解析失败 → 原样返回（fail-open）。抽取为可导出纯函数（`gateway/src/core/goal-budget.ts` 新文件，deps 注入 fs 便于单测）。

- [ ] **Step 1: 写失败测试**

```ts
import { mergeBudgetIntoSnapshot } from '../../../src/core/goal-budget';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('mergeBudgetIntoSnapshot', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-gb-'));
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('merges maxTurns/maxCostUsd from request file', () => {
    const req = path.join(tmp, 'g1.json');
    fs.writeFileSync(req, JSON.stringify({ goalId: 'g1', budget: { maxTurns: 8, maxCostUsd: 0.3 } }));
    const out = mergeBudgetIntoSnapshot({ version: 'v1', proposalId: null }, req);
    expect(out).toEqual({ version: 'v1', proposalId: null, maxTurns: 8, maxCostUsd: 0.3 });
  });

  it('returns snapshot unchanged when request has no budget', () => {
    const req = path.join(tmp, 'g2.json');
    fs.writeFileSync(req, JSON.stringify({ goalId: 'g2' }));
    const snap = { version: 'v1' };
    expect(mergeBudgetIntoSnapshot(snap as any, req)).toEqual({ version: 'v1' });
  });

  it('fail-open on missing/invalid request file', () => {
    const snap = { version: 'v1' };
    expect(mergeBudgetIntoSnapshot(snap as any, path.join(tmp, 'nope.json'))).toEqual({ version: 'v1' });
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, 'not json');
    expect(mergeBudgetIntoSnapshot(snap as any, bad)).toEqual({ version: 'v1' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- goal-budget-policy`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`gateway/src/core/goal-budget.ts`（新文件）：

```ts
import * as fs from 'fs';

/**
 * 把 goal request 文件里的 budget.{maxTurns,maxCostUsd} 并入 policySnapshot。
 * fail-open：文件缺失/坏 JSON/无 budget → 原样返回。
 */
export function mergeBudgetIntoSnapshot(
  snapshot: Record<string, unknown>,
  requestFile: string,
): Record<string, unknown> {
  try {
    if (!fs.existsSync(requestFile)) return snapshot;
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf-8'));
    const budget = request?.budget;
    const maxTurns = typeof budget?.maxTurns === 'number' ? budget.maxTurns : undefined;
    const maxCostUsd = typeof budget?.maxCostUsd === 'number' ? budget.maxCostUsd : undefined;
    if (maxTurns === undefined && maxCostUsd === undefined) return snapshot;
    return {
      ...snapshot,
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    };
  } catch {
    return snapshot;
  }
}
```

`index.ts` 接线两处：
- `handleValidate` 的 `policySnapshot: (...)` 改为经 merge（request 文件 = `path.join(mafwDir, 'requests', goalId + '.json')`）：

```ts
      policySnapshot: mergeBudgetIntoSnapshot(
        (() => { try { return getActivePolicy(config.resolvePath()); } catch { return { version: 'builtin-v1', proposalId: null }; } })(),
        path.join(mafwDir, 'requests', `${goalId}.json`),
      ),
```

- `onGoalCreated` 的 policySnapshot 写入处同样包 merge（request 路径 = `path.join(mafwDir, 'requests', goalId + '.json')`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- goal-budget-policy`
Expected: PASS（3 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal-budget.ts gateway/src/index.ts gateway/tests/unit/goal-budget-policy.test.ts
git commit -m "feat(core): merge goal request budget into policySnapshot (BudgetGuard closed loop)"
```

---

### Task 3: AGENTS.md + 全量回归

**Files:**
- Modify: `AGENTS.md`（§5.19 P1 段落后补一行）

- [ ] **Step 1: AGENTS.md 补**

```markdown
- Goal 预算面：`mafw_create_goal`/`mafw_set_goal` 接受 `budget.{maxTurns,maxCostUsd}` → request.json →
  policySnapshot（`core/goal-budget.ts` mergeBudgetIntoSnapshot，fail-open）→ BudgetGuard 硬停闭环
```

- [ ] **Step 2: 全量回归 + 构建**

```bash
npm test --prefix gateway
npm run build
```

Expected: 全绿 + exit 0；汇报测试数。

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md goal budget creation surface"
```
