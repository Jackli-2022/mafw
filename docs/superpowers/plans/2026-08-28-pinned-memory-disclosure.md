# Pinned 记忆披露层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现谐波记忆的 pinned 披露层：`pinned` 标志 + 每轮 system prompt 注入 `<user-profile>` 块 + `mafw_pin_memory` 工具 + `mafw_add_memory` 的 `supersedes` 参数。

**Architecture:** pinned 与 type 正交（数据模型加可选字段，索引条目同步携带）；注入保证来自新的 `GET /api/recall/pinned` 端点 + 插件 `experimental.chat.system.transform`（fail-open）；supersede 复用 MinHash soft-supersede 机制（`superseded_by` + energy ×0.5）。渲染收敛在 gateway `inject-format.ts`，插件只做传输。

**Tech Stack:** TypeScript (CJS gateway + ESM plugin)、jest + ts-jest、无新依赖。

## Global Constraints

- spec：`docs/superpowers/specs/2026-08-28-pinned-memory-disclosure-design.md`
- 预算硬 cap：**20 条 / 2000 字符**，按 `energy × salience` 降序截断；溢出记日志 `[Recall] pinned overflow: N entries dropped`
- salience 缺失按 **1**（AGENTS.md §3.2）
- superseded 条目（`superseded_by` 非空）不参与披露注入
- pinned 条目检索排序**不加分**（披露是注入策略，不扭曲 BM25）
- 插件侧 fail-open：gateway 超时/错误 → 不注入块、不抛异常、不阻塞（超时 150ms）
- system 数组顺序：`<memory-guide>`（静态）在前 → `<user-profile>`（半稳定）在后
- MinHash 合并产物 `pinned = 各源 OR`；显式 `supersedes` **不继承** pinned（新条目显式声明）
- 显式 `supersedes`：目标不存在 → 显式错误；目标已被 superseded → 跳过重复标记（防 energy 二次减半）；新条目 energy = `Math.max(0.8, 旧条目 energy)`
- 测试命令：`npx jest --runInBand`（workdir `gateway/`），构建门禁 `npm run build`（repo 根）
- 本仓库惯例：`src/`（插件）无单元测试基建——插件 hook 不写 jest，靠 typecheck + 验收标准；gateway 测试全部在 `gateway/tests/unit/`

---

### Task 1: 数据模型 + 存储层（pinned 字段、setPinned、merge OR）

