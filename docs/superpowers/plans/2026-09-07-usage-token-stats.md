# 用量页 Token 统计与分模型统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UsageDock 增加业界标准（ccusage 风）的时间窗口 + 分模型 token 统计，配额窗口拆为 RightDock 独立 `quota` tab。

**Architecture:** 复用 `trajectory_turns` 表（`model`/`provider`/`tokens`/`created_at` 列已逐 turn 持久化），查询时 `GROUP BY provider, model` 现算四个时间窗口；成本用 `model-prices.ts` 价目表估算；trajectory 保留期从硬编码 14 天改为配置 `trajectory.retentionDays`（默认 365）。前端 UsageDock 合并区块展示 KPI + 分模型表，配额区块搬入新 QuotaDock。

**Tech Stack:** TypeScript / better-sqlite3（gateway）、SolidJS + @opencode-ai/ui（desktop）、jest + ts-jest（gateway/tests）。

**Spec:** `docs/superpowers/specs/2026-09-07-usage-token-stats-design.md`

## Global Constraints

- 实测依据：`idx_traj_turn_ttl ON trajectory_turns(created_at)` 索引**已存在**（`gateway/src/memory/gateway-db.ts:121`），窗口查询无需新建索引（spec 中"新增索引"一步作废）
- `trajectory_events` 的 prune 不在本次范围，保持现状
- 桌面 UI 禁止裸 `<button>`/`<input>`/裸 `title`，一律 `@opencode-ai/ui/v2/*`；Tooltip 统一 `openDelay: 300`
- gateway 测试：`cd gateway && npx jest tests/unit/<file> --runInBand`
- 桌面 typecheck：`cd opencode-dev/packages/desktop && npm run typecheck`
- 全量构建：repo 根 `npm run build`
- commit 风格：conventional（如 `feat(gateway): ...`），一个 task 一个 commit
- 路由 fail-open：聚合异常不影响 `/api/usage` 其他字段

---

### Task 1: trajectory 保留期配置化

**Files:**
- Modify: `gateway/src/config.ts`（interface ~L163 后、defaults ~L363 后、getter ~L499 后）
- Modify: `gateway/src/trajectory/collector.ts:45-49,106-108`
- Modify: `gateway/src/index.ts:1707`
- Test: `gateway/tests/unit/trajectory-retention.test.ts`

**Interfaces:**
- Produces: `config.trajectory.retentionDays: number`（默认 365，0=永久）；`resolveRetentionDays(v: number | undefined): number`（从 collector.ts 导出）

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/trajectory-retention.test.ts
import { resolveRetentionDays } from '../../src/trajectory/collector';

