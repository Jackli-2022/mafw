# 记忆系统与 Goal 全解绑 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从 MAFW 记忆系统中彻底移除 `goal_id` 字段，记忆独立于 goal 上下文。

**Architecture:** 自底向上 4 层：数据模型 → 存储层 → API 层 → 注入层。旧格式 `memory/tier3/{goalId}.json` 不处理，新代码只读写 `memory/tier3.json` 等单文件。

**Tech Stack:** TypeScript

## Global Constraints

- 不改部分：成本系统、状态系统、引擎层、问题/反馈系统、认知图谱、复习调度器、MinHash 合并器
- 旧 `memory/tier{2,3,4}/{goalId}.json` 文件不处理
- 所有现有测试必须通过（507 tests）

---

### Task 1: 数据模型 + 索引层

**Files:**
- Modify: `src/memory/harmonic-types.ts`
- Modify: `src/memory/harmonic-index.ts`
- Test: `tests/unit/harmonic-index.test.ts`

- [ ] **Step 1: Rewrite harmonic-types.ts — 删除 goal_id**

```typescript
export interface HarmonicUnit {
  id: string;
  memory_type: 'episodic' | 'semantic' | 'procedural' | 'global';
  primary_abstraction: string;
  cue_anchors: string[];
  memory_value: string;
  energy: number;
  created_at: string;
  updated_at: string;
  merged_from?: string[];
  salience?: number;
  abstraction_level?: number;
  review_count?: number;
  last_reviewed?: string;
  top_associations?: string[];
}

export interface HarmonicIndexEntry {
  id: string;
  primary_abstraction: string;
  cue_anchors: string[];
  memory_type: string;
  tier: string;
  energy: number;
}
```

- [ ] **Step 2: Rewrite harmonic-index.ts — addEntry 删除 goal_id**

```typescript
addEntry(unit: HarmonicUnit, tier: string): void {
  this.index.entries.push({
    id: unit.id,
    primary_abstraction: unit.primary_abstraction,
    cue_anchors: unit.cue_anchors,
    memory_type: unit.memory_type,
    tier,
    energy: unit.energy,
  });
  this.save();
}
```

- [ ] **Step 3: Update tests**

Read `tests/unit/harmonic-index.test.ts` and remove any assertions on `goal_id`.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/harmonic-index.test.ts --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/harmonic-types.ts src/memory/harmonic-index.ts tests/unit/harmonic-index.test.ts
git commit -m "refactor(memory): remove goal_id from HarmonicUnit and HarmonicIndexEntry"
```

---

### Task 2: 存储层 — Tier 文件扁平化

**Files:**
- Modify: `src/compression/hybrid-compressor.ts`
- Modify: `src/memory/abstraction-distiller.ts`

- [ ] **Step 1: Rewrite hybrid-compressor.ts — persistUnit 单文件**

找到 `persistUnit()` 方法，将：

```typescript
const goalId = unit.goal_id || '__global__';
const filePath = path.join(this.baseDir, 'memory', tier, `${goalId}.json`);
```

改为：

```typescript
const filePath = path.join(this.baseDir, 'memory', `${tier}.json`);
```

同时删除 `extractGoalId()` 方法（不再需要）。

- [ ] **Step 2: Rewrite abstraction-distiller.ts — 去掉 goalId 参数**

将 `loadTierUnits(baseDir, tier, goalId)` 改为 `loadTierUnits(baseDir, tier)`:

```typescript
function loadTierUnits(baseDir: string, tier: string): HarmonicUnit[] {
  const filePath = path.join(baseDir, 'memory', `${tier}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
```

`saveTierUnits()` 同理删除 goalId 参数。

T2→T3 分组逻辑去掉 `entry.goal_id` 分组：

```typescript
// 之前按 goal_id 分组
const groups = new Map<string, HarmonicUnit[]>();
for (const entry of episodicUnits) {
  const goalKey = entry.goal_id || '__global__';
  // ...
}

// 之后直接全局分组（只按 similarity）
// 去掉 goal_id 作为分组键
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/compression/ tests/unit/abstraction-distiller.test.ts --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/compression/hybrid-compressor.ts src/memory/abstraction-distiller.ts
git commit -m "refactor(memory): flatten tier files, remove goalId from storage paths"
```

---

### Task 3: API 层 — MCP 工具去掉 goalId 参数

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `tests/unit/mcp/tools.test.ts`

- [ ] **Step 1: mafw_search_hybrid — 删除 goalId 参数**

从 `inputSchema.properties` 删除 `goalId`。同时在 handler 中删除 post-filter 代码：

```typescript
// 删除这段
// if (args.goalId) {
//   filtered = filtered.filter((r) => r.goal_id === args.goalId);
// }
```

- [ ] **Step 2: mafw_add_memory — 删除 scope 和 goalId 参数**

从 `inputSchema.properties` 删除 `scope`、`goalId`。同时在 handler 中删除 scope/goalId 分支：

```typescript
// 删除
// const scope = (args.scope as string) || 'project';
// const goalId = (args.goalId as string) || null;
// unit.goal_id = scope === 'global' ? null : goalId;

// 文件路径直接写单文件：
const filePath = path.join(mafwDir, 'memory', `${tier}.json`);
```

同时删除 `mafwDir` 中关于 `goalFile` 的变量：

```typescript
// 删除: const goalFile = unit.goal_id || '__global__';
```

- [ ] **Step 3: Update tools test**

```typescript
// 工具定义数不变（仍是 9 个）
// mafw_add_memory 的参数变了 — 更新测试中的参数验证
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/mcp/tools.test.ts --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/unit/mcp/tools.test.ts
git commit -m "refactor(mcp): remove goalId from mafw_search_hybrid and mafw_add_memory"
```

---

### Task 4: 注入层 — plugin.ts 去 goal 化

**Files:**
- Modify: `src/plugin.ts`
- Modify: `tests/unit/plugin-command.test.ts`

- [ ] **Step 1: Rewrite executeHybridSearch — 删除 goalId 参数**

找到 `executeHybridSearch` 函数，删除 `goalId` 参数。删除以下代码：
- `loadGoal(goalId, dir)` — 读取 goal charter
- `loadState(goalId, dir)` — 读取 state
- `files.filter(f => f.startsWith(goalId))` — review 前缀过滤
- charter 作为合成结果注入
- `state.loop` / `state.phase` 上下文

保留：harmonic index 搜索 + RRF fusion + token 裁剪

- [ ] **Step 2: Rewrite experimental.chat.messages.transform — 不再用 goalId 检索**

当前 transform 解析 goalId 后传递给 `executeHybridSearch({ goalId, query })`。改为直接传递 query：

```typescript
// 之前
const goalId = extractGoalId(message);
const results = await executeHybridSearch({ goalId, query });

// 之后
const results = await executeSearch({ query });
```

仍然解析 goalId 用于判断是否在 MAFW 工作流中（决定是否启用注入），但不再传入检索函数。

- [ ] **Step 3: Compile + run tests**

```bash
npx tsc --noEmit
npx jest tests/unit/plugin-command.test.ts --no-coverage
```
Expected: all pass

- [ ] **Step 4: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: 61 suites, 507 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/plugin.ts tests/unit/plugin-command.test.ts
git commit -m "refactor(plugin): remove goalId from memory injection and hybrid search"
```