**Files:**
- Modify: `gateway/src/core/memory/harmonic-types.ts`（HarmonicUnit + HarmonicIndexEntry）
- Modify: `gateway/src/memory/harmonic-file-store.ts:68-83`（write 透传 pinned）、新增 `setPinned()`
- Modify: `gateway/src/core/memory/minhash-merger.ts:87-97`（merge pinned=OR）
- Test: `gateway/tests/unit/pinned-memory-store.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `HarmonicUnitFileStore.write/read/markSuperseded`、`MinHashMerger.merge`
- Produces: `HarmonicUnit.pinned?: boolean`、`HarmonicIndexEntry.pinned?: boolean`、`HarmonicUnitFileStore.setPinned(id: string, pinned: boolean): boolean`

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/pinned-memory-store.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';

function makeUnit(overrides: Partial<HarmonicUnit> = {}): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'semantic',
    primary_abstraction: '用户偏好中文回复',
    cue_anchors: ['用户', '偏好', '中文'],
    memory_value: '用户偏好中文回复',
    energy: 0.8,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('pinned memory store', () => {
  let dir: string;
  let store: HarmonicUnitFileStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pinned-'));
    store = new HarmonicUnitFileStore(dir);
  });

  test('write with pinned=true → index entry carries pinned', async () => {
    await store.write(makeUnit({ pinned: true }));
    const entry = store.indexManager_().getIndex().entries.find((e: any) => e.pinned);
    expect(entry).toBeDefined();
    expect(entry.pinned).toBe(true);
  });

  test('write without pinned → entry has no pinned flag', async () => {
    await store.write(makeUnit());
    const entry = store.indexManager_().getIndex().entries[0];
    expect((entry as any).pinned).toBeFalsy();
  });

  test('setPinned round-trip updates index and is readable', async () => {
    const u = makeUnit();
    await store.write(u);
    expect(store.setPinned(u.id, true)).toBe(true);
    expect((store.indexManager_().getIndex().entries[0] as any).pinned).toBe(true);
    const reread = await store.read(u.id);
    expect((reread as any).pinned).toBe(true);
    expect(store.setPinned(u.id, false)).toBe(true);
    expect((store.indexManager_().getIndex().entries[0] as any).pinned).toBe(false);
  });

  test('setPinned on nonexistent id returns false', () => {
    expect(store.setPinned('mem_nope', true)).toBe(false);
  });

  test('MinHash merge: pinned = OR across sources', async () => {
    await store.write(makeUnit({ pinned: true, primary_abstraction: '用户偏好中文回复和简洁代码' }));
    // 相似 abstraction 触发合并（threshold 0.75，3-gram shingle）
    const b = makeUnit({ primary_abstraction: '用户偏好中文回复和简洁代码风格', pinned: false });
    await store.write(b);
    const mergedEntry = store.indexManager_().getIndex().entries.find((e: any) => e.merged_from?.length);
    expect(mergedEntry).toBeDefined();
    expect(mergedEntry.pinned).toBe(true);
  });

  test('explicit supersedes flow: old entry gets superseded_by = new id', async () => {
    const old = makeUnit({ primary_abstraction: '用户偏好在晚上工作' });
    await store.write(old);
    const fresh = makeUnit({ primary_abstraction: '用户偏好在白天工作' });
    await store.write(fresh);
    expect(store.markSuperseded(old.id, fresh.id)).toBe(true);
    const target = store.indexManager_().getIndex().entries.find((e: any) => e.id === old.id);
    expect((target as any).superseded_by).toBe(fresh.id);
    expect(target.energy).toBeLessThan(0.8);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest --runInBand tests/unit/pinned-memory-store.test.ts`（workdir `gateway/`）
Expected: FAIL（`pinned` 不在类型上 / `setPinned is not a function`）

- [ ] **Step 3: 最小实现**

`harmonic-types.ts` — `HarmonicUnit` 在 `source_session_id?: string;` 前加：

```typescript
  /** Disclosure layer: injected into the system prompt every turn (excluded when superseded). */
  pinned?: boolean;
```

`HarmonicIndexEntry` 在 `source_session_id?: string;` 前加：

```typescript
  pinned?: boolean;
```

`harmonic-file-store.ts` — `write()` 的 `addEntry({...})` 里 `source_session_id: targetUnit.source_session_id,` 前加一行：

```typescript
        pinned: targetUnit.pinned,
```

`harmonic-file-store.ts` — 在 `markSuperseded` 方法后新增（复用其 frontmatter 重写模式）：

```typescript
  /**
   * Pin/unpin an existing memory for the disclosure layer. Rewrites the OKF
   * frontmatter and updates the index entry. Returns false when id is unknown.
   */
  setPinned(id: string, pinned: boolean): boolean {
    const entry = this.indexManager.getIndex().entries.find(e => e.id === id);
    if (!entry || !(entry as any).filePath) return false;
    const fullPath = path.join(this.baseDir, (entry as any).filePath);
    if (!fs.existsSync(fullPath)) return false;

    const { unit, body } = readOKFFile(fullPath);
    unit.pinned = pinned;
    unit.updated_at = new Date().toISOString();
    const yaml = require('js-yaml');
    const yamlStr = yaml.dump(unit, { lineWidth: -1, quotingType: '"' });
    const tmpPath = fullPath + '.tmp';
    fs.writeFileSync(tmpPath, `---\n${yamlStr}---\n${body}\n`, 'utf-8');
    fs.renameSync(tmpPath, fullPath);

    entry.pinned = pinned;
    this.indexManager.save();
    return true;
  }
```