describe('resolveRetentionDays', () => {
  test('valid positive passes through (floored)', () => {
    expect(resolveRetentionDays(30)).toBe(30);
    expect(resolveRetentionDays(30.9)).toBe(30);
  });
  test('zero means keep forever', () => {
    expect(resolveRetentionDays(0)).toBe(0);
  });
  test('invalid falls back to 365', () => {
    expect(resolveRetentionDays(-5)).toBe(365);
    expect(resolveRetentionDays(NaN)).toBe(365);
    expect(resolveRetentionDays(undefined)).toBe(365);
    expect(resolveRetentionDays(Infinity)).toBe(365);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/trajectory-retention.test.ts --runInBand`
Expected: FAIL — `resolveRetentionDays is not a function` / module has no export

- [ ] **Step 3: Implement**

`gateway/src/trajectory/collector.ts` — 文件顶部（`truncate` 函数后）加：

```ts
export function resolveRetentionDays(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 365;
  return Math.floor(v);
}
```

构造函数加第 4 参（带默认值，兼容现有测试）：

```ts
  constructor(
    private store: TrajectoryStore,
    private db: GatewayDatabase,
    private projectID: string,
    private getRetentionDays: () => number = () => 14,
  ) {}
```

`emit()` 内（L107）替换硬编码：

```ts
    this.store.recordEvent(evt);
    const days = resolveRetentionDays(this.getRetentionDays());
    if (days > 0) this.store.pruneOlderThan(days);
    return evt as TrajectoryEvent;
```

`gateway/src/config.ts` 三处：

interface（`usage: {...}` 块之后）：

```ts
  trajectory: {
    retentionDays: number;
  };
```

defaults（`usage: {...}` 块之后）：

```ts
    trajectory: {
      retentionDays: 365,
    },
```

getter（`get usage()` 之后）：

```ts
  get trajectory() { return this.data.trajectory; }
```

`gateway/src/index.ts:1707`：

```ts
      const collector = new TrajectoryCollector(trajStore, this.getGatewayDb(), projectDir, () => config.trajectory.retentionDays);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway; npx jest tests/unit/trajectory-retention.test.ts --runInBand`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/config.ts gateway/src/trajectory/collector.ts gateway/src/index.ts gateway/tests/unit/trajectory-retention.test.ts
git commit -m "feat(gateway): make trajectory retention configurable (trajectory.retentionDays, default 365)"
```

---

### Task 2: TrajectoryStore.getModelUsageStats

**Files:**
- Modify: `gateway/src/trajectory/types.ts`
- Modify: `gateway/src/trajectory/trajectory-store.ts`（`getDistinctProviders` 后追加）
- Test: `gateway/tests/unit/trajectory-model-stats.test.ts`

**Interfaces:**
- Consumes: `GatewayDatabase`（tmp 文件构造，参考 `gateway/tests/unit/outcome-recorder.test.ts`）
- Produces:
  ```ts
  interface ModelUsageRow {
    provider: string | null;
    model: string;
    turns: number;
    tokens: TokenCounts;  // { input, output, reasoning, cache: { read, write } }
  }
  TrajectoryStore.getModelUsageStats(sinceEpochSec: number | null): ModelUsageRow[]
  // null = 全部时间；按 token 总量降序；model IS NULL 的行排除
  ```

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/trajectory-model-stats.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { TrajectoryStore } from '../../src/trajectory/trajectory-store';

describe('getModelUsageStats', () => {
  let db: GatewayDatabase;
  let tmpDir: string;
  let store: TrajectoryStore;

  const insertTurn = (opts: {
    sessionID: string; turnID: number; model?: string | null;
    provider?: string | null; tokens?: any; ageSec?: number;
  }) => {
    store.upsertTurn({
      projectID: 'p1',
      sessionID: opts.sessionID,
      turnID: opts.turnID,
      turnStartMs: Date.now(),
      turnEndMs: Date.now(),
      durationMs: 1000,
      toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
      tokens: opts.tokens ?? { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      finish: 'stop',
      model: opts.model === undefined ? 'mimo-v2.5' : opts.model,
      provider: opts.provider === undefined ? 'xiaomi' : opts.provider,
      agent: 'build',
      userText: 'hi',
    } as any);
    if (opts.ageSec) {
      const created = Math.floor(Date.now() / 1000) - opts.ageSec;
      (db as any).db
        .prepare('UPDATE trajectory_turns SET created_at = ? WHERE session_id = ? AND turn_id = ?')
        .run(created, opts.sessionID, opts.turnID);
    }
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-stats-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
    store = new TrajectoryStore(db, 'p1');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('aggregates per provider+model, sorted by total tokens desc', () => {
    insertTurn({ sessionID: 's1', turnID: 1, tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } } });
    insertTurn({ sessionID: 's1', turnID: 2, tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } });
    insertTurn({ sessionID: 's2', turnID: 1, model: 'qwen3.7-max', provider: 'alibaba-cn', tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } } });

    const rows = store.getModelUsageStats(null);
    expect(rows).toHaveLength(2);
    expect(rows[0].model).toBe('qwen3.7-max'); // 1500 > 467
    expect(rows[1].model).toBe('mimo-v2.5');
    expect(rows[1].turns).toBe(2);
    expect(rows[1].tokens).toEqual({ input: 300, output: 150, reasoning: 10, cache: { read: 5, write: 2 } });
    expect(rows[0].provider).toBe('alibaba-cn');
  });

  test('window filter excludes old turns; null means all', () => {
    insertTurn({ sessionID: 's1', turnID: 1, ageSec: 10 * 86400 });
    insertTurn({ sessionID: 's1', turnID: 2 });

    const recent = store.getModelUsageStats(Math.floor(Date.now() / 1000) - 7 * 86400);
    expect(recent).toHaveLength(1);
    expect(recent[0].turns).toBe(1);

    const all = store.getModelUsageStats(null);
    expect(all[0].turns).toBe(2);
  });

  test('null tokens and null model handled', () => {
    insertTurn({ sessionID: 's1', turnID: 1, tokens: null as any });
    insertTurn({ sessionID: 's1', turnID: 2, model: null });

    const rows = store.getModelUsageStats(null);
    expect(rows).toHaveLength(1); // model=null 行被排除
    expect(rows[0].tokens.input).toBe(0);
  });
});
```

注：`upsertTurn` 传 `tokens: null` 会走 `JSON.stringify(null)` 存 `'null'`，`json_extract('null','$.input')` 为 NULL，`SUM` 忽略 NULL → 聚合为 0。第三条断言依赖此行为。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/trajectory-model-stats.test.ts --runInBand`
Expected: FAIL — `store.getModelUsageStats is not a function`

- [ ] **Step 3: Implement**

`gateway/src/trajectory/types.ts` 追加：

```ts
export interface ModelUsageRow {
  provider: string | null;
  model: string;
  turns: number;
  tokens: TokenCounts;
}
```

`gateway/src/trajectory/trajectory-store.ts` — import 行加 `ModelUsageRow`，类尾（`getDistinctProviders` 之后）加：

```ts
  getModelUsageStats(sinceEpochSec: number | null): ModelUsageRow[] {
    const rows = this.rawDb
      .prepare(
        `SELECT provider, model, COUNT(*) AS turns,
                SUM(CAST(json_extract(tokens,'$.input') AS INTEGER)) AS input,
                SUM(CAST(json_extract(tokens,'$.output') AS INTEGER)) AS output,
                SUM(CAST(json_extract(tokens,'$.reasoning') AS INTEGER)) AS reasoning,
                SUM(CAST(json_extract(tokens,'$.cache.read') AS INTEGER)) AS cache_read,
                SUM(CAST(json_extract(tokens,'$.cache.write') AS INTEGER)) AS cache_write
         FROM trajectory_turns
         WHERE model IS NOT NULL${sinceEpochSec !== null ? ' AND created_at >= ?' : ''}
         GROUP BY provider, model
         ORDER BY (COALESCE(input,0)+COALESCE(output,0)+COALESCE(reasoning,0)+COALESCE(cache_read,0)+COALESCE(cache_write,0)) DESC`,
      )
      .all(...(sinceEpochSec !== null ? [sinceEpochSec] : [])) as any[];
    return rows.map((r) => ({
      provider: r.provider ?? null,
      model: r.model,
      turns: r.turns,
      tokens: {
        input: r.input || 0,
        output: r.output || 0,
        reasoning: r.reasoning || 0,
        cache: { read: r.cache_read || 0, write: r.cache_write || 0 },
      },
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway; npx jest tests/unit/trajectory-model-stats.test.ts --runInBand`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/trajectory/types.ts gateway/src/trajectory/trajectory-store.ts gateway/tests/unit/trajectory-model-stats.test.ts
git commit -m "feat(gateway): add getModelUsageStats (GROUP BY provider+model with time window)"
```

---

### Task 3: /api/usage modelStats（成本估算 + 路由 + SDK 类型）

**Files:**
- Create: `gateway/src/usage/model-stats.ts`
- Modify: `gateway/src/index.ts`（顶部 import + /api/usage handler L4282-4305）
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts:163-171`
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts:42-46`
- Test: `gateway/tests/unit/usage-model-stats.test.ts`

**Interfaces:**
- Consumes: `TrajectoryStore.getModelUsageStats`（Task 2）；`getModelPrice` / `calculateCost`（`gateway/src/usage/model-prices.ts`，已存在）
- Produces:
  ```ts
  interface ModelUsageRowWithCost extends ModelUsageRow { estimatedCost: number | null }
  interface ModelUsageWindows { today: ModelUsageRowWithCost[]; '7d': ModelUsageRowWithCost[]; '30d': ModelUsageRowWithCost[]; all: ModelUsageRowWithCost[] }
  buildModelStats(store: TrajectoryStore, nowMs?: number): ModelUsageWindows
  ```
  `/api/usage` 响应新增顶层字段 `modelStats: ModelUsageWindows`（异常时四窗口空数组）。

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/usage-model-stats.test.ts
import { buildModelStats } from '../../src/usage/model-stats';

const ROW = (model: string, input = 1000, output = 500) => ({
  provider: 'xiaomi',
  model,
  turns: 2,
  tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
});

describe('buildModelStats', () => {
  test('attaches estimatedCost for priced models, null for unknown', () => {
    const store = { getModelUsageStats: () => [ROW('mimo-v2.5'), ROW('totally-unknown-model')] } as any;
    const stats = buildModelStats(store);
    expect(stats.all[0].estimatedCost).toBeCloseTo((1000 / 1e6) * 0.10 + (500 / 1e6) * 0.30, 6);
    expect(stats.all[1].estimatedCost).toBeNull();
  });

  test('four windows computed with correct cutoffs', () => {
    const now = new Date('2026-09-07T15:30:00').getTime(); // local time
    const seen: (number | null)[] = [];
    const store = { getModelUsageStats: (since: number | null) => { seen.push(since); return []; } } as any;
    buildModelStats(store, now);

    const localMidnight = new Date(now);
    localMidnight.setHours(0, 0, 0, 0);
    expect(seen[0]).toBe(Math.floor(localMidnight.getTime() / 1000)); // today = 本地零点
    expect(seen[1]).toBe(Math.floor(now / 1000) - 7 * 86400);
    expect(seen[2]).toBe(Math.floor(now / 1000) - 30 * 86400);
    expect(seen[3]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/usage-model-stats.test.ts --runInBand`
Expected: FAIL — Cannot find module '../../src/usage/model-stats'

- [ ] **Step 3: Implement**

`gateway/src/usage/model-stats.ts`（新文件）：

```ts
import { TrajectoryStore } from '../trajectory/trajectory-store';
import { ModelUsageRow } from '../trajectory/types';
import { getModelPrice, calculateCost } from './model-prices';

export interface ModelUsageRowWithCost extends ModelUsageRow {
  estimatedCost: number | null;
}

export interface ModelUsageWindows {
  today: ModelUsageRowWithCost[];
  '7d': ModelUsageRowWithCost[];
  '30d': ModelUsageRowWithCost[];
  all: ModelUsageRowWithCost[];
}

function withCost(rows: ModelUsageRow[]): ModelUsageRowWithCost[] {
  return rows.map((r) => ({
    ...r,
    estimatedCost: getModelPrice(r.model) ? calculateCost(r.model, r.tokens) : null,
  }));
}

export function buildModelStats(store: TrajectoryStore, nowMs: number = Date.now()): ModelUsageWindows {
  const nowSec = Math.floor(nowMs / 1000);
  const localMidnight = new Date(nowMs);
  localMidnight.setHours(0, 0, 0, 0);
  return {
    today: withCost(store.getModelUsageStats(Math.floor(localMidnight.getTime() / 1000))),
    '7d': withCost(store.getModelUsageStats(nowSec - 7 * 86400)),
    '30d': withCost(store.getModelUsageStats(nowSec - 30 * 86400)),
    all: withCost(store.getModelUsageStats(null)),
  };
}
```

`gateway/src/index.ts` — 顶部 import 区（如 L83 附近）加：

```ts
import { buildModelStats, ModelUsageWindows } from './usage/model-stats';
```

`/api/usage` handler（L4296-4298 之间）插入：

```ts
            let modelStats: ModelUsageWindows = { today: [], '7d': [], '30d': [], all: [] };
            if (store) {
              try {
                modelStats = buildModelStats(store);
              } catch (err: any) {
                log.warn(`[Usage] modelStats failed: ${err.message}`);
              }
            }
```

响应行改为：

```ts
            res.end(JSON.stringify({ summary, memory, modelStats, ...providerData }));
```

`opencode-dev/packages/gateway-sdk/src/client.ts` — `usage` 方法返回类型（L163-165）改为：

```ts
    usage: async (
      params?: { sessionID?: string; projectID?: string },
    ): Promise<{
      summary: any;
      memory: any;
      providers: any[];
      modelStats?: {
        today: ModelUsageStat[];
        '7d': ModelUsageStat[];
        '30d': ModelUsageStat[];
        all: ModelUsageStat[];
      };
      updatedAt: number;
    }> => {
```

并在 `client.ts` 顶部（其他 export 附近）导出：

```ts
export interface ModelUsageStat {
  provider: string | null;
  model: string;
  turns: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  estimatedCost: number | null;
}
```

`opencode-dev/packages/desktop/src/preload/mafw-types.ts` — `usage` 返回类型（L42-46）改为：

```ts
    usage: (sessionID?: string, projectID?: string) => Promise<{
      summary: { session: any; project: any; global: any }
      providers: any[]
      modelStats?: {
        today: ModelUsageStatRow[]
        '7d': ModelUsageStatRow[]
        '30d': ModelUsageStatRow[]
        all: ModelUsageStatRow[]
      }
      updatedAt: number
    }>
```

并在 `mafw-types.ts` 顶部加：

```ts
type ModelUsageStatRow = {
  provider: string | null
  model: string
  turns: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  estimatedCost: number | null
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd gateway; npx jest tests/unit/usage-model-stats.test.ts tests/unit/trajectory-model-stats.test.ts --runInBand`
Expected: PASS (5 tests total)

Run: `npm run build`（repo 根，含 gateway tsc）
Expected: 构建成功

Run: `cd opencode-dev/packages/desktop; npm run typecheck`
Expected: 通过（desktop renderer 组件多为 `// @ts-nocheck`，此步主要验证 preload/SDK 类型）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/usage/model-stats.ts gateway/src/index.ts gateway/tests/unit/usage-model-stats.test.ts opencode-dev/packages/gateway-sdk/src/client.ts opencode-dev/packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(gateway): /api/usage modelStats with per-model windows and price-table cost estimates"
```

---

### Task 4: 配额窗口拆为 QuotaDock（新 tab）

**Files:**
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/components/QuotaDock.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx`（删 ProviderSection 区块与相关 helper/props）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/RightDock.tsx:9-23`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx:1610-1617,1822,2248-2257`

**Interfaces:**
- Consumes: 现有 `window.api.mafw.sessions.usage()` 的 `providers` 字段
- Produces: RightDock tab 类型 `"tasks" | "trajectory" | "usage" | "quota"`；`QuotaDock(props: { modelGroups: () => { provider: string; providerID: string; models: { id: string; contextK?: number }[] }[] })`

- [ ] **Step 1: 创建 QuotaDock.tsx**

从 `UsageDock.tsx` **整体搬走**以下内容到新文件（代码原样，仅组件名与标题不同）：
- `fmtTime`（L72-81）、`pacingIcon`（L83-87）、`severityClass`（L89-94）、`ProviderSection`（L189-260）——四个代码块从 UsageDock.tsx 原样剪切到 QuotaDock.tsx 顶部
- `fmt`（L7-11）在 UsageDock 中仍被 TokenStatRow 使用，QuotaDock 中**复制**一份（配额窗口 tokens 显示用到）
- 数据流：15s 轮询 `window.api.mafw.sessions.usage()` + `mafw:usage-config-saved` 监听 + `providerNames` memo（需要 `modelGroups` prop），见下方骨架

新组件骨架：

```tsx
// @ts-nocheck
import { createSignal, createMemo, createEffect, onMount, onCleanup, Show, For } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

// ……fmt / fmtTime / pacingIcon / severityClass / ProviderSection 从 UsageDock.tsx 原样复制……

export function QuotaDock(props: {
  modelGroups: () => { provider: string; providerID: string; models: { id: string; contextK?: number }[] }[]
}) {
  const [providers, setProviders] = createSignal<any[]>([])

  const fetchUsage = async () => {
    try {
      const r = await window.api.mafw.sessions.usage()
      setProviders(r?.providers || [])
    } catch (e: any) {
      console.warn("[QuotaDock] fetch failed:", e?.message)
    }
  }
  createEffect(() => { fetchUsage() })
  const timer = setInterval(fetchUsage, 15000)
  onCleanup(() => clearInterval(timer))
  onMount(() => {
    const handler = () => fetchUsage()
    window.addEventListener('mafw:usage-config-saved', handler)
    onCleanup(() => window.removeEventListener('mafw:usage-config-saved', handler))
  })

  const providerNames = createMemo(() => {
    const m = new Map<string, string>()
    for (const g of props.modelGroups()) {
      if (g.provider && g.provider !== g.providerID) m.set(g.providerID, g.provider)
    }
    return m
  })

  return (
    <div class="mafw-usage-dock">
      <div class="mafw-usage-dock-toolbar">
        <span class="mafw-usage-dock-title">配额</span>
        <ButtonV2 variant="ghost" size="small" onClick={() => {
          window.dispatchEvent(new CustomEvent('mafw:open-config', { detail: 'usage' }))
        }}>
          <Icon name="settings-gear" size="small" />
          配置
        </ButtonV2>
      </div>
      <Show when={providers().length > 0} fallback={
        <div class="mafw-usage-empty">
          <div class="mafw-usage-empty-icon">⏳</div>
          <div class="mafw-usage-empty-text">暂无配额数据</div>
          <div class="mafw-usage-empty-hint">在配置页启用用量插件后此处显示配额窗口</div>
        </div>
      }>
        <div class="mafw-usage-section">
          <For each={providers()}>
            {(provider: any) => <ProviderSection provider={provider} displayName={providerNames().get(provider.name)} />}
          </For>
        </div>
      </Show>
    </div>
  )
}
```

- [ ] **Step 2: UsageDock 删配额区块**

`UsageDock.tsx` 中删除：
- L479-486 的「配额窗口」`<Show>` 区块（整个 providers For 循环）
- `ProviderSection` 组件（L189-260）及只被它使用的 helper：`fmtTime`、`pacingIcon`、`severityClass`
- `providerNames` memo（L310-316，只被 ProviderSection 用）
- UsageDock 的 `hasData()` 中 `d.providers` 判断（L345）改为只看 summary/memory：

```ts
  const hasData = () => {
    const d = apiData()
    if (!d) return false
    if (d.memory?.turnCount) return true
    return d.summary?.session?.turnCount || d.summary?.project?.turnCount || d.summary?.global?.turnCount
  }
```

UsageDock 的 props 不变（`modelGroups` 仍被 contextInfo 用）。

- [ ] **Step 3: RightDock 加 tab**

`RightDock.tsx`：两处类型签名 `"tasks" | "trajectory" | "usage"` 改为 `"tasks" | "trajectory" | "usage" | "quota"`，并加 trigger：

```tsx
              <TabsV2.Trigger value="usage">📈 用量</TabsV2.Trigger>
              <TabsV2.Trigger value="quota">⏳ 配额</TabsV2.Trigger>
```

- [ ] **Step 4: MafwShell 接线**

- L1610 `createSignal<"tasks" | "trajectory" | "usage">` 与 L1615 `applyRightDock` 的 tab 参数类型，同样加 `"quota"`
- 顶部 import 区加 `import { QuotaDock } from "./components/QuotaDock"`
- L1822 UsagePill 的 `onOpenUsage={() => applyRightDock(true, "usage")}` 改为 `applyRightDock(true, "quota")`
- L2248-2256 usage div 之后加：

```tsx
              <div style={{ display: rightDockTab() === "quota" ? "contents" : "none" }}>
                <QuotaDock modelGroups={modelGroups} />
              </div>
```

localStorage `mafw-right-dock-tab` 旧值仍是合法 union 成员，无需迁移。

- [ ] **Step 5: Typecheck + 构建 + commit**

Run: `cd opencode-dev/packages/desktop; npm run typecheck`
Expected: 通过

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/QuotaDock.tsx opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx opencode-dev/packages/desktop/src/renderer/mafw/components/RightDock.tsx opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): split quota windows into dedicated RightDock tab (QuotaDock)"
```

---

### Task 5: UsageDock 分模型统计 UI

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx`（Token 统计区块内追加）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`（usage 样式区，~L2715 之后追加）

**Interfaces:**
- Consumes: `/api/usage` 响应的 `modelStats.windows`（Task 3，preload 类型已就位）；TabsV2（`@opencode-ai/ui/v2/tabs-v2`，RightDock 同款 pill 用法）
- Produces: 无对外接口

- [ ] **Step 1: UsageDock 加分模型区块**

`UsageDock.tsx` 顶部 import 加 `TabsV2`：

```ts
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
```

类型与 helper（`roleColors` 之后插入）：

```tsx
type ModelWindow = 'today' | '7d' | '30d' | 'all'
type ModelStatRow = {
  provider: string | null
  model: string
  turns: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  estimatedCost: number | null
}