`minhash-merger.ts` — `merge()` 在 `const existingUnit = await store.read(entry.id); if (!existingUnit) continue;` 之后加：

```typescript
        if (existingUnit.pinned) result.pinned = true;
```

注意：`existingUnit` 类型是 `HarmonicUnit | null`，`read()` 返回的 unit 已带 `pinned`（OKF frontmatter 往返）。

- [ ] **Step 4: 运行确认通过**

Run: `npx jest --runInBand tests/unit/pinned-memory-store.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/harmonic-types.ts gateway/src/memory/harmonic-file-store.ts gateway/src/core/memory/minhash-merger.ts gateway/tests/unit/pinned-memory-store.test.ts
git commit -m "feat(gateway): pinned flag on harmonic units + setPinned + merge OR semantics"
```

---

### Task 2: 渲染器 formatPinnedProfile（inject-format.ts）

**Files:**
- Modify: `gateway/src/recall/inject-format.ts`（文件末尾新增）
- Test: `gateway/tests/unit/pinned-profile-format.test.ts`（新建）

**Interfaces:**
- Produces: `formatPinnedProfile(entries: MemoryUnit[]): { profile: string | null; used: number }`、`PINNED_BUDGET: { max: 20; maxChars: 2000 }`（Task 3 的路由消费）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/pinned-profile-format.test.ts
import { formatPinnedProfile, PINNED_BUDGET } from '../../src/recall/inject-format';

function mem(overrides: Partial<{ memory_value: string; primary_abstraction: string }> = {}) {
  return { id: 'mem_x', memory_value: '用户偏好中文回复', primary_abstraction: '偏好', ...overrides };
}