const modelTotal = (r: ModelStatRow): number =>
  r.tokens.input + r.tokens.output + r.tokens.reasoning + r.tokens.cache.read + r.tokens.cache.write

const modelCacheHit = (r: ModelStatRow): number => {
  const denom = r.tokens.input + r.tokens.cache.read
  return denom > 0 ? Math.round((r.tokens.cache.read / denom) * 100) : 0
}

function ModelStatsSection(props: { windows: Record<ModelWindow, ModelStatRow[]> | undefined }) {
  const [win, setWin] = createSignal<ModelWindow>('7d')
  const rows = createMemo<ModelStatRow[]>(() => props.windows?.[win()] || [])

  const kpi = createMemo(() => {
    let tokens = 0, cost = 0, cacheRead = 0, inputAll = 0
    for (const r of rows()) {
      tokens += modelTotal(r)
      cost += r.estimatedCost ?? 0
      cacheRead += r.tokens.cache.read
      inputAll += r.tokens.input + r.tokens.cache.read
    }
    return { tokens, cost, cacheHit: inputAll > 0 ? Math.round((cacheRead / inputAll) * 100) : 0 }
  })

  const items = createMemo(() => {
    const rs = rows()
    const grand = rs.reduce((s, r) => s + modelTotal(r), 0)
    const toItem = (name: string, tooltip: string, tokens: number, cost: number | null) => ({
      name, tooltip, tokens, cost,
      pct: grand > 0 ? (tokens / grand) * 100 : 0,
    })
    const top = rs.slice(0, 3).map((r) =>
      toItem(
        r.model,
        [
          r.provider ? `${r.provider}/${r.model}` : r.model,
          `输入 ${fmt(r.tokens.input)} · 输出 ${fmt(r.tokens.output)}` + (r.tokens.reasoning > 0 ? ` · 推理 ${fmt(r.tokens.reasoning)}` : ''),
          `缓存读 ${fmt(r.tokens.cache.read)} · 缓存写 ${fmt(r.tokens.cache.write)} · 命中率 ${modelCacheHit(r)}%`,
          `${r.turns} 回合`,
        ].join('\n'),
        modelTotal(r),
        r.estimatedCost,
      ),
    )
    const rest = rs.slice(3)
    if (rest.length === 0) return top
    const restTokens = rest.reduce((s, r) => s + modelTotal(r), 0)
    const restCost = rest.reduce((s, r) => s + (r.estimatedCost ?? 0), 0)
    const restCostKnown = rest.some((r) => r.estimatedCost !== null)
    top.push(toItem(`其他 ${rest.length} 个模型`, rest.map((r) => r.model).join('\n'), restTokens, restCostKnown ? restCost : null))
    return top
  })

  return (
    <Show when={rows().length > 0}>
      <div class="mafw-usage-models">
        <div class="mafw-usage-models-head">
          <span class="mafw-usage-models-title">按模型</span>
          <TabsV2 value={win()} onChange={(v: string) => setWin(v as ModelWindow)} variant="pill">
            <TabsV2.List class="mafw-usage-models-tabs">
              <TabsV2.Trigger value="today">今日</TabsV2.Trigger>
              <TabsV2.Trigger value="7d">7天</TabsV2.Trigger>
              <TabsV2.Trigger value="30d">30天</TabsV2.Trigger>
              <TabsV2.Trigger value="all">全部</TabsV2.Trigger>
            </TabsV2.List>
          </TabsV2>
        </div>
        <div class="mafw-usage-kpis">
          <div class="mafw-usage-kpi">
            <div class="mafw-usage-kpi-value">{fmt(kpi().tokens)}</div>
            <div class="mafw-usage-kpi-label">tokens</div>
          </div>
          <div class="mafw-usage-kpi">
            <div class="mafw-usage-kpi-value">{fmtCost(kpi().cost)}</div>
            <div class="mafw-usage-kpi-label">估算成本</div>
          </div>
          <div class="mafw-usage-kpi">
            <div class="mafw-usage-kpi-value">{kpi().cacheHit}%</div>
            <div class="mafw-usage-kpi-label">缓存命中</div>
          </div>
        </div>
        <For each={items()}>
          {(item) => (
            <TooltipV2 value={item.tooltip} openDelay={300}>
              <div class="mafw-usage-model">
                <div class="mafw-usage-model-head">
                  <span class="mafw-usage-model-name">{item.name}</span>
                  <span class="mafw-usage-model-tokens">{fmt(item.tokens)}</span>
                  <span class="mafw-usage-model-cost">{item.cost !== null ? fmtCost(item.cost) : '—'}</span>
                </div>
                <div class="mafw-usage-model-bar">
                  <div class="mafw-usage-model-bar-fill" style={{ width: `${item.pct}%` }} />
                </div>
                <span class="mafw-usage-model-pct">{Math.round(item.pct)}%</span>
              </div>
            </TooltipV2>
          )}
        </For>
      </div>
    </Show>
  )
}
```

挂载点：「Token 统计」section 内、记忆系统 `</Show>` 之后（即原 L474-476 之间）：

```tsx
            <ModelStatsSection windows={apiData()?.modelStats?.windows} />
```

`apiData` 的 signal 类型（L271-276）补 `modelStats?: { windows: Record<'today' | '7d' | '30d' | 'all', ModelStatRow[]> }`。

- [ ] **Step 2: CSS（mafw.css usage 区追加）**

```css
.mafw-usage-models {
  margin-top: 8px;
  border-top: 1px solid var(--border-1, rgba(255, 255, 255, 0.08));
  padding-top: 8px;
}

.mafw-usage-models-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.mafw-usage-models-title {
  font-size: 11px;
  color: var(--text-3, #888);
}

.mafw-usage-models-tabs {
  transform: scale(0.85);
  transform-origin: right center;
}

.mafw-usage-kpis {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  margin-bottom: 8px;
}

.mafw-usage-kpi {
  background: var(--bg-2, rgba(255, 255, 255, 0.03));
  border-radius: 6px;
  padding: 6px 8px;
  text-align: center;
}

.mafw-usage-kpi-value {
  font-size: 14px;
  font-weight: 600;
}

.mafw-usage-kpi-label {
  font-size: 10px;
  color: var(--text-3, #888);
  margin-top: 2px;
}

.mafw-usage-model {
  display: grid;
  grid-template-columns: 1fr 60px 24px;
  grid-template-areas:
    "head head head"
    "bar bar pct";
  align-items: center;
  column-gap: 6px;
  padding: 3px 0;
}

.mafw-usage-model-head {
  grid-area: head;
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.mafw-usage-model-name {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.mafw-usage-model-tokens {
  font-size: 11px;
  color: var(--text-2, #aaa);
}

.mafw-usage-model-cost {
  font-size: 11px;
  color: var(--text-3, #888);
}

.mafw-usage-model-bar {
  grid-area: bar;
  height: 3px;
  background: var(--bg-3, rgba(255, 255, 255, 0.06));
  border-radius: 2px;
  overflow: hidden;
}

.mafw-usage-model-bar-fill {
  height: 100%;
  background: var(--accent, #3b82f6);
  opacity: 0.7;
}

.mafw-usage-model-pct {
  grid-area: pct;
  font-size: 10px;
  color: var(--text-3, #888);
  text-align: right;
}
```

CSS 变量名先 grep `mafw.css` 确认现有变量（`--text-3`/`--accent` 等在现有 usage 样式里的实际命名），以文件内已有变量为准，fallback 值保留。

- [ ] **Step 3: Typecheck + commit**

Run: `cd opencode-dev/packages/desktop; npm run typecheck`
Expected: 通过

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): per-model token stats with KPI row and time windows in UsageDock"
```

---

### Task 6: 文档与全量验证

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-09-07-usage-token-stats-design.md`（索引修正）

- [ ] **Step 1: AGENTS.md 更新**

- §5.20 中「豁免 trajectory 14 天 prune」改为「豁免 trajectory prune（保留期 `trajectory.retentionDays`，默认 365 天，0=永久）」
- §3 之后或 §5 合适位置补一句：`/api/usage` 响应含 `modelStats.windows{today,7d,30d,all}`（GROUP BY provider+model 现算，成本经 model-prices.ts 估算，无价目模型 `estimatedCost: null`）
- RightDock 说明（§5.5/5.6 附近）补 `quota` tab

- [ ] **Step 2: spec 索引修正**

spec 数据层一节「新增索引」改为注明：`idx_traj_turn_ttl(created_at)` 已存在（gateway-db.ts:121），无需新建。

- [ ] **Step 3: 全量验证**

Run: `cd gateway; npx jest tests/unit/trajectory-retention.test.ts tests/unit/trajectory-model-stats.test.ts tests/unit/usage-model-stats.test.ts --runInBand`
Expected: 全 PASS

Run: `npm run build`（repo 根）
Expected: 构建成功

Run: `cd opencode-dev/packages/desktop; npm run typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-09-07-usage-token-stats-design.md
git commit -m "docs: trajectory retention config + /api/usage modelStats + quota tab"
```