describe('formatPinnedProfile', () => {
  test('empty entries → profile null, used 0', () => {
    expect(formatPinnedProfile([])).toEqual({ profile: null, used: 0 });
  });

  test('renders <user-profile> block with one bullet per memory_value', () => {
    const { profile, used } = formatPinnedProfile([mem(), mem({ memory_value: '不在生产库跑迁移前先备份' })]);
    expect(profile).toBe('<user-profile>\n- 用户偏好中文回复\n- 不在生产库跑迁移前先备份\n</user-profile>');
    expect(used).toBe(2);
  });

  test('strips newlines from memory_value', () => {
    const { profile } = formatPinnedProfile([mem({ memory_value: '第一行\n第二行' })]);
    expect(profile).not.toContain('\n第二行');
    expect(profile).toContain('第一行 第二行');
  });

  test('enforces maxEntries cap', () => {
    const entries = Array.from({ length: 30 }, (_, i) => mem({ memory_value: `条目${i}` }));
    const { used } = formatPinnedProfile(entries);
    expect(used).toBe(PINNED_BUDGET.max);
  });

  test('enforces maxChars budget (long entries dropped)', () => {
    const longValue = 'x'.repeat(1500);
    const entries = [mem({ memory_value: longValue }), mem({ memory_value: longValue })];
    const { used } = formatPinnedProfile(entries);
    expect(used).toBe(1); // 第二条会超出 2000 字符预算
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest --runInBand tests/unit/pinned-profile-format.test.ts`
Expected: FAIL（`formatPinnedProfile` 未导出）

- [ ] **Step 3: 最小实现**

`inject-format.ts` 文件末尾追加：

```typescript
// ---- Pinned disclosure profile rendering (GET /api/recall/pinned) ----

export const PINNED_BUDGET = { max: 20, maxChars: 2000 } as const;

const PROFILE_TAG = '<user-profile>';
const PROFILE_END_TAG = '</user-profile>';

/**
 * Renders pinned memories into the <user-profile> disclosure block.
 * Enforces the hard budget (max entries / max chars); entries beyond the
 * budget are dropped (caller logs the overflow count). Returns null profile
 * for an empty set — callers must not inject an empty block.
 */
export function formatPinnedProfile(entries: MemoryUnit[]): { profile: string | null; used: number } {
  const lines: string[] = [];
  let chars = 0;
  for (const m of entries.slice(0, PINNED_BUDGET.max)) {
    const text = (m.memory_value || m.primary_abstraction || '?').replace(/\n/g, ' ');
    const line = `- ${text}`;
    if (chars + line.length > PINNED_BUDGET.maxChars) break;
    lines.push(line);
    chars += line.length;
  }
  if (lines.length === 0) return { profile: null, used: 0 };
  return { profile: `${PROFILE_TAG}\n${lines.join('\n')}\n${PROFILE_END_TAG}`, used: lines.length };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest --runInBand tests/unit/pinned-profile-format.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/inject-format.ts gateway/tests/unit/pinned-profile-format.test.ts
git commit -m "feat(gateway): formatPinnedProfile renderer with disclosure budget"
```

---

### Task 3: HTTP 端点（recall/pinned 路由模块 + memory/pin + memory/add 参数）

**Files:**
- Create: `gateway/src/routes/pinned-recall.ts`
- Modify: `gateway/src/index.ts:3891-3931` 附近（`/api/recall/pinned` 路由，放在 `/api/recall/context` 之后）
- Modify: `gateway/src/index.ts:4894-4935`（`/api/memory/add` 透传 pinned/supersedes；`/api/memory/pin` 新路由）
- Test: `gateway/tests/unit/pinned-recall.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `HarmonicUnitFileStore.setPinned`、Task 2 的 `formatPinnedProfile`
- Produces: `handleRecallPinned(deps: PinnedDeps)`，`PinnedDeps = { getIndex(): { entries: any[] }; readUnit(id: string): Promise<HarmonicUnit | null> }`；HTTP `GET /api/recall/pinned` → `{ profile, entries, budget }`；`POST /api/memory/pin` → `{ success, id, pinned }`

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/pinned-recall.test.ts
import { handleRecallPinned, PINNED_BUDGET } from '../../src/routes/pinned-recall';

function entry(overrides: Partial<{ id: string; pinned: boolean; superseded_by: string; energy: number; salience: number }> = {}) {
  return { id: 'mem_a', type: 'semantic', pinned: true, energy: 0.8, salience: 0.5, ...overrides };
}

describe('handleRecallPinned', () => {
  test('filters to pinned && !superseded, loads full values, returns budget', async () => {
    const units: Record<string, any> = {
      mem_a: { id: 'mem_a', type: 'semantic', primary_abstraction: 'a', memory_value: '偏好中文', energy: 0.8, salience: 0.5, created_at: '2026-08-28T00:00:00Z' },
      mem_b: { id: 'mem_b', type: 'semantic', primary_abstraction: 'b', memory_value: '偏好简洁', energy: 0.9, salience: 0.5, created_at: '2026-08-28T00:00:00Z' },
    };
    const result = await handleRecallPinned({
      getIndex: () => ({ entries: [
        entry({ id: 'mem_a' }),
        entry({ id: 'mem_b', energy: 0.9 }),
        entry({ id: 'mem_c', superseded_by: 'mem_b' }),   // superseded：排除
        entry({ id: 'mem_d', pinned: false }),            // 未 pin：排除
      ] }),
      readUnit: async (id: string) => units[id] || null,
    });
    expect(result.entries.map((e: any) => e.id)).toEqual(['mem_b', 'mem_a']); // energy 0.9 > 0.8
    expect(result.profile).toContain('偏好简洁');
    expect(result.budget).toEqual({ ...PINNED_BUDGET, used: 2 });
  });

  test('empty set → profile null', async () => {
    const result = await handleRecallPinned({ getIndex: () => ({ entries: [] }), readUnit: async () => null });
    expect(result.profile).toBeNull();
    expect(result.budget.used).toBe(0);
  });

  test('salience missing treated as 1 in sort', async () => {
    const units: Record<string, any> = {
      mem_low: { id: 'mem_low', memory_value: '低', energy: 0.8, salience: 0.5 },
      def: { id: 'def', memory_value: '默认', energy: 0.8 }, // salience 缺失 = 1 → 排前
    };
    const result = await handleRecallPinned({
      getIndex: () => ({ entries: [entry({ id: 'mem_low' }), entry({ id: 'def', salience: undefined as any })] }),
      readUnit: async (id) => units[id] || null,
    });
    expect(result.entries[0].id).toBe('def');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest --runInBand tests/unit/pinned-recall.test.ts`
Expected: FAIL（`../../src/routes/pinned-recall` 不存在）

- [ ] **Step 3: 实现路由模块**

```typescript
// gateway/src/routes/pinned-recall.ts
import { HarmonicUnit } from '../core/memory/harmonic-types';

export interface PinnedDeps {
  getIndex(): { entries: any[] };
  readUnit(id: string): Promise<HarmonicUnit | null>;
}

export { PINNED_BUDGET } from '../recall/inject-format';

/**
 * Scan the harmonic index for pinned (and not superseded) entries, sort by
 * energy × salience, load full memory values, and render the disclosure
 * profile. Overflow beyond the budget is logged here (formatter only counts).
 */
export async function handleRecallPinned(deps: PinnedDeps): Promise<{
  profile: string | null;
  entries: Array<Pick<HarmonicUnit, 'id' | 'type' | 'primary_abstraction' | 'memory_value' | 'energy' | 'salience' | 'created_at'>>;
  budget: { max: number; maxChars: number; used: number };
}> {
  const { formatPinnedProfile, PINNED_BUDGET } = require('../recall/inject-format');

  const pinned = deps.getIndex().entries.filter((e: any) => e.pinned && !e.superseded_by);
  pinned.sort((a: any, b: any) =>
    (b.energy ?? 0) * (b.salience ?? 1) - (a.energy ?? 0) * (a.salience ?? 1));

  const units: HarmonicUnit[] = [];
  for (const e of pinned) {
    const u = await deps.readUnit(e.id);
    if (u) units.push(u);
  }

  const { profile, used } = formatPinnedProfile(units);
  if (units.length > used) {
    console.log(`[Recall] pinned overflow: ${units.length - used} entries dropped`);
  }

  const entries = units.slice(0, used).map(u => ({
    id: u.id,
    type: u.type,
    primary_abstraction: u.primary_abstraction,
    memory_value: u.memory_value,
    energy: u.energy,
    salience: u.salience,
    created_at: u.created_at,
  }));

  return { profile, entries, budget: { max: PINNED_BUDGET.max, maxChars: PINNED_BUDGET.maxChars, used } };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest --runInBand tests/unit/pinned-recall.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: index.ts 接线**

`gateway/src/index.ts` — 在 `/api/recall/context` 路由块的 `return;`（约 line 3931）之后新增：

```typescript
        // GET /api/recall/pinned — disclosure layer for system prompt injection.
        // Pinned memories appear every turn regardless of retrieval; fail-open.
        if (req.url?.startsWith('/api/recall/pinned') && req.method === 'GET') {
          try {
            if (!this.memoryService) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } }));
              return;
            }
            const { handleRecallPinned } = require('./routes/pinned-recall');
            const { HarmonicUnitFileStore } = require('./memory/harmonic-file-store.js');
            const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
            const result = await handleRecallPinned({
              getIndex: () => this.memoryService!.harmonicIndex.getIndex(),
              readUnit: (id: string) => store.read(id),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            log.error('[Scheduler] recall/pinned error:', err.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } }));
          }
          return;
        }
```

`/api/memory/add`（约 line 4916-4930）— unit 字面量里 `source_session_id:` 之前加：

```typescript
          pinned: data?.pinned === true || undefined,
```

`await store.write(unit);` 之前加 supersedes 校验与能量继承：

```typescript
        let supersedesTarget: any = null;
        if (data?.supersedes) {
          const sid = String(data.supersedes);
          supersedesTarget = this.memoryService.harmonicIndex.getIndex().entries.find((e: any) => e.id === sid);
          if (!supersedesTarget) return { success: false, error: `supersedes target not found: ${sid}` };
          unit.energy = Math.max(unit.energy, supersedesTarget.energy ?? 0);
        }
```

`await store.write(unit);` 之后、`return` 之前加：

```typescript
        if (supersedesTarget && !supersedesTarget.superseded_by) {
          store.markSuperseded(supersedesTarget.id, unit.id);
        }
```

`/api/memory/pin` 新路由（放在 `/api/memory/add` 块之后）：

```typescript
    if (req.url === '/api/memory/pin' && req.method === 'POST') {
      const body = await new Promise<string>((resolve) => {
        let b = '';
        req.on('data', (c: Buffer) => (b += c.toString('utf-8')));
        req.on('end', () => resolve(b));
      });
      try {
        const data = JSON.parse(body);
        const id = String(data?.id || '');
        if (!id) return { success: false, error: 'id required' };
        if (!this.memoryService) return { success: false, error: 'memoryService not ready' };
        const { HarmonicUnitFileStore } = require('./memory/harmonic-file-store.js');
        const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
        const pinned = data?.pinned === true;
        const ok = store.setPinned(id, pinned);
        if (!ok) return { success: false, error: `memory not found: ${id}` };
        return { success: true, id, pinned };
      } catch (err: any) {
        log.warn(`[Scheduler] /api/memory/pin failed: ${err.message}`);
        return { success: false, error: err.message };
      }
    }
```

- [ ] **Step 6: 全量测试确认无回归**

Run: `npx jest --runInBand`（workdir `gateway/`）
Expected: 全部 PASS（25+ 套件）

- [ ] **Step 7: Commit**

```bash
git add gateway/src/routes/pinned-recall.ts gateway/src/index.ts gateway/tests/unit/pinned-recall.test.ts
git commit -m "feat(gateway): /api/recall/pinned + /api/memory/pin + add pinned/supersedes params"
```

---

### Task 4: MCP 工具（add_memory 参数 + mafw_pin_memory 新工具）

**Files:**
- Modify: `gateway/src/core/mcp/tools.ts:156-169`（add_memory schema）、`gateway/src/core/mcp/tools.ts:429-466`（add_memory handler）、工具清单数组与 handlers 各加一项

**Interfaces:**
- Consumes: Task 1 的 `store.setPinned`、`store.markSuperseded`
- Produces: MCP 工具 `mafw_pin_memory { id, pinned }` → `{ success, id, pinned }`；`mafw_add_memory` 新参数 `pinned?: boolean`、`supersedes?: string`

- [ ] **Step 1: add_memory schema 加参数**

`tools.ts` schema properties（`primaryAbstraction` 行后）：

```typescript
          pinned: { type: 'boolean', description: 'Pin to disclosure layer: injected into system prompt every turn. ONLY for user identity/profile and long-term preferences/constraints. Never for task-specific or volatile content.' },
          supersedes: { type: 'string', description: 'ID of an existing memory this one replaces (e.g. a preference changed). The old memory is marked superseded automatically; its history is preserved.' },
```

- [ ] **Step 2: add_memory handler 实现**

`mafw_add_memory` handler — unit 字面量 `updated_at: now,` 之后加：

```typescript
          pinned: args.pinned === true || undefined,
```

`await store.write(unit);` 前后加 supersedes 逻辑（与 Task 3 HTTP 版一致）：

```typescript
        let supersedesTarget: any = null;
        if (args.supersedes) {
          const sid = String(args.supersedes);
          supersedesTarget = store.indexManager_().getIndex().entries.find((e: any) => e.id === sid);
          if (!supersedesTarget) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `supersedes target not found: ${sid}` }) }], isError: true };
          }
          unit.energy = Math.max(unit.energy, supersedesTarget.energy ?? 0);
        }
        await store.write(unit);
        if (supersedesTarget && !supersedesTarget.superseded_by) {
          store.markSuperseded(supersedesTarget.id, unit.id);
        }
```

（注意 handler 里现有 `new HarmonicUnitFileStore(mafwDir)` 在 write 前构造——把 supersedes 校验放在 store 构造之后即可，`indexManager_()` 是 Task 1 已有的公开方法。）

- [ ] **Step 3: 新工具 mafw_pin_memory**

工具清单数组（`mafw_add_memory` 定义之后）加：

```typescript
    {
      name: 'mafw_pin_memory',
      description: 'Pin or unpin an existing memory to/from the disclosure layer. Pinned memories are injected into the system prompt every turn. Unpin is the correction path when a pinned preference becomes stale.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory unit id (mem_...)' },
          pinned: { type: 'boolean', description: 'true to pin, false to unpin' },
        },
        required: ['id', 'pinned'],
      },
    },
```

handlers 对象（`mafw_add_memory` handler 之后）加：

```typescript
    mafw_pin_memory: async (args) => {
      try {
        const id = String(args.id || '');
        if (!id) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'id required' }) }], isError: true };
        }
        const { HarmonicUnitFileStore } = await import('../../memory/harmonic-file-store.js');
        const store = new HarmonicUnitFileStore(mafwDir);
        const pinned = args.pinned === true;
        const ok = store.setPinned(id, pinned);
        if (!ok) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `memory not found: ${id}` }) }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, id, pinned }) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    },
```

- [ ] **Step 4: 构建门禁**

Run: `npm run build`（repo 根）
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/mcp/tools.ts
git commit -m "feat(gateway): mafw_pin_memory tool + pinned/supersedes params on mafw_add_memory"
```

---

### Task 5: 插件注入（user-profile hook + memory-guide 纪律 + 接线）

**Files:**
- Create: `src/hooks/user-profile.ts`
- Modify: `src/hooks/memory-guide.ts:10-24`（GUIDE_BODY 加纪律）
- Modify: `src/plugin.ts:218-222`（system.transform 接线）

**Interfaces:**
- Consumes: Task 3 的 `GET /api/recall/pinned`（`{ profile: string | null, ... }`）
- Produces: `userProfileSystemHook(input, output)` —— 在 `output.system.push(<user-profile> 块)`

- [ ] **Step 1: user-profile.ts**

```typescript
// Disclosure layer injection: fetches the pinned <user-profile> block from the
// gateway and appends it to the system prompt (after <memory-guide>, so the
// static prefix stays cacheable). Fail-open: any error/timeout means no block,
// never an exception — LLM flow must not be blocked by memory injection.

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const PINNED_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/recall/pinned`

export async function userProfileSystemHook(_input: any, output: any): Promise<any> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 150)
    const res = await fetch(PINNED_URL, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return output
    const body = await res.json() as any
    if (body?.profile) {
      if (!output.system) output.system = []
      output.system.push(body.profile)
    }
  } catch {
    // fail-open: gateway down / timeout → no disclosure block this turn
  }
  return output
}
```

- [ ] **Step 2: memory-guide 纪律**

`memory-guide.ts` 的 `GUIDE_BODY` 在「### 子代理」小节之前插入：

```
### 披露层（pinned）
- 用户身份/画像、长期偏好与约束 → mafw_add_memory 时 pinned: true（每轮保证注入）；任务相关、易变内容不要 pin
- 偏好/事实变了 → 新写一条并带 supersedes: 旧id（旧版自动失效，历史保留）
- 需要 pin/unpin 已有记忆 → mafw_pin_memory
```

- [ ] **Step 3: plugin.ts 接线**

import 区（`memoryGuideHook` import 附近）加：

```typescript
import { userProfileSystemHook } from './hooks/user-profile';
```

system.transform（line 218-222）改为：

```typescript
    'experimental.chat.system.transform': async (input: any, output: any) => {
      memoryGuideHook(input, output);
      await userProfileSystemHook(input, output);
      voiceGuideSystemHook(input, output);
      return output;
    },
```

（顺序即缓存契约：静态 guide → 半稳定 profile → 条件 voice-guide。）

- [ ] **Step 4: 构建门禁**

Run: `npm run build`（repo 根）
Expected: exit 0（插件 tsc 通过）

- [ ] **Step 5: Commit**

```bash
git add src/hooks/user-profile.ts src/hooks/memory-guide.ts src/plugin.ts
git commit -m "feat(plugin): inject <user-profile> disclosure block in system transform"
```

---

### Task 6: AGENTS.md 文档 + 全量验证

**Files:**
- Modify: `AGENTS.md`（§3.1 字段、§4 工具表、§5.13 简述）

**Interfaces:** 无代码；文档与实现一致。

- [ ] **Step 1: §3.1 HarmonicUnit 字段**

接口代码块 `superseded_by` 注释行后加：

```typescript
  pinned?: boolean;               // 披露层：每轮注入 <user-profile>（superseded 后失效）；与 type 正交
```

- [ ] **Step 2: §4 工具表**

标题改为「v6.8 总共 36 个」，表格 `mafw_add_memory` 行后加：

```markdown
| `mafw_pin_memory` | pin/unpin 已有记忆（披露层正门） |
```

`mafw_add_memory` 行用途补「（支持 pinned / supersedes）」。

- [ ] **Step 3: §5.13 末尾加披露层小节**

```markdown
#### Pinned 披露层（2026-08-28）

`pinned` 是 HarmonicUnit 一等标志（与 type 正交）：pinned 且未 superseded 的记忆经
`GET /api/recall/pinned` 渲染为 `<user-profile>` 块，由插件 system.transform 每轮注入
（`<memory-guide>` 之后，半稳定内容靠后保前缀缓存；fail-open）。预算 20 条/2000 字符，
按 energy×salience 截断。知识更新：`mafw_add_memory { supersedes: 旧id }` 显式取代
（复用 MinHash soft-supersede 链）；纠错正门 `mafw_pin_memory`。渲染收敛在
`inject-format.ts:formatPinnedProfile()`，路由逻辑在 `routes/pinned-recall.ts`（deps 注入可单测）。
不加独立 update/delete 工具（业界实践：记忆变异属后台管线——下期 turnCompress 矛盾检测）。
```

- [ ] **Step 4: 全量验证**

```bash
npx jest --runInBand        # workdir gateway/ — 全部 PASS
npm run build               # repo 根 — exit 0
```

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document pinned disclosure layer and mafw_pin_memory"
```

---

## 验收对照（spec §11）

| # | 验收 | 覆盖 |
|---|---|---|
| 1 | pinned 写入 → 下轮 system 含 `<user-profile>` | Task 1/3/5 端到端；手动验收 |
| 2 | summarize 后披露块仍在 | system.transform 每轮重建（机制保证） |
| 3 | gateway 停止 → 不报错不注入空块 | Task 5 fail-open（catch + profile null 检查） |
| 4 | 21 条只注入 20 条 + overflow 日志 | Task 2 cap 测试 + Task 3 overflow 日志 |
| 5 | supersedes 后旧记忆退出检索和披露 | Task 1 supersede 测试 + Task 3 superseded 过滤 |
| 6 | unpin 后披露块不再含该条 | Task 1 setPinned 测试 |
